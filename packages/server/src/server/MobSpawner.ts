import { CHUNK_SIZE, Biome, TileType } from "@mmo/shared";
import { WorldGenerator, lookupBiome, normalise } from "@mmo/shared";
import { AOIManager } from "./AOI.js";
import {
  type MobInstance,
  type MobTypeConfig,
  type CombatEvent,
  MOB_TYPES,
  getMobTypeForBiome,
} from "./CombatSystem.js";

/* ── Constants ── */

const MAX_MOBS_PER_CHUNK = 5;
const RESPAWN_TIME_MS = 30_000;
const AGGRO_RANGE = 5; // tiles — how close a mob notices a player
const LEASH_RANGE = 30; // tiles — how far a mob will chase before giving up
const COMBAT_LEASH_TIMEOUT = 5000; // ms — how long a mob maintains aggro after leaving combat range
const PATROL_RANGE = 5; // tiles
const MOB_SPEED = 2; // tiles per second
const MOB_ATTACK_RANGE = 1.5; // tiles

/* ── Tile → Biome Reverse Lookup ── */

function tileToBiome(tile: TileType): Biome | undefined {
  switch (tile) {
    case TileType.Forest: return Biome.Forest;
    case TileType.Sand: return Biome.Desert;
    case TileType.Stone: return Biome.Mountains;
    case TileType.Grass: return Biome.Plains;
    case TileType.Snow: return Biome.Tundra;
    case TileType.Swamp: return Biome.Swamp;
    default: return undefined;
  }
}

/* ── MobSpawner Class ── */

/**
 * Manages mob spawning, AI, and lifecycle.
 * Each tick updates mob AI state (patrol, aggro, chase, dead).
 */
export class MobSpawner {
  /** All active mobs keyed by mob ID. */
  private readonly mobs = new Map<string, MobInstance>();

  /** Mobs per chunk for spawn limiting: "cx,cy" → count. */
  private readonly chunkMobCounts = new Map<string, number>();

  /** Counter for unique mob IDs. */
  private nextMobId = 1;

  private readonly worldGen: WorldGenerator;
  /** Invoked with a mob ID immediately before it is removed from the world
   *  (AOI chunk prune). Lets the room release any encounter referencing it. */
  private readonly onMobRemoved?: (mobId: string) => void;

  constructor(worldGen: WorldGenerator, onMobRemoved?: (mobId: string) => void) {
    this.worldGen = worldGen;
    this.onMobRemoved = onMobRemoved;
  }

  /** Get all active mobs (including dead ones awaiting respawn). */
  getAllMobs(): Map<string, MobInstance> {
    return this.mobs;
  }

  /** Get a specific mob by ID. */
  getMob(id: string): MobInstance | undefined {
    return this.mobs.get(id);
  }

  /* ── Spawning ── */

  /**
   * Spawn mobs in a chunk if needed.
   * Determines biome from terrain and spawns appropriate mob types.
   */
  spawnMobsForChunk(cx: number, cy: number): MobInstance[] {
    const key = `${cx},${cy}`;
    const currentCount = this.chunkMobCounts.get(key) ?? 0;
    const remaining = MAX_MOBS_PER_CHUNK - currentCount;
    if (remaining <= 0) return [];

    const chunk = this.worldGen.generateChunk(cx, cy);
    const spawned: MobInstance[] = [];

    // Sample tiles to determine dominant biome
    const biome = this.getDominantBiome(chunk.tiles);
    if (biome === undefined) return [];

    const mobConfig = getMobTypeForBiome(biome);
    if (!mobConfig) return [];

    for (let i = 0; i < remaining; i++) {
      const mob = this.createMob(mobConfig, cx, cy, chunk.tiles);
      if (mob) {
        this.mobs.set(mob.id, mob);
        this.chunkMobCounts.set(key, (this.chunkMobCounts.get(key) ?? 0) + 1);
        spawned.push(mob);
      }
    }

    return spawned;
  }

  /**
   * Remove all mobs in a chunk (called when no players can see it).
   */
  removeMobsForChunk(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    for (const [id, mob] of this.mobs) {
      if (mob.chunkX === cx && mob.chunkY === cy) {
        this.onMobRemoved?.(id);
        this.mobs.delete(id);
      }
    }
    this.chunkMobCounts.delete(key);
  }

  /* ── AI Tick ── */

  /**
   * Update all mob AI. Called once per game tick.
   * @param dt - Delta time in seconds.
   * @param players - Map of sessionId → { x, y, health }.
   * @param now - Current timestamp in ms.
   * @returns Events to process (damage, death, etc.).
   */
  tick(
    dt: number,
    players: Map<string, { x: number; y: number; health: number }>,
    now: number,
  ): CombatEvent[] {
    const events: CombatEvent[] = [];

    for (const [, mob] of this.mobs) {
      // Handle dead mobs — check for respawn
      if (mob.aiState === "dead") {
        if (now - mob.deathTime >= RESPAWN_TIME_MS) {
          this.respawnMob(mob, now);
        }
        continue;
      }

      // Skip AI for mobs locked in a turn-based encounter
      if (mob.aiState === "fighting" || mob.inEncounter) {
        continue;
      }

      // Find nearest player for aggro check
      const nearest = this.findNearestPlayer(mob, players);

      // AI state transitions
      if (!mob.aggroTarget) {
        // No current target — check for aggro
        if (nearest && nearest.distance <= AGGRO_RANGE) {
          mob.aggroTarget = nearest.sessionId;
          mob.aiState = "chase";
        } else if (mob.aiState === "idle" || !mob.patrolTarget) {
          // Start patrolling
          mob.aiState = "patrol";
          mob.patrolTarget = this.getRandomPatrolTarget(mob);
        }
      } else {
        // Has aggro target — check leash range
        const target = players.get(mob.aggroTarget);
        if (!target) {
          // Target disconnected
          mob.aggroTarget = null;
          mob.aiState = "patrol";
          mob.patrolTarget = this.getRandomPatrolTarget(mob);
        } else {
          const dist = this.distance(mob.x, mob.y, target.x, target.y);
          if (dist > LEASH_RANGE) {
            // Check combat leash — maintain aggro briefly after leaving combat range
            const timeSinceLastCombat = now - mob.lastCombatTime;
            if (timeSinceLastCombat < COMBAT_LEASH_TIMEOUT) {
              // Still within combat leash timeout — keep chasing
            } else {
              // Leashed — return to spawn
              mob.aggroTarget = null;
              mob.aiState = "patrol";
              mob.patrolTarget = { x: mob.spawnX, y: mob.spawnY };
            }
          }
        }
      }

      // Move mob
      this.moveMob(mob, dt, now, players, events);
    }

    return events;
  }

  /* ── Private: Mob Creation ── */

  private createMob(
    config: MobTypeConfig,
    cx: number,
    cy: number,
    tiles: TileType[][],
  ): MobInstance | null {
    // Try to find a valid spawn position in the chunk
    const chunkPx = CHUNK_SIZE;

    for (let attempt = 0; attempt < 10; attempt++) {
      const lx = Math.floor(Math.random() * chunkPx);
      const ly = Math.floor(Math.random() * chunkPx);

      // Check tile is walkable (not water)
      const tile = tiles[ly]?.[lx];
      if (tile === undefined) continue;
      if (tile === TileType.Water || tile === TileType.DeepWater) continue;

      // World position
      const wx = cx * chunkPx + lx + 0.5;
      const wy = cy * chunkPx + ly + 0.5;

      const mobId = `mob_${this.nextMobId++}`;

      return {
        id: mobId,
        typeId: config.id,
        config,
        x: wx,
        y: wy,
        currentHp: config.baseHp,
        maxHp: config.baseHp,
        aggroTarget: null,
        aiState: "idle",
        inEncounter: false,
        pendingEncounterTarget: null,
        patrolTarget: null,
        spawnX: wx,
        spawnY: wy,
        chunkX: cx,
        chunkY: cy,
        deathTime: 0,
        lastAttackTime: 0,
        lastCombatTime: 0,
        synced: false,
      };
    }

    return null;
  }

  /* ── Private: AI Helpers ── */

  private findNearestPlayer(
    mob: MobInstance,
    players: Map<string, { x: number; y: number; health: number }>,
  ): { sessionId: string; distance: number } | null {
    let nearest: { sessionId: string; distance: number } | null = null;

    for (const [sessionId, player] of players) {
      if (player.health <= 0) continue;
      const dist = this.distance(mob.x, mob.y, player.x, player.y);
      if (!nearest || dist < nearest.distance) {
        nearest = { sessionId, distance: dist };
      }
    }

    return nearest;
  }

  private moveMob(
    mob: MobInstance,
    dt: number,
    now: number,
    players: Map<string, { x: number; y: number; health: number }>,
    events: CombatEvent[],
  ): void {
    let targetX: number;
    let targetY: number;

    if (mob.aggroTarget) {
      const target = players.get(mob.aggroTarget);
      if (!target) return;
      targetX = target.x;
      targetY = target.y;

      // Check attack range
      const dist = this.distance(mob.x, mob.y, targetX, targetY);
      if (dist <= MOB_ATTACK_RANGE) {
        // Mark for encounter — GameLoop will begin the turn-based combat.
        mob.pendingEncounterTarget = mob.aggroTarget;
        return;
      }
    } else if (mob.patrolTarget) {
      targetX = mob.patrolTarget.x;
      targetY = mob.patrolTarget.y;

      // Check if reached patrol target
      const dist = this.distance(mob.x, mob.y, targetX, targetY);
      if (dist < 0.5) {
        mob.patrolTarget = this.getRandomPatrolTarget(mob);
        return;
      }
    } else {
      return;
    }

    // Move toward target
    const dx = targetX - mob.x;
    const dy = targetY - mob.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.1) {
      const moveDistance = Math.min(MOB_SPEED * dt, dist);
      mob.x += (dx / dist) * moveDistance;
      mob.y += (dy / dist) * moveDistance;
    }
  }

  private respawnMob(mob: MobInstance, now: number): void {
    mob.currentHp = mob.maxHp;
    mob.aiState = "idle";
    mob.aggroTarget = null;
    mob.inEncounter = false;
    mob.pendingEncounterTarget = null;
    mob.patrolTarget = null;
    mob.deathTime = 0;
    mob.lastAttackTime = 0;
    mob.lastCombatTime = 0;

    // Respawn at a random position near spawn
    const offset = (Math.random() - 0.5) * 4;
    mob.x = mob.spawnX + offset;
    mob.y = mob.spawnY + (Math.random() - 0.5) * 4;
  }

  private getRandomPatrolTarget(mob: MobInstance): { x: number; y: number } {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * PATROL_RANGE;
    return {
      x: mob.spawnX + Math.cos(angle) * dist,
      y: mob.spawnY + Math.sin(angle) * dist,
    };
  }

  /* ── Private: Helpers ── */

  private getDominantBiome(tiles: TileType[][]): Biome | undefined {
    // Sample a grid of tiles to determine dominant biome
    const counts = new Map<Biome, number>();
    const step = 4;

    for (let y = 0; y < CHUNK_SIZE; y += step) {
      for (let x = 0; x < CHUNK_SIZE; x += step) {
        const tile = tiles[y]?.[x];
        if (tile === undefined) continue;
        const biome = tileToBiome(tile);
        if (biome !== undefined) {
          counts.set(biome, (counts.get(biome) ?? 0) + 1);
        }
      }
    }

    // Find biome with highest count
    let dominant: Biome | undefined;
    let maxCount = 0;
    for (const [biome, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        dominant = biome;
      }
    }

    return dominant;
  }

  private distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
