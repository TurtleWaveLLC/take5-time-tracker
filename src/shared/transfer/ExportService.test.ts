/**
 * Tests for export collection: snapshot partitioning, envelope building,
 * and the envelope guard.
 */

import type { Day, History, ExtensionSettings } from "../../../types";
import {
  partitionSnapshot,
  buildEnvelope,
  serializeEnvelope,
} from "./ExportService";
import {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  TRANSFER_EXTRA_STORAGE_KEY,
  isExportEnvelope,
} from "./schema";

const settings = { pillVisibility: true } as unknown as ExtensionSettings;
const history = { earliest: 1, latest: 2, days: {} } as unknown as History;
const day = (total: number): Day =>
  ({ totalTime: total, domains: {} }) as unknown as Day;

const META = { exportedAt: 1789000000000, extensionVersion: "0.0.1" };

describe("partitionSnapshot", () => {
  it("routes known keys into data and re-keys days by dateKey", () => {
    const { data, extra } = partitionSnapshot({
      settings,
      history,
      day_2026_09_06: day(1000),
      day_2026_09_07: day(2000),
    });

    expect(data.settings).toBe(settings);
    expect(data.history).toBe(history);
    expect(Object.keys(data.days).sort()).toEqual([
      "2026_09_06",
      "2026_09_07",
    ]);
    expect(data.days["2026_09_07"].totalTime).toBe(2000);
    expect(extra).toEqual({});
  });

  it("excludes activeTab from the payload entirely", () => {
    const { data, extra } = partitionSnapshot({
      activeTab: { domain: "example.com", active: true },
    });

    expect(JSON.stringify(data)).not.toContain("example.com");
    expect(extra).toEqual({});
  });

  it("sweeps unknown keys into extra, untouched", () => {
    const mystery = { future: ["stuff"] };
    const { data, extra } = partitionSnapshot({ someFutureKey: mystery });

    expect(extra.someFutureKey).toBe(mystery);
    expect(data.days).toEqual({});
  });

  it("seeds extra from the transferExtra stash without exposing the stash key", () => {
    const { extra } = partitionSnapshot({
      [TRANSFER_EXTRA_STORAGE_KEY]: { preservedByOldImport: 42 },
    });

    expect(extra).toEqual({ preservedByOldImport: 42 });
    expect(TRANSFER_EXTRA_STORAGE_KEY in extra).toBe(false);
  });

  it("prefers live storage over the stash on key collision", () => {
    const { extra } = partitionSnapshot({
      [TRANSFER_EXTRA_STORAGE_KEY]: { contested: "stale-from-import" },
      contested: "fresh-from-live-storage",
    });

    expect(extra.contested).toBe("fresh-from-live-storage");
  });

  it("produces a valid empty partition from empty storage", () => {
    const { data, extra } = partitionSnapshot({});

    expect(data).toEqual({ days: {} });
    expect(extra).toEqual({});
  });
});

describe("buildEnvelope / serializeEnvelope", () => {
  it("wraps a partition with format, version, and metadata", () => {
    const envelope = buildEnvelope(
      partitionSnapshot({ settings, day_2026_09_07: day(500) }),
      META,
    );

    expect(envelope.format).toBe(EXPORT_FORMAT);
    expect(envelope.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(envelope.exportedAt).toBe(META.exportedAt);
    expect(envelope.extensionVersion).toBe(META.extensionVersion);
  });

  it("round-trips through serialization losslessly", () => {
    const envelope = buildEnvelope(
      partitionSnapshot({
        settings,
        history,
        day_2026_09_07: day(500),
        unknownKey: { nested: [1, 2, 3] },
      }),
      META,
    );

    const parsed: unknown = JSON.parse(serializeEnvelope(envelope));
    expect(parsed).toEqual(envelope);
    expect(isExportEnvelope(parsed)).toBe(true);
  });

  it("produces a valid envelope from empty storage", () => {
    const envelope = buildEnvelope(partitionSnapshot({}), META);
    expect(isExportEnvelope(JSON.parse(serializeEnvelope(envelope)))).toBe(
      true,
    );
  });
});

describe("isExportEnvelope", () => {
  const valid = buildEnvelope(partitionSnapshot({}), META);

  it("accepts a well-formed envelope", () => {
    expect(isExportEnvelope(valid)).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "take5-export"],
    ["foreign format", { ...valid, format: "other-app-export" }],
    ["missing data", { ...valid, data: undefined }],
    ["non-numeric version", { ...valid, schemaVersion: "1" }],
    ["zero version", { ...valid, schemaVersion: 0 }],
  ])("rejects %s", (_label, candidate) => {
    expect(isExportEnvelope(candidate)).toBe(false);
  });

  it("accepts newer schema versions structurally (gating is import policy)", () => {
    expect(isExportEnvelope({ ...valid, schemaVersion: 99 })).toBe(true);
  });
});
