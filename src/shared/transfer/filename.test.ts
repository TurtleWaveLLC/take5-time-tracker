/**
 * Tests for export filename generation
 */

import { buildExportFilename } from "./filename";

describe("buildExportFilename", () => {
  it("formats local wall-clock time, not UTC", () => {
    // Construct via local-time parts; the same moment in UTC would differ
    // for any non-UTC zone, so assert against the local getters' values.
    const now = new Date(2026, 8, 7, 14, 32, 5); // Sep 7 2026, 14:32:05 local
    expect(buildExportFilename(now)).toBe(
      "take5-export-2026-09-07_14-32-05.json",
    );
  });

  it("zero-pads single-digit components", () => {
    const now = new Date(2026, 0, 3, 4, 5, 6);
    expect(buildExportFilename(now)).toBe(
      "take5-export-2026-01-03_04-05-06.json",
    );
  });

  it("contains no filesystem-hostile characters", () => {
    const name = buildExportFilename(new Date(2026, 11, 31, 23, 59, 59));
    expect(name).not.toMatch(/[:/\\<>"|?*]/);
  });

  it("sorts lexicographically in chronological order", () => {
    const earlier = buildExportFilename(new Date(2026, 8, 7, 9, 0, 0));
    const later = buildExportFilename(new Date(2026, 9, 1, 8, 59, 59));
    expect(earlier < later).toBe(true);
  });
});
