import { TARGET_SIZE_MB } from './constants';
import type { BitrateCalculation, EncodePass } from './types';

export const DEGRADATION_PASSES: EncodePass[] = [
  { bitrateMultiplier: 1, removeAudio: false },
  { bitrateMultiplier: 0.75, removeAudio: false },
  { bitrateMultiplier: 0.55, maxDimensionOverride: 640, removeAudio: false },
  { bitrateMultiplier: 0.55, maxDimensionOverride: 640, removeAudio: true },
];

export function stepDownDimension(current: number): number {
  if (current > 1280) return 1280;
  if (current > 854) return 854;
  if (current > 640) return 640;
  return 480;
}

export function calculateTargetBitrates(
  durationInSeconds: number,
  removeAudio: boolean,
  bitrateMultiplier = 1,
  maxDimensionOverride?: number,
  targetSizeInBytes = TARGET_SIZE_MB * 1024 * 1024,
): BitrateCalculation {

  if (!durationInSeconds || durationInSeconds <= 0) {
    return {
      videoBitrateBps: 1500 * 1000 * bitrateMultiplier,
      audioBitrateBps: removeAudio ? 0 : 128 * 1000,
      isScalingNeeded: !!maxDimensionOverride,
      maxDimension: maxDimensionOverride ?? 1920,
    };
  }

  const totalBitrateBps = (targetSizeInBytes * 8) / durationInSeconds;

  let audioBitrateBps = 0;
  if (!removeAudio) {
    audioBitrateBps = Math.min(128 * 1000, Math.max(64 * 1000, totalBitrateBps * 0.1));
  }

  let videoBitrateBps = (totalBitrateBps - audioBitrateBps) * bitrateMultiplier;
  videoBitrateBps = Math.max(120 * 1000, Math.min(6000 * 1000, videoBitrateBps));

  let isScalingNeeded = false;
  let maxDimension = 1920;

  if (maxDimensionOverride) {
    isScalingNeeded = true;
    maxDimension = maxDimensionOverride;
  } else if (videoBitrateBps < 350000) {
    isScalingNeeded = true;
    maxDimension = 640;
  } else if (videoBitrateBps < 750000) {
    isScalingNeeded = true;
    maxDimension = 854;
  } else if (videoBitrateBps < 1800000) {
    isScalingNeeded = true;
    maxDimension = 1280;
  }

  return { videoBitrateBps, audioBitrateBps, isScalingNeeded, maxDimension };
}

export function buildLibx264FfmpegArgs(
  inputName: string,
  outputName: string,
  blueprint: BitrateCalculation,
): string[] {
  const videoBitrate = `${Math.round(blueprint.videoBitrateBps)}`;
  const maxrate = videoBitrate;
  const bufsize = `${Math.round(blueprint.videoBitrateBps * 2)}`;
  const scale = blueprint.isScalingNeeded
    ? `scale=min(${blueprint.maxDimension}\\,iw):-2`
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
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-threads',
    '0',
    '-b:v',
    videoBitrate,
    '-maxrate',
    maxrate,
    '-bufsize',
    bufsize,
  ];

  if (blueprint.audioBitrateBps > 0) {
    args.push('-c:a', 'aac', '-b:a', `${Math.round(blueprint.audioBitrateBps)}`);
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', outputName);
  return args;
}
