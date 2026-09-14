/**
 * Export filename generation.
 *
 * Requirements: local wall-clock time (not UTC), filesystem-safe on every
 * platform (no colons), and lexicographically sortable.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Build the export filename for a given moment, e.g.
 * `take5-export-2026-09-07_14-32-05.json`.
 */
export function buildExportFilename(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `take5-export-${date}_${time}.json`;
}
