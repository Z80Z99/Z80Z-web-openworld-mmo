import { getTitleForLevel, getNewTitleOnLevelUp } from "./TitleData.js";
import type { PlayerState } from "@mmo/shared";

/* ── Types ── */

export interface TitleUpdate {
  oldTitle: string;
  newTitle: string;
}

/* ── TitleSystem ── */

/**
 * Server-side title management.
 *
 * Titles are cosmetic-only and unlock based on player level.
 * The title is stored on PlayerState.title and syncs to all clients.
 */
export class TitleSystem {
  /**
   * Check if a level change unlocks a new title.
   * Updates PlayerState.title if a new title was earned.
   *
   * Returns a TitleUpdate if the title changed, null otherwise.
   */
  checkLevelUp(player: PlayerState, oldLevel: number, newLevel: number): TitleUpdate | null {
    const newTitle = getNewTitleOnLevelUp(oldLevel, newLevel);
    if (!newTitle) return null;

    const oldTitle = player.title;
    player.title = newTitle;

    return { oldTitle, newTitle };
  }

  /**
   * Set the title on a player based on their current level.
   * Used during initial player load.
   */
  syncTitle(player: PlayerState): void {
    player.title = getTitleForLevel(player.level);
  }
}
