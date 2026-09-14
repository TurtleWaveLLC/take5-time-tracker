/**
 * useDataExport - UI state machine for the data-export flow.
 *
 * A thin requester: the pipeline (flush, collect, download, completion)
 * runs in the background behind one EXPORT_DATA message, so the download
 * survives this context closing — on Firefox the popup dies when the save
 * dialog takes focus, and the file still saves; the user just doesn't see
 * the success state. Persistent surfaces (the future dashboard) get the
 * full lifecycle from this same hook.
 *
 * `pending` spans the whole flow so the button can show a spinner and stay
 * disabled against double-fires.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { ExportResponse } from "../../background/services/ExportHandler";

export type ExportStatus = "idle" | "pending" | "success" | "error";

export interface DataExport {
  status: ExportStatus;
  error: string | null;
  startExport: () => void;
}

const SUCCESS_RESET_MS = 2500;

export function useDataExport(): DataExport {
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const setIfMounted = (next: ExportStatus, message?: string): void => {
    if (!mountedRef.current) return;
    setStatus(next);
    setError(message ?? null);
    if (next === "success") {
      resetTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setStatus("idle");
      }, SUCCESS_RESET_MS);
    }
  };

  const startExport = (): void => {
    if (status === "pending") return;
    setStatus("pending");
    setError(null);

    void (async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: "EXPORT_DATA",
          payload: {},
          id: `export-${Date.now()}`,
          timestamp: Date.now(),
        })) as ExportResponse | undefined;

        if (!response) {
          throw new Error("No response from background service");
        }
        if (!response.success) {
          throw new Error(response.error ?? "Export failed");
        }
        // Canceling the save dialog is a user decision, not a failure
        setIfMounted(
          response.data?.outcome === "canceled" ? "idle" : "success",
        );
      } catch (err) {
        console.error("Data export failed:", err);
        setIfMounted(
          "error",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  };

  return { status, error, startExport };
}
