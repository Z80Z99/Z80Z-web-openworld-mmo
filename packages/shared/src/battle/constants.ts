import type { BattleRulesConfig } from "./types.js";

/* ── Default battle rule configuration (Phase 0 balancing values) ──
 *
 * Centralised so the pure rules never scatter magic numbers.
 * These are tunable defaults; every rule accepts an explicit config
 * override for customisation and testing.
 */
export const DEFAULT_BATTLE_RULES_CONFIG: BattleRulesConfig = {
  area: {
    baseRadius: 8,
    expansionRate: 24,
    diminishingReturnScale: 4,
    maxRadius: 32,
  },
  engagement: {
    maxEngagementDistance: 12,
    cowardFleeRatio: 0.75,
    cowardEngageRatio: 1.25,
    cautiousEngageRatio: 1,
  },
} as const;

/* ── Phase 3I-3B: Battle turn timing constants ──
 *
 * Migrated from the removed EncounterSystem (formerly TURN_TIMEOUT_MS /
 * MOB_TURN_DELAY_MS). Renamed to New Combat semantic names. Values kept
 * byte-identical so existing turn/timing behavior is preserved.
 */
/** Player turn timeout in ms — auto-defends when exceeded. */
export const BATTLE_TURN_TIMEOUT_MS = 12_000;
/** Delay before a mob's first turn after a combat starts (in ms). */
export const BATTLE_MOB_TURN_DELAY_MS = 800;
