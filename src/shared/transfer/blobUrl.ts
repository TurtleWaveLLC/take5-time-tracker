/**
 * Blob object-URL creation for export delivery.
 *
 * This module must only run in a document context (Firefox background page,
 * Chrome offscreen document, extension pages) — service workers have no
 * URL.createObjectURL, which is exactly why the ObjectUrlPort seam exists.
 * Keeping the DOM calls in one shared module is what unifies the wiring:
 * both browsers execute this code, they just reach it differently.
 */

export function mintJsonUrl(json: string): string {
  const blob = new Blob([json], { type: "application/json" });
  return URL.createObjectURL(blob);
}

export function releaseUrl(url: string): void {
  URL.revokeObjectURL(url);
}
