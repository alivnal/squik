/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getI18nInstance } from '@squish/i18n';
import { fetchFile } from '@ffmpeg/util';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { CompressionCancelledError, type VideoProbeMetadata } from '@/lib/squish-core';
import { extFromName, loadFFmpeg, probeVideoFile } from './compress-wasm';
import { probeHasAudioInFfmpeg } from './trim-wasm';
import { WEB_MERGE_MAX_DIMENSION } from './web-compress-strategy';

function t(key: string): string {
  return getI18nInstance().t(key);
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function capMergeDimensions(width: number, height: number): { width: number; height: number } {
  const maxSide = Math.max(width, height);
  if (maxSide <= WEB_MERGE_MAX_DIMENSION) {
    return { width: evenDimension(width), height: evenDimension(height) };
  }
  const scale = WEB_MERGE_MAX_DIMENSION / maxSide;
  return {
    width: evenDimension(width * scale),
    height: evenDimension(height * scale),
  };
}

function buildFilterMergeArgs(
  inputNames: string[],
  probes: VideoProbeMetadata[],
  hasAudio: boolean[],
  outputName: string,
): string[] {
  const maxW = evenDimension(Math.max(...probes.map((p) => p.width)));
  const maxH = evenDimension(Math.max(...probes.map((p) => p.height)));
  const capped = capMergeDimensions(maxW, maxH);
  const hasAnyAudio = hasAudio.some(Boolean);

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats'];
  for (const inputName of inputNames) {
    args.push('-i', inputName);
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];

  for (let i = 0; i < inputNames.length; i++) {
    filterParts.push(
      `[${i}:v]scale=${capped.width}:${capped.height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${capped.width}:${capped.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`,
    );
    concatInputs.push(`[v${i}]`);

    if (hasAnyAudio) {
      if (hasAudio[i]) {
        filterParts.push(
          `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0[a${i}]`,
        );
      } else {
        filterParts.push(
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${probes[i].duration},asetpts=PTS-STARTPTS[a${i}]`,
        );
      }
      concatInputs.push(`[a${i}]`);
    }
  }

  if (hasAnyAudio) {
    filterParts.push(
      `${concatInputs.join('')}concat=n=${inputNames.length}:v=1:a=1[outv][outa]`,
    );
  } else {
    filterParts.push(`${concatInputs.join('')}concat=n=${inputNames.length}:v=1:a=0[outv]`);
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', '[outv]');
  if (hasAnyAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '96k');
  } else {
    args.push('-an');
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-x264-params', 'ref=1:me=dia:subme=0:8x8dct=0:weightp=0',
    '-threads', '1',
    '-crf', '28',
    '-movflags', '+faststart',
    outputName,
  );

  return args;
}

/** Estimate upload time to WASM FS from byte count. */
function estimateUploadMs(bytes: number): number {
  return Math.max(3000, (bytes / (80 * 1024 * 1024)) * 1000);
}

export async function mergeVideosWasm(
  files: File[],
  options?: {
    onProgress?: (progress: number) => void;
    onLoadProgress?: (progress: number) => void;
    isCancelled?: () => boolean;
  },
): Promise<{
  ffmpeg: FFmpeg;
  outputName: string;
  metadata: VideoProbeMetadata;
  totalInputSize: number;
  hasAudio: boolean;
}> {
  if (files.length < 2) {
    throw new Error(t('errors.mergeMinTwo'));
  }

  const { onProgress, onLoadProgress, isCancelled } = options ?? {};
  const totalInputSize = files.reduce((s, f) => s + f.size, 0);

  // ── Phase 1: load FFmpeg + probe all files in parallel ──────────────
  onLoadProgress?.(0);
  const [ffmpeg, ...probes] = await Promise.all([
    loadFFmpeg(onLoadProgress),
    ...files.map((f) => probeVideoFile(f)),
  ]);
  if (isCancelled?.()) throw new CompressionCancelledError();

  const inputNames: string[] = [];
  const hasAudio: boolean[] = [];
  const mountedDirectories: string[] = [];
  const memoryInputNames: string[] = [];
  const outputName = 'merged.mp4';
  let mergeSucceeded = false;

  try {
    // ── Phase 2: mount files without copying large inputs into WASM memory ─
    const totalBytes = Math.max(totalInputSize, 1);
    let uploadedBytes = 0;

    for (let i = 0; i < files.length; i++) {
      if (isCancelled?.()) throw new CompressionCancelledError();

      const file = files[i];
      const uploadStart = Date.now();
      const budget = estimateUploadMs(file.size);
      const ticker = window.setInterval(() => {
        if (isCancelled?.()) return;
        const ratio = Math.min(0.95, (Date.now() - uploadStart) / budget);
        const fileFraction = file.size / totalBytes;
        onProgress?.((uploadedBytes / totalBytes) + ratio * fileFraction);
      }, 200);

      const inputDirectory = `/merge_input_${i}`;
      const fallbackInputName = `merge_fallback_${i}${extFromName(file.name)}`;
      let mountedInputName: string | null = null;
      let hasAudioForInput = false;
      try {
        try {
          await ffmpeg.createDir(inputDirectory);
          const mounted = await ffmpeg.mount(
            'WORKERFS' as Parameters<typeof ffmpeg.mount>[0],
            { files: [file] },
            inputDirectory,
          );
          if (mounted) {
            mountedDirectories.push(inputDirectory);
            const entries = await ffmpeg.listDir(inputDirectory);
            if (entries.some((entry) => entry.name === file.name && !entry.isDir)) {
              mountedInputName = `${inputDirectory}/${file.name}`;
              try {
                hasAudioForInput = await probeHasAudioInFfmpeg(ffmpeg, mountedInputName);
              } catch (error) {
                if (
                  !(error instanceof Error) ||
                  !/No such file or directory|does not exist|could not read input|aborted\(\)/i.test(
                    error.message,
                  )
                ) {
                  throw error;
                }
                mountedInputName = null;
              }
            }
          }
        } catch (error) {
          if (isCancelled?.()) throw new CompressionCancelledError();
          console.warn(
            `[Squish] Could not mount merge input ${i + 1}; using a memory-backed input.`,
            error,
          );
          mountedInputName = null;
        }

        if (!mountedInputName) {
          try {
            await ffmpeg.unmount(inputDirectory);
          } catch {
            // The mount may have failed before it was created.
          }
          try {
            await ffmpeg.deleteDir(inputDirectory);
          } catch {
            // The directory may already have been removed.
          }
          const mountedIndex = mountedDirectories.indexOf(inputDirectory);
          if (mountedIndex >= 0) mountedDirectories.splice(mountedIndex, 1);
          await ffmpeg.writeFile(fallbackInputName, await fetchFile(file));
          memoryInputNames.push(fallbackInputName);
          mountedInputName = fallbackInputName;
          hasAudioForInput = await probeHasAudioInFfmpeg(ffmpeg, mountedInputName);
        }
      } finally {
        window.clearInterval(ticker);
      }

      if (!mountedInputName) throw new Error(`Could not prepare merge input ${i + 1}.`);
      inputNames.push(mountedInputName);
      hasAudio.push(hasAudioForInput);
      uploadedBytes += file.size;
      onProgress?.(uploadedBytes / totalBytes);
      if (isCancelled?.()) throw new CompressionCancelledError();
    }

    // ── Phase 3: merge encode ────────────────────────────────────────────
    const totalDurationSeconds = probes.reduce((s, p) => s + p.duration, 0);
    const args = buildFilterMergeArgs(inputNames, probes, hasAudio, outputName);

    const progressHandler = ({ progress }: { progress: number }) => {
      if (isCancelled?.()) return;
      const ratio = totalDurationSeconds > 0 ? Math.min(0.99, progress) : progress;
      onProgress?.(ratio);
    };

    const diagnostics: string[] = [];
    const logHandler = ({ message }: { message: string }) => {
      if (message.trim()) {
        diagnostics.push(message.trim());
        if (diagnostics.length > 20) diagnostics.shift();
      }
    };
    ffmpeg.on('progress', progressHandler);
    ffmpeg.on('log', logHandler);
    let code: number;
    try {
      code = await ffmpeg.exec(args);
    } finally {
      ffmpeg.off('progress', progressHandler);
      ffmpeg.off('log', logHandler);
    }

    if (isCancelled?.()) throw new CompressionCancelledError();
    if (code !== 0) {
      const detail = diagnostics.slice(-5).join(' | ');
      throw new Error(
        detail
          ? `${t('errors.mergeFailed')} ${t('errors.encodingFailedDetails').replace('{{details}}', detail)}`
          : t('errors.mergeFailed'),
      );
    }

    // ── Phase 4: pass the intermediate directly to compression ──────────
    const maxW = Math.max(...probes.map((p) => p.width));
    const maxH = Math.max(...probes.map((p) => p.height));
    const capped = capMergeDimensions(maxW, maxH);
    const mergedMeta: VideoProbeMetadata = {
      name: 'merged.mp4',
      size: totalInputSize,
      duration: totalDurationSeconds,
      width: capped.width,
      height: capped.height,
    };

    onProgress?.(1);
    mergeSucceeded = true;
    return {
      ffmpeg,
      outputName,
      metadata: mergedMeta,
      totalInputSize,
      hasAudio: hasAudio.some(Boolean),
    };
  } finally {
    if (!mergeSucceeded) await ffmpeg.deleteFile(outputName).catch(() => {});
    await Promise.all([
      ...memoryInputNames.map((name) => ffmpeg.deleteFile(name).catch(() => {})),
      ...mountedDirectories.map(async (directory) => {
        await ffmpeg.unmount(directory).catch(() => {});
        await ffmpeg.deleteDir(directory).catch(() => {});
      }),
    ]);
  }
}
