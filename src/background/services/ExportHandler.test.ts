/**
 * Tests for the background export pipeline: flush -> collect -> mint ->
 * download -> completion -> release, plus cancel semantics and orphan
 * cleanup after a worker restart.
 */

import type { ObjectUrlPort } from "../delivery/ObjectUrlPort";
import type { DataModelManager } from "./DataModelManager";
import {
  ExportHandler,
  type DownloadsApi,
  type SessionStore,
} from "./ExportHandler";

jest.mock("../../shared/transfer/ExportService", () => ({
  createExport: jest.fn().mockResolvedValue({ fake: "envelope" }),
  serializeEnvelope: jest.fn().mockReturnValue('{"fake":"envelope"}'),
}));

type Delta = { id: number; state?: { current: string }; error?: { current: string } };

function makeHarness(overrides?: {
  download?: jest.Mock;
  checkpointNow?: jest.Mock;
}): {
  handler: ExportHandler;
  port: { mint: jest.Mock; release: jest.Mock };
  emitChange: (delta: Delta) => void;
  download: jest.Mock;
  checkpointNow: jest.Mock;
  sessionData: Record<string, unknown>;
} {
  let changeListener: ((delta: Delta) => void) | null = null;
  const download =
    overrides?.download ?? jest.fn().mockResolvedValue(41);
  const downloads: DownloadsApi = {
    download,
    onChanged: {
      addListener: (listener) => {
        changeListener = listener as (delta: Delta) => void;
      },
    },
  };

  const sessionData: Record<string, unknown> = {};
  const session: SessionStore = {
    get: jest.fn(async (key: string) => ({ [key]: sessionData[key] })),
    set: jest.fn(async (items: Record<string, unknown>) => {
      Object.assign(sessionData, items);
    }),
    remove: jest.fn(async (key: string) => {
      delete sessionData[key];
    }),
  };

  const port = {
    mint: jest.fn().mockResolvedValue("blob:minted"),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const checkpointNow =
    overrides?.checkpointNow ?? jest.fn().mockResolvedValue(undefined);
  const dataModelManager = {
    checkpointNow,
  } as unknown as DataModelManager;

  const handler = new ExportHandler(
    dataModelManager,
    () => port as unknown as ObjectUrlPort,
    downloads,
    session,
  );

  return {
    handler,
    port,
    emitChange: (delta) => changeListener?.(delta),
    download,
    checkpointNow,
    sessionData,
  };
}

async function settle(): Promise<void> {
  // Drain the microtask chains between handleExport() and waiter
  // registration (flush -> collect -> mint -> download -> stash) before
  // emitting the terminal download event
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ExportHandler.handleExport", () => {
  it("runs the full pipeline and reports success on completion", async () => {
    const h = makeHarness();

    const pending = h.handler.handleExport();
    await settle();
    h.emitChange({ id: 41, state: { current: "complete" } });

    const response = await pending;
    expect(response).toEqual({ success: true, data: { outcome: "success" } });
    expect(h.checkpointNow).toHaveBeenCalled();
    expect(h.port.mint).toHaveBeenCalledWith('{"fake":"envelope"}');
    expect(h.download).toHaveBeenCalledWith(
      expect.objectContaining({ url: "blob:minted", saveAs: true }),
    );
    expect(h.port.release).toHaveBeenCalledWith("blob:minted");
    expect(h.sessionData).toEqual({});
  });

  it("exports even when the session flush fails", async () => {
    const h = makeHarness({
      checkpointNow: jest.fn().mockRejectedValue(new Error("no session")),
    });

    const pending = h.handler.handleExport();
    await settle();
    h.emitChange({ id: 41, state: { current: "complete" } });

    expect((await pending).success).toBe(true);
  });

  it("treats a rejected download() with cancel text as canceled (Firefox dialog dismissal)", async () => {
    const h = makeHarness({
      download: jest
        .fn()
        .mockRejectedValue(new Error("Download canceled by the user")),
    });

    const response = await h.handler.handleExport();
    expect(response).toEqual({ success: true, data: { outcome: "canceled" } });
    expect(h.port.release).toHaveBeenCalled();
  });

  it("treats USER_CANCELED interruption as canceled (Chrome dialog dismissal)", async () => {
    const h = makeHarness();

    const pending = h.handler.handleExport();
    await settle();
    h.emitChange({
      id: 41,
      state: { current: "interrupted" },
      error: { current: "USER_CANCELED" },
    });

    const response = await pending;
    expect(response).toEqual({ success: true, data: { outcome: "canceled" } });
    expect(h.port.release).toHaveBeenCalled();
  });

  it("reports a non-cancel interruption as an error, still releasing the URL", async () => {
    const h = makeHarness();

    const pending = h.handler.handleExport();
    await settle();
    h.emitChange({
      id: 41,
      state: { current: "interrupted" },
      error: { current: "FILE_FAILED" },
    });

    const response = await pending;
    expect(response.success).toBe(false);
    expect(response.error).toContain("FILE_FAILED");
    expect(h.port.release).toHaveBeenCalled();
  });

  it("reports mint failures as errors without attempting a download", async () => {
    const h = makeHarness();
    h.port.mint.mockRejectedValue(new Error("offscreen unavailable"));

    const response = await h.handler.handleExport();
    expect(response.success).toBe(false);
    expect(h.download).not.toHaveBeenCalled();
  });

  it("ignores non-terminal download deltas", async () => {
    const h = makeHarness();

    const pending = h.handler.handleExport();
    await settle();
    h.emitChange({ id: 41, state: { current: "in_progress" } });
    h.emitChange({ id: 41, state: { current: "complete" } });

    expect((await pending).success).toBe(true);
  });
});

describe("ExportHandler orphan cleanup (worker restart)", () => {
  it("releases a stashed pending export when its terminal event has no waiter", async () => {
    const h = makeHarness();
    // Simulate state left by a previous worker: stash without a live waiter
    h.sessionData.pendingExport = { downloadId: 99, url: "blob:orphaned" };

    h.emitChange({ id: 99, state: { current: "complete" } });
    await settle();

    expect(h.port.release).toHaveBeenCalledWith("blob:orphaned");
    expect(h.sessionData).toEqual({});
  });

  it("ignores waiter-less events that do not match the stash", async () => {
    const h = makeHarness();
    h.sessionData.pendingExport = { downloadId: 99, url: "blob:orphaned" };

    h.emitChange({ id: 7, state: { current: "complete" } });
    await settle();

    expect(h.port.release).not.toHaveBeenCalled();
    expect(h.sessionData.pendingExport).toBeDefined();
  });
});
