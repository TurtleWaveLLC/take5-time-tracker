/**
 * ExportHandler - Background-owned data export pipeline.
 *
 * Owns the whole flow so the download's lifetime is decoupled from whichever
 * UI context requested it (Firefox closes popups when the save dialog takes
 * focus): flush -> collect -> mint URL -> download -> completion -> release.
 *
 * MV3 mortality hardening: the downloads.onChanged listener is registered at
 * construction (i.e. at worker start), and the in-flight export is stashed in
 * storage.session — a worker restarted mid-download can still release the
 * object URL and close the offscreen document when the terminal event fires,
 * even though the original waiter promise died with the old worker.
 */

import type { MessageResponse } from "../../../types";
import {
  createExport,
  serializeEnvelope,
} from "../../shared/transfer/ExportService";
import { buildExportFilename } from "../../shared/transfer/filename";
import type { ObjectUrlPort } from "../delivery/ObjectUrlPort";
import type { DataModelManager } from "./DataModelManager";

export type ExportOutcome = "success" | "canceled";
export type ExportResponse = MessageResponse<{ outcome: ExportOutcome }>;

const PENDING_EXPORT_KEY = "pendingExport";
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000; // saveAs dialogs can sit open a while

interface PendingExport {
  downloadId: number;
  url: string;
}

// The slices of browser APIs we touch, injectable for tests
export interface DownloadsApi {
  download(options: {
    url: string;
    filename: string;
    saveAs: boolean;
  }): Promise<number>;
  onChanged: {
    addListener(
      listener: (delta: browser.downloads._OnChangedDownloadDelta) => void,
    ): void;
  };
}

export interface SessionStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

class DownloadCanceledError extends Error {}

function isCancelIndicator(text: string): boolean {
  return /cancel/i.test(text);
}

export class ExportHandler {
  private dataModelManager: DataModelManager;
  private portFactory: () => ObjectUrlPort;
  private portInstance: ObjectUrlPort | null = null;
  private downloads: DownloadsApi;
  private session: SessionStore | null;
  private waiters = new Map<number, Waiter>();

  constructor(
    dataModelManager: DataModelManager,
    // A factory, not an instance: capability detection (offscreen vs direct)
    // belongs at export time, not at service construction
    portFactory: () => ObjectUrlPort,
    downloads: DownloadsApi = browser.downloads as unknown as DownloadsApi,
    // storage.session is absent on older Firefox; orphan cleanup is
    // best-effort there (the page death that kills a waiter kills its
    // blob URL too)
    session: SessionStore | null = (browser.storage as { session?: SessionStore })
      .session ?? null,
  ) {
    this.dataModelManager = dataModelManager;
    this.portFactory = portFactory;
    this.downloads = downloads;
    this.session = session;
    // Registered at construction so a restarted worker hears terminal events
    // for downloads the previous worker started
    this.downloads.onChanged.addListener(this.handleDownloadChanged.bind(this));
  }

  private get port(): ObjectUrlPort {
    this.portInstance ??= this.portFactory();
    return this.portInstance;
  }

  /**
   * Run the export pipeline. Resolves with the terminal outcome; the user
   * dismissing the save dialog is a decision (outcome "canceled"), not an
   * error.
   */
  async handleExport(): Promise<ExportResponse> {
    try {
      await this.flushBestEffort();

      const envelope = await createExport();
      const url = await this.port.mint(serializeEnvelope(envelope));

      try {
        let downloadId: number;
        try {
          downloadId = await this.downloads.download({
            url,
            filename: buildExportFilename(new Date()),
            saveAs: true,
          });
        } catch (error) {
          // Firefox rejects download() when the save dialog is dismissed
          const message =
            error instanceof Error ? error.message : String(error);
          if (isCancelIndicator(message)) {
            return { success: true, data: { outcome: "canceled" } };
          }
          throw error;
        }

        await this.stashPending({ downloadId, url });
        await this.waitForCompletion(downloadId);
        return { success: true, data: { outcome: "success" } };
      } catch (error) {
        if (error instanceof DownloadCanceledError) {
          return { success: true, data: { outcome: "canceled" } };
        }
        throw error;
      } finally {
        await this.clearPending();
        await this.port.release(url).catch((releaseError) => {
          console.warn("ExportHandler: object URL release failed", releaseError);
        });
      }
    } catch (error) {
      console.error("ExportHandler.handleExport error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async flushBestEffort(): Promise<void> {
    try {
      await this.dataModelManager.checkpointNow();
    } catch (error) {
      // A slightly stale backup beats none
      console.warn("ExportHandler: session flush failed, exporting anyway", error);
    }
  }

  private waitForCompletion(downloadId: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(downloadId);
        reject(new Error("Download timed out"));
      }, DOWNLOAD_TIMEOUT_MS);
      this.waiters.set(downloadId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  private handleDownloadChanged(
    delta: browser.downloads._OnChangedDownloadDelta,
  ): void {
    const state = delta.state?.current;
    if (state !== "complete" && state !== "interrupted") {
      return;
    }

    const waiter = this.waiters.get(delta.id);
    if (waiter) {
      this.waiters.delete(delta.id);
      if (state === "complete") {
        waiter.resolve();
      } else {
        const cause = delta.error?.current ?? "interrupted";
        waiter.reject(
          isCancelIndicator(cause)
            ? new DownloadCanceledError(cause)
            : new Error(`Download ${cause}`),
        );
      }
      return;
    }

    // No waiter: the worker that started this download is gone. Clean up the
    // orphaned object URL / offscreen document it left behind.
    void this.cleanupOrphan(delta.id);
  }

  private async cleanupOrphan(downloadId: number): Promise<void> {
    const pending = await this.readPending();
    if (pending?.downloadId !== downloadId) {
      return;
    }
    await this.clearPending();
    await this.port.release(pending.url).catch(() => {
      // The context holding the URL may already be gone — nothing to leak
    });
  }

  private async stashPending(pending: PendingExport): Promise<void> {
    await this.session
      ?.set({ [PENDING_EXPORT_KEY]: pending })
      .catch(() => undefined);
  }

  private async readPending(): Promise<PendingExport | null> {
    if (!this.session) return null;
    try {
      const result = await this.session.get(PENDING_EXPORT_KEY);
      return (result[PENDING_EXPORT_KEY] as PendingExport) ?? null;
    } catch {
      return null;
    }
  }

  private async clearPending(): Promise<void> {
    await this.session?.remove(PENDING_EXPORT_KEY).catch(() => undefined);
  }
}
