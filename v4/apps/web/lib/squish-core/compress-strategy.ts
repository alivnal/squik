import { MAX_OUTPUT_BYTES, targetBytesForCap } from './constants';
import type { BitrateCalculation } from './types';
import {
  DEGRADATION_PASSES,
  calculateTargetBitrates,
  stepDownDimension,
} from './bitrate';

/** Retries at the same degradation tier before stepping down. */
export const MAX_BITRATE_RETRIES = 2;

/** Shrink factor applied when an encode overshoots the size cap. */
export const BITRATE_SAFETY_FACTOR = 0.9;

/** Lowest bitrates any tier or retry goes to; below them the picture falls apart. */
export const MIN_VIDEO_BITRATE_BPS = 120_000;
export const MIN_AUDIO_BITRATE_BPS = 48_000;

/**
 * The smallest output the encode ladder can make for this length: the video
 * floor, plus the audio floor when the last tier keeps sound. Container
 * overhead is left out, so this errs toward trying.
 */
export function minimumOutputBytes(durationSeconds: number, keepsAudio: boolean): number {
  const floorBps = MIN_VIDEO_BITRATE_BPS + (keepsAudio ? MIN_AUDIO_BITRATE_BPS : 0);
  return (floorBps * Math.max(durationSeconds, 0)) / 8;
}

/**
 * False when even the floor bitrates cannot fit the cap, so a 1 MB request on
 * a ten-minute video fails at once instead of after every tier has encoded.
 */
export function canFitUnderCap(
  durationSeconds: number,
  maxOutputBytes: number,
  keepsAudio: boolean,
): boolean {
  return minimumOutputBytes(durationSeconds, keepsAudio) <= maxOutputBytes;
}

/**
 * Skip easy tiers when the source is far above the target size — avoids wasted full-quality encodes.
 */
export function estimateStartPassIndex(
  durationSeconds: number,
  sourceSizeBytes: number,
  maxOutputBytes = MAX_OUTPUT_BYTES,
): number {
  const safeDuration = Math.max(durationSeconds, 1);
  const sourceRate = sourceSizeBytes / safeDuration;
  const targetRate = targetBytesForCap(maxOutputBytes) / safeDuration;
  const compressionNeeded = sourceRate / Math.max(targetRate, 1);

  if (compressionNeeded <= 1.25) return 0;
  if (compressionNeeded <= 2.5) return 1;
  if (compressionNeeded <= 5) return 2;
  return 3;
}

export function blueprintForDegradationPass(
  passIndex: number,
  durationSeconds: number,
  maxOutputBytes = MAX_OUTPUT_BYTES,
): BitrateCalculation {
  const pass = DEGRADATION_PASSES[passIndex] ?? DEGRADATION_PASSES[DEGRADATION_PASSES.length - 1];
  const targetBytes = targetBytesForCap(maxOutputBytes);
  let maxDim = pass.maxDimensionOverride;

  if (passIndex === 1 && !maxDim) {
    const base = calculateTargetBitrates(durationSeconds, false, 1, undefined, targetBytes);
    maxDim = stepDownDimension(base.maxDimension);
  }

  return calculateTargetBitrates(
    durationSeconds,
    pass.removeAudio,
    pass.bitrateMultiplier,
    maxDim,
    targetBytes,
  );
}

export function adjustBitrateForOvershoot(
  blueprint: BitrateCalculation,
  outputBytes: number,
  maxOutputBytes = MAX_OUTPUT_BYTES,
): BitrateCalculation {
  const factor = (maxOutputBytes / outputBytes) * BITRATE_SAFETY_FACTOR;
  return {
    ...blueprint,
    videoBitrateBps: Math.max(
      MIN_VIDEO_BITRATE_BPS,
      Math.round(blueprint.videoBitrateBps * factor),
    ),
    audioBitrateBps:
      blueprint.audioBitrateBps > 0
        ? Math.max(MIN_AUDIO_BITRATE_BPS, Math.round(blueprint.audioBitrateBps * factor))
        : 0,
  };
}

export function maxCompressionAttempts(): number {
  return DEGRADATION_PASSES.length * (MAX_BITRATE_RETRIES + 1);
}

export function mapAttemptProgress(
  attemptIndex: number,
  encodeRatio: number,
  maxAttempts = maxCompressionAttempts(),
): number {
  const span = 1 / maxAttempts;
  const start = attemptIndex / maxAttempts;
  return Math.min(0.99, start + encodeRatio * span);
}
