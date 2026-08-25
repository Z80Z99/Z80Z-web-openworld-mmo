import { MOVE_SPEED, CHUNK_SIZE, TileType, WorldGenerator } from "@mmo/shared";
import type { PlayerState } from "@mmo/shared";

/**
 * Result of processing a single movement command.
 */
export interface MovementResult {
  /** Whether the movement was valid (speed + terrain). */
  valid: boolean;
  /** Final X position (corrected if invalid). */
  x: number;
  /** Final Y position (corrected if invalid). */
  y: number;
  /** Chunk X after movement. */
  chunkX: number;
  /** Chunk Y after movement. */
  chunkY: number;
}

/**
 * Pending movement command queued by message handlers.
 */
export interface MovementCommand {
  sessionId: string;
  targetX: number;
  targetY: number;
}

/** Tile types that block movement. */
const BLOCKED_TILES: ReadonlySet<TileType> = new Set([
  TileType.Water,
  TileType.WaterVariant1,
  TileType.WaterVariant2,
  TileType.DeepWater,
  TileType.DeepWaterVariant1,
  TileType.Stone, // Mountains biome
  TileType.StoneVariant1,
  TileType.StoneVariant2,
]);

/**
 * Server-side movement validation and processing.
 *
 * Responsibilities:
 *  - Validate movement speed does not exceed MOVE_SPEED.
 *  - Validate target position is walkable terrain (not water/mountains).
 *  - Clamp movement to valid speed and return corrected position.
 *  - Queue and batch-process movements per tick.
 */
export class MovementSystem {
  private readonly worldGen: WorldGenerator;
  private readonly movementQueue: MovementCommand[] = [];

  constructor(worldGen: WorldGenerator) {
    this.worldGen = worldGen;
  }

  /**
   * Enqueue a movement command for processing on the next tick.
   */
  queueMovement(sessionId: string, targetX: number, targetY: number): void {
    this.movementQueue.push({ sessionId, targetX, targetY });
  }

  /**
   * Drain and return all queued movement commands.
   * Used by GameLoop to process movements each tick.
   */
  drainQueue(): MovementCommand[] {
    return this.movementQueue.splice(0);
  }

  /**
   * Validate and process a single movement command.
   *
   * @param cmd      - The movement command to process.
   * @param player   - The player's current authoritative state.
   * @param dt       - Time elapsed since last tick (seconds).
   * @returns        - MovementResult with valid flag and final position.
   */
  processMovement(cmd: MovementCommand, player: PlayerState, dt: number): MovementResult {
    // 1. Speed validation: clamp movement to max distance per tick
    const clamped = this.clampSpeed(
      player.x,
      player.y,
      cmd.targetX,
      cmd.targetY,
      player.speed,
      dt,
    );

    // 2. Terrain validation: check if target tile is walkable
    const terrainValid = this.validateTerrain(clamped.x, clamped.y);

    if (!terrainValid) {
      // Reject movement entirely — stay at current position
      return {
        valid: false,
        x: player.x,
        y: player.y,
        chunkX: player.chunkX,
        chunkY: player.chunkY,
      };
    }

    // 3. Calculate new chunk
    const chunkX = Math.floor(clamped.x / CHUNK_SIZE);
    const chunkY = Math.floor(clamped.y / CHUNK_SIZE);

    return {
      valid: true,
      x: clamped.x,
      y: clamped.y,
      chunkX,
      chunkY,
    };
  }

  /**
   * Clamp target position to within max allowed distance from current position.
   * This prevents speed hacks and teleportation exploits.
   *
   * @returns Clamped {x, y} position.
   */
  clampSpeed(
    currentX: number,
    currentY: number,
    targetX: number,
    targetY: number,
    speed: number,
    dt: number,
  ): { x: number; y: number } {
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = speed * dt;

    if (distance <= maxDistance) {
      return { x: targetX, y: targetY };
    }

    const ratio = maxDistance / distance;
    return {
      x: currentX + dx * ratio,
      y: currentY + dy * ratio,
    };
  }

  /**
   * Validate that a world position is on walkable terrain.
   * Blocks Water, DeepWater, and Stone (Mountains) tiles.
   *
   * @param x - World X coordinate.
   * @param y - World Y coordinate.
   * @returns  true if the tile is walkable.
   */
  validateTerrain(x: number, y: number): boolean {
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);

    // Convert world tile coords to chunk + local coords
    // Handle negative coordinates correctly
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);
    const localX = ((tileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((tileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const chunk = this.worldGen.generateChunk(chunkX, chunkY);
    const tile = chunk.tiles[localY][localX];

    return !BLOCKED_TILES.has(tile);
  }
}
