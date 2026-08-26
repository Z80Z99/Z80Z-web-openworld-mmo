import type { Room } from "@colyseus/core";
import type { RoomState } from "@mmo/shared";
import type { CombatEvent, MobInstance } from "./CombatSystem.js";

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
