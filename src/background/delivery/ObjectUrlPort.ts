/**
 * ObjectUrlPort - The per-browser seam for turning export JSON into a URL
 * that browser.downloads.download can consume.
 *
 * Blob URLs require a document context. Firefox's background is a document;
 * Chrome's MV3 service worker is not, and Chrome's answer (the offscreen
 * API) doesn't exist in Firefox. This two-method port is the entire
 * per-browser surface — everything on either side of it is shared code.
 *
 * See docs/plans/data-export-design.md.
 */

import { DirectObjectUrlPort } from "./DirectObjectUrlPort";
import {
  OffscreenObjectUrlPort,
  chromeOffscreenDeps,
} from "./OffscreenObjectUrlPort";

export interface ObjectUrlPort {
  /** Produce a URL for the given JSON, valid until release() is called. */
  mint(json: string): Promise<string>;
  /** Revoke the URL and tear down any context created to host it. */
  release(url: string): Promise<void>;
}

/**
 * Select the delivery implementation by capability, not browser sniffing:
 * any context that can create object URLs directly should (Firefox MV2
 * background pages today, MV3 event pages later); only a true worker
 * context needs the offscreen document.
 */
export function createObjectUrlPort(): ObjectUrlPort {
  if (typeof URL.createObjectURL === "function") {
    return new DirectObjectUrlPort();
  }
  return new OffscreenObjectUrlPort(chromeOffscreenDeps());
}
