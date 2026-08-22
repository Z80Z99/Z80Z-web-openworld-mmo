import { Graphics, Container, Sprite } from "pixi.js";
import { TileType, CHUNK_SIZE } from "@mmo/shared";
import type { Chunk } from "@mmo/shared";
import type { Camera } from "./Camera.js";
import {
  tileColor,
  waterShimmer,
  findAnimatedTiles,
  type AnimatedTile,
} from "./TileAnimations.js";
import { textureManager } from "./TextureManager.js";

// ── Palette ─────────────────────────────────────────────────────────────────

const TILE_COLORS: Record<number, number> = {
  [TileType.Grass]: 0x4a7c59,
  [TileType.Water]: 0x3498db,
  [TileType.Sand]: 0xf0d9b5,
  [TileType.Stone]: 0x95a5a6,
  [TileType.Forest]: 0x2d5016,
  [TileType.Snow]: 0xecf0f1,
  [TileType.DeepWater]: 0x2471a3,
  [TileType.Swamp]: 0x5d6d3f,
  [TileType.Ice]: 0xd5e8f0,
};

/** Size of each tile in pixels. */
export const TILE_PX = 16;

/** Seed for per-tile variation (stable across frames). */
const VARIATION_SEED = 42;

// ── Per-chunk render state ──────────────────────────────────────────────────

interface ChunkRenderState {
  /** Static tile layer (everything except water). */
  base: Graphics;
  /** Animated water overlay — cleared and redrawn each frame. */
  water: Graphics;
  /** Local positions + types of animated tiles within the chunk. */
  animatedTiles: AnimatedTile[];
}

// ── TileRenderer ────────────────────────────────────────────────────────────

/**
 * Renders terrain tiles from chunk data.
 * Uses textures from TextureManager when available, falls back to colored rectangles.
 */
export class TileRenderer {
  private readonly stage: Container;
  private readonly camera: Camera;
  private readonly chunks = new Map<string, ChunkRenderState>();

  constructor(stage: Container, camera: Camera) {
    this.stage = stage;
    this.camera = camera;
  }

  // ── Chunk lifecycle ──────────────────────────────────────────────────────

  /** Render a chunk with tile variation and animation tracking. */
  renderChunk(chunk: Chunk): void {
    const key = `${chunk.cx},${chunk.cy}`;
    if (this.chunks.has(key)) return;

    const chunkPx = CHUNK_SIZE * TILE_PX;

    // Static base layer
    const base = new Graphics();
    // Animated water overlay
    const water = new Graphics();

    const animatedTiles = findAnimatedTiles(chunk.tiles);
    const animatedSet = new Set(
      animatedTiles.map((t) => t.ly * CHUNK_SIZE + t.lx),
    );

    const useTextures = textureManager.isLoaded();

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileType = chunk.tiles[ly]?.[lx];
        if (tileType === undefined) continue;

        // Animated tiles go into the water overlay; skip here.
        if (animatedSet.has(ly * CHUNK_SIZE + lx)) continue;

        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;

        if (useTextures) {
          // Use texture from spritesheet
          const texture = textureManager.getTileTexture(tileType);
          const sprite = new Sprite(texture);
          sprite.x = chunk.cx * chunkPx + lx * TILE_PX;
          sprite.y = chunk.cy * chunkPx + ly * TILE_PX;
          this.stage.addChild(sprite);
        } else {
          // Fallback: colored rectangle
          const baseColor = TILE_COLORS[tileType] ?? 0xff00ff;
          const color = tileColor(tileType, baseColor, wx, wy, VARIATION_SEED);
          base.rect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
          base.fill(color);
        }
      }
    }

    // Draw initial water frame (t = 0)
    if (!useTextures) {
      this.drawWaterLayer(water, chunk, animatedTiles, 0);
    }

    if (!useTextures) {
      base.x = chunk.cx * chunkPx;
      base.y = chunk.cy * chunkPx;
      water.x = base.x;
      water.y = base.y;
      this.stage.addChild(base);
      this.stage.addChild(water);
    }

    this.chunks.set(key, { base, water, animatedTiles });
  }

  /** Remove a chunk from the display. */
  removeChunk(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const state = this.chunks.get(key);
    if (state) {
      this.stage.removeChild(state.base);
      this.stage.removeChild(state.water);
      state.base.destroy();
      state.water.destroy();
      this.chunks.delete(key);
    }
  }

  /**
   * Prune chunks outside the visible area + buffer.
   * Call after camera moves.
   */
  pruneChunks(visibleChunks: Set<string>): void {
    for (const [key, state] of this.chunks) {
      if (!visibleChunks.has(key)) {
        this.stage.removeChild(state.base);
        this.stage.removeChild(state.water);
        state.base.destroy();
        state.water.destroy();
        this.chunks.delete(key);
      }
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  /**
   * Update animated tiles (water shimmer).
   * Must be called once per frame with the elapsed time in seconds.
   */
  update(time: number): void {
    if (textureManager.isLoaded()) return; // no animation needed with textures

    for (const [, state] of this.chunks) {
      if (state.animatedTiles.length === 0) continue;
      state.water.clear();
      const cx = Math.round(state.base.x / (CHUNK_SIZE * TILE_PX));
      const cy = Math.round(state.base.y / (CHUNK_SIZE * TILE_PX));
      this.drawWaterLayerFromCoords(state.water, cx, cy, state.animatedTiles, time);
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  /** Get the set of chunk keys currently rendered. */
  getRenderedKeys(): Set<string> {
    return new Set(this.chunks.keys());
  }

  /** Number of rendered chunks. */
  get renderedCount(): number {
    return this.chunks.size;
  }

  /** Destroy all chunk graphics. */
  destroy(): void {
    for (const [, state] of this.chunks) {
      this.stage.removeChild(state.base);
      this.stage.removeChild(state.water);
      state.base.destroy();
      state.water.destroy();
    }
    this.chunks.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  /** Draw water tiles with shimmer into the given Graphics. */
  private drawWaterLayer(
    g: Graphics,
    chunk: Chunk,
    animatedTiles: AnimatedTile[],
    time: number,
  ): void {
    for (const { lx, ly, tileType } of animatedTiles) {
      const wx = chunk.cx * CHUNK_SIZE + lx;
      const wy = chunk.cy * CHUNK_SIZE + ly;
      const baseColor = TILE_COLORS[tileType] ?? 0xff00ff;
      const color = waterShimmer(baseColor, wx, wy, time);
      g.rect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
      g.fill(color);
    }
  }

  /** Draw water tiles from chunk coordinates (used by update loop). */
  private drawWaterLayerFromCoords(
    g: Graphics,
    cx: number,
    cy: number,
    animatedTiles: AnimatedTile[],
    time: number,
  ): void {
    for (const { lx, ly, tileType } of animatedTiles) {
      const wx = cx * CHUNK_SIZE + lx;
      const wy = cy * CHUNK_SIZE + ly;
      const baseColor = TILE_COLORS[tileType] ?? 0xff00ff;
      const color = waterShimmer(baseColor, wx, wy, time);
      g.rect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
      g.fill(color);
    }
  }
}
