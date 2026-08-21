import { CHUNK_SIZE, CHUNK_SIZE as CS } from "@mmo/shared";
import type { Chunk } from "@mmo/shared";

// ── Types ───────────────────────────────────────────────────────────────────

/** Cached chunk data (mirrors the shared Chunk shape without coupling). */
export interface ChunkData {
  readonly cx: number;
  readonly cy: number;
  readonly tiles: number[][];
}

/** Callback fired when a chunk is needed but not yet cached. */
export type ChunkRequestHandler = (cx: number, cy: number) => void;

/** World-space AABB. */
export interface ViewBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Result of a single {@link ChunkManager.update} call. */
export interface ChunkUpdateResult {
  /** Chunks that were unloaded (keys). */
  readonly unloaded: string[];
  /** Chunks requested from the server / predictor, sorted by distance. */
  readonly requested: ReadonlyArray<{ cx: number; cy: number; distance: number }>;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Pixels per tile (must match TileRenderer.TILE_PX). */
const TILE_PX = 16;
/** Pixels per chunk side. */
const CHUNK_PX = CHUNK_SIZE * TILE_PX;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build the canonical "cx,cy" map key. */
function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Euclidean distance between two chunk centres (in chunk units). */
function chunkDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Convert world-pixel bounds to chunk coordinate range. */
function boundsToChunkRange(bounds: ViewBounds): {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
} {
  return {
    minCx: Math.floor(bounds.left / CHUNK_PX),
    maxCx: Math.floor(bounds.right / CHUNK_PX),
    minCy: Math.floor(bounds.top / CHUNK_PX),
    maxCy: Math.floor(bounds.bottom / CHUNK_PX),
  };
}

// ── ChunkManager ────────────────────────────────────────────────────────────

/**
 * Manages chunk lifecycle: loading, caching, unloading, and viewport queries.
 *
 * Call {@link update} each frame with the player's chunk coordinates.
 * Missing chunks within the load radius trigger the {@link ChunkRequestHandler}.
 * Chunks beyond the unload radius are evicted from cache.
 */
export class ChunkManager {
  private readonly chunks = new Map<string, ChunkData>();
  private readonly requested = new Set<string>();
  private readonly requestHandler: ChunkRequestHandler;

  /** Radius (in chunks) at which to request new chunks. Default 4 → 9×9 area. */
  private readonly loadRadius: number;
  /** Radius at which to unload cached chunks. Slightly larger to add hysteresis. */
  private readonly unloadRadius: number;

  constructor(
    requestHandler: ChunkRequestHandler,
    options?: { loadRadius?: number; unloadRadius?: number },
  ) {
    this.requestHandler = requestHandler;
    this.loadRadius = options?.loadRadius ?? 4;
    this.unloadRadius = options?.unloadRadius ?? 5;
  }

  // ── Core ────────────────────────────────────────────────────────────────

  /**
   * Drive chunk loading / unloading from the player's current chunk position.
   * Returns what changed so the caller can react (render / send network msg).
   */
  update(playerCx: number, playerCy: number): ChunkUpdateResult {
    const unloaded = this.unloadDistant(playerCx, playerCy);
    const requested = this.requestNearby(playerCx, playerCy);
    return { unloaded, requested };
  }

  /** Cache a chunk (from prediction or server response). */
  addChunk(cx: number, cy: number, tiles: number[][]): void {
    const key = chunkKey(cx, cy);
    this.chunks.set(key, { cx, cy, tiles });
    this.requested.delete(key);
  }

  /** Retrieve cached chunk data, or undefined if not loaded. */
  getChunk(cx: number, cy: number): ChunkData | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  /** Whether the chunk is in the local cache. */
  hasChunk(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy));
  }

  /** Number of cached chunks. */
  get size(): number {
    return this.chunks.size;
  }

  /** All currently cached chunk keys (for diagnostics / pruning). */
  keys(): string[] {
    return [...this.chunks.keys()];
  }

  // ── Viewport query ──────────────────────────────────────────────────────

  /**
   * Return cached chunks whose bounding box overlaps the given world-space
   * viewport (with a 1-chunk buffer for smooth scrolling).
   */
  getChunksForViewport(bounds: ViewBounds): ChunkData[] {
    const pad = CHUNK_PX; // 1-chunk buffer
    const range = boundsToChunkRange({
      left: bounds.left - pad,
      right: bounds.right + pad,
      top: bounds.top - pad,
      bottom: bounds.bottom + pad,
    });

    const result: ChunkData[] = [];
    for (let cy = range.minCy; cy <= range.maxCy; cy++) {
      for (let cx = range.minCx; cx <= range.maxCx; cx++) {
        const c = this.chunks.get(chunkKey(cx, cy));
        if (c) result.push(c);
      }
    }
    return result;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Evict chunks farther than {@link unloadRadius} from the player.
   * Returns the keys of evicted chunks.
   */
  private unloadDistant(playerCx: number, playerCy: number): string[] {
    const evicted: string[] = [];
    for (const [key, data] of this.chunks) {
      if (chunkDistance(data.cx, data.cy, playerCx, playerCy) > this.unloadRadius) {
        this.chunks.delete(key);
        this.requested.delete(key);
        evicted.push(key);
      }
    }
    return evicted;
  }

  /**
   * Request missing chunks within {@link loadRadius}, sorted closest-first.
   * Each missing chunk triggers exactly one {@link ChunkRequestHandler} call.
   */
  private requestNearby(
    playerCx: number,
    playerCy: number,
  ): Array<{ cx: number; cy: number; distance: number }> {
    const candidates: Array<{ cx: number; cy: number; distance: number }> = [];
    const r = this.loadRadius;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = playerCx + dx;
        const cy = playerCy + dy;
        const key = chunkKey(cx, cy);
        if (this.chunks.has(key) || this.requested.has(key)) continue;

        const distance = chunkDistance(cx, cy, playerCx, playerCy);
        if (distance > this.loadRadius) continue;

        candidates.push({ cx, cy, distance });
      }
    }

    // Sort closest-first so the renderer prioritises near chunks.
    candidates.sort((a, b) => a.distance - b.distance);

    for (const c of candidates) {
      this.requested.add(chunkKey(c.cx, c.cy));
      this.requestHandler(c.cx, c.cy);
    }

    return candidates;
  }
}
