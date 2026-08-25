/**
 * Shore Rule System — deterministic shore tile selection based on 8-neighbor bitmask.
 *
 * This is the SINGLE source of truth for shore tile mapping.
 * Both the formal game renderer and the shore-debug tool MUST use this module.
 *
 * Bitmask layout:
 *   NW=1  N=2  NE=4
 *   W=8   C    E=16
 *   SW=32 S=64 SE=128
 *
 * Each bit = 1 if that neighbor is LAND, 0 if WATER.
 * The mask value (0-255) determines which shore PNGs to draw.
 */

import { TileType } from "./types.js";

// ── Bitmask Constants ──────────────────────────────────────────────

export const Direction = {
  NW: 1,   // 0b00000001
  N: 2,    // 0b00000010
  NE: 4,   // 0b00000100
  W: 8,    // 0b00001000
  E: 16,   // 0b00010000
  SW: 32,  // 0b00100000
  S: 64,   // 0b01000000
  SE: 128, // 0b10000000
} as const;

/** Direction names in bitmask order (index 0 = NW, index 7 = SE). */
export const DIRECTION_NAMES = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'] as const;

/** Direction name → bitmask lookup. */
export const DIRECTION_MASK: Record<string, number> = {
  NW: 1, N: 2, NE: 4, W: 8, E: 16, SW: 32, S: 64, SE: 128,
};

// ── Types ──────────────────────────────────────────────────────────

/** A single shore tile to render. */
export interface ShoreTile {
  type: 'concave' | 'convex';
  index: number;      // 1-8 for concave (shore1-8), 1-4 for convex (convex-shore1-4)
  direction: string;  // 'NW', 'N', etc.
}

/** Custom shore rule override for a specific mask. */
export interface ShoreRule {
  mask: number;
  concave: number[];  // indices 1-8 (shore1-8)
  convex: number[];   // indices 1-4 (convex-shore1-4)
}

// ── Rule Storage ───────────────────────────────────────────────────

const shoreRules: Map<number, ShoreRule> = new Map();

/** Register a custom shore rule for a specific mask. */
export function registerShoreRule(rule: ShoreRule): void {
  shoreRules.set(rule.mask, rule);
}

/** Get a registered shore rule for a specific mask. */
export function getShoreRule(mask: number): ShoreRule | undefined {
  return shoreRules.get(mask);
}

/** Clear all registered shore rules. */
export function clearShoreRules(): void {
  shoreRules.clear();
}

// ── Core Logic ─────────────────────────────────────────────────────

/**
 * Given a neighbor mask (bitmask of LAND neighbors), return which shore
 * tiles should be drawn on this water tile.
 *
 * Default behavior: each land neighbor direction maps to its concave shore tile.
 * Custom rules can override specific masks via registerShoreRule().
 *
 * @param mask Bitmask where each bit represents a land neighbor in that direction
 * @returns Array of shore tiles to render (deterministic, no randomness)
 */
export function getShoreTiles(mask: number): ShoreTile[] {
  // Check for registered custom rule first
  const customRule = shoreRules.get(mask);
  if (customRule) {
    const tiles: ShoreTile[] = [];

    for (const index of customRule.concave) {
      const dirIdx = index - 1;
      if (dirIdx >= 0 && dirIdx < DIRECTION_NAMES.length) {
        tiles.push({
          type: 'concave',
          index,
          direction: DIRECTION_NAMES[dirIdx],
        });
      }
    }

    const convexDirections = ['NW', 'NE', 'SE', 'SW'];
    for (const index of customRule.convex) {
      if (index >= 1 && index <= 4) {
        tiles.push({
          type: 'convex',
          index,
          direction: convexDirections[index - 1],
        });
      }
    }

    return tiles;
  }

  // Default: return 0 or 1 tile per mask
  if (mask === 0) return [];

  const edges = mask & (Direction.N | Direction.E | Direction.S | Direction.W);

  if (edges === 0) {
    // Diagonal-only → convex art; priority NW > NE > SE > SW
    if (mask & Direction.NW) return [{ type: 'convex', index: 1, direction: 'NW' }];
    if (mask & Direction.NE) return [{ type: 'convex', index: 2, direction: 'NE' }];
    if (mask & Direction.SE) return [{ type: 'convex', index: 3, direction: 'SE' }];
    if (mask & Direction.SW) return [{ type: 'convex', index: 4, direction: 'SW' }];
    return [];
  }

  // Quadrant pairs first, fixed check order: N&W, N&E, S&W, S&E
  if ((mask & Direction.N) && (mask & Direction.W)) return [{ type: 'concave', index: 1, direction: 'NW' }];
  if ((mask & Direction.N) && (mask & Direction.E)) return [{ type: 'concave', index: 3, direction: 'NE' }];
  if ((mask & Direction.S) && (mask & Direction.W)) return [{ type: 'concave', index: 6, direction: 'SW' }];
  if ((mask & Direction.S) && (mask & Direction.E)) return [{ type: 'concave', index: 8, direction: 'SE' }];

  // Single edge by priority: N > E > S > W
  if (mask & Direction.N) return [{ type: 'concave', index: 2, direction: 'N' }];
  if (mask & Direction.E) return [{ type: 'concave', index: 5, direction: 'E' }];
  if (mask & Direction.S) return [{ type: 'concave', index: 7, direction: 'S' }];
  if (mask & Direction.W) return [{ type: 'concave', index: 4, direction: 'W' }];

  return [];
}

// ── Utility Functions ──────────────────────────────────────────────

/** Build bitmask from neighbor boolean array [NW, N, NE, W, E, SW, S, SE]. */
export function getMaskFromNeighbors(neighbors: boolean[]): number {
  let mask = 0;
  for (let i = 0; i < Math.min(neighbors.length, 8); i++) {
    if (neighbors[i]) mask |= (1 << i);
  }
  return mask;
}

/** Expand bitmask to neighbor boolean array [NW, N, NE, W, E, SW, S, SE]. */
export function getNeighborsFromMask(mask: number): boolean[] {
  const neighbors: boolean[] = [];
  for (let i = 0; i < 8; i++) {
    neighbors.push((mask & (1 << i)) !== 0);
  }
  return neighbors;
}

/** Convert mask to 8-bit binary string (MSB first). */
export function maskToBinary(mask: number): string {
  return (mask >>> 0).toString(2).padStart(8, '0');
}

/** Get active (land) direction names from mask. */
export function getActiveDirections(mask: number): string[] {
  const directions: string[] = [];
  for (let i = 0; i < DIRECTION_NAMES.length; i++) {
    if (mask & (1 << i)) directions.push(DIRECTION_NAMES[i]);
  }
  return directions;
}

/**
 * Compute the 8-neighbor bitmask for a water tile at world coordinates (wx, wy).
 *
 * @param wx World X coordinate
 * @param wy World Y coordinate
 * @param isLand Function that returns true if the tile at (x, y) is land
 * @returns Bitmask 0-255
 */
export function computeNeighborMask(
  wx: number,
  wy: number,
  isLand: (x: number, y: number) => boolean,
): number {
  let mask = 0;
  if (isLand(wx - 1, wy - 1)) mask |= Direction.NW;
  if (isLand(wx,     wy - 1)) mask |= Direction.N;
  if (isLand(wx + 1, wy - 1)) mask |= Direction.NE;
  if (isLand(wx - 1, wy    )) mask |= Direction.W;
  if (isLand(wx + 1, wy    )) mask |= Direction.E;
  if (isLand(wx - 1, wy + 1)) mask |= Direction.SW;
  if (isLand(wx,     wy + 1)) mask |= Direction.S;
  if (isLand(wx + 1, wy + 1)) mask |= Direction.SE;
  return mask;
}

// ── Ground-Edge Tile Selection ─────────────────────────────────────

/**
 * A single ground-edge overlay tile.
 *
 * `index` maps to `edge-grass-dirt{index}.png` (1–8).
 */
export interface GroundEdgeTile {
  readonly index: number;
}

/**
 * Returns true when `t` is any grass-family tile (grass, forest, or
 * grass-transition variants that visually belong to the green biome).
 */
export function isGrassFamilyTile(t: TileType): boolean {
  switch (t) {
    case TileType.Grass:
    case TileType.GrassVariant1:
    case TileType.GrassVariant2:
    case TileType.Forest:
    case TileType.ForestVariant1:
    case TileType.ForestVariant2:
    case TileType.GrassToForest:
    case TileType.GrassToSand:
      return true;
    default:
      return false;
  }
}

/**
 * Returns true when `t` is a sand-family tile (sand or sand variant).
 */
export function isSandFamilyTile(t: TileType): boolean {
  switch (t) {
    case TileType.Sand:
    case TileType.SandVariant1:
      return true;
    default:
      return false;
  }
}

/**
 * Deterministic ground-edge overlay selection for a sand-family tile
 * whose 8-neighbor bitmask encodes which neighbours are grass-family.
 *
 * Each set bit means "that neighbour is grass-family"; the tile hosting
 * the overlay is sand-family.
 *
 * Returns 0–4 `GroundEdgeTile`s. Cardinal bits take priority: quadrant
 * pairs (two adjacent cardinals) beat single edges, checked in fixed order
 * N&W, N&E, S&W, S&E; single edges resolve by priority N > E > S > W.
 * Diagonal-only masks (no cardinal bits) return corner overlays from
 * edge-grass-dirt9..12 — one per set diagonal (corners paint disjoint
 * quadrants, so they stack), ordered by ascending bit value NW→NE→SW→SE.
 *
 * @param mask Bitmask where each bit represents a grass-family neighbour
 * @returns Array of 0–4 GroundEdgeTiles
 */
export function getGroundEdgeTiles(mask: number): GroundEdgeTile[] {
  if (mask === 0) return [];

  const edges = mask & (Direction.N | Direction.E | Direction.S | Direction.W);

  if (edges === 0) {
    // Diagonal-only → corner overlays (edge-grass-dirt9..12). Corners paint
    // disjoint quadrants, so every set diagonal gets its tile; order is fixed
    // by ascending bit value for determinism: NW(1)→9, NE(4)→10, SW(32)→12,
    // SE(128)→11.
    const corners: GroundEdgeTile[] = [];
    if (mask & Direction.NW) corners.push({ index: 9 });
    if (mask & Direction.NE) corners.push({ index: 10 });
    if (mask & Direction.SW) corners.push({ index: 12 });
    if (mask & Direction.SE) corners.push({ index: 11 });
    return corners;
  }

  // Quadrant pairs first, fixed check order: N&W, N&E, S&W, S&E
  if ((mask & Direction.N) && (mask & Direction.W)) return [{ index: 1 }];
  if ((mask & Direction.N) && (mask & Direction.E)) return [{ index: 3 }];
  if ((mask & Direction.S) && (mask & Direction.W)) return [{ index: 6 }];
  if ((mask & Direction.S) && (mask & Direction.E)) return [{ index: 8 }];

  // Single edge by priority: N > E > S > W
  if (mask & Direction.N) return [{ index: 2 }];
  if (mask & Direction.E) return [{ index: 5 }];
  if (mask & Direction.S) return [{ index: 7 }];
  if (mask & Direction.W) return [{ index: 4 }];

  return [];
}
