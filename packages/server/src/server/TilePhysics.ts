import { CHUNK_SIZE, TileType } from "@mmo/shared";
import type Database from "better-sqlite3";

// ── Extended tile types (not in shared enum) ────────────────────────────────

/** Fire tile type — extends the base TileType enum for physics only. */
export const FIRE_TYPE = 9;
/** Lava tile type — extends the base TileType enum for physics only. */
export const LAVA_TYPE = 10;

// ── Physics constants ──────────────────────────────────────────────────────

/** Maximum cascade depth per single tile change to prevent infinite loops. */
export const MAX_PROPAGATION_DEPTH = 10;

/** Fire spread probability per adjacent flammable tile per processing cycle. */
export const FIRE_SPREAD_CHANCE = 0.2;

/** Lava flow cooldown in milliseconds (1 tile per 5 seconds). */
export const LAVA_FLOW_COOLDOWN_MS = 5_000;

// ── Tile elevation map (for flow direction) ────────────────────────────────

/**
 * Elevation values per tile type — water and lava flow from higher to lower.
 * These are simplified heuristic values, not real-world elevations.
 */
const ELEVATION: Record<number, number> = {
  [TileType.DeepWater]: 0,
  [TileType.Water]: 1,
  [TileType.Ice]: 2,
  [TileType.Swamp]: 3,
  [TileType.Sand]: 4,
  [TileType.Grass]: 5,
  [TileType.Snow]: 6,
  [TileType.Forest]: 7,
  [TileType.Stone]: 8,
  [FIRE_TYPE]: 5,
  [LAVA_TYPE]: 1,
};

/** Get the elevation of a tile type. Unknown types default to 5. */
export function getElevation(tileType: number): number {
  return ELEVATION[tileType] ?? 5;
}

// ── Tile classification helpers ────────────────────────────────────────────

/** Tile types that water can flow into (replacing them). */
const WATER_FLOWABLE: ReadonlySet<number> = new Set([
  TileType.Grass,
  TileType.Sand,
  TileType.Snow,
  TileType.Swamp,
  TileType.Ice,
]);

/** Tile types that sand can pile onto. */
const SAND_FLOWABLE: ReadonlySet<number> = new Set([
  TileType.Grass,
  TileType.Snow,
  TileType.Swamp,
]);

/** Tile types that fire can spread to. */
const FLAMMABLE: ReadonlySet<number> = new Set([
  TileType.Forest,
  TileType.Swamp,
]);

/** Tile types that lava melts into water. */
const MELTABLE: ReadonlySet<number> = new Set([TileType.Ice, TileType.Snow]);

/** Tile types that are liquid (water or lava). */
const LIQUIDS: ReadonlySet<number> = new Set([
  TileType.Water,
  TileType.DeepWater,
  LAVA_TYPE,
]);

/** Tile types that block flow. */
const SOLID: ReadonlySet<number> = new Set([TileType.Stone]);

// ── Physics effect events ──────────────────────────────────────────────────

/** A single physics effect event to broadcast to clients. */
export interface PhysicsEffect {
  type: "water_flow" | "sand_pile" | "fire_spread" | "fire_burnout" | "lava_flow" | "lava_melt";
  x: number;
  y: number;
  /** Extra data for the effect (e.g., direction, target type). */
  data?: Record<string, unknown>;
}

/** A pending tile change to be applied. */
export interface TileChange {
  wx: number;
  wy: number;
  newType: number;
}

// ── TilePhysics ────────────────────────────────────────────────────────────

/**
 * Server-side tile physics simulation.
 *
 * Event-driven: only processes when tiles change, not every tick.
 * Handles water flow, sand piling, fire spread, and lava melting.
 *
 * Each tile change can cascade up to MAX_PROPAGATION_DEPTH tiles.
 */
export class TilePhysics {
  private db: Database.Database;
  private pendingChanges: TileChange[] = [];
  private processedKeys = new Set<string>();

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── Tile access helpers ────────────────────────────────────────────────

  /**
   * Read a tile value at world coordinates from the room state tiles map.
   * Returns the numeric tile type, or null if the chunk isn't loaded.
   */
  static getTileAt(
    tiles: Map<string, { tiles: { [idx: number]: number } }>,
    wx: number,
    wy: number,
  ): number | null {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const key = `${cx},${cy}`;
    const tileState = tiles.get(key);
    if (!tileState) return null;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return tileState.tiles[ly * CHUNK_SIZE + lx];
  }

  /**
   * Write a tile value at world coordinates into the room state tiles map.
   */
  static setTileAt(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    tileType: number,
  ): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const key = `${cx},${cy}`;
    const tileState = tiles.get(key);
    if (!tileState) return;

    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    tileState.tiles[ly * CHUNK_SIZE + lx] = tileType;
  }

  // ── Queue management ──────────────────────────────────────────────────

  /**
   * Queue a tile change for physics processing.
   * Call this when a player places a tile or when the world generator creates tiles.
   */
  queueChange(wx: number, wy: number, newType: number): void {
    this.pendingChanges.push({ wx, wy, newType });
  }

  /**
   * Check if there are pending changes to process.
   */
  hasPendingChanges(): boolean {
    return this.pendingChanges.length > 0;
  }

  /**
   * Get the number of pending changes.
   */
  getPendingCount(): number {
    return this.pendingChanges.length;
  }

  // ── Main physics processing ───────────────────────────────────────────

  /**
   * Process all pending tile changes and their cascading effects.
   *
   * @param tiles - The room state tiles map (mutated in place).
   * @param db    - Database reference for persisting tile edits.
   * @returns     - List of physics effect events for client rendering.
   */
  processChanges(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
  ): PhysicsEffect[] {
    const effects: PhysicsEffect[] = [];
    const changes = this.pendingChanges.splice(0);

    for (const change of changes) {
      const key = `${change.wx},${change.wy}`;
      if (this.processedKeys.has(key)) continue;

      this.processChange(tiles, change.wx, change.wy, change.newType, effects, 0);
    }

    this.processedKeys.clear();
    return effects;
  }

  /**
   * Process a single tile change and cascade to neighbors.
   */
  private processChange(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    newType: number,
    effects: PhysicsEffect[],
    depth: number,
  ): void {
    if (depth > MAX_PROPAGATION_DEPTH) return;

    const key = `${wx},${wy}`;
    if (this.processedKeys.has(key)) return;
    this.processedKeys.add(key);

    // Get the previous tile type
    const prevType = TilePhysics.getTileAt(tiles, wx, wy);
    if (prevType === null) return; // Chunk not loaded

    // Apply the change
    TilePhysics.setTileAt(tiles, wx, wy, newType);

    // Persist to DB
    this.persistTileEdit(wx, wy, newType);

    // Process physics based on the new tile type
    switch (newType) {
      case TileType.Water:
        this.processWaterFlow(tiles, wx, wy, effects, depth);
        break;
      case LAVA_TYPE:
        this.processLavaFlow(tiles, wx, wy, effects, depth);
        this.processLavaMelt(tiles, wx, wy, effects);
        break;
      case FIRE_TYPE:
        this.processFireSpread(tiles, wx, wy, effects, depth);
        break;
      default:
        // Check if this tile should have sand physics
        if (prevType === TileType.Sand || newType === TileType.Sand) {
          this.processSandPile(tiles, wx, wy, effects, depth);
        }
        break;
    }
  }

  // ── Water flow ────────────────────────────────────────────────────────

  /**
   * Water flows to adjacent tiles with lower elevation.
   * Water fills depressions and spreads across flat terrain.
   */
  private processWaterFlow(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    effects: PhysicsEffect[],
    depth: number,
  ): void {
    const waterElevation = getElevation(TileType.Water);
    const neighbors = this.getCardinalNeighbors(wx, wy);

    for (const [nx, ny] of neighbors) {
      const neighborType = TilePhysics.getTileAt(tiles, nx, ny);
      if (neighborType === null) continue;

      // Don't flow into solid tiles or existing liquids
      if (SOLID.has(neighborType) || LIQUIDS.has(neighborType)) continue;

      const neighborElevation = getElevation(neighborType);

      // Water flows to tiles with lower or equal elevation
      if (neighborElevation <= waterElevation && WATER_FLOWABLE.has(neighborType)) {
        effects.push({
          type: "water_flow",
          x: nx,
          y: ny,
          data: { fromX: wx, fromY: wy },
        });

        this.processChange(tiles, nx, ny, TileType.Water, effects, depth + 1);
      }
    }
  }

  // ── Sand piling ──────────────────────────────────────────────────────

  /**
   * Sand piles onto adjacent tiles with lower elevation.
   * Maintains a 45° angle of repose — sand only flows to tiles
   * at most 1 elevation level lower.
   */
  private processSandPile(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    effects: PhysicsEffect[],
    depth: number,
  ): void {
    const sandElevation = getElevation(TileType.Sand);
    const neighbors = this.getCardinalNeighbors(wx, wy);

    for (const [nx, ny] of neighbors) {
      const neighborType = TilePhysics.getTileAt(tiles, nx, ny);
      if (neighborType === null) continue;

      // Don't pile onto liquids, solid tiles, or fire/lava
      if (LIQUIDS.has(neighborType) || SOLID.has(neighborType)) continue;
      if (neighborType === FIRE_TYPE || neighborType === LAVA_TYPE) continue;

      const neighborElevation = getElevation(neighborType);

      // 45° angle of repose: sand flows to tiles at most 1 level lower
      if (sandElevation - neighborElevation <= 1 && SAND_FLOWABLE.has(neighborType)) {
        effects.push({
          type: "sand_pile",
          x: nx,
          y: ny,
          data: { fromX: wx, fromY: wy },
        });

        this.processChange(tiles, nx, ny, TileType.Sand, effects, depth + 1);
      }
    }
  }

  // ── Fire spread ──────────────────────────────────────────────────────

  /**
   * Fire spreads to adjacent flammable tiles (Forest, Swamp) with
   * a 20% probability per adjacent tile.
   */
  private processFireSpread(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    effects: PhysicsEffect[],
    depth: number,
  ): void {
    const neighbors = this.getCardinalNeighbors(wx, wy);

    for (const [nx, ny] of neighbors) {
      const neighborType = TilePhysics.getTileAt(tiles, nx, ny);
      if (neighborType === null) continue;

      // Only spread to flammable tiles
      if (!FLAMMABLE.has(neighborType)) continue;

      // 20% chance to spread
      if (Math.random() < FIRE_SPREAD_CHANCE) {
        effects.push({
          type: "fire_spread",
          x: nx,
          y: ny,
          data: { fromX: wx, fromY: wy },
        });

        this.processChange(tiles, nx, ny, FIRE_TYPE, effects, depth + 1);
      }
    }

    // Fire burns out after spreading — becomes grass (or stone if on mountain)
    // This happens after a short lifetime, handled by the caller
  }

  /**
   * Burn out a fire tile — convert to appropriate terrain.
   */
  burnOutFire(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
  ): PhysicsEffect[] {
    const effects: PhysicsEffect[] = [];
    const currentType = TilePhysics.getTileAt(tiles, wx, wy);
    if (currentType !== FIRE_TYPE) return effects;

    // Fire burns out to grass (or stays stone if surrounded by stone)
    const neighbors = this.getCardinalNeighbors(wx, wy);
    let stoneCount = 0;
    for (const [nx, ny] of neighbors) {
      const nType = TilePhysics.getTileAt(tiles, nx, ny);
      if (nType === TileType.Stone) stoneCount++;
    }

    const newType = stoneCount >= 3 ? TileType.Stone : TileType.Grass;

    effects.push({
      type: "fire_burnout",
      x: wx,
      y: wy,
      data: { newType },
    });

    TilePhysics.setTileAt(tiles, wx, wy, newType);
    this.persistTileEdit(wx, wy, newType);

    return effects;
  }

  // ── Lava flow ────────────────────────────────────────────────────────

  /**
   * Lava flows slowly to adjacent tiles with lower elevation.
   * Cooldown: 1 tile per 5 seconds.
   */
  private processLavaFlow(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    effects: PhysicsEffect[],
    depth: number,
  ): void {
    const lavaElevation = getElevation(LAVA_TYPE);
    const neighbors = this.getCardinalNeighbors(wx, wy);

    for (const [nx, ny] of neighbors) {
      const neighborType = TilePhysics.getTileAt(tiles, nx, ny);
      if (neighborType === null) continue;

      // Don't flow into solid tiles or existing lava
      if (SOLID.has(neighborType) || neighborType === LAVA_TYPE) continue;

      const neighborElevation = getElevation(neighborType);

      // Lava flows to lower elevation tiles
      if (neighborElevation < lavaElevation) {
        // Lava melts ice/snow — handled by processLavaMelt
        if (MELTABLE.has(neighborType)) continue;

        effects.push({
          type: "lava_flow",
          x: nx,
          y: ny,
          data: { fromX: wx, fromY: wy },
        });

        this.processChange(tiles, nx, ny, LAVA_TYPE, effects, depth + 1);
      }
    }
  }

  /**
   * Lava melts adjacent ice and snow tiles, converting them to water.
   */
  private processLavaMelt(
    tiles: Map<string, { tiles: { [idx: number]: number }; chunkX: number; chunkY: number }>,
    wx: number,
    wy: number,
    effects: PhysicsEffect[],
  ): void {
    const neighbors = this.getCardinalNeighbors(wx, wy);

    for (const [nx, ny] of neighbors) {
      const neighborType = TilePhysics.getTileAt(tiles, nx, ny);
      if (neighborType === null) continue;

      if (MELTABLE.has(neighborType)) {
        effects.push({
          type: "lava_melt",
          x: nx,
          y: ny,
          data: { fromType: neighborType, fromX: wx, fromY: wy },
        });

        TilePhysics.setTileAt(tiles, nx, ny, TileType.Water);
        this.persistTileEdit(nx, ny, TileType.Water);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Get the 4 cardinal neighbors of a tile position. */
  getCardinalNeighbors(wx: number, wy: number): [number, number][] {
    return [
      [wx, wy - 1], // North
      [wx, wy + 1], // South
      [wx - 1, wy], // West
      [wx + 1, wy], // East
    ];
  }

  /**
   * Persist a tile edit to the database.
   */
  private persistTileEdit(wx: number, wy: number, tileType: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    this.db
      .prepare(
        "INSERT INTO tile_edits (chunk_x, chunk_y, tile_x, tile_y, tile_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(cx, cy, lx, ly, tileType, Date.now());
  }

  /**
   * Check if a tile type is a physics-extended type (Fire or Lava).
   */
  static isExtendedType(tileType: number): boolean {
    return tileType === FIRE_TYPE || tileType === LAVA_TYPE;
  }

  /**
   * Get the display name for a tile type (including extended types).
   */
  static getTileTypeName(tileType: number): string {
    switch (tileType) {
      case TileType.Grass: return "Grass";
      case TileType.Water: return "Water";
      case TileType.Sand: return "Sand";
      case TileType.Stone: return "Stone";
      case TileType.Forest: return "Forest";
      case TileType.Snow: return "Snow";
      case TileType.DeepWater: return "DeepWater";
      case TileType.Swamp: return "Swamp";
      case TileType.Ice: return "Ice";
      case FIRE_TYPE: return "Fire";
      case LAVA_TYPE: return "Lava";
      default: return "Unknown";
    }
  }
}
