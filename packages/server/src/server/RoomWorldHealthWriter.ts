import type { WorldHealthWriter } from "@mmo/shared";
import type { Room } from "@colyseus/core";
import type { RoomState } from "@mmo/shared";

/**
 * Adapts RoomState entity HP fields to the WorldHealthWriter interface.
 * This allows BattleCombatBridge to read/write world HP through Colyseus state.
 */
export class RoomWorldHealthWriter implements WorldHealthWriter {
  private room: Room<RoomState>;

  constructor(room: Room<RoomState>) {
    this.room = room;
  }

  getHp(entityId: string): { currentHp: number; maxHp: number } | undefined {
    // Check players first
    const player = this.room.state.players.get(entityId);
    if (player) {
      return { currentHp: player.health, maxHp: player.maxHealth };
    }

    // Check mobs
    const mob = this.room.state.entities.get(entityId);
    if (mob) {
      return { currentHp: mob.health, maxHp: mob.maxHealth };
    }

    return undefined;
  }

  setHp(entityId: string, hp: number): void {
    // Update players
    const player = this.room.state.players.get(entityId);
    if (player) {
      player.health = Math.max(0, Math.min(hp, player.maxHealth));
      return;
    }

    // Update mobs
    const mob = this.room.state.entities.get(entityId);
    if (mob) {
      mob.health = Math.max(0, Math.min(hp, mob.maxHealth));
    }
  }

  isAlive(entityId: string): boolean {
    const hp = this.getHp(entityId);
    return hp !== undefined && hp.currentHp > 0;
  }
}
