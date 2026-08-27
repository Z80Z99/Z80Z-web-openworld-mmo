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
