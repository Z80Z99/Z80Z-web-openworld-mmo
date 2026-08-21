import { AOI_CHUNK_RADIUS, CHUNK_SIZE } from "@mmo/shared";
import { WorldGenerator } from "@mmo/shared";

export interface ChunkKey {
  cx: number;
  cy: number;
}

export interface PlayerAOI {
  /** Current chunk the player occupies. */
  chunkX: number;
  chunkY: number;
  /** Set of chunk keys the player can currently see (serialized as "cx,cy"). */
  visibleChunks: Set<string>;
}

/**
 * Area-of-Interest manager.
 *
 * Tracks which chunks each player can see and
 * computes the delta when a player moves to a new chunk.
 */
export class AOIManager {
  /** Per-player AOI state keyed by session ID. */
  private players: Map<string, PlayerAOI> = new Map();
  private worldGen: WorldGenerator;

  constructor(worldGen: WorldGenerator) {
    this.worldGen = worldGen;
  }

  /** Register a new player at chunk (cx, cy). Returns the initial visible chunks. */
  addPlayer(sessionId: string, cx: number, cy: number): ChunkKey[] {
    const visible = this.computeVisibleChunks(cx, cy);
    const visibleSet = new Set(visible.map((c) => `${c.cx},${c.cy}`));

    this.players.set(sessionId, {
      chunkX: cx,
      chunkY: cy,
      visibleChunks: visibleSet,
    });

    return visible;
  }

  /** Remove a player from tracking. */
  removePlayer(sessionId: string): void {
    this.players.delete(sessionId);
  }

  /**
   * Move a player to a new chunk. Returns the chunks that need action:
   *  - `entered`: chunks newly visible (send tile + entity data)
   *  - `exited`: chunks no longer visible (remove entities from client)
   *  - `unchanged`: chunks that remain visible
   *
   * If the player hasn't actually changed chunk, returns null.
   */
  movePlayer(
    sessionId: string,
    newCx: number,
    newCy: number,
  ): { entered: ChunkKey[]; exited: ChunkKey[]; unchanged: ChunkKey[] } | null {
    const aoi = this.players.get(sessionId);
    if (!aoi) return null;

    if (aoi.chunkX === newCx && aoi.chunkY === newCy) {
      return null;
    }

    const oldVisible = aoi.visibleChunks;
    const newVisibleKeys = this.computeVisibleChunks(newCx, newCy);
    const newVisibleSet = new Set(newVisibleKeys.map((c) => `${c.cx},${c.cy}`));

    const entered: ChunkKey[] = [];
    const unchanged: ChunkKey[] = [];

    for (const chunk of newVisibleKeys) {
      const key = `${chunk.cx},${chunk.cy}`;
      if (oldVisible.has(key)) {
        unchanged.push(chunk);
      } else {
        entered.push(chunk);
      }
    }

    const exited: ChunkKey[] = [];
    for (const key of oldVisible) {
      if (!newVisibleSet.has(key)) {
        const [cx, cy] = key.split(",").map(Number);
        exited.push({ cx, cy });
      }
    }

    // Update player state
    aoi.chunkX = newCx;
    aoi.chunkY = newCy;
    aoi.visibleChunks = newVisibleSet;

    return { entered, exited, unchanged };
  }

  /**
   * Get all chunk keys that a player can see.
   */
  getVisibleChunks(sessionId: string): ChunkKey[] {
    const aoi = this.players.get(sessionId);
    if (!aoi) return [];

    return Array.from(aoi.visibleChunks).map((key) => {
      const [cx, cy] = key.split(",").map(Number);
      return { cx, cy };
    });
  }

  /**
   * Get all players who can see a given chunk.
   */
  getPlayersWhoCanSeeChunk(cx: number, cy: number): string[] {
    const key = `${cx},${cy}`;
    const result: string[] = [];
    for (const [sessionId, aoi] of this.players) {
      if (aoi.visibleChunks.has(key)) {
        result.push(sessionId);
      }
    }
    return result;
  }

  /**
   * Check if a player can see a given chunk.
   */
  canPlayerSeeChunk(sessionId: string, cx: number, cy: number): boolean {
    const aoi = this.players.get(sessionId);
    if (!aoi) return false;
    return aoi.visibleChunks.has(`${cx},${cy}`);
  }

  /**
   * Get the player's current chunk coordinates.
   */
  getPlayerChunk(sessionId: string): ChunkKey | null {
    const aoi = this.players.get(sessionId);
    if (!aoi) return null;
    return { cx: aoi.chunkX, cy: aoi.chunkY };
  }

  /**
   * Generate tile data for a chunk using the WorldGenerator.
   * Returns flat tile array suitable for storing in TileState.
   */
  generateChunkTiles(cx: number, cy: number): number[] {
    const chunk = this.worldGen.generateChunk(cx, cy);
    const tiles: number[] = [];
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        tiles.push(chunk.tiles[y][x]);
      }
    }
    return tiles;
  }

  /**
   * Convert world position (x, y) to chunk coordinates.
   */
  static worldToChunk(x: number, y: number): ChunkKey {
    return {
      cx: Math.floor(x / CHUNK_SIZE),
      cy: Math.floor(y / CHUNK_SIZE),
    };
  }

  /** Internal: compute the visible chunk set around a center chunk. */
  private computeVisibleChunks(cx: number, cy: number): ChunkKey[] {
    const chunks: ChunkKey[] = [];
    const r = AOI_CHUNK_RADIUS;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        chunks.push({ cx: cx + dx, cy: cy + dy });
      }
    }
    return chunks;
  }
}
