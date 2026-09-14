/**
 * Tests for the offscreen object-URL port: singleton lifecycle, the
 * concurrent-create race, and mint/release message dispatch.
 */

import type { MessageResponse } from "../../../types";
import {
  OffscreenObjectUrlPort,
  type OffscreenDeps,
} from "./OffscreenObjectUrlPort";

interface DepsOverrides {
  hasDocument?: jest.Mock;
  createDocument?: jest.Mock;
  closeDocument?: jest.Mock;
  sendMessage?: jest.Mock;
}

function makeDeps(overrides: DepsOverrides = {}): {
  deps: OffscreenDeps;
  mocks: Required<DepsOverrides>;
} {
  const mocks = {
    hasDocument: overrides.hasDocument ?? jest.fn().mockResolvedValue(false),
    createDocument:
      overrides.createDocument ?? jest.fn().mockResolvedValue(undefined),
    closeDocument:
      overrides.closeDocument ?? jest.fn().mockResolvedValue(undefined),
    sendMessage:
      overrides.sendMessage ??
      jest.fn().mockResolvedValue({
        success: true,
        data: { url: "blob:minted" },
      } satisfies MessageResponse<{ url: string }>),
  };
  return { deps: mocks, mocks };
}

describe("OffscreenObjectUrlPort.mint", () => {
  it("creates the document when absent, then mints via targeted message", async () => {
    const { deps, mocks } = makeDeps();
    const port = new OffscreenObjectUrlPort(deps);

    const url = await port.mint('{"a":1}');

    expect(url).toBe("blob:minted");
    expect(mocks.createDocument).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OFFSCREEN_MINT_URL",
        target: "offscreen",
        payload: { json: '{"a":1}' },
      }),
    );
  });

  it("skips creation when the document already exists", async () => {
    const { deps, mocks } = makeDeps({
      hasDocument: jest.fn().mockResolvedValue(true),
    });

    await new OffscreenObjectUrlPort(deps).mint("{}");

    expect(mocks.createDocument).not.toHaveBeenCalled();
  });

  it("tolerates losing the singleton-create race", async () => {
    // First existence check says absent; create fails because a concurrent
    // caller won; re-check finds the document present
    const { deps, mocks } = makeDeps({
      hasDocument: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
      createDocument: jest
        .fn()
        .mockRejectedValue(new Error("Only a single offscreen document...")),
    });

    await expect(new OffscreenObjectUrlPort(deps).mint("{}")).resolves.toBe(
      "blob:minted",
    );
    expect(mocks.createDocument).toHaveBeenCalledTimes(1);
  });

  it("propagates a genuine create failure", async () => {
    const { deps } = makeDeps({
      createDocument: jest.fn().mockRejectedValue(new Error("boom")),
    });

    await expect(new OffscreenObjectUrlPort(deps).mint("{}")).rejects.toThrow(
      "boom",
    );
  });

  it("throws when the offscreen document reports failure", async () => {
    const { deps } = makeDeps({
      sendMessage: jest
        .fn()
        .mockResolvedValue({ success: false, error: "mint exploded" }),
    });

    await expect(new OffscreenObjectUrlPort(deps).mint("{}")).rejects.toThrow(
      "mint exploded",
    );
  });
});

describe("OffscreenObjectUrlPort.release", () => {
  it("sends the release message then closes the document", async () => {
    const { deps, mocks } = makeDeps();

    await new OffscreenObjectUrlPort(deps).release("blob:minted");

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OFFSCREEN_RELEASE_URL",
        target: "offscreen",
        payload: { url: "blob:minted" },
      }),
    );
    expect(mocks.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("still closes the document when the release message fails", async () => {
    const { deps, mocks } = makeDeps({
      sendMessage: jest.fn().mockRejectedValue(new Error("no receiver")),
    });

    await expect(
      new OffscreenObjectUrlPort(deps).release("blob:minted"),
    ).rejects.toThrow("no receiver");
    expect(mocks.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("swallows close failures (already-closed documents)", async () => {
    const { deps } = makeDeps({
      closeDocument: jest
        .fn()
        .mockRejectedValue(new Error("No current offscreen document")),
    });

    await expect(
      new OffscreenObjectUrlPort(deps).release("blob:minted"),
    ).resolves.toBeUndefined();
  });
});
