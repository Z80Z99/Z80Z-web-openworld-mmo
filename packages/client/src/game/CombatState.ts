/**
 * Phase 3H.3: Client Combat State Types
 *
 * Simplified mirror of shared CombatSession/CombatParticipantState
 * for client-side rendering. Client does NOT compute these — receives
 * from server events and normalizes into these structures.
 *
 * Server authority: All fields are populated from server events.
 * Client never recalculates damage, initiative, or turn order.
 */

/** Combat session lifecycle state. */
export type CombatSessionState = "FORMING" | "ACTIVE" | "RESOLVED";

/** Per-participant combat state. */
export interface ClientCombatParticipant {
  readonly participantId: string;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly defending: boolean;
  readonly fleeing: boolean;
  readonly side: "player" | "enemy";
}

/** Client-side combat session state. */
export interface ClientCombatState {
  readonly combatId: string;
  readonly battleId: string;
  readonly state: CombatSessionState;
  readonly round: number;
  readonly currentActorId: string;
  readonly turnOrder: readonly string[];
  readonly participants: readonly ClientCombatParticipant[];
}

/** Null state when no combat is active. */
export const NO_COMBAT: null = null;
