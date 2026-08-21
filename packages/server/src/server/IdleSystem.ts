import type Database from "better-sqlite3";
import {
  WorldGenerator,
  Biome,
  TileType,
  CHUNK_SIZE,
  OFFLINE_CAP_HOURS,
} from "@mmo/shared";

/* ── Constants ── */

const MS_PER_HOUR = 60 * 60 * 1000;
const MIN_IDLE_MS = 60 * 1000; // 1 minute minimum

/** Biome → resource rate (per hour). Only 4 biomes yield idle resources. */
const BIOME_RATES: Partial<Record<Biome, { resource: string; rate: number }>> = {
  [Biome.Forest]: { resource: "Wood", rate: 2 },
  [Biome.Plains]: { resource: "Herb", rate: 1 },
  [Biome.Desert]: { resource: "Sand", rate: 1 },
  [Biome.Mountains]: { resource: "Stone", rate: 1 },
};

/* ── Types ── */

export interface IdleSummary {
  hours: number;
  resources: Record<string, number>;
}

export interface IdleClaimResult {
  success: boolean;
  resources: Record<string, number>;
}

function parseResourceRecord(value: string): Record<string, number> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const resources: Record<string, number> = {};
  for (const [resource, amount] of Object.entries(parsed)) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
    resources[resource] = amount;
  }
  return resources;
}

/* ── Tile → Biome reverse lookup (matches MobSpawner pattern) ── */

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

/* ── IdleSystem Class ── */

/**
 * Server-side idle/AFK resource accumulation system.
 *
 * Flow:
 *  1. On player leave  → recordLogout() saves timestamp
 *  2. On player join   → calculateIdleRewards() computes offline resources
 *  3. Player claims    → claimRewards() adds to inventory & clears record
 *
 * Resources are biome-dependent:
 *   Forest  → 2 Wood/hr
 *   Plains  → 1 Herb/hr
 *   Desert  → 1 Sand/hr
 *   Mountains → 1 Stone/hr
 */
export class IdleSystem {
  private readonly db: Database.Database;
  private readonly worldGen: WorldGenerator;

  constructor(db: Database.Database, worldGen: WorldGenerator) {
    this.db = db;
    this.worldGen = worldGen;
  }

  /**
   * Record player logout timestamp.
   * Called from GameRoom.onLeave().
   */
  recordLogout(playerId: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
      )
      .run(playerId, Date.now(), "{}");
  }

  /**
   * Calculate idle rewards on join.
   *
   * Reads `offline_accumulation` for the player, computes resources based on
   * offline time (capped at OFFLINE_CAP_HOURS) and the dominant biome at the
   * player's chunk position, stores the result, and returns a summary.
   *
   * @returns IdleSummary if resources exist, null otherwise.
   */
  calculateIdleRewards(
    playerId: string,
    chunkX: number,
    chunkY: number,
  ): IdleSummary | null {
    const row = this.db
      .prepare("SELECT last_logout FROM offline_accumulation WHERE player_id = ?")
      .get(playerId) as { last_logout: number } | undefined;

    if (!row?.last_logout) return null;

    const now = Date.now();
    const offlineMs = now - row.last_logout;

    // Too short — nothing to accumulate
    if (offlineMs < MIN_IDLE_MS) return null;

    const offlineHours = Math.min(OFFLINE_CAP_HOURS, offlineMs / MS_PER_HOUR);

    const biome = this.getDominantBiome(chunkX, chunkY);
    if (biome === undefined) return null;

    const rate = BIOME_RATES[biome];
    if (!rate || rate.rate <= 0) return null;

    const amount = Math.floor(offlineHours * rate.rate);
    if (amount <= 0) return null;

    const resources: Record<string, number> = { [rate.resource]: amount };

    // Persist calculated resources
    this.db
      .prepare("UPDATE offline_accumulation SET accumulated_resources = ? WHERE player_id = ?")
      .run(JSON.stringify(resources), playerId);

    return {
      hours: Math.round(offlineHours * 10) / 10,
      resources,
    };
  }

  /**
   * Claim accumulated idle resources.
   *
   * Adds resources to the player's inventory, deletes the accumulation
   * record, and returns the result. Prevents double-claiming.
   */
  claimRewards(playerId: string): IdleClaimResult {
    return this.db.transaction((): IdleClaimResult => {
      const row = this.db
        .prepare("SELECT accumulated_resources FROM offline_accumulation WHERE player_id = ?")
        .get(playerId) as { accumulated_resources: string } | undefined;
      if (!row?.accumulated_resources) return { success: false, resources: {} };

      const resources = parseResourceRecord(row.accumulated_resources);
      if (!resources || Object.keys(resources).length === 0) {
        return { success: false, resources: {} };
      }

      const invRow = this.db
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string } | undefined;
      const inventory = invRow?.inventory ? parseResourceRecord(invRow.inventory) ?? {} : {};

      for (const [resource, amount] of Object.entries(resources)) {
        inventory[resource] = (inventory[resource] ?? 0) + amount;
      }

      this.db
        .prepare("UPDATE players SET inventory = ? WHERE id = ?")
        .run(JSON.stringify(inventory), playerId);
      this.db.prepare("DELETE FROM offline_accumulation WHERE player_id = ?").run(playerId);
      return { success: true, resources };
    })();
  }

  /* ── Private helpers ── */

  /**
   * Determine the dominant biome for a chunk by sampling tiles.
   * Same algorithm as MobSpawner.getDominantBiome().
   */
  private getDominantBiome(chunkX: number, chunkY: number): Biome | undefined {
    const chunk = this.worldGen.generateChunk(chunkX, chunkY);
    const counts = new Map<Biome, number>();
    const step = 4;

    for (let y = 0; y < CHUNK_SIZE; y += step) {
      for (let x = 0; x < CHUNK_SIZE; x += step) {
        const tile = chunk.tiles[y]?.[x];
        if (tile === undefined) continue;
        const biome = tileToBiome(tile);
        if (biome !== undefined) {
          counts.set(biome, (counts.get(biome) ?? 0) + 1);
        }
      }
    }

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
}
