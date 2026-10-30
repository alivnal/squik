/**
 * Web compression — target 95% of the cap (190 MB under the default 200 MB),
 * balanced speed vs quality.
 */

import {
  MAX_OUTPUT_BYTES,
  TARGET_SIZE_MB,
  adjustBitrateForOvershoot,
  calculateTargetBitrates,
  mapAttemptProgress,
  targetBytesForCap,
  type BitrateCalculation,
  type EncodePass,
} from '@/lib/squish-core';

/** Web tiers: capped resolution for WASM speed; audio always kept. */
export const WEB_DEGRADATION_PASSES: EncodePass[] = [
  { bitrateMultiplier: 1, maxDimensionOverride: 1280, removeAudio: false },
  { bitrateMultiplier: 0.75, maxDimensionOverride: 854, removeAudio: false },
  { bitrateMultiplier: 0.55, maxDimensionOverride: 640, removeAudio: false },
  { bitrateMultiplier: 0.45, maxDimensionOverride: 640, removeAudio: false },
];

/** One retry per tier on web — extra passes are costly in WASM. */
export const WEB_MAX_BITRATE_RETRIES = 1;

function estimateOutputBytes(blueprint: BitrateCalculation, durationSeconds: number): number {
  const safeDuration = Math.max(durationSeconds, 1);
  return ((blueprint.videoBitrateBps + blueprint.audioBitrateBps) * safeDuration) / 8;
}

export function blueprintForWebPass(
  passIndex: number,
  durationSeconds: number,
  maxOutputBytes = MAX_OUTPUT_BYTES,
): BitrateCalculation {
  const pass = WEB_DEGRADATION_PASSES[passIndex] ?? WEB_DEGRADATION_PASSES.at(-1)!;
  return calculateTargetBitrates(
    durationSeconds,
    pass.removeAudio,
    pass.bitrateMultiplier,
    pass.maxDimensionOverride,
    targetBytesForCap(maxOutputBytes),
  );
}

/**
 * Pick the best tier that should hit under the cap in one pass, with a speed
 * bias for large sources so WASM does not waste time on a full-res first encode.
 */
export function estimateWebStartPassIndex(
  durationSeconds: number,
  sourceSizeBytes: number,
  maxOutputBytes = MAX_OUTPUT_BYTES,
): number {
  let tier = WEB_DEGRADATION_PASSES.length - 1;
  for (let t = 0; t < WEB_DEGRADATION_PASSES.length; t++) {
    const blueprint = blueprintForWebPass(t, durationSeconds, maxOutputBytes);
    if (estimateOutputBytes(blueprint, durationSeconds) <= maxOutputBytes) {
      tier = t;
      break;
    }
  }

  // Speed bias — large files skip the slowest full-res pass in the browser.
  if (sourceSizeBytes > 500 * 1024 * 1024 && tier < 1) tier = 1;
  if (sourceSizeBytes > 850 * 1024 * 1024 && tier < 2) tier = 2;

  // Last tier is fallback only (after failed encodes).
  return Math.min(tier, 2);
}

export function maxWebCompressionAttempts(startTierIndex: number): number {
  const tiersLeft = WEB_DEGRADATION_PASSES.length - startTierIndex;
  return tiersLeft * (WEB_MAX_BITRATE_RETRIES + 1);
}

export function mapWebAttemptProgress(
  attemptIndex: number,
  encodeRatio: number,
  maxAttempts: number,
): number {
  return mapAttemptProgress(attemptIndex, encodeRatio, maxAttempts);
}

export { adjustBitrateForOvershoot, MAX_OUTPUT_BYTES, TARGET_SIZE_MB };

export function buildWasmLibx264FfmpegArgs(
  inputName: string,
  outputName: string,
  blueprint: BitrateCalculation,
  hasAudio: boolean,
): string[] {
  const videoBitrate = `${Math.round(blueprint.videoBitrateBps)}`;
  const maxrate = videoBitrate;
  const bufsize = `${Math.round(blueprint.videoBitrateBps * 2)}`;
  const scale = blueprint.isScalingNeeded
    ? `scale=min(${blueprint.maxDimension}\\,iw):-2:flags=fast_bilinear`
    : 'scale=trunc(iw/2)*2:-2';

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputName,
    '-vf',
    scale,
    '-map',
    '0:v:0',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-profile:v',
    'baseline',
    '-x264-params',
    'ref=1:me=dia:subme=0:8x8dct=0:weightp=0',
    '-threads',
    '1',
    '-b:v',
    videoBitrate,
    '-maxrate',
    maxrate,
    '-bufsize',
    bufsize,
  ];

  if (hasAudio && blueprint.audioBitrateBps > 0) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${Math.round(blueprint.audioBitrateBps)}`);
  }

  args.push('-movflags', '+faststart', outputName);
  return args;
}

export const WEB_MERGE_MAX_DIMENSION = 1280;

/** Single-pass trim: filter_complex trim/atrim + concat + WASM-fast libx264. */
export function buildWasmTrimFilterFfmpegArgs(
  inputName: string,
  keepSegments: Array<{ startSec: number; endSec: number }>,
  outputName: string,
  blueprint: BitrateCalculation,
  hasAudio: boolean,
): string[] {
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  const maxDim = blueprint.maxDimension;

  for (let i = 0; i < keepSegments.length; i++) {
    const { startSec, endSec } = keepSegments[i];
    filterParts.push(
      `[0:v]trim=start=${startSec}:end=${endSec},setpts=PTS-STARTPTS,scale=min(${maxDim}\\,iw):-2:flags=fast_bilinear,setsar=1,format=yuv420p[v${i}]`,
    );
    concatInputs.push(`[v${i}]`);
    if (hasAudio) {
      filterParts.push(
        `[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS[a${i}]`,
      );
      concatInputs.push(`[a${i}]`);
    }
  }

  if (hasAudio) {
    filterParts.push(
      `${concatInputs.join('')}concat=n=${keepSegments.length}:v=1:a=1[outv][outa]`,
    );
  } else {
    const videoOnly = keepSegments.map((_, i) => `[v${i}]`).join('');
    filterParts.push(`${videoOnly}concat=n=${keepSegments.length}:v=1:a=0[outv]`);
  }

  const videoBitrate = `${Math.round(blueprint.videoBitrateBps)}`;
  const maxrate = videoBitrate;
  const bufsize = `${Math.round(blueprint.videoBitrateBps * 2)}`;

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostats',
    '-i',
    inputName,
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[outv]',
  ];

  if (hasAudio && blueprint.audioBitrateBps > 0) {
    args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', `${Math.round(blueprint.audioBitrateBps)}`);
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-profile:v',
    'baseline',
    '-x264-params',
    'ref=1:me=dia:subme=0:8x8dct=0:weightp=0',
    '-threads',
    '1',
    '-b:v',
    videoBitrate,
    '-maxrate',
    maxrate,
    '-bufsize',
    bufsize,
    '-movflags',
    '+faststart',
    outputName,
  );

  return args;
}

/** Trim filter_complex output mapped straight into compress-tier libx264 (one exec). */
export function buildWasmTrimAndCompressFilterFfmpegArgs(
  inputName: string,
  keepSegments: Array<{ startSec: number; endSec: number }>,
  outputName: string,
  blueprint: BitrateCalculation,
  hasAudio: boolean,
): string[] {
  return buildWasmTrimFilterFfmpegArgs(inputName, keepSegments, outputName, blueprint, hasAudio);
}
