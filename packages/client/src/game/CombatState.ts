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

/** Legacy encounter fields for backward compatibility. */
export interface LegacyEncounterState {
  readonly inEncounter: boolean;
  readonly encounterMobId: string | null;
  readonly encounterMobHp: number;
  readonly encounterMobMaxHp: number;
  readonly encounterTurn: "player" | "mob";
  readonly encounterRound: number;
}

/** Default legacy encounter state. */
export const DEFAULT_LEGACY_ENCOUNTER: LegacyEncounterState = {
  inEncounter: false,
  encounterMobId: null,
  encounterMobHp: 0,
  encounterMobMaxHp: 0,
  encounterTurn: "player",
  encounterRound: 0,
};
