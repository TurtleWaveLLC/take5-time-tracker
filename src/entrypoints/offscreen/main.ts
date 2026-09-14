/**
 * Offscreen document script (Chrome only).
 *
 * A minimal blob-URL factory for the background service worker: mints and
 * revokes object URLs on targeted messages, using the same shared blobUrl
 * module the Firefox background path calls directly. No other logic belongs
 * here — download initiation and completion tracking stay in the background.
 */

import type { ExtensionMessageUnion, MessageResponse } from "../../../types";
import { mintJsonUrl, releaseUrl } from "../../shared/transfer/blobUrl";

browser.runtime.onMessage.addListener(
  (
    message: ExtensionMessageUnion,
    _sender: browser.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ): boolean => {
    // Only answer messages addressed to this context; responding to anything
    // else would race the background's reply on the shared bus
    if (message?.target !== "offscreen") {
      return false;
    }

    switch (message.type) {
      case "OFFSCREEN_MINT_URL":
        try {
          sendResponse({
            success: true,
            data: { url: mintJsonUrl(message.payload.json) },
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return true;

      case "OFFSCREEN_RELEASE_URL":
        releaseUrl(message.payload.url);
        sendResponse({ success: true });
        return true;

      default:
        return false;
    }
  },
);
