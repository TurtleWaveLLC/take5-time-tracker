// Contexts that receive messages on the shared runtime bus. Every context
// must return without responding for messages addressed elsewhere; an absent
// target means "background" (all pre-existing message types).
export type MessageTarget = "background" | "offscreen";

// Base message interface for all extension communications
export interface ExtensionMessage {
  type: string;
  payload: unknown;
  id: string;
  timestamp: number;
  // `| undefined` keeps generic Omit-and-respread call sites assignable
  // under exactOptionalPropertyTypes
  target?: MessageTarget | undefined;
}

// Message response wrapper for async communication
export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Message handler type definition
export type MessageHandler<T extends ExtensionMessage = ExtensionMessage> = (
  message: T,
  sender: browser.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void,
) => boolean | Promise<MessageResponse>;

// Message sender utility type
export interface MessageSender {
  sendMessage<T extends ExtensionMessage>(
    message: Omit<T, "id" | "timestamp">,
  ): Promise<MessageResponse>;
}

// ============================================================================
// Specific Message Types
// ============================================================================

import type { PillPosition } from "./index";

// Session state payload (shared by multiple message types)
export interface SessionStatePayload {
  domain: string;
  currentTime: number;
  isActive: boolean;
  isPaused: boolean;
  startTime: number;
}

// Request session state from background
export interface GetSessionStateMessage extends ExtensionMessage {
  type: "GET_SESSION_STATE";
  payload: { domain: string };
}

// Session state response
export interface SessionStateResponseMessage extends ExtensionMessage {
  type: "SESSION_STATE_RESPONSE";
  payload: SessionStatePayload | null;
}

// Refresh state reason discriminator
export type RefreshStateReason =
  | "tab_activated"
  | "navigation"
  | "settings_changed"
  | "service_ready";

// Signal content script to refresh state from storage
export interface RefreshStateMessage extends ExtensionMessage {
  type: "REFRESH_STATE";
  payload: {
    reason: RefreshStateReason;
  };
}

// Request settings from background
export interface GetSettingsMessage extends ExtensionMessage {
  type: "GET_SETTINGS";
  payload: Record<string, never>;
}

// Position change source discriminator
export type PositionChangeSource = "user_drag" | "window_resize";

// Update pill position
export interface UpdatePillPositionMessage extends ExtensionMessage {
  type: "UPDATE_PILL_POSITION";
  payload: {
    position: PillPosition;
    source: PositionChangeSource;
  };
}

// Update pill show full info setting
export interface UpdatePillShowFullInfoMessage extends ExtensionMessage {
  type: "UPDATE_PILL_SHOW_FULL_INFO";
  payload: {
    showFullInfo: boolean;
  };
}

// Update pill hidden setting
export interface UpdatePillHiddenMessage extends ExtensionMessage {
  type: "UPDATE_PILL_HIDDEN";
  payload: {
    hidden: boolean;
  };
}

// Request a full data export (any UI surface -> background). The response's
// data carries the terminal outcome; canceling the save dialog is a user
// decision reported as outcome "canceled", not an error.
export interface ExportDataMessage extends ExtensionMessage {
  type: "EXPORT_DATA";
  payload: Record<string, never>;
}

// Ask the offscreen document to create a blob object URL for the given JSON
// (Chrome only — the MV3 service worker has no createObjectURL)
export interface OffscreenMintUrlMessage extends ExtensionMessage {
  type: "OFFSCREEN_MINT_URL";
  target: "offscreen";
  payload: { json: string };
}

// Ask the offscreen document to revoke a previously minted object URL
export interface OffscreenReleaseUrlMessage extends ExtensionMessage {
  type: "OFFSCREEN_RELEASE_URL";
  target: "offscreen";
  payload: { url: string };
}

// Error report from content script
export interface ErrorReportMessage extends ExtensionMessage {
  type: "ERROR_REPORT";
  payload: {
    error: string;
    context: string;
    stackTrace?: string;
  };
}

// Union type for all extension messages
export type ExtensionMessageUnion =
  | GetSessionStateMessage
  | SessionStateResponseMessage
  | RefreshStateMessage
  | GetSettingsMessage
  | UpdatePillPositionMessage
  | UpdatePillShowFullInfoMessage
  | UpdatePillHiddenMessage
  | ExportDataMessage
  | OffscreenMintUrlMessage
  | OffscreenReleaseUrlMessage
  | ErrorReportMessage;
