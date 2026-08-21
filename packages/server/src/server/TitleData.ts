/**
 * Title definitions and progression.
 *
 * Titles unlock automatically when the player reaches the required level.
 * Titles are cosmetic only — no stat bonuses.
 */

export interface TitleDefinition {
  readonly name: string;
  readonly minLevel: number;
}

/** Titles ordered by level requirement (lowest first). */
export const TITLE_PROGRESSION: readonly TitleDefinition[] = [
  { name: "Newcomer", minLevel: 1 },
  { name: "Adventurer", minLevel: 5 },
  { name: "Explorer", minLevel: 10 },
  { name: "Veteran", minLevel: 20 },
  { name: "Hero", minLevel: 30 },
  { name: "Legend", minLevel: 50 },
] as const;

/**
 * Get the title for a given level.
 * Returns the highest-level title the player has unlocked.
 */
export function getTitleForLevel(level: number): string {
  let title = "";
  for (const t of TITLE_PROGRESSION) {
    if (level >= t.minLevel) {
      title = t.name;
    }
  }
  return title;
}

/**
 * Check if a level-up unlocks a new title.
 * Returns the new title name if one was unlocked, null otherwise.
 */
export function getNewTitleOnLevelUp(oldLevel: number, newLevel: number): string | null {
  const oldTitle = getTitleForLevel(oldLevel);
  const newTitle = getTitleForLevel(newLevel);
  if (newTitle !== oldTitle) {
    return newTitle;
  }
  return null;
}
