import {
  type PlayerState,
  type EntityState,
  type ChatMessage,
  type ClientMessage,
  CHUNK_SIZE,
} from "@mmo/shared";
import { WorldGenerator } from "@mmo/shared";

/** Local player identity and transient state. */
export interface LocalPlayer {
  id: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  name: string;
  level: number;
}

/** Remote player snapshot received from the server. */
export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  name: string;
  level: number;
  health: number;
}

/** Mob entity state received from the server. */
export interface MobState {
  id: string;
  typeId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  isAggro: boolean;
}

/** Combat event received from the server. */
export interface CombatEvent {
  type: string;
  sourceId: string;
  targetId: string;
  damage?: number;
  xp?: number;
  loot?: string[];
  currentHp?: number;
  maxHp?: number;
}

/**
 * Client-side game state.
 *
 * Maintains authoritative local player info, a map of remote players,
 * mob entities, and a deterministic WorldGenerator for client-side chunk prediction.
 */
export class GameState {
  /** The Colyseus session room id (set on join). */
  public roomId: string | null = null;

  /** Local player (set when room state arrives). */
  public localPlayer: LocalPlayer | null = null;

  /** Remote players keyed by Colyseus sessionId. */
  public readonly remotePlayers = new Map<string, RemotePlayer>();

  /** Mob entities keyed by entity ID. */
  public readonly mobs = new Map<string, MobState>();

  /** Currently targeted mob ID (for combat). */
  public targetedMobId: string | null = null;

  /** XP state. */
  public xp = 0;
  public xpToNextLevel = 100;

  /** Pending combat events to process. */
  public readonly pendingCombatEvents: CombatEvent[] = [];

  /** Client-side chunk prediction generator (seed must match server). */
  private readonly worldGen: WorldGenerator;

  /** Set of "cx,cy" keys for chunks the server has pushed. */
  private readonly serverChunks = new Set<string>();

  constructor(seed: number) {
    this.worldGen = new WorldGenerator(seed);
  }

  /* ── Local player ── */

  setLocalPlayer(id: string, state: PlayerState): void {
    this.localPlayer = {
      id,
      x: state.x,
      y: state.y,
      health: state.health,
      maxHealth: state.maxHealth,
      name: state.name,
      level: state.level,
    };
  }

  updateLocalPlayer(state: PlayerState): void {
    if (!this.localPlayer) return;
    this.localPlayer.x = state.x;
    this.localPlayer.y = state.y;
    this.localPlayer.health = state.health;
    this.localPlayer.maxHealth = state.maxHealth;
    this.localPlayer.name = state.name;
    this.localPlayer.level = state.level;
  }

  /** Client-side predicted movement (applied immediately before server ack). */
  predictMove(dx: number, dy: number, speed: number, dt: number): void {
    if (!this.localPlayer) return;
    this.localPlayer.x += dx * speed * dt;
    this.localPlayer.y += dy * speed * dt;
  }

  /* ── Remote players ── */

  addRemotePlayer(id: string, state: PlayerState): void {
    this.remotePlayers.set(id, {
      id,
      x: state.x,
      y: state.y,
      name: state.name,
      level: state.level,
      health: state.health,
    });
  }

  updateRemotePlayer(id: string, state: PlayerState): void {
    const p = this.remotePlayers.get(id);
    if (!p) return;
    p.x = state.x;
    p.y = state.y;
    p.name = state.name;
    p.level = state.level;
    p.health = state.health;
  }

  removeRemotePlayer(id: string): void {
    this.remotePlayers.delete(id);
  }

  /* ── Mobs ── */

  addMob(entity: EntityState): void {
    // Default max health estimate: mob HP * 2 for health bar display
    const maxHp = entity.health > 0 ? Math.max(entity.health, 50) : 50;
    this.mobs.set(entity.id, {
      id: entity.id,
      typeId: entity.type,
      x: entity.x,
      y: entity.y,
      health: entity.health,
      maxHealth: maxHp,
      isAggro: false,
    });
  }

  updateMob(entity: EntityState): void {
    const mob = this.mobs.get(entity.id);
    if (!mob) {
      this.addMob(entity);
      return;
    }
    mob.x = entity.x;
    mob.y = entity.y;
    mob.health = entity.health;

    // Remove mob if health reaches 0 (it's dead)
    if (entity.health <= 0) {
      this.mobs.delete(entity.id);
      if (this.targetedMobId === entity.id) {
        this.targetedMobId = null;
      }
    }
  }

  removeMob(id: string): void {
    this.mobs.delete(id);
    if (this.targetedMobId === id) {
      this.targetedMobId = null;
    }
  }

  /** Set aggro state for a mob. */
  setMobAggro(mobId: string, isAggro: boolean): void {
    const mob = this.mobs.get(mobId);
    if (mob) {
      mob.isAggro = isAggro;
    }
  }

  /* ── Combat ── */

  addCombatEvent(event: CombatEvent): void {
    this.pendingCombatEvents.push(event);
  }

  /** Drain pending combat events (call once per frame). */
  drainCombatEvents(): CombatEvent[] {
    return this.pendingCombatEvents.splice(0);
  }

  /* ── Chunk prediction ── */

  /** Mark a chunk key as received from server. */
  markServerChunk(cx: number, cy: number): void {
    this.serverChunks.add(`${cx},${cy}`);
  }

  /** Whether the server has sent this chunk yet. */
  hasServerChunk(cx: number, cy: number): boolean {
    return this.serverChunks.has(`${cx},${cy}`);
  }

  /** Client-side predicted chunk (same seed as server). */
  predictChunk(cx: number, cy: number) {
    return this.worldGen.generateChunk(cx, cy);
  }

  /** Derive which chunk coordinates a world-tile position belongs to. */
  static worldToChunk(wx: number, wy: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(wx / CHUNK_SIZE),
      cy: Math.floor(wy / CHUNK_SIZE),
    };
  }
}
