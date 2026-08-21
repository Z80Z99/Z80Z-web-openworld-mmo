import { TileType } from "@mmo/shared";

/**
 * Tile animation helpers: seeded variation, water shimmer, per-tile color offsets.
 *
 * All functions are pure — no PixiJS dependency — so they are trivially testable.
 */

// ── Seeded hash ─────────────────────────────────────────────────────────────

/**
 * Deterministic hash from world-tile coordinates + seed.
 * Returns a value in [0, 1) for use as a variation factor.
 */
export function tileHash(wx: number, wy: number, seed: number): number {
  let h = (seed + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (wx | 0), 0x85ebca6b);
  h = Math.imul(h ^ (wy | 0), 0xc2b2ae35);
  h = (h ^ (h >>> 16)) | 0;
  return (h >>> 0) / 4_294_967_296;
}

// ── Color manipulation ──────────────────────────────────────────────────────

/** Decompose a 24-bit color into [r, g, b] (0-255 each). */
function decompose(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

/** Recompose [r, g, b] into a 24-bit color, clamped to [0, 255]. */
function compose(r: number, g: number, b: number): number {
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : (v | 0);
}

/**
 * Apply slight brightness variation to a base color.
 * `hash` is a [0, 1) value from {@link tileHash}.
 * `amount` controls max deviation (0.08 = ±8 %).
 */
export function varyColor(
  baseColor: number,
  hash: number,
  amount = 0.08,
): number {
  const [r, g, b] = decompose(baseColor);
  const offset = (hash - 0.5) * 2 * amount; // [-amount, +amount]
  return compose(r * (1 + offset), g * (1 + offset), b * (1 + offset));
}

/**
 * Per-tile color with seeded variation, specialized per tile type.
 *
 * - **Water / DeepWater**: base variation only (shimmer is applied separately).
 * - **Sand**: warm-shifted variation.
 * - **Forest**: darker shift to hint at canopy depth.
 * - **Others**: generic brightness variation.
 */
export function tileColor(
  tileType: number,
  baseColor: number,
  wx: number,
  wy: number,
  seed: number,
): number {
  const h = tileHash(wx, wy, seed);

  if (tileType === TileType.Sand) {
    // warm-shift: boost red, slight reduce blue
    const [r, g, b] = decompose(baseColor);
    const warm = (h - 0.5) * 0.1;
    return compose(r * (1 + warm), g * (1 + warm * 0.4), b * (1 - warm * 0.3));
  }

  if (tileType === TileType.Forest) {
    // darker canopy hint
    const [r, g, b] = decompose(baseColor);
    const darken = 0.85 + h * 0.15; // [0.85, 1.0)
    return compose(r * darken, g * darken, b * darken);
  }

  // Generic variation for Grass, Stone, Snow, Swamp, Ice, Water, DeepWater
  return varyColor(baseColor, h);
}

// ── Water shimmer ───────────────────────────────────────────────────────────

/**
 * Animated water color using a sin-wave shimmer.
 * Different phase per tile produces a gentle ripple effect.
 *
 * @param baseColor - the palette water color
 * @param wx - world tile X
 * @param wy - world tile Y
 * @param time - elapsed seconds (increases continuously)
 * @returns 24-bit animated color
 */
export function waterShimmer(
  baseColor: number,
  wx: number,
  wy: number,
  time: number,
): number {
  const [r, g, b] = decompose(baseColor);
  const phase = wx * 0.7 + wy * 0.5;
  // Oscillate brightness between 82 % and 100 %
  const shimmer = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(time * 2.0 + phase));
  return compose(r * shimmer, g * shimmer, b * shimmer);
}

// ── Animated tile detection ─────────────────────────────────────────────────

/** Set of tile types that require per-frame animation updates. */
const ANIMATED_TYPES = new Set<number>([TileType.Water, TileType.DeepWater]);

/** Returns true when the tile type needs animated rendering (water shimmer). */
export function isAnimatedTile(tileType: number): boolean {
  return ANIMATED_TYPES.has(tileType);
}

/** Position + type of an animated tile within a chunk. */
export interface AnimatedTile {
  readonly lx: number;
  readonly ly: number;
  readonly tileType: number;
}

/**
 * Scan a chunk's tile grid and return local positions of all animated tiles.
 */
export function findAnimatedTiles(tiles: number[][]): AnimatedTile[] {
  const out: AnimatedTile[] = [];
  for (let ly = 0; ly < tiles.length; ly++) {
    const row = tiles[ly];
    for (let lx = 0; lx < row.length; lx++) {
      if (isAnimatedTile(row[lx])) {
        out.push({ lx, ly, tileType: row[lx] });
      }
    }
  }
  return out;
}
