import { Graphics, Container } from "pixi.js";
import { CHUNK_SIZE, TileType } from "@mmo/shared";
import { TILE_PX } from "./TileRenderer.js";
import {
  tileHash,
  varyColor,
  waterShimmer,
} from "./TileAnimations.js";

// ── Extended tile types (must match server TilePhysics constants) ──────────

const FIRE_TYPE = 9;
const LAVA_TYPE = 10;

// ── Physics tile colors ────────────────────────────────────────────────────

const PHYSICS_COLORS: Record<number, number> = {
  [FIRE_TYPE]: 0xff4500,
  [LAVA_TYPE]: 0xcc2200,
};

/** Seed for per-tile variation (must match TileRenderer). */
const VARIATION_SEED = 42;

// ── Physics visual effect types ────────────────────────────────────────────

/** A physics visual effect received from the server. */
export interface PhysicsEffect {
  id: string;
  type: "splash" | "ember" | "dust" | "glow" | "melt_steam";
  x: number;
  y: number;
  duration: number;
  intensity: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

// ── Per-chunk physics render state ─────────────────────────────────────────

interface ChunkPhysicsState {
  /** Graphics layer for fire tiles. */
  fire: Graphics;
  /** Graphics layer for lava tiles. */
  lava: Graphics;
  /** Graphics layer for physics effects (particles). */
  effects: Graphics;
  /** Local positions of fire tiles within the chunk. */
  fireTiles: { lx: number; ly: number }[];
  /** Local positions of lava tiles within the chunk. */
  lavaTiles: { lx: number; ly: number }[];
}

// ── PhysicsRenderer ────────────────────────────────────────────────────────

/**
 * Client-side renderer for physics tiles (fire, lava) and physics effects.
 *
 * Follows the same pattern as TileRenderer and MobRenderer:
 * - Takes a stage Container in constructor
 * - Has update() called per frame
 * - Has destroy() for cleanup
 *
 * Renders:
 * - Fire tiles with flickering color animation
 * - Lava tiles with pulsing glow effect
 * - Water flow direction indicators (subtle shimmer)
 * - Sand pile gradients
 * - Physics effects (splash, ember, dust, glow, steam)
 */
export class PhysicsRenderer {
  private readonly stage: Container;
  private readonly chunks = new Map<string, ChunkPhysicsState>();
  private activeEffects: PhysicsEffect[] = [];

  constructor(stage: Container) {
    this.stage = stage;
  }

  // ── Chunk lifecycle ──────────────────────────────────────────────────

  /**
   * Scan a chunk's tile grid for physics tiles and set up rendering.
   * Call this when a chunk is loaded or updated.
   */
  initChunk(
    cx: number,
    cy: number,
    tiles: number[][],
  ): void {
    const key = `${cx},${cy}`;
    // Remove old state if exists
    this.removeChunk(cx, cy);

    const chunkPx = CHUNK_SIZE * TILE_PX;
    const fire = new Graphics();
    const lava = new Graphics();
    const effects = new Graphics();

    const fireTiles: { lx: number; ly: number }[] = [];
    const lavaTiles: { lx: number; ly: number }[] = [];

    for (let ly = 0; ly < tiles.length; ly++) {
      const row = tiles[ly];
      for (let lx = 0; lx < row.length; lx++) {
        const tileType = row[lx];
        if (tileType === FIRE_TYPE) {
          fireTiles.push({ lx, ly });
        } else if (tileType === LAVA_TYPE) {
          lavaTiles.push({ lx, ly });
        }
      }
    }

    fire.x = cx * chunkPx;
    fire.y = cy * chunkPx;
    lava.x = fire.x;
    lava.y = fire.y;
    effects.x = fire.x;
    effects.y = fire.y;

    this.stage.addChild(fire);
    this.stage.addChild(lava);
    this.stage.addChild(effects);

    this.chunks.set(key, { fire, lava, effects, fireTiles, lavaTiles });
  }

  /**
   * Remove a chunk from the display.
   */
  removeChunk(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const state = this.chunks.get(key);
    if (state) {
      this.stage.removeChild(state.fire);
      this.stage.removeChild(state.lava);
      this.stage.removeChild(state.effects);
      state.fire.destroy();
      state.lava.destroy();
      state.effects.destroy();
      this.chunks.delete(key);
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────

  /**
   * Update physics tile rendering and effects.
   * Must be called once per frame with elapsed time in seconds.
   *
   * @param time - Elapsed seconds (continuous, increases each frame).
   */
  update(time: number): void {
    for (const [key, state] of this.chunks) {
      const [cxStr, cyStr] = key.split(",");
      const cx = parseInt(cxStr, 10);
      const cy = parseInt(cyStr, 10);

      // Redraw fire with flickering
      this.drawFireLayer(state.fire, state.fireTiles, cx, cy, time);

      // Redraw lava with pulsing glow
      this.drawLavaLayer(state.lava, state.lavaTiles, cx, cy, time);
    }

    // Draw active effects
    this.drawEffects(time);
  }

  // ── Effect management ────────────────────────────────────────────────

  /**
   * Add a batch of physics effects received from the server.
   */
  addEffects(effects: PhysicsEffect[]): void {
    this.activeEffects.push(...effects);
  }

  /**
   * Remove expired effects.
   */
  pruneEffects(now: number): void {
    this.activeEffects = this.activeEffects.filter(
      (e) => now - e.createdAt < e.duration,
    );
  }

  /**
   * Get count of active effects.
   */
  get effectCount(): number {
    return this.activeEffects.length;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /**
   * Check if a tile type is a physics-extended type (Fire or Lava).
   */
  static isPhysicsTile(tileType: number): boolean {
    return tileType === FIRE_TYPE || tileType === LAVA_TYPE;
  }

  /**
   * Get the set of chunk keys currently rendered.
   */
  getRenderedKeys(): Set<string> {
    return new Set(this.chunks.keys());
  }

  /**
   * Number of rendered chunks.
   */
  get renderedCount(): number {
    return this.chunks.size;
  }

  /**
   * Destroy all chunk graphics and effects.
   */
  destroy(): void {
    for (const [, state] of this.chunks) {
      this.stage.removeChild(state.fire);
      this.stage.removeChild(state.lava);
      this.stage.removeChild(state.effects);
      state.fire.destroy();
      state.lava.destroy();
      state.effects.destroy();
    }
    this.chunks.clear();
    this.activeEffects = [];
  }

  // ── Private drawing methods ──────────────────────────────────────────

  /**
   * Draw fire tiles with flickering color animation.
   * Fire alternates between orange-red and yellow-orange.
   */
  private drawFireLayer(
    g: Graphics,
    fireTiles: { lx: number; ly: number }[],
    cx: number,
    cy: number,
    time: number,
  ): void {
    g.clear();

    for (const { lx, ly } of fireTiles) {
      const wx = cx * CHUNK_SIZE + lx;
      const wy = cy * CHUNK_SIZE + ly;
      const baseColor = PHYSICS_COLORS[FIRE_TYPE];

      // Flickering: oscillate between orange-red and bright orange
      const flicker = 0.7 + 0.3 * Math.sin(time * 8.0 + wx * 1.3 + wy * 0.9);
      const [r, g2, b] = decompose(baseColor);
      const color = compose(
        Math.min(255, r * flicker),
        Math.min(255, g2 * (0.6 + 0.4 * flicker)),
        Math.min(255, b * flicker * 0.5),
      );

      g.rect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
      g.fill(color);
    }
  }

  /**
   * Draw lava tiles with pulsing glow effect.
   * Lava has a slow, rhythmic brightness pulse.
   */
  private drawLavaLayer(
    g: Graphics,
    lavaTiles: { lx: number; ly: number }[],
    cx: number,
    cy: number,
    time: number,
  ): void {
    g.clear();

    for (const { lx, ly } of lavaTiles) {
      const wx = cx * CHUNK_SIZE + lx;
      const wy = cy * CHUNK_SIZE + ly;
      const baseColor = PHYSICS_COLORS[LAVA_TYPE];

      // Slow pulse: brightness oscillates between 80% and 110%
      const pulse = 0.8 + 0.3 * Math.sin(time * 1.5 + wx * 0.7 + wy * 0.5);
      const [r, g2, b] = decompose(baseColor);
      const color = compose(
        Math.min(255, r * pulse),
        Math.min(255, g2 * (0.4 + 0.6 * pulse)),
        Math.min(255, b * pulse * 0.3),
      );

      g.rect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
      g.fill(color);
    }
  }

  /**
   * Draw active physics effects (particles, glow, etc.).
   */
  private drawEffects(time: number): void {
    // Effects are drawn on per-chunk graphics
    // For simplicity, we draw them as colored rectangles that fade
    for (const effect of this.activeEffects) {
      const chunkKey = this.getChunkKey(effect.x, effect.y);
      const state = this.chunks.get(chunkKey);
      if (!state) continue;

      const cx = parseInt(chunkKey.split(",")[0], 10);
      const cy = parseInt(chunkKey.split(",")[1], 10);
      const lx = ((effect.x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const ly = ((effect.y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

      const elapsed = time * 1000 - effect.createdAt;
      const progress = Math.min(1, elapsed / effect.duration);
      const alpha = (1 - progress) * effect.intensity;

      let color: number;
      let size: number;

      switch (effect.type) {
        case "splash":
          color = 0x3498db;
          size = TILE_PX * (0.5 + 0.5 * progress);
          break;
        case "ember":
          color = 0xff6600;
          size = TILE_PX * (1 - progress * 0.5);
          break;
        case "dust":
          color = 0xd4a574;
          size = TILE_PX * (0.3 + 0.7 * progress);
          break;
        case "glow":
          color = 0xff2200;
          size = TILE_PX * (1 + 0.5 * Math.sin(time * 3));
          break;
        case "melt_steam":
          color = 0xcccccc;
          size = TILE_PX * progress;
          break;
        default:
          continue;
      }

      // Draw effect as a semi-transparent rectangle
      const g = state.effects;
      g.rect(
        lx * TILE_PX + (TILE_PX - size) / 2,
        ly * TILE_PX + (TILE_PX - size) / 2,
        size,
        size,
      );
      g.fill({ color, alpha });
    }
  }

  /**
   * Get the chunk key for a world tile position.
   */
  private getChunkKey(wx: number, wy: number): string {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    return `${cx},${cy}`;
  }
}

// ── Color helpers (same as TileAnimations) ─────────────────────────────────

function decompose(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

function compose(r: number, g: number, b: number): number {
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : (v | 0);
}
