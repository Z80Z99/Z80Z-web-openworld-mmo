/**
 * Phase 3H.3: Client Battle State Types
 *
 * Simplified mirror of shared BattleGroup/BattleSide/BattleParticipant
 * for client-side rendering. Client does NOT compute these — receives
 * from server events and normalizes into these structures.
 *
 * Server authority: All fields are populated from server events.
 * Client never recalculates battle area, turn order, or initiative.
 */

/** Continuous world-space position (tiles). */
export interface BattlePoint {
  readonly x: number;
  readonly y: number;
}

/** A circular area in world space. */
export interface BattleArea {
  readonly center: BattlePoint;
  readonly radius: number;
}

/** Client-side battle participant (simplified from shared BattleParticipant). */
export interface ClientBattleParticipant {
  readonly id: string;
  readonly position: BattlePoint;
  readonly state: ParticipantState;
}

/** Side-level lifecycle state. */
export type BattleState = "ACTIVE" | "FLEEING" | "RESOLVED" | "ELIMINATED";

/** Individual participant lifecycle state. */
export type ParticipantState = "ACTIVE" | "FLEEING" | "ELIMINATED";

/** One side of a battle (player or enemy). */
export interface ClientBattleSide {
  readonly id: string;
  readonly leaderId: string | null;
  readonly participants: readonly ClientBattleParticipant[];
  readonly area: BattleArea;
  readonly state: BattleState;
}

/** Client-side battle group: two opposing sides. */
export interface ClientBattleState {
  readonly battleId: string;
  readonly playerSide: ClientBattleSide;
  readonly enemySide: ClientBattleSide;
}

/** Null state when no battle is active. */
export const NO_BATTLE: null = null;
