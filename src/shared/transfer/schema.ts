/**
 * Export/import file format — the versioned envelope contract.
 *
 * The envelope is an import contract: once a version of this format ships,
 * import must accept it forever. Changes to the schema'd payload require a
 * schemaVersion bump and a migration on the import side.
 *
 * See docs/plans/data-export-design.md for the full design, including the
 * stash-not-live rules governing `extra`.
 */

import type { ExtensionSettings, History, Day } from "../../../types";

export const EXPORT_FORMAT = "take5-export";
export const EXPORT_SCHEMA_VERSION = 1;

/**
 * Storage key where import parks content it does not recognize (the file's
 * `extra` plus unknown `data` members). Export re-emits it; nothing else in
 * the extension reads it. A future version that understands an entry promotes
 * it out via a schema migration.
 */
export const TRANSFER_EXTRA_STORAGE_KEY = "transferExtra";

/**
 * Schema'd payload. Members are optional so an export of empty storage is
 * still a valid, importable file.
 */
export interface ExportDataV1 {
  settings?: ExtensionSettings;
  history?: History;
  /** Day records keyed by dateKey (e.g. "2026-09-07"), not by storage key. */
  days: Record<string, Day>;
}

export interface ExportEnvelopeV1 {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  /** Unix ms at collection time. */
  exportedAt: number;
  /** Extension version that produced the file, for support/debugging. */
  extensionVersion: string;
  data: ExportDataV1;
  /**
   * Opaque unknown-content bucket (DDIA/proto-style preservation). Never
   * interpreted, never a fallback read path — carried through round-trips.
   */
  extra: Record<string, unknown>;
}

/**
 * Structural check that a parsed value is a Take5 export envelope of any
 * version. Version acceptance is a separate decision (import refuses
 * schemaVersion > EXPORT_SCHEMA_VERSION rather than best-effort reading).
 */
export function isExportEnvelope(value: unknown): value is ExportEnvelopeV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.format === EXPORT_FORMAT &&
    typeof candidate.schemaVersion === "number" &&
    Number.isInteger(candidate.schemaVersion) &&
    candidate.schemaVersion >= 1 &&
    typeof candidate.exportedAt === "number" &&
    typeof candidate.extensionVersion === "string" &&
    typeof candidate.data === "object" &&
    candidate.data !== null &&
    typeof candidate.extra === "object" &&
    candidate.extra !== null
  );
}
