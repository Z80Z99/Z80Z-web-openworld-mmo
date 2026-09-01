import type { GameState } from "../game/GameState.js";

/** Read-only world snapshot for browser QA testing. */
export interface QASnapshot {
  readonly localPlayer: { readonly x: number; readonly y: number } | null;
  readonly mobs: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }>;
}

/** QA hook interface exposed on window.__QA__ in DEV mode. */
export interface QAHook {
  getWorldSnapshot(): QASnapshot;
}

/**
 * Install the DEV-only QA hook on window.__QA__.
 *
 * Provides a read-only snapshot of player and mob positions for
 * Playwright-based browser combat acceptance testing (Phase 4A.7).
 *
 * SAFE: Only installs in Vite DEV mode. Production builds tree-shake this away.
 * SAFE: Returns frozen objects — no mutation possible even if consumer ignores types.
 * SAFE: No setters, no spawn, no teleport, no position modification.
 */
export function installQAHook(gameState: GameState): void {
  if (!import.meta.env.DEV) return;

  const hook: QAHook = {
    getWorldSnapshot(): QASnapshot {
      const lp = gameState.localPlayer;
      return Object.freeze({
        localPlayer: lp ? Object.freeze({ x: lp.x, y: lp.y }) : null,
        mobs: Object.freeze(
          Array.from(gameState.mobs.values()).map((m) =>
            Object.freeze({ id: m.id, x: m.x, y: m.y })
          )
        ),
      }) as QASnapshot;
    },
  };

  (window as unknown as Record<string, unknown>).__QA__ = hook;
}
