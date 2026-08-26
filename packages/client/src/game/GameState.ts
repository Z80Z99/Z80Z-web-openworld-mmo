import {
  type PlayerState,
  type EntityState,
  type ChatMessage,
  type ClientMessage,
  type CombatEventPayload,
  CHUNK_SIZE,
  TileType,
} from "@mmo/shared";
import type { Chunk } from "@mmo/shared";
import { WorldGenerator } from "@mmo/shared";

/** Tile types that block movement (mirrors server's MovementSystem). */
const BLOCKED_TILES: ReadonlySet<TileType> = new Set([
  TileType.Water,
  TileType.WaterVariant1,
  TileType.WaterVariant2,
  TileType.DeepWater,
  TileType.DeepWaterVariant1,
  TileType.Stone,
  TileType.StoneVariant1,
  TileType.StoneVariant2,
]);

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
export type CombatEvent = CombatEventPayload;

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

  /** Chunk cache for getTileAt() — generateChunk() is expensive, never re-generate. */
  private readonly tileQueryCache = new Map<string, Chunk>();

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

  /**
   * Client-side predicted movement with collision detection.
   * Checks if target tile is walkable before applying movement.
   */
  predictMove(dx: number, dy: number, speed: number, dt: number): void {
    if (!this.localPlayer) return;
    const newX = this.localPlayer.x + dx * speed * dt;
    const newY = this.localPlayer.y + dy * speed * dt;
    // Only move if target tile is walkable
    if (this.validateTerrain(newX, newY)) {
      this.localPlayer.x = newX;
      this.localPlayer.y = newY;
    }
  }

  /**
   * Validate that a world position is on walkable terrain.
   * Mirrors server's MovementSystem.validateTerrain().
   *
   * Fail-closed: if chunk generation fails, the tile is treated as blocked.
   */
  validateTerrain(x: number, y: number): boolean {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);
    const localX = ((tileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((tileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunk = this.getOrGenerateChunk(chunkX, chunkY);
    if (!chunk) return false;
    const tile = chunk.tiles[localY]?.[localX];
    return tile !== undefined && !BLOCKED_TILES.has(tile);
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

  /**
   * Client-side predicted chunk (same seed as server).
   * Shares the unified chunk cache with getTileAt()/validateTerrain().
   */
  predictChunk(cx: number, cy: number): Chunk | null {
    return this.getOrGenerateChunk(cx, cy);
  }

  /**
   * Single shared chunk generation path. Every world coordinate resolves to
   * ONE generated Chunk instance regardless of who asks: movement prediction,
   * collision checks and renderer neighbour queries all reuse the same entry,
   * so generateChunk()'s full noise re-sample (~10k calls) runs at most once
   * per chunk per session.
   *
   * Returns null only when generation throws.
   */
  private getOrGenerateChunk(cx: number, cy: number): Chunk | null {
    const key = `${cx},${cy}`;
    let chunk = this.tileQueryCache.get(key);
    if (!chunk) {
      try {
        chunk = this.worldGen.generateChunk(cx, cy);
      } catch {
        return null;
      }
      this.tileQueryCache.set(key, chunk);
    }
    return chunk;
  }

  /**
   * Get any tile in the world by world coordinates (cross-chunk aware).
   * Used by TileRenderer for deterministic shore bitmask computation.
   * Returns null if the tile cannot be determined.
   *
   * Chunk results are cached: generateChunk() is a full noise re-sample
   * (~10k noise calls), and shore rendering queries it thousands of times
   * per chunk — without caching the main thread stalls on first render.
   */
  getTileAt(wx: number, wy: number): TileType | null {
    const tileX = Math.floor(wx);
    const tileY = Math.floor(wy);
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);
    const localX = ((tileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((tileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunk = this.getOrGenerateChunk(chunkX, chunkY);
    if (!chunk) return null;
    return chunk.tiles[localY]?.[localX] ?? null;
  }

  /** Derive which chunk coordinates a world-tile position belongs to. */
  static worldToChunk(wx: number, wy: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(wx / CHUNK_SIZE),
      cy: Math.floor(wy / CHUNK_SIZE),
    };
  }
}
