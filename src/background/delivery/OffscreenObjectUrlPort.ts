/**
 * OffscreenObjectUrlPort - Object URL creation via Chrome's offscreen
 * document (the MV3 service worker has no URL.createObjectURL).
 *
 * Manages the extension's singleton offscreen document: ensure-on-mint
 * (tolerating the concurrent-create race), close-on-release. The document
 * itself runs the same shared blobUrl module as the Firefox direct path;
 * this class only dispatches to it over targeted runtime messages.
 */

import type {
  MessageResponse,
  OffscreenMintUrlMessage,
  OffscreenReleaseUrlMessage,
} from "../../../types";
import type { ObjectUrlPort } from "./ObjectUrlPort";

/** Offscreen document entrypoint (built by WXT from src/entrypoints/offscreen). */
export const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html";

/**
 * The slice of Chrome APIs this port needs, injectable for tests and
 * narrowly typed because the project compiles against Firefox-oriented
 * webextension-polyfill types with no chrome.offscreen namespace.
 */
export interface OffscreenDeps {
  hasDocument(): Promise<boolean>;
  createDocument(): Promise<void>;
  closeDocument(): Promise<void>;
  sendMessage(message: unknown): Promise<unknown>;
}

export class OffscreenObjectUrlPort implements ObjectUrlPort {
  private deps: OffscreenDeps;

  constructor(deps: OffscreenDeps) {
    this.deps = deps;
  }

  async mint(json: string): Promise<string> {
    await this.ensureDocument();

    const message: OffscreenMintUrlMessage = {
      type: "OFFSCREEN_MINT_URL",
      target: "offscreen",
      payload: { json },
      id: `mint-${Date.now()}`,
      timestamp: Date.now(),
    };
    const response = (await this.deps.sendMessage(
      message,
    )) as MessageResponse<{ url: string }> | undefined;

    if (!response?.success || !response.data?.url) {
      throw new Error(
        response?.error ?? "Offscreen document failed to mint object URL",
      );
    }
    return response.data.url;
  }

  async release(url: string): Promise<void> {
    const message: OffscreenReleaseUrlMessage = {
      type: "OFFSCREEN_RELEASE_URL",
      target: "offscreen",
      payload: { url },
      id: `release-${Date.now()}`,
      timestamp: Date.now(),
    };
    try {
      await this.deps.sendMessage(message);
    } finally {
      // Close regardless: a failed revoke message must not leak the
      // document, and closing it releases its URLs anyway.
      await this.deps.closeDocument().catch(() => {
        // Already closed (or never created) — nothing to tear down
      });
    }
  }

  private async ensureDocument(): Promise<void> {
    if (await this.deps.hasDocument()) {
      return;
    }
    try {
      await this.deps.createDocument();
    } catch (error) {
      // A concurrent mint can win the singleton-create race; the error is
      // benign iff the document exists now
      if (!(await this.deps.hasDocument())) {
        throw error;
      }
    }
  }
}

// Narrow structural types for the chrome.* surface we touch (no @types/chrome)
interface ChromeOffscreenNamespace {
  createDocument(options: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
  closeDocument(): Promise<void>;
}

interface ChromeRuntimeNamespace {
  getContexts(filter: { contextTypes: string[] }): Promise<unknown[]>;
}

interface ChromeGlobal {
  offscreen?: ChromeOffscreenNamespace;
  runtime?: Partial<ChromeRuntimeNamespace>;
}

/** Build real deps from the chrome global. Throws where the API is absent. */
export function chromeOffscreenDeps(): OffscreenDeps {
  const chrome = (globalThis as { chrome?: ChromeGlobal }).chrome;
  const offscreen = chrome?.offscreen;
  const getContexts = chrome?.runtime?.getContexts?.bind(chrome.runtime);
  if (!offscreen || !getContexts) {
    throw new Error(
      "Offscreen API unavailable — no direct createObjectURL and no chrome.offscreen",
    );
  }

  return {
    hasDocument: async (): Promise<boolean> => {
      const contexts = await getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
      return contexts.length > 0;
    },
    createDocument: (): Promise<void> =>
      offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["BLOBS"],
        justification:
          "Create a blob object URL for the user-initiated data export download",
      }),
    closeDocument: (): Promise<void> => offscreen.closeDocument(),
    sendMessage: (message: unknown): Promise<unknown> =>
      browser.runtime.sendMessage(message),
  };
}
