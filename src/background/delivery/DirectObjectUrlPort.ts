/**
 * DirectObjectUrlPort - Object URL creation for contexts that have the DOM
 * API themselves (Firefox background pages, future MV3 event pages).
 */

import { mintJsonUrl, releaseUrl } from "../../shared/transfer/blobUrl";
import type { ObjectUrlPort } from "./ObjectUrlPort";

export class DirectObjectUrlPort implements ObjectUrlPort {
  async mint(json: string): Promise<string> {
    return mintJsonUrl(json);
  }

  async release(url: string): Promise<void> {
    releaseUrl(url);
  }
}
