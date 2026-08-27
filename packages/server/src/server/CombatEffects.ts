import type { Room } from "@colyseus/core";
import type { RoomState, PlayerState } from "@mmo/shared";
import {
  type CombatEvent,
  type MobInstance,
  type PlayerCombatStats,
  calculateXpGain,
  hasLeveledUp,
  rollLoot,
} from "./CombatSystem.js";

/**
 * Apply combat events to Colyseus state, broadcast to clients,
 * and persist loot.  Extracted from GameRoom so GameLoop and
 * GameRoom can both use the same authoritative path.
 */
export function applyCombatEvents(
  room: Room<RoomState>,
  events: CombatEvent[],
  mob: MobInstance,
  attackerSessionId: string,
  getPlayerInventory: (playerId: string) => Map<string, number>,
  savePlayerInventory: (playerId: string, inventory: Map<string, number>) => void,
  getAuthData: (sessionId: string) => { playerId: string } | undefined,
): void {
  for (const event of events) {
    if (event.type === "player_damaged" || event.type === "player_died") {
      const player = room.state.players.get(event.targetId);
      if (player && event.currentHp !== undefined) {
        player.health = event.currentHp;
      }
      const targetClient = room.clients.getById(event.targetId);
      if (targetClient) {
        targetClient.send("combat_event", event);
      }
    }

    if (event.type === "mob_killed") {
      const entity = room.state.entities.get(mob.id);
      if (entity) {
        entity.health = 0;
      }
    }

    if (event.type === "damage_dealt") {
      const entity = room.state.entities.get(mob.id);
      if (entity && event.currentHp !== undefined) {
        entity.health = event.currentHp;
      }
    }

    if (
      event.type === "damage_dealt" ||
      event.type === "mob_killed" ||
      event.type === "xp_gained" ||
      event.type === "loot_dropped"
    ) {
      const combatClient = room.clients.getById(attackerSessionId);
      if (combatClient) {
        combatClient.send("combat_event", event);
      }
    }

    if (event.type === "loot_dropped" && event.loot?.length) {
      const authData = getAuthData(attackerSessionId);
      if (authData?.playerId) {
        const inventory = getPlayerInventory(authData.playerId);
        for (const itemId of event.loot) {
          inventory.set(itemId, (inventory.get(itemId) ?? 0) + 1);
        }
        savePlayerInventory(authData.playerId, inventory);
      }
    }
  }
}

/**
 * Send a combat event to the attacker's client.
 */
export function sendEncounterEvent(
  room: Room<RoomState>,
  sessionId: string,
  event: { type: string; [key: string]: unknown },
): void {
  const client = room.clients.getById(sessionId);
  if (client) {
    client.send("combat_event", event);
  }
}

/* ── Shared reward pipeline (single authoritative entry points) ── */

/** Context needed to apply level-ups for a player. */
export interface RewardContext {
  room: Room<RoomState>;
  player: PlayerState;
  playerStats: PlayerCombatStats;
  sessionId: string;
}

/**
 * Apply the level-up progression loop (single authoritative version).
 *
 * Replicates the exact stat increments, event payloads, and Schema
 * synchronization previously inlined in both the real-time attack handler
 * and the encounter victory handler of GameRoom.
 */
export function applyLevelUps(ctx: RewardContext): void {
  const { room, player, playerStats, sessionId } = ctx;

  while (hasLeveledUp(playerStats.xp, playerStats.xpToNextLevel)) {
    playerStats.xp -= playerStats.xpToNextLevel;
    player.level += 1;
    playerStats.attack += 2;
    playerStats.defense += 1;
    playerStats.xpToNextLevel = 100 * player.level;
    player.maxHealth += 20;
    player.health = player.maxHealth;

    sendEncounterEvent(room, sessionId, {
      type: "level_up",
      sourceId: sessionId,
      targetId: sessionId,
      level: player.level,
      attack: playerStats.attack,
      defense: playerStats.defense,
      currentHp: player.health,
      maxHp: player.maxHealth,
    });
  }

  player.xp = playerStats.xp;
  player.xpToNextLevel = playerStats.xpToNextLevel;
}

/** Context needed to resolve a mob killed by a player. */
export interface KillRewardContext extends RewardContext {
  mob: MobInstance;
  getPlayerInventory: (playerId: string) => Map<string, number>;
  savePlayerInventory: (playerId: string, inventory: Map<string, number>) => void;
  getAuthData: (sessionId: string) => { playerId: string } | undefined;
}

/**
 * Resolve a player-killed mob (single authoritative version).
 *
 * Marks the mob dead, then builds and applies the authoritative reward events
 * (one `mob_killed`, one `xp_gained`, optional `loot_dropped`) through
 * `applyCombatEvents` (Schema sync + client sends + loot persistence), then
 * runs the shared level-up loop. The caller must NOT emit a second
 * `mob_killed` — this function's kill event is the sole client-facing one.
 */
export function resolveMobKill(ctx: KillRewardContext): void {
  const { room, mob, playerStats, sessionId } = ctx;

  mob.currentHp = 0;
  mob.aiState = "dead";
  mob.deathTime = Date.now();
  mob.aggroTarget = null;

  const events: CombatEvent[] = [{ type: "mob_killed", sourceId: sessionId, targetId: mob.id }];

  const xpGain = calculateXpGain(mob.config.level);
  playerStats.xp += xpGain;
  events.push({ type: "xp_gained", sourceId: sessionId, targetId: mob.id, xp: xpGain });

  const loot = rollLoot(mob.config.lootTable);
  if (loot.length > 0) {
    events.push({ type: "loot_dropped", sourceId: sessionId, targetId: mob.id, loot });
  }

  applyCombatEvents(
    room,
    events,
    mob,
    sessionId,
    ctx.getPlayerInventory,
    ctx.savePlayerInventory,
    ctx.getAuthData,
  );

  applyLevelUps(ctx);
}
