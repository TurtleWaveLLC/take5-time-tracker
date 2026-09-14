/**
 * ExportService - Collects extension data into a versioned export envelope.
 *
 * Collection is a single storage read partitioned against an allowlist, so the
 * snapshot is internally consistent (no day rollover or checkpoint can land
 * between reads). Key names come from the repositories; moving collection
 * behind the repository interface itself is tracked as T5TIMER-20.
 *
 * See docs/plans/data-export-design.md.
 */

import type { ExtensionSettings, History, Day } from "../../../types";
import { DAY_STORAGE_PREFIX } from "../utils";
import { HISTORY_STORAGE_KEY } from "../repositories/HistoryRepository";
import { SETTINGS_STORAGE_KEY } from "../repositories/SettingsRepository";
import { ACTIVE_TAB_STORAGE_KEY } from "../repositories/TabRepository";
import {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  TRANSFER_EXTRA_STORAGE_KEY,
  type ExportDataV1,
  type ExportEnvelopeV1,
} from "./schema";

export interface SnapshotPartition {
  data: ExportDataV1;
  extra: Record<string, unknown>;
}

/**
 * Partition a raw storage snapshot into the schema'd payload and the opaque
 * extra bucket.
 *
 * Rules:
 * - settings / history / day_* -> data (days re-keyed by dateKey)
 * - activeTab -> dropped (live-session state; flush-before-export folds its
 *   value into today's day record, and restoring it on import would resurrect
 *   a stale "actively tracking" session)
 * - transferExtra stash -> seeds extra (content a past import preserved)
 * - anything else -> extra, winning over stash entries on key collision
 *   (live storage is fresher than what an old import parked)
 */
export function partitionSnapshot(
  raw: Record<string, unknown>,
): SnapshotPartition {
  const days: Record<string, Day> = {};
  const data: ExportDataV1 = { days };
  const extra: Record<string, unknown> = {};

  const stash = raw[TRANSFER_EXTRA_STORAGE_KEY];
  if (typeof stash === "object" && stash !== null) {
    Object.assign(extra, stash as Record<string, unknown>);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key === SETTINGS_STORAGE_KEY) {
      data.settings = value as ExtensionSettings;
    } else if (key === HISTORY_STORAGE_KEY) {
      data.history = value as History;
    } else if (key.startsWith(DAY_STORAGE_PREFIX)) {
      days[key.slice(DAY_STORAGE_PREFIX.length)] = value as Day;
    } else if (
      key === ACTIVE_TAB_STORAGE_KEY ||
      key === TRANSFER_EXTRA_STORAGE_KEY
    ) {
      // Recognized and deliberately not part of the schema'd payload
    } else {
      extra[key] = value;
    }
  }

  return { data, extra };
}

export interface EnvelopeMeta {
  exportedAt: number;
  extensionVersion: string;
}

export function buildEnvelope(
  partition: SnapshotPartition,
  meta: EnvelopeMeta,
): ExportEnvelopeV1 {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: meta.exportedAt,
    extensionVersion: meta.extensionVersion,
    data: partition.data,
    extra: partition.extra,
  };
}

export function serializeEnvelope(envelope: ExportEnvelopeV1): string {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Collect current extension data into an export envelope.
 * Callers should flush the live session first (FLUSH_SESSION) so today's day
 * record includes un-checkpointed time.
 */
export async function createExport(): Promise<ExportEnvelopeV1> {
  const raw = (await browser.storage.local.get(null)) as Record<
    string,
    unknown
  >;
  return buildEnvelope(partitionSnapshot(raw), {
    exportedAt: Date.now(),
    extensionVersion: browser.runtime.getManifest().version,
  });
}
