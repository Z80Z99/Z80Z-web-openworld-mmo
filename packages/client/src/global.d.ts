import type { QAHook } from "./qa/QAHook.js";

declare global {
  interface Window {
    /** DEV-only PixiJS app handle for headless QA. */
    __PIXI_APP__?: unknown;
    /** DEV-only debug handles for headless QA. */
    __GAME_DEBUG__?: unknown;
    /** DEV-only read-only QA hook (Phase 4A.7 browser combat acceptance). */
    __QA__?: QAHook;
  }
}

export {};
