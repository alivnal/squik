/**
 * A byte count as "8.7 MB" ("8,7 MB" in Turkish): one decimal everywhere, so
 * the same size reads the same on every screen, and a non-breaking space so
 * the unit never wraps away from its number.
 */
export function formatBytes(bytes: number, decimals = 1, locale?: string): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: dm }).format(bytes / Math.pow(k, i));
  return `${value} ${sizes[i]}`;
}
