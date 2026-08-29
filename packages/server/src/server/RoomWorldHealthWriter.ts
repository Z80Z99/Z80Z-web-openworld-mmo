import type { WorldHealthWriter } from "@mmo/shared";
import type { Room } from "@colyseus/core";
import type { RoomState } from "@mmo/shared";

/**
 * Adapts RoomState entity HP fields to the WorldHealthWriter interface.
 * This allows BattleCombatBridge to read/write world HP through Colyseus state.
 *
 * Phase 3G-2 (mob HP authority): MobInstance.currentHp is the authoritative
 * mob HP; EntityState.health is only a sync mirror (syncMobEntities copies
 * mob.currentHp → entity.health every tick). The writer therefore reads/writes
 * the MobInstance via an injected `getMob` provider, falling back to the
 * entity mirror when no provider is given (backward compatible). Players keep
 * using player.health directly (already authoritative).
 */
export class RoomWorldHealthWriter implements WorldHealthWriter {
  private room: Room<RoomState>;
  private getMob?: (entityId: string) => { currentHp: number; maxHp: number } | undefined;

  constructor(
    room: Room<RoomState>,
    getMob?: (entityId: string) => { currentHp: number; maxHp: number } | undefined,
  ) {
    this.room = room;
    this.getMob = getMob;
  }

  getHp(entityId: string): { currentHp: number; maxHp: number } | undefined {
    // Check players first
    const player = this.room.state.players.get(entityId);
    if (player) {
      return { currentHp: player.health, maxHp: player.maxHealth };
    }

    // Check mobs — MobInstance.currentHp is the authority when a provider exists
    const mob = this.getMob ? this.getMob(entityId) : undefined;
    if (mob) {
      return { currentHp: mob.currentHp, maxHp: mob.maxHp };
    }

    // Fallback: entity mirror (pre-3G-2 behavior)
    const entity = this.room.state.entities.get(entityId);
    if (entity) {
      return { currentHp: entity.health, maxHp: entity.maxHealth };
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

    // Update mobs — write the authoritative MobInstance and keep the mirror in sync
    const mob = this.getMob ? this.getMob(entityId) : undefined;
    if (mob) {
      mob.currentHp = Math.max(0, Math.min(hp, mob.maxHp));
      const entity = this.room.state.entities.get(entityId);
      if (entity) entity.health = mob.currentHp;
      return;
    }

    // Fallback: entity mirror
    const entity = this.room.state.entities.get(entityId);
    if (entity) {
      entity.health = Math.max(0, Math.min(hp, entity.maxHealth));
    }
  }

  isAlive(entityId: string): boolean {
    const hp = this.getHp(entityId);
    return hp !== undefined && hp.currentHp > 0;
  }
}
