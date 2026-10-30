import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { rm, stat, statfs, writeFile } from 'node:fs/promises';
import {
  CompressionCancelledError,
  MAX_BITRATE_RETRIES,
  MAX_OUTPUT_BYTES,
  adjustBitrateForOvershoot,
  blueprintForDegradationPass,
  canFitUnderCap,
  deleteSegmentsToKeepSegments,
  formatBytes,
  mergeTrimSegments,
  resolveMaxOutputBytes,
  validateDeleteSegments,
  type BitrateCalculation,
  type TrimSegment,
  type VideoProbeMetadata,
} from '../../../../v4/apps/web/lib/squish-core';
import { DEGRADATION_PASSES } from '../../../../v4/apps/web/lib/squish-core/bitrate';
import { TOO_LARGE_PREFIX, type NativeJob, type NativeJobProgress } from './contracts';

export interface ProbeResult extends VideoProbeMetadata {
  /** Stream index of the main picture (cover art is skipped). */
  videoStream: number;
  videoCodec: string;
  /** Stream index of the first audio track, or null. */
  audioStream: number | null;
  audioCodec: string | null;
  /** Codec parameters that must match for clips to be joined without re-encoding. */
  copySignature: string;
}

export interface JobOutput {
  /** File holding the result: a temp encode, or the source when no encode was needed. */
  path: string;
  filename: string;
  originalSize: number;
  compressedSize: number;
  skippedEncode: boolean;
  encodeTimeMs: number;
  clipCount?: number;
  trimSegmentCount?: number;
}

/** One FFmpeg input: a file, or only part of it, so the rest is never decoded. */
interface EncodeInput {
  path: string;
  startSec?: number;
  durationSec?: number;
  /** Decode on the GPU (see wantsHardwareDecode). */
  hardwareDecode: boolean;
}

/** What one FFmpeg run reads: inputs plus a filtergraph ending in [srcv]. */
interface EncodeSource {
  inputs: EncodeInput[];
  filter: string;
  /** Audio to map: a filtergraph label, an input stream, or none. */
  audio: string | null;
  durationSeconds: number;
  sourceBytes: number;
}

type ProgressReporter = (progress: Omit<NativeJobProgress, 'jobId'>) => void;

interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

const MERGE_MAX_DIMENSION = 1920;
const MAX_OUTPUT_DIMENSION = 1920;
const MERGE_FPS = 30;
// One encode attempt at a time plus the previous one's file during the size check.
// Sized for the default cap: a smaller cap needs less, and it is only a guard.
const REQUIRED_FREE_BYTES = 2 * MAX_OUTPUT_BYTES + 100 * 1024 * 1024;
const KILL_GRACE_MS = 3000;
const MIN_CAPPED_VIDEO_BPS = 300_000;
// A trim is copied without re-encoding only if every cut moves this little.
const KEYFRAME_SNAP_SECONDS = 0.5;
// Codecs that copy into MP4 as they are.
const COPYABLE_VIDEO = ['h264', 'hevc'];
const COPYABLE_AUDIO = ['aac', 'mp3', 'alac', 'ac3', 'eac3'];
const HARDWARE_DECODER = process.platform === 'darwin' ? 'videotoolbox' : process.platform === 'win32' ? 'd3d11va' : null;
// A GPU decoder that cannot handle a video (large H.264 screen recordings on
// VideoToolbox) fails frame by frame, yet FFmpeg carries on and exits cleanly
// with an audio-only file; on these lines the encode stops and decodes in
// software instead.
const HARDWARE_DECODE_FAILED = /hardware accelerator failed|Error while decoding stream/i;
// A result is only accepted with a picture at least this share of the job's
// length. Not the whole length: a source's video can end well before its
// audio, and a mid-way decode failure is caught on stderr anyway.
const MIN_PICTURE_SHARE = 0.5;

/**
 * Phone video (HEVC, often 4K) is slow to decode in software: decoding alone
 * took 24 of the 27 seconds of a 4K trim, and the GPU halves it. 1080p H.264
 * decodes faster on the CPU, so it stays there.
 */
function wantsHardwareDecode(probe: ProbeResult): boolean {
  return HARDWARE_DECODER !== null && (probe.videoCodec === 'hevc' || probe.width * probe.height > 1920 * 1080);
}

/** The GPU decoder gave up on this video; the encode is retried in software. */
class HardwareDecodeError extends Error {}

/** One file in a copy join, optionally only from inpoint to outpoint. */
interface CopyPart {
  path: string;
  inpoint?: number;
  outpoint?: number;
}

export class FfmpegJobs {
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  constructor(private readonly binary: (name: 'ffmpeg' | 'ffprobe') => string) {}

  cancel(): void {
    this.cancelled = true;
    const child = this.activeProcess;
    if (!child) return;
    child.kill('SIGTERM');
    // FFmpeg can hang on a stalled input; make sure it goes.
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, KILL_GRACE_MS).unref();
  }

  async probe(path: string): Promise<ProbeResult> {
    const stdout = await this.capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]);
    const metadata = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string };
      streams?: FfprobeStream[];
    };
    const streams = metadata.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    const audio = streams.find((s) => s.codec_type === 'audio') ?? null;
    const duration = Number(metadata.format?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('The selected file does not contain a readable video stream.');
    }

    // FFmpeg rotates frames on decode, so report the size as it will be shown.
    const rotation = Math.abs(Number(video.tags?.rotate ?? video.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0)) % 180;
    const [width, height] = rotation === 90 ? [video.height ?? 0, video.width ?? 0] : [video.width ?? 0, video.height ?? 0];

    return {
      name: basename(path),
      size: Number(metadata.format?.size) || (await stat(path)).size,
      duration,
      width,
      height,
      videoStream: video.index,
      videoCodec: video.codec_name ?? '',
      audioStream: audio?.index ?? null,
      audioCodec: audio?.codec_name ?? null,
      copySignature: JSON.stringify([
        video.codec_name, video.profile, video.width, video.height, video.pix_fmt, video.r_frame_rate, rotation,
        audio?.codec_name ?? null, audio?.sample_rate ?? null, audio?.channels ?? null,
      ]),
    };
  }

  async run(job: NativeJob, outputPath: string, report: ProgressReporter): Promise<JobOutput> {
    this.cancelled = false;
    report({ stage: 'preparing', ratio: 0 });
    const maxOutputBytes = resolveMaxOutputBytes(job.maxOutputBytes);

    if (job.kind === 'compress') {
      const probe = await this.probe(job.path);
      const extension = extname(job.path);
      const base = basename(job.path, extension);
      if (probe.size <= maxOutputBytes) {
        return {
          path: job.path,
          filename: `${base}_compressed${extension}`,
          originalSize: probe.size,
          compressedSize: probe.size,
          skippedEncode: true,
          encodeTimeMs: 0,
        };
      }
      return this.encode(compressSource(job.path, probe), outputPath, `${base}_compressed.mp4`, maxOutputBytes, report);
    }

    if (job.kind === 'trim') {
      const probe = await this.probe(job.path);
      const deleteSegments = mergeTrimSegments(job.deleteSegments);
      const invalid = validateDeleteSegments(deleteSegments, probe.duration);
      if (invalid) throw new Error(`The sections to delete are not valid (${invalid}).`);
      const keeps = deleteSegmentsToKeepSegments(deleteSegments, probe.duration);
      const base = basename(job.path, extname(job.path));
      const filename = `${base}_trimmed_compressed.mp4`;
      const output = (await this.trimByCopy(job.path, probe, keeps, outputPath, filename, maxOutputBytes, report))
        ?? (await this.encode(trimSource(job.path, probe, keeps), outputPath, filename, maxOutputBytes, report));
      return { ...output, originalSize: probe.size, trimSegmentCount: deleteSegments.length };
    }

    if (job.paths.length < 2) throw new Error('Select at least two videos to merge.');
    const probes: ProbeResult[] = [];
    for (const path of job.paths) {
      this.throwIfCancelled();
      probes.push(await this.probe(path));
      report({ stage: 'preparing', ratio: probes.length / job.paths.length });
    }
    const base = basename(job.paths[0], extname(job.paths[0]));
    const filename = `${base}_merged_compressed.mp4`;
    const copied = await this.mergeByCopy(job.paths, probes, outputPath, filename, maxOutputBytes, report);
    const output = copied ?? (await this.encode(mergeSource(job.paths, probes), outputPath, filename, maxOutputBytes, report));
    return { ...output, clipCount: job.paths.length };
  }

  /**
   * Clips from the same camera or export share codec settings and can be joined
   * as they are: lossless and seconds instead of minutes. Returns null when the
   * clips differ, the result would be over the cap, or the join looks wrong.
   */
  private async mergeByCopy(
    paths: string[],
    probes: ProbeResult[],
    outputPath: string,
    filename: string,
    maxOutputBytes: number,
    report: ProgressReporter,
  ): Promise<JobOutput | null> {
    const totalBytes = probes.reduce((sum, probe) => sum + probe.size, 0);
    const signatures = new Set(probes.map((probe) => probe.copySignature));
    const copyableCodec = COPYABLE_VIDEO.includes(probes[0].videoCodec);
    if (signatures.size !== 1 || !copyableCodec || totalBytes > maxOutputBytes * 0.98) return null;
    const expectedDuration = probes.reduce((sum, probe) => sum + probe.duration, 0);
    return this.copyJoin(paths.map((path) => ({ path })), expectedDuration, totalBytes, outputPath, filename, maxOutputBytes, report);
  }

  /**
   * A trim that already fits under the cap is copied as it is: lossless, and
   * about a second instead of a full encode. A copy can only start at a
   * keyframe, so each cut moves to the nearest keyframe, and only if that is
   * within KEYFRAME_SNAP_SECONDS; otherwise (or for other codecs) returns null
   * and the trim is encoded with exact cuts.
   */
  private async trimByCopy(
    path: string,
    probe: ProbeResult,
    keeps: TrimSegment[],
    outputPath: string,
    filename: string,
    maxOutputBytes: number,
    report: ProgressReporter,
  ): Promise<JobOutput | null> {
    const keptSeconds = keeps.reduce((sum, keep) => sum + keep.endSec - keep.startSec, 0);
    const copyable = COPYABLE_VIDEO.includes(probe.videoCodec) &&
      (probe.audioCodec === null || COPYABLE_AUDIO.includes(probe.audioCodec));
    if (!copyable || probe.size * (keptSeconds / probe.duration) > maxOutputBytes * 0.98) return null;

    const parts: CopyPart[] = [];
    for (const { startSec, endSec } of keeps) {
      const inpoint = startSec > 0 ? await this.keyframeNear(path, probe, startSec) : 0;
      if (inpoint === null) return null;
      parts.push({ path, inpoint, outpoint: endSec < probe.duration ? endSec : undefined });
    }
    const expectedDuration = parts.reduce((sum, part) => sum + (part.outpoint ?? probe.duration) - (part.inpoint ?? 0), 0);
    const output = await this.copyJoin(parts, expectedDuration, probe.size, outputPath, filename, maxOutputBytes, report);
    return output && { ...output, originalSize: probe.size };
  }

  /** The keyframe nearest to seconds, if one is within KEYFRAME_SNAP_SECONDS. */
  private async keyframeNear(path: string, probe: ProbeResult, seconds: number): Promise<number | null> {
    const stdout = await this.capture('ffprobe', [
      '-v', 'error', '-select_streams', `${probe.videoStream}`,
      '-read_intervals', `${Math.max(0, seconds - 2)}%${seconds + 1}`,
      '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', path,
    ]);
    let best: number | null = null;
    for (const line of stdout.split(/\r?\n/)) {
      const [time, flags] = line.split(',');
      const pts = Number(time);
      if (!flags?.includes('K') || !Number.isFinite(pts)) continue;
      if (Math.abs(pts - seconds) <= KEYFRAME_SNAP_SECONDS && (best === null || Math.abs(pts - seconds) < Math.abs(best - seconds))) {
        best = pts;
      }
    }
    return best;
  }

  /**
   * Joins parts by stream copy through FFmpeg's concat list. Returns null if
   * the result is over the cap or its length looks wrong (the job is then
   * encoded instead).
   */
  private async copyJoin(
    parts: CopyPart[],
    expectedDuration: number,
    originalSize: number,
    outputPath: string,
    filename: string,
    maxOutputBytes: number,
    report: ProgressReporter,
  ): Promise<JobOutput | null> {
    await this.assertFreeSpace(outputPath);
    const listPath = join(dirname(outputPath), `${basename(outputPath, '.mp4')}-concat.txt`);
    const list = parts.map((part) => [
      `file '${part.path.replaceAll("'", "'\\''")}'`,
      ...(part.inpoint ? [`inpoint ${part.inpoint}`] : []),
      ...(part.outpoint !== undefined ? [`outpoint ${part.outpoint}`] : []),
    ].join('\n')).join('\n');
    const started = Date.now();
    try {
      await writeFile(listPath, `${list}\n`, 'utf8');
      await this.runFfmpeg(
        [
          '-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
          '-f', 'concat', '-safe', '0', '-i', listPath,
          '-map', `0:v:0`, '-map', '0:a:0?', '-c', 'copy',
          '-movflags', '+faststart', outputPath,
        ],
        expectedDuration,
        (ratio) => report({ stage: 'encoding', ratio }),
      );
      const joined = await this.probe(outputPath);
      const tolerance = 0.5 + 0.25 * parts.length;
      if (joined.size > maxOutputBytes || Math.abs(joined.duration - expectedDuration) > tolerance) {
        await rm(outputPath, { force: true });
        return null;
      }
      return {
        path: outputPath,
        filename,
        originalSize,
        compressedSize: joined.size,
        skippedEncode: true,
        encodeTimeMs: Date.now() - started,
      };
    } catch (error) {
      await rm(outputPath, { force: true });
      if (error instanceof CompressionCancelledError) throw error;
      // Codec details the probe cannot see can still break a copy join; encode instead.
      return null;
    } finally {
      await rm(listPath, { force: true });
    }
  }

  /** Encodes down the degradation ladder until the file fits under the cap. */
  private async encode(
    source: EncodeSource,
    outputPath: string,
    filename: string,
    maxOutputBytes: number,
    report: ProgressReporter,
  ): Promise<JobOutput> {
    // The last tier drops the sound, so the video floor alone decides whether
    // any tier can fit; if not, say so now instead of after every tier.
    if (!canFitUnderCap(source.durationSeconds, maxOutputBytes, false)) {
      throw new Error(tooLargeMessage(maxOutputBytes));
    }
    await this.assertFreeSpace(outputPath);
    // Most jobs fit on the first try, so it fills most of the bar; a retry
    // fills most of what is left instead of the bar sitting still.
    let progressDone = 0;
    let progress = 0;
    // Every tier already aims its bitrate at the size cap, so the best tier is
    // tried first; the shared start-tier guess skips tiers by input size and
    // would shrink a short 4K clip to 360p that fits easily at full quality.
    let tier = 0;
    let retriesLeft = MAX_BITRATE_RETRIES;
    // Never spend more bits than the source has: a small or already-compressed
    // input would otherwise come out larger than it went in.
    const sourceBps = (source.sourceBytes * 8) / Math.max(source.durationSeconds, 1);
    const capToSource = (plan: BitrateCalculation): BitrateCalculation => ({
      ...plan,
      videoBitrateBps: Math.max(MIN_CAPPED_VIDEO_BPS, Math.min(plan.videoBitrateBps, sourceBps - plan.audioBitrateBps)),
    });
    let blueprint = capToSource(blueprintForDegradationPass(tier, source.durationSeconds, maxOutputBytes));
    let encodeTimeMs = 0;
    let hardwareDecode = source.inputs.some((input) => input.hardwareDecode);

    try {
      while (tier < DEGRADATION_PASSES.length) {
        this.throwIfCancelled();
        await rm(outputPath, { force: true });
        const started = Date.now();
        try {
          await this.runFfmpeg(
            encodeArgs(source, blueprint, outputPath, hardwareDecode),
            source.durationSeconds,
            (ratio) => {
              progress = progressDone + (1 - progressDone) * 0.9 * ratio;
              report({ stage: 'encoding', ratio: progress });
            },
            hardwareDecode ? HARDWARE_DECODE_FAILED : undefined,
          );
          await this.assertHasPicture(outputPath, source.durationSeconds, hardwareDecode);
        } catch (error) {
          if (!hardwareDecode || error instanceof CompressionCancelledError) throw error;
          // No GPU decoder for this video (or no GPU at all): decode in software.
          hardwareDecode = false;
          progress = progressDone;
          continue;
        }
        encodeTimeMs += Date.now() - started;
        progressDone = progress;
        report({ stage: 'finalizing', ratio: 0.5 });
        const { size } = await stat(outputPath);
        if (size <= maxOutputBytes) {
          return {
            path: outputPath,
            filename,
            originalSize: source.sourceBytes,
            compressedSize: size,
            skippedEncode: false,
            encodeTimeMs,
          };
        }

        if (retriesLeft > 0) {
          blueprint = adjustBitrateForOvershoot(blueprint, size, maxOutputBytes);
          retriesLeft -= 1;
          continue;
        }
        tier += 1;
        retriesLeft = MAX_BITRATE_RETRIES;
        if (tier < DEGRADATION_PASSES.length) {
          blueprint = capToSource(blueprintForDegradationPass(tier, source.durationSeconds, maxOutputBytes));
        }
      }
      throw new Error(tooLargeMessage(maxOutputBytes));
    } catch (error) {
      await rm(outputPath, { force: true });
      throw error;
    }
  }

  /**
   * Throws unless the encode has a picture through most of the job: decoding
   * can fail without FFmpeg failing, and the result must never be a file with
   * sound and no picture.
   */
  private async assertHasPicture(outputPath: string, expectedSeconds: number, hardwareDecode: boolean): Promise<void> {
    const stdout = await this.capture('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,duration', '-of', 'csv=p=0', outputPath,
    ]).catch(() => '');
    const [frames, seconds] = stdout.trim().split(',').map(Number);
    if (frames > 0 && seconds >= expectedSeconds * MIN_PICTURE_SHARE) return;
    if (hardwareDecode) throw new HardwareDecodeError('The GPU could not decode this video.');
    throw new Error('Squik could not read the picture of this video. Try exporting it again from the app that made it.');
  }

  private async assertFreeSpace(outputPath: string): Promise<void> {
    const { bavail, bsize } = await statfs(dirname(outputPath));
    if (bavail * bsize < REQUIRED_FREE_BYTES) {
      throw new Error('Not enough free disk space. Free up at least 500 MB and try again.');
    }
  }

  private capture(name: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary(name), args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-4000);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(friendlyFfmpegError(stderr, code)));
      });
    });
  }

  /** Runs FFmpeg; a stderr line matching failOn stops it and rejects. */
  private runFfmpeg(args: string[], durationSeconds: number, onRatio: (ratio: number) => void, failOn?: RegExp): Promise<void> {
    this.throwIfCancelled();
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary('ffmpeg'), args, { windowsHide: true });
      this.activeProcess = child;
      let stderr = '';
      let failed = false;
      let stdoutBuffer = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const [key, value] = line.split('=');
          // Both keys hold microseconds; out_time_ms is the older name.
          if (key !== 'out_time_us' && key !== 'out_time_ms') continue;
          const seconds = Number(value) / 1_000_000;
          if (Number.isFinite(seconds) && durationSeconds > 0) {
            onRatio(Math.min(0.995, Math.max(0, seconds / durationSeconds)));
          }
        }
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-6000);
        if (failOn && !failed && failOn.test(chunk)) {
          failed = true;
          child.kill('SIGKILL');
        }
      });
      child.once('error', (error) => {
        this.activeProcess = null;
        reject(error);
      });
      child.once('close', (code) => {
        this.activeProcess = null;
        if (this.cancelled) reject(new CompressionCancelledError());
        else if (failed) reject(new HardwareDecodeError(friendlyFfmpegError(stderr, code)));
        else if (code !== 0) reject(new Error(friendlyFfmpegError(stderr, code)));
        else resolve();
      });
    });
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new CompressionCancelledError();
  }
}

function tooLargeMessage(maxOutputBytes: number): string {
  return `${TOO_LARGE_PREFIX} ${formatBytes(maxOutputBytes)}. Try a shorter video or a lower-resolution source.`;
}

function friendlyFfmpegError(stderr: string, code: number | null): string {
  const lines = stderr.trim().split('\n').filter(Boolean);
  if (/No space left on device/i.test(stderr)) return 'The disk is full. Free up some space and try again.';
  if (/Invalid data found|moov atom not found|could not find codec/i.test(stderr)) {
    return 'This video file is damaged or uses a format Squik cannot read.';
  }
  return lines.slice(-3).join(' ') || `FFmpeg exited with code ${code}.`;
}

function encodeArgs(source: EncodeSource, blueprint: BitrateCalculation, outputPath: string, hardwareDecode: boolean): string[] {
  const videoBitrate = `${Math.round(blueprint.videoBitrateBps)}`;
  // Bound the long side, so portrait phone video shrinks like landscape does,
  // and never go above 1080p: at these bitrates 4K only looks worse.
  const maxSide = blueprint.isScalingNeeded ? blueprint.maxDimension : MAX_OUTPUT_DIMENSION;
  const scale =
    `scale=w=if(gte(iw\\,ih)\\,min(${maxSide}\\,iw)\\,-2):h=if(gte(iw\\,ih)\\,-2\\,min(${maxSide}\\,ih))` +
    ',scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1'];
  for (const input of source.inputs) {
    if (hardwareDecode && input.hardwareDecode && HARDWARE_DECODER) args.push('-hwaccel', HARDWARE_DECODER);
    // Input seeking: FFmpeg starts decoding at the keyframe before startSec and
    // stops after durationSec, still cutting frame-accurately.
    if (input.startSec) args.push('-ss', `${input.startSec}`);
    if (input.durationSec !== undefined) args.push('-t', `${input.durationSec}`);
    args.push('-i', input.path);
  }
  const keepAudio = source.audio !== null && blueprint.audioBitrateBps > 0;
  // A filtergraph audio label left unmapped must still be consumed.
  const dropAudio = !keepAudio && source.audio?.startsWith('[') ? `;${source.audio}anullsink` : '';
  args.push('-filter_complex', `${source.filter};[srcv]${scale},format=yuv420p[outv]${dropAudio}`, '-map', '[outv]');
  if (keepAudio) {
    args.push('-map', source.audio!, '-c:a', 'aac', '-b:a', `${Math.round(blueprint.audioBitrateBps)}`);
  } else {
    args.push('-an');
  }
  args.push(
    // superfast measured 28% faster than veryfast on a 10-minute 1080p lecture
    // at the same bitrate, for a quality difference SSIM barely registers.
    '-c:v', 'libx264',
    '-preset', 'superfast',
    '-profile:v', 'high',
    '-threads', '0',
    '-b:v', videoBitrate,
    '-maxrate', videoBitrate,
    '-bufsize', `${Math.round(blueprint.videoBitrateBps * 2)}`,
    // Sparse or late audio otherwise aborts with "Too many packets buffered".
    '-max_muxing_queue_size', '4096',
    // Keep each frame's own timing. Screen recordings are variable frame rate
    // (about 25 real frames a second, tagged 120), and the MP4 default of a
    // constant rate filled them out to 120 fps with repeated frames.
    '-vsync', 'vfr',
    '-map_chapters', '-1',
    '-movflags', '+faststart',
    outputPath,
  );
  return args;
}

function compressSource(path: string, probe: ProbeResult): EncodeSource {
  return {
    inputs: [{ path, hardwareDecode: wantsHardwareDecode(probe) }],
    filter: `[0:${probe.videoStream}]null[srcv]`,
    audio: probe.audioStream === null ? null : `0:${probe.audioStream}`,
    durationSeconds: probe.duration,
    sourceBytes: probe.size,
  };
}

function trimSource(path: string, probe: ProbeResult, keeps: TrimSegment[]): EncodeSource {
  const hasAudio = probe.audioStream !== null;
  const parts: string[] = [];
  const concatInputs: string[] = [];
  // Each kept part is its own seeked input, so the deleted parts are never decoded.
  keeps.forEach((_, i) => {
    parts.push(`[${i}:${probe.videoStream}]setpts=PTS-STARTPTS,setsar=1[v${i}]`);
    concatInputs.push(`[v${i}]`);
    if (hasAudio) {
      parts.push(`[${i}:${probe.audioStream}]asetpts=PTS-STARTPTS[a${i}]`);
      concatInputs.push(`[a${i}]`);
    }
  });
  parts.push(`${concatInputs.join('')}concat=n=${keeps.length}:v=1:a=${hasAudio ? 1 : 0}[srcv]${hasAudio ? '[srca]' : ''}`);
  const durationSeconds = keeps.reduce((sum, keep) => sum + keep.endSec - keep.startSec, 0);
  const hardwareDecode = wantsHardwareDecode(probe);
  return {
    inputs: keeps.map(({ startSec, endSec }) => ({ path, startSec, durationSec: endSec - startSec, hardwareDecode })),
    filter: parts.join(';'),
    audio: hasAudio ? '[srca]' : null,
    durationSeconds,
    // Size the ladder by the part that is kept, not the whole source.
    sourceBytes: Math.round(probe.size * (durationSeconds / probe.duration)),
  };
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function mergeSource(paths: string[], probes: ProbeResult[]): EncodeSource {
  const maxWidth = Math.max(...probes.map((probe) => probe.width));
  const maxHeight = Math.max(...probes.map((probe) => probe.height));
  const fit = Math.min(1, MERGE_MAX_DIMENSION / Math.max(maxWidth, maxHeight));
  const width = evenDimension(maxWidth * fit);
  const height = evenDimension(maxHeight * fit);
  const hasAnyAudio = probes.some((probe) => probe.audioStream !== null);

  const parts: string[] = [];
  const concatInputs: string[] = [];
  probes.forEach((probe, i) => {
    parts.push(
      `[${i}:${probe.videoStream}]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${MERGE_FPS},format=yuv420p[v${i}]`,
    );
    concatInputs.push(`[v${i}]`);
    if (!hasAnyAudio) return;
    parts.push(
      probe.audioStream !== null
        ? `[${i}:${probe.audioStream}]aformat=sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0[a${i}]`
        : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${probe.duration},asetpts=PTS-STARTPTS[a${i}]`,
    );
    concatInputs.push(`[a${i}]`);
  });
  parts.push(
    `${concatInputs.join('')}concat=n=${paths.length}:v=1:a=${hasAnyAudio ? 1 : 0}[srcv]${hasAnyAudio ? '[srca]' : ''}`,
  );

  return {
    inputs: paths.map((path, i) => ({ path, hardwareDecode: wantsHardwareDecode(probes[i]) })),
    filter: parts.join(';'),
    audio: hasAnyAudio ? '[srca]' : null,
    durationSeconds: probes.reduce((sum, probe) => sum + probe.duration, 0),
    sourceBytes: probes.reduce((sum, probe) => sum + probe.size, 0),
  };
}
