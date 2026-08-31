/**
 * BattlePanel HP Resolution
 *
 * Resolves HP for a BattlePanel participant by looking up the corresponding
 * CombatState participant. When CombatState is unavailable, returns a safe
 * fallback (no hardcoded 100/100).
 */

import type { ClientCombatParticipant } from "../game/CombatState.js";

/**
 * Look up HP from CombatState for a given battle participant.
 *
 * @param battleParticipantId - The participant ID from BattleState
 * @param combatParticipants - The participants array from CombatState (may be undefined)
 * @returns { currentHp, maxHp } from CombatState, or { 0, 0 } when unavailable
 */
export function resolveBattleParticipantHp(
  battleParticipantId: string,
  combatParticipants: readonly ClientCombatParticipant[] | undefined,
): { currentHp: number; maxHp: number } {
  if (!combatParticipants) return { currentHp: 0, maxHp: 0 };
  const cp = combatParticipants.find((p) => p.participantId === battleParticipantId);
  if (!cp) return { currentHp: 0, maxHp: 0 };
  return { currentHp: cp.currentHp, maxHp: cp.maxHp };
}
