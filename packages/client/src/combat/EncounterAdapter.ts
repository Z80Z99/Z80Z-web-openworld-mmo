/**
 * Phase 3H.3: Encounter Adapter
 *
 * Maps ClientCombatState → EncounterPanel payloads.
 * This adapter bridges the new structured state model with the legacy
 * EncounterPanel UI component, allowing gradual migration.
 *
 * Server authority: All values come from ClientCombatState which is
 * populated from server events. No client-side computation.
 */

import type { ClientCombatState, ClientCombatParticipant } from "../game/CombatState.js";

/** Payload expected by EncounterPanel.show() */
export interface EncounterShowPayload {
  readonly mobId: string;
  readonly mobName: string;
  readonly mobLevel: number;
  readonly mobHp: number;
  readonly mobMaxHp: number;
  readonly turn: "player" | "mob";
  readonly round: number;
}

/** Payload expected by EncounterPanel.update() */
export interface EncounterUpdatePayload {
  readonly turn: "player" | "mob";
  readonly round: number;
  readonly mobHp: number;
  readonly playerDefending?: boolean;
}

/**
 * Extracts the local player's participant from a combat state.
 * Returns undefined if the local player is not in the combat.
 */
export function findLocalParticipant(
  combat: ClientCombatState,
  localPlayerId: string,
): ClientCombatParticipant | undefined {
  return combat.participants.find((p) => p.participantId === localPlayerId);
}

/**
 * Extracts the enemy participant from a combat state.
 * For 1v1 encounters, returns the single enemy.
 * For multi-participant, returns the first alive enemy.
 */
export function findEnemyParticipant(
  combat: ClientCombatState,
  localPlayerId: string,
): ClientCombatParticipant | undefined {
  return combat.participants.find(
    (p) => p.side === "enemy" && p.alive && p.participantId !== localPlayerId,
  );
}

/**
 * Maps ClientCombatState to EncounterPanel show payload.
 * Used when an encounter starts.
 */
export function toEncounterShowPayload(
  combat: ClientCombatState,
  localPlayerId: string,
  mobName: string,
  mobLevel: number,
): EncounterShowPayload | null {
  const enemy = findEnemyParticipant(combat, localPlayerId);
  if (!enemy) return null;

  const isPlayerTurn = combat.currentActorId === localPlayerId;

  return {
    mobId: enemy.participantId,
    mobName,
    mobLevel,
    mobHp: enemy.currentHp,
    mobMaxHp: enemy.maxHp,
    turn: isPlayerTurn ? "player" : "mob",
    round: combat.round,
  };
}

/**
 * Maps ClientCombatState to EncounterPanel update payload.
 * Used on each turn change or HP update.
 */
export function toEncounterUpdatePayload(
  combat: ClientCombatState,
  localPlayerId: string,
): EncounterUpdatePayload | null {
  const enemy = findEnemyParticipant(combat, localPlayerId);
  if (!enemy) return null;

  const isPlayerTurn = combat.currentActorId === localPlayerId;
  const localParticipant = findLocalParticipant(combat, localPlayerId);

  return {
    turn: isPlayerTurn ? "player" : "mob",
    round: combat.round,
    mobHp: enemy.currentHp,
    playerDefending: localParticipant?.defending,
  };
}

/**
 * Determines if the encounter should be hidden (combat resolved).
 */
export function shouldHideEncounter(combat: ClientCombatState): boolean {
  return combat.state === "RESOLVED";
}

/**
 * Maps terminal combat events to encounter panel hide trigger.
 */
export function isTerminalEvent(
  eventType: string,
): boolean {
  return (
    eventType === "mob_killed" ||
    eventType === "player_died" ||
    eventType === "encounter_fled" ||
    eventType === "encounter_timeout"
  );
}
