import { TileType } from "@mmo/shared";
import { tileHash } from "./TileAnimations.js";

/**
 * Deterministic decoration registry — maps terrain categories to curated
 * outdoor atlas indices from the Tiny Town 12×11 packed tilemap (132 tiles).
 *
 * This module is pure (no PixiJS) so it is trivially testable.
 * All selections are deterministic for a given (wx, wy, seed) triple.
 *
 * Atlas layout: 12 columns × 11 rows, 16×16 px, 0 spacing.
 * Flat index = row * 12 + col.
 *
 * Curated index ranges (based on Tiny Town tileset content):
 *   Row 0 (0–11):  ground tiles (0–2), trees/bushes/plants (3–11)
 *   Row 1 (12–23): transitions (12–14), bushes/plants (15–18), nature (19–23)
 *   Row 2 (24–35): terrain blends (24), pebbles/rocks (25–27), bushes (29–33)
 *   Row 3 (36–47): path/structure features (36–47)
 *   Rows 4–10: buildings, interiors, special objects (not used for outdoor deco)
 */

// ── Terrain category classification ─────────────────────────────────────────

export type TerrainCategory =
  | "forest"
  | "grass"
  | "sand"
  | "stone"
  | "snow"
  | "swamp"
  | "ice"
  | "shore"
  | "water";

/** Classify a TileType into a terrain category. */
export function classifyTerrain(tileType: number): TerrainCategory | null {
  if (
    tileType === TileType.Water ||
    tileType === TileType.DeepWater ||
    tileType === TileType.WaterVariant1 ||
    tileType === TileType.WaterVariant2 ||
    tileType === TileType.DeepWaterVariant1
  ) return "water";

  if (
    tileType === TileType.ShoreSand ||
    tileType === TileType.ShoreGrass ||
    tileType === TileType.ShoreForest ||
    tileType === TileType.ShoreSwamp ||
    tileType === TileType.ShoreSnow ||
    tileType === TileType.ShoreStone
  ) return "shore";

  if (
    tileType === TileType.Forest ||
    tileType === TileType.ForestVariant1 ||
    tileType === TileType.ForestVariant2 ||
    tileType === TileType.GrassToForest ||
    tileType === TileType.ForestToSwamp ||
    tileType === TileType.ForestToStone
  ) return "forest";

  if (
    tileType === TileType.Sand ||
    tileType === TileType.SandVariant1 ||
    tileType === TileType.GrassToSand
  ) return "sand";

  if (
    tileType === TileType.Stone ||
    tileType === TileType.StoneVariant1 ||
    tileType === TileType.StoneVariant2 ||
    tileType === TileType.ShoreStone ||
    tileType === TileType.GrassToStone ||
    tileType === TileType.SandToStone ||
    tileType === TileType.ForestToStone ||
    tileType === TileType.SwampToStone
  ) return "stone";

  if (
    tileType === TileType.Snow ||
    tileType === TileType.SnowVariant1 ||
    tileType === TileType.GrassToSnow ||
    tileType === TileType.StoneToSnow
  ) return "snow";

  if (
    tileType === TileType.Swamp ||
    tileType === TileType.SwampVariant1 ||
    tileType === TileType.GrassToSwamp ||
    tileType === TileType.ForestToSwamp
  ) return "swamp";

  if (
    tileType === TileType.Ice ||
    tileType === TileType.SnowToIce
  ) return "ice";

  if (
    tileType === TileType.Grass ||
    tileType === TileType.GrassVariant1 ||
    tileType === TileType.GrassVariant2 ||
    tileType === TileType.ShoreGrass
  ) return "grass";

  return null;
}

// ── Curated atlas index registry ────────────────────────────────────────────

/**
 * Curated outdoor atlas tile indices by terrain category.
 * All indices are flat (row * 12 + col) into the 12×11 Tiny Town tilemap.
 *
 * Only outdoor-appropriate tiles are included:
 *   - No characters (those live in the separate character sheet)
 *   - No indoor furniture or building interiors
 *   - No UI elements or items
 *   - Stumps avoided (indices 16, 28)
 *   - Tree canopy/trunk indices (3, 4, 15, 16) excluded from generic lists;
 *     they are placed explicitly by the two-tile tree system in TileRenderer.
 *   - One-tile tree indices (27, 28) excluded from generic grass/sand lists;
 *     they are placed explicitly by the one-tile tree system in TileRenderer.
 */

// ── Tree atlas indices ──────────────────────────────────────────────────────

/** One-tile tree atlas indices — each occupies a single tile. */
export const ONE_TILE_TREES: readonly number[] = [27, 28];

/** Two-tile tree canopy/trunk pairs — canopy sits one tile above trunk. */
export const TWO_TILE_TREES: readonly { canopy: number; trunk: number }[] = [
  { canopy: 3, trunk: 15 },
  { canopy: 4, trunk: 16 },
];

// ── Edge transition atlas indices ───────────────────────────────────────────

/**
 * Grass/dirt (Sand) boundary edge transition atlas indices.
 * Used when a Grass tile is 4-connected to a Sand tile.
 */
export const EDGE_TRANSITIONS: readonly number[] = [12, 13, 14, 24, 26, 36, 37, 38];
export const TERRAIN_DECORATIONS: Record<TerrainCategory, readonly number[]> = {
  // Other atlas props are intentionally disabled until they are assigned.
  forest: [],
  grass: [],
  sand: [],
  stone: [],
  snow: [],
  swamp: [],
  ice: [],
  shore: [],
  water: [],
};

// ── Decoration selection ────────────────────────────────────────────────────

/**
 * Density factor controlling how many tiles receive decorations.
 * 0.0 = none, 1.0 = every tile. Separate probability gates per category
 * are applied inside {@link selectDecoration}.
 */
const DENSITY_MAP: Record<TerrainCategory, number> = {
  forest: 0.55,
  grass: 0.30,
  sand: 0.18,
  stone: 0.22,
  snow: 0.15,
  swamp: 0.25,
  ice: 0.12,
  shore: 0.20,
  water: 0.0,
};

/**
 * Deterministically select a decoration atlas index for a world tile.
 *
 * Returns a valid atlas index (0–131) if a decoration should be placed,
 * or `null` if the tile should remain bare (or is an unsupported type).
 *
 * Selection is purely function of (tileType, wx, wy, seed) — identical
 * inputs always produce identical outputs.
 *
 * @param tileType - the TileType at this position
 * @param wx - world tile X coordinate
 * @param wy - world tile Y coordinate
 * @param seed - deterministic seed (must match shared DEFAULT_SEED)
 * @param atlasCount - number of loaded atlas textures (typically 132)
 * @returns atlas index or null
 */
export function selectDecoration(
  tileType: number,
  wx: number,
  wy: number,
  seed: number,
  atlasCount: number,
): number | null {
  if (atlasCount === 0) return null;

  const category = classifyTerrain(tileType);
  if (!category) return null;

  const indices = TERRAIN_DECORATIONS[category];
  if (indices.length === 0) return null;

  const density = DENSITY_MAP[category];

  // Primary hash for density gate and selection
  const h1 = tileHash(wx, wy, seed);
  if (h1 > density) return null;

  // Secondary hash for index selection (different seed offset for decorrelation)
  const h2 = tileHash(wx, wy, seed + 31337);
  const selectionIdx = (h2 * indices.length * 100) | 0;
  const atlasIndex = indices[selectionIdx % indices.length];

  // Validate the atlas index is within loaded range
  if (atlasIndex >= atlasCount) return null;

  return atlasIndex;
}

/**
 * Select a decoration with a sub-tile position offset for variety.
 * Returns the atlas index plus pixel offsets within the tile for
 * placement variety (xOffset, yOffset in 0–8 range).
 */
export function selectDecorationWithOffset(
  tileType: number,
  wx: number,
  wy: number,
  seed: number,
  atlasCount: number,
): { atlasIndex: number; xOffset: number; yOffset: number } | null {
  const atlasIndex = selectDecoration(tileType, wx, wy, seed, atlasCount);
  if (atlasIndex === null) return null;

  const h3 = tileHash(wx, wy, seed + 7919);
  const h4 = tileHash(wx, wy, seed + 104729);
  const xOffset = (h3 * 6) | 0;  // 0–5 px offset
  const yOffset = (h4 * 4) | 0;  // 0–3 px offset

  return { atlasIndex, xOffset, yOffset };
}

// ── Tree selection ──────────────────────────────────────────────────────────

/**
 * Deterministically select a two-tile tree pair for a forest tile.
 *
 * @returns A {canopy, trunk} pair with the atlas indices and the
 *          relative offset {canopyDy: -1, trunkDy: 0}, or null if
 *          this tile should not get a two-tile tree.
 */
export function selectTwoTileTree(
  wx: number,
  wy: number,
  seed: number,
  atlasCount: number,
): { canopy: number; trunk: number; canopyDy: number } | null {
  if (TWO_TILE_TREES.length === 0) return null;

  const h = tileHash(wx, wy, seed + 55555);
  if (h > 0.40) return null; // ~40% density for two-tile trees

  const idx = (h * TWO_TILE_TREES.length * 1000) | 0;
  const pair = TWO_TILE_TREES[idx % TWO_TILE_TREES.length];

  if (pair.canopy >= atlasCount || pair.trunk >= atlasCount) return null;

  return { canopy: pair.canopy, trunk: pair.trunk, canopyDy: -1 };
}

/**
 * Deterministically select a one-tile tree for a forest tile.
 * Only returns 27 or 28.
 *
 * @returns atlas index (27 or 28) or null.
 */
export function selectOneTileTree(
  wx: number,
  wy: number,
  seed: number,
  atlasCount: number,
): number | null {
  if (ONE_TILE_TREES.length === 0) return null;

  const h = tileHash(wx, wy, seed + 44444);
  if (h > 0.30) return null; // ~30% density for one-tile trees

  const idx = (h * ONE_TILE_TREES.length * 1000) | 0;
  const atlasIndex = ONE_TILE_TREES[idx % ONE_TILE_TREES.length];

  if (atlasIndex >= atlasCount) return null;

  return atlasIndex;
}

// ── Edge transition selection ───────────────────────────────────────────────

/**
 * Deterministically select a grass/dirt boundary edge transition atlas index.
 * Used when a Grass tile is 4-connected to a Sand (dirt) tile.
 *
 * @returns one of the 8 edge indices [12,13,14,24,26,36,37,38] or null.
 */
export function selectEdgeTransition(
  wx: number,
  wy: number,
  seed: number,
  atlasCount: number,
): number | null {
  if (EDGE_TRANSITIONS.length === 0) return null;

  const h = tileHash(wx, wy, seed + 66666);
  const idx = (h * EDGE_TRANSITIONS.length * 1000) | 0;
  const atlasIndex = EDGE_TRANSITIONS[idx % EDGE_TRANSITIONS.length];

  if (atlasIndex >= atlasCount) return null;

  return atlasIndex;
}
