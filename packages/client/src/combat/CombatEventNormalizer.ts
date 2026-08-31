/**
 * Phase 3H.3: Combat Event Normalizer
 *
 * Converts raw server combat_event payloads into strongly-typed events.
 * Handles all 10 event types from the server protocol.
 *
 * Server authority: This normalizer does NOT compute or validate —
 * it only types the incoming data. All values come from the server.
 */

import type {
  ClientBattleState,
  ClientBattleSide,
  ClientBattleParticipant,
  BattleArea,
  BattlePoint,
  BattleState,
  ParticipantState,
} from "../game/BattleState.js";

import type {
  ClientCombatState,
  ClientCombatParticipant,
  CombatSessionState,
} from "../game/CombatState.js";

/* ── Raw Event Types (from server) ── */

export type CombatEventType =
  | "damage_dealt"
  | "mob_killed"
  | "player_damaged"
  | "player_died"
  | "xp_gained"
  | "loot_dropped"
  | "player_respawn"
  | "level_up"
  | "mob_respawn"
  | "encounter_started"
  | "defend"
  | "encounter_fled"
  | "encounter_timeout";

/** Raw combat event from server (untyped payload). */
export interface RawCombatEvent {
  readonly type: string;
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly damage?: number;
  readonly xp?: number;
  readonly loot?: string[];
  readonly currentHp?: number;
  readonly maxHp?: number;
  readonly mobType?: string;
  readonly level?: number;
  readonly attack?: number;
  readonly defense?: number;
  readonly mobId?: string;
  readonly reason?: string;
  readonly round?: number;
  readonly combatId?: string;
  readonly currentActorId?: string;
}

/* ── Normalized Event Types ── */

export interface NormalizedEncounterStarted {
  readonly type: "encounter_started";
  readonly mobId: string;
  readonly combatId: string | null;
  readonly currentActorId: string | null;
}

export interface NormalizedDamageDealt {
  readonly type: "damage_dealt";
  readonly sourceId: string;
  readonly targetId: string;
  readonly damage: number;
  readonly currentHp: number;
  readonly maxHp: number;
}

export interface NormalizedPlayerDamaged {
  readonly type: "player_damaged";
  readonly sourceId: string;
  readonly targetId: string;
  readonly damage: number;
  readonly currentHp: number;
  readonly maxHp: number;
}

export interface NormalizedMobKilled {
  readonly type: "mob_killed";
  readonly sourceId: string;
  readonly targetId: string;
  readonly mobType?: string;
}

export interface NormalizedPlayerDied {
  readonly type: "player_died";
  readonly sourceId: string;
  readonly targetId: string;
}

export interface NormalizedEncounterFled {
  readonly type: "encounter_fled";
  readonly sourceId: string;
  readonly targetId: string;
}

export interface NormalizedXpGained {
  readonly type: "xp_gained";
  readonly sourceId: string;
  readonly targetId: string;
  readonly xp: number;
}

export interface NormalizedLevelUp {
  readonly type: "level_up";
  readonly sourceId: string;
  readonly targetId: string;
  readonly level: number;
  readonly attack: number;
  readonly defense: number;
}

export interface NormalizedPlayerRespawn {
  readonly type: "player_respawn";
  readonly sourceId: string;
  readonly targetId: string;
  readonly currentHp: number;
  readonly maxHp: number;
}

export interface NormalizedLootDropped {
  readonly type: "loot_dropped";
  readonly sourceId: string;
  readonly targetId: string;
  readonly loot: string[];
}

export type NormalizedCombatEvent =
  | NormalizedEncounterStarted
  | NormalizedDamageDealt
  | NormalizedPlayerDamaged
  | NormalizedMobKilled
  | NormalizedPlayerDied
  | NormalizedEncounterFled
  | NormalizedXpGained
  | NormalizedLevelUp
  | NormalizedPlayerRespawn
  | NormalizedLootDropped;

/* ── Normalizer ── */

/**
 * Normalizes a raw combat event into a strongly-typed event.
 * Returns null if the event type is unknown or required fields are missing.
 */
export function normalizeCombatEvent(raw: RawCombatEvent): NormalizedCombatEvent | null {
  switch (raw.type) {
    case "encounter_started":
      return normalizeEncounterStarted(raw);
    case "damage_dealt":
      return normalizeDamageDealt(raw);
    case "player_damaged":
      return normalizePlayerDamaged(raw);
    case "mob_killed":
      return normalizeTerminal(raw, "mob_killed");
    case "player_died":
      return normalizeTerminal(raw, "player_died");
    case "encounter_fled":
      return normalizeTerminal(raw, "encounter_fled");
    case "xp_gained":
      return normalizeXpGained(raw);
    case "level_up":
      return normalizeLevelUp(raw);
    case "player_respawn":
      return normalizePlayerRespawn(raw);
    case "loot_dropped":
      return normalizeLootDropped(raw);
    default:
      return null;
  }
}

function normalizeEncounterStarted(raw: RawCombatEvent): NormalizedEncounterStarted | null {
  if (!raw.mobId) return null;
  return {
    type: "encounter_started",
    mobId: raw.mobId,
    combatId: raw.combatId ?? null,
    currentActorId: raw.currentActorId ?? null,
  };
}

function normalizeDamageDealt(raw: RawCombatEvent): NormalizedDamageDealt | null {
  if (!raw.sourceId || !raw.targetId) return null;
  return {
    type: "damage_dealt",
    sourceId: raw.sourceId,
    targetId: raw.targetId,
    damage: raw.damage ?? 0,
    currentHp: raw.currentHp ?? 0,
    maxHp: raw.maxHp ?? 0,
  };
}

function normalizePlayerDamaged(raw: RawCombatEvent): NormalizedPlayerDamaged | null {
  if (!raw.sourceId || !raw.targetId) return null;
  return {
    type: "player_damaged",
    sourceId: raw.sourceId,
    targetId: raw.targetId,
    damage: raw.damage ?? 0,
    currentHp: raw.currentHp ?? 0,
    maxHp: raw.maxHp ?? 0,
  };
}

function normalizeTerminal(
  raw: RawCombatEvent,
  type: "mob_killed" | "player_died" | "encounter_fled",
): NormalizedMobKilled | NormalizedPlayerDied | NormalizedEncounterFled | null {
  if (!raw.sourceId || !raw.targetId) return null;
  if (type === "mob_killed") {
    return { type, sourceId: raw.sourceId, targetId: raw.targetId, mobType: raw.mobType };
  }
  return { type, sourceId: raw.sourceId, targetId: raw.targetId } as any;
}

function normalizeXpGained(raw: RawCombatEvent): NormalizedXpGained | null {
  if (!raw.sourceId || !raw.targetId) return null;
  return {
    type: "xp_gained",
    sourceId: raw.sourceId,
    targetId: raw.targetId,
    xp: raw.xp ?? 0,
  };
}

function normalizeLevelUp(raw: RawCombatEvent): NormalizedLevelUp | null {
  if (!raw.sourceId || !raw.targetId) return null;
  return {
    type: "level_up",
    sourceId: raw.sourceId,
    targetId: raw.targetId,
    level: raw.level ?? 1,
    attack: raw.attack ?? 0,
    defense: raw.defense ?? 0,
  };
}

function normalizePlayerRespawn(raw: RawCombatEvent): NormalizedPlayerRespawn | null {
  if (!raw.sourceId || !raw.targetId) return null;
  return {
    type: "player_respawn",
    sourceId: raw.sourceId,
    targetId: raw.targetId,
    currentHp: raw.currentHp ?? 0,
    maxHp: raw.maxHp ?? 0,
  };
}

function normalizeLootDropped(raw: RawCombatEvent): NormalizedLootDropped | null {
  if (!raw.sourceId || !raw.targetId) return null;
  return {
    type: "loot_dropped",
    sourceId: raw.sourceId,
    targetId: raw.targetId,
    loot: raw.loot ?? [],
  };
}

/* ── State Builders ── */

/**
 * Builds a ClientBattleState from an encounter_started event.
 * Used for initial battle state creation.
 */
export function buildBattleStateFromEncounter(
  mobId: string,
  mobPosition: BattlePoint,
  playerPosition: BattlePoint,
): ClientBattleState {
  return {
    battleId: `battle-${mobId}`,
    playerSide: {
      id: "player",
      leaderId: null,
      participants: [],
      area: { center: playerPosition, radius: 0 },
      state: "ACTIVE",
    },
    enemySide: {
      id: "enemy",
      leaderId: mobId,
      participants: [{
        id: mobId,
        position: mobPosition,
        state: "ACTIVE",
      }],
      area: { center: mobPosition, radius: 0 },
      state: "ACTIVE",
    },
  };
}

/**
 * Builds a ClientCombatState from an encounter_started event.
 * Used for initial combat state creation.
 */
export function buildCombatStateFromEncounter(
  mobId: string,
  combatId: string | null,
  currentActorId: string | null,
): ClientCombatState {
  return {
    combatId: combatId ?? `combat-${mobId}`,
    battleId: `battle-${mobId}`,
    state: "ACTIVE",
    round: 1,
    currentActorId: currentActorId ?? mobId,
    turnOrder: [mobId],
    participants: [{
      participantId: mobId,
      currentHp: 0,
      maxHp: 0,
      alive: true,
      defending: false,
      fleeing: false,
      side: "enemy",
    }],
  };
}
