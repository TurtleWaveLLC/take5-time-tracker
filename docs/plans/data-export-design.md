# Data Export Design

Tracked in Linear: T5TIMER-19 (export), T5TIMER-20 (repository-interface follow-up).
Import is a future sibling feature; this document defines the contract it will build on.

## Goals

- User-facing "Export my data" in the popup producing a single JSON file.
- The file is an **import contract**: versioned, explicit about what it contains,
  and safe to round-trip across mismatched extension versions.
- Nothing leaves the machine; export is a local download only.

## File format

```json
{
  "format": "take5-export",
  "schemaVersion": 1,
  "exportedAt": 1789000000000,
  "extensionVersion": "0.0.1",
  "data": {
    "settings": { },
    "history": { },
    "days": { "2026-09-07": { } }
  },
  "extra": { }
}
```

- `data` is the schema'd payload: exactly `settings`, `history`, and all `day_*`
  records re-keyed by dateKey under `days`. Storage key naming stays an internal
  detail. `activeTab` is deliberately excluded — restoring a stale live session
  is an import hazard, and flush-before-export folds its value into today's day.
- `extra` is an opaque bucket implementing DDIA/protobuf-style unknown-field
  preservation. It is never interpreted, never used as a fallback read path.

### The `extra` round-trip (stash-not-live)

- **Export** fills `extra` from (a) live storage keys outside the allowlist and
  (b) the `transferExtra` stash key. Live wins on collision.
- **Import** (future) writes recognized `data` verbatim to live storage; every
  unrecognized member — the file's `extra` plus unknown `data` entries — is
  written into the `transferExtra` storage key, never to live keys. A later
  version that understands the data promotes it out via a schema migration.
- Consequence: unknown data survives export→import→export indefinitely, but can
  never resurrect stale runtime state in a version that doesn't understand it.

### Versioning rules

- Newer code reading older files: `schemaVersion` + explicit migration functions.
- Older code reading newer files: refuse with a clear message (v1 policy). The
  envelope makes best-effort import possible later without a format change.
- Importers must validate structurally but write parsed objects through
  verbatim — never rebuild field-by-field — so unknown fields inside known
  objects survive for free.

## Flow — background-owned pipeline

The download's lifetime must not be coupled to the initiating UI context:
Firefox closes browser-action popups when the native Save As dialog takes
focus, destroying any popup-created blob URL before the download manager
reads it (download shows "Failed", no file). The pipeline therefore lives in
the background, and UI surfaces (popup today, dashboard later) are thin
requesters sending one message.

1. UI sends `EXPORT_DATA` (target: background).
2. Background `ExportHandler`: `DataModelManager.checkpointNow()` (plain
   method call — folds live-session elapsed time into today's record; export
   proceeds on failure, a slightly stale backup beats none).
3. `ExportService` performs **one** `browser.storage.local.get(null)` and
   partitions keys (atomic snapshot; key constants imported from repositories —
   see T5TIMER-20 for moving this behind the repository interface). Envelope
   wrapped and serialized (pretty-printed).
4. `ObjectUrlPort.mint(json)` produces a blob URL (see delivery below).
5. `browser.downloads.download({ url, filename, saveAs: true })` from the
   background; completion tracked via a top-level `downloads.onChanged`
   listener with the pending download ID persisted (`storage.session`) so an
   MV3 worker restart can still finish the sequence. Requires the `downloads`
   permission (accepted store-review cost).
6. `ObjectUrlPort.release(url)`, then the terminal status (success / error /
   canceled) is returned as the message response. Canceling the save dialog is
   a user decision → idle, not error. If the popup died meanwhile the response
   evaporates harmlessly; the file still saves.

## Delivery: ObjectUrlPort (per-browser seam, unified modules)

`downloads.download` needs a URL, and blob URLs require a document context.
Firefox's background is a document; Chrome's MV3 service worker is not, and
Chrome's answer is the offscreen API — which Firefox doesn't implement. The
seam is kept to a two-method port; everything else is shared code:

- `ObjectUrlPort { mint(json): url, release(url) }`, selected by capability
  (`typeof URL.createObjectURL === "function"`), not browser sniffing.
- `DirectObjectUrlPort` (Firefox, future MV3 event pages): calls the shared
  `blobUrl.ts` module locally.
- `OffscreenObjectUrlPort` (Chrome): manages the singleton offscreen document
  (`runtime.getContexts` existence check, tolerate the create race), reason
  `"BLOBS"`, and messages it mint/release requests; closes the document on
  release. The offscreen entrypoint runs the same `blobUrl.ts` module.
- Data URLs were rejected: Chromium caps URLs at 2MB, a real cliff at long
  retention settings. The offscreen route has no size limit.

### Message routing (`target` convention)

The offscreen document shares `runtime.onMessage` with the background. Every
message on the bus may carry `target: "background" | "offscreen"`; each
context returns without responding for messages addressed elsewhere (absent
target means background — all pre-existing message types). This prevents the
background's default-case error response from racing the offscreen reply.
The `offscreen` permission is Chrome-only and must not appear in the Firefox
manifest (browser-conditional in wxt.config.ts). It carries no install-time
user warning.

## Filename

`take5-export-YYYY-MM-DD_HH-MM-SS.json` in **local** wall-clock time,
filesystem-safe (no colons), lexicographically sortable. Pure function of an
injected `Date`.

## Popup UI

Data section between the domain list and the debug section. Single button with
a pending/success/error state machine (`useDataExport` hook — a thin requester
around `EXPORT_DATA`): spinner beside the label while the flow runs, button
disabled to prevent double-fires, result surfaced inline. Copy notes that the
file contains browsing-time history. On Firefox the popup may close when the
save dialog opens; the download is unaffected, the user just doesn't see the
success state. The future dashboard page reuses the same hook and, being a
persistent tab, gets the full status lifecycle.
