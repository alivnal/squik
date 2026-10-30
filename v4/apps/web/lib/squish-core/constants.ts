export const TARGET_SIZE_MB = 190;
export const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;

/**
 * Smallest cap a job accepts. Below this the bitrate floors leave nothing to
 * aim at for all but a few seconds of video, so smaller requests are raised to
 * it. Decimal 1 MB, the smallest size the picker offers: raising a 1,000,000
 * byte request to 1 MiB would hand back a file over what was asked for.
 */
export const MIN_OUTPUT_BYTES = 1_000_000;

/** A caller's cap, or the default 200 MB, raised to at least MIN_OUTPUT_BYTES. */
export function resolveMaxOutputBytes(maxOutputBytes?: number): number {
  if (maxOutputBytes === undefined || !Number.isFinite(maxOutputBytes)) return MAX_OUTPUT_BYTES;
  return Math.max(MIN_OUTPUT_BYTES, Math.floor(maxOutputBytes));
}

/**
 * The size bitrates aim at for a cap: 95% of it, the same headroom 190 MB
 * leaves under 200 MB for container overhead and rate-control drift. Integer
 * maths so the default cap gives exactly TARGET_SIZE_MB.
 */
export function targetBytesForCap(maxOutputBytes: number): number {
  return Math.floor((maxOutputBytes * 19) / 20);
}
