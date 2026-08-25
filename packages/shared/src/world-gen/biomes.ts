import { Biome, TileType } from "./types.js";

/** Normalise noise [-1, 1] → [0, 1]. */
export function normalise(v: number): number {
  return (v + 1) * 0.5;
}

/** Get deterministic variant index from world coordinates. */
function variantHash(wx: number, wy: number, max: number): number {
  let h = (wx * 73856093) ^ (wy * 19349663) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  return (h >>> 0) % max;
}

/** Lookup biome from normalised elevation and moisture (both 0..1). */
export function lookupBiome(elevation: number, moisture: number): Biome {
  if (elevation < 0.18) return Biome.Ocean;
  if (elevation < 0.30) return Biome.Ocean;
  if (elevation < 0.38) {
    return moisture > 0.55 ? Biome.Swamp : Biome.Plains;
  }
  if (elevation < 0.42) return Biome.Beach;

  if (elevation < 0.65) {
    if (moisture < 0.33) return Biome.Desert;
    if (moisture < 0.66) return Biome.Plains;
    return Biome.Forest;
  }

  if (elevation < 0.78) return Biome.Mountains;

  return moisture > 0.4 ? Biome.Ice : Biome.Tundra;
}

// ── Layered biome selection ──────────────────────────────────────────────────

/** Parameters for layered biome selection (all values normalised 0..1). */
export interface LayeredBiomeParams {
  /** Macro landmass vs ocean (very-low-frequency noise). */
  readonly continentalness: number;
  /** Landform roughness (medium-frequency noise). */
  readonly erosion: number;
  /** Mountain-ridge intensity (medium-high-frequency noise). */
  readonly peaks: number;
  /** Wet vs dry (existing moisture noise). */
  readonly moisture: number;
  /** Hot vs cold (dedicated temperature noise — no latitude). */
  readonly temperature: number;
}

/**
 * Deterministic biome selection from layered noise parameters.
 *
 * Design:
 * - **continentalness** drives ocean vs land (primary ocean gate).
 * - **peaks** drives mountain placement (modulated slightly by erosion).
 * - **temperature + moisture** decide land biomes.
 * - Maps conservatively to the existing 9 `Biome` values.
 */
export function lookupBiomeLayered(p: LayeredBiomeParams): Biome {
  // 1. Continentalness → ocean vs land
  if (p.continentalness < 0.48) return Biome.Ocean;

  // 2. Beach: narrow transition zone at the continental margin
  if (p.continentalness < 0.53) return Biome.Beach;

  // 3. Peaks/ridges → mountains (erosion shifts the threshold)
  //    High erosion lowers the mountain threshold; low erosion raises it.
  const mountainThreshold = 0.72 + (0.5 - p.erosion) * 0.12;
  if (p.peaks > mountainThreshold) return Biome.Mountains;

  // 4. Temperature + moisture → land biomes
  // ── Cold zones ──
  if (p.temperature < 0.12) {
    return p.moisture > 0.50 ? Biome.Ice : Biome.Tundra;
  }
  if (p.temperature < 0.32) {
    return Biome.Tundra;
  }

  // ── Hot zones ──
  if (p.temperature > 0.68) {
    if (p.moisture < 0.32) return Biome.Desert;
    if (p.moisture > 0.62) return Biome.Swamp;
    return Biome.Plains;
  }

  // ── Temperate zones ──
  if (p.moisture < 0.28) return Biome.Desert;
  if (p.moisture < 0.55) return Biome.Plains;
  return Biome.Forest;
}

/** Map a biome to its primary tile type (legacy export for backward compat). */
export function biomeToTile(biome: Biome): TileType {
  switch (biome) {
    case Biome.Ocean: return TileType.Water;
    case Biome.Beach: return TileType.Sand;
    case Biome.Plains: return TileType.Grass;
    case Biome.Desert: return TileType.Sand;
    case Biome.Forest: return TileType.Forest;
    case Biome.Swamp: return TileType.Swamp;
    case Biome.Mountains: return TileType.Stone;
    case Biome.Tundra: return TileType.Snow;
    case Biome.Ice: return TileType.Ice;
  }
}

// biomeToShoreTile removed — shore visual is now handled entirely by the
// renderer via 8-neighbor bitmask → shore-rules.ts.  Water tiles remain
// Water/WaterVariant/DeepWater in the tile data.

/** Get variant tile for a base biome tile. Canonical export — import this instead of duplicating. */
export function biomeToVariantTile(biome: Biome, wx: number, wy: number, elevation = 0.5): TileType {
  const v = variantHash(wx, wy, 4);
  switch (biome) {
    case Biome.Plains:
      return v < 2 ? TileType.Grass : (v === 2 ? TileType.GrassVariant1 : TileType.GrassVariant2);
    case Biome.Desert:
      return v < 3 ? TileType.Sand : TileType.SandVariant1;
    case Biome.Forest:
      return v < 2 ? TileType.Forest : (v === 2 ? TileType.ForestVariant1 : TileType.ForestVariant2);
    case Biome.Swamp:
      return v < 3 ? TileType.Swamp : TileType.SwampVariant1;
    case Biome.Mountains:
      // Lower mountain slopes use the light variant; high peaks use darker stone.
      return elevation >= 0.72
        ? (v < 2 ? TileType.StoneVariant2 : TileType.Stone)
        : (v < 2 ? TileType.Stone : TileType.StoneVariant1);
    case Biome.Tundra:
      return v < 3 ? TileType.Snow : TileType.SnowVariant1;
    case Biome.Ice:
      return v < 3 ? TileType.Ice : TileType.Ice; // Ice has no variant yet
    case Biome.Ocean:
      // The lowest band is deep water; the upper ocean band is shallow water.
      return elevation < 0.24
        ? TileType.DeepWater
        : (v < 2 ? TileType.Water : (v === 2 ? TileType.WaterVariant1 : TileType.WaterVariant2));
    case Biome.Beach:
      return v < 3 ? TileType.Sand : TileType.SandVariant1;
    default:
      return biomeToTile(biome);
  }
}

/** Check if biome is water-like. */
function isWaterBiome(biome: Biome): boolean {
  return biome === Biome.Ocean;
}

/** Get transition tile between two biomes. */
function getTransitionTile(biomeA: Biome, biomeB: Biome): TileType | null {
  // Order-independent transition lookup
  const key = biomeA < biomeB ? `${biomeA},${biomeB}` : `${biomeB},${biomeA}`;

  const transitions: Record<string, TileType> = {
    // Plains (2) transitions
    "2,3": TileType.GrassToSand,      // Plains <-> Desert
    "2,4": TileType.GrassToForest,    // Plains <-> Forest
    "2,5": TileType.GrassToSwamp,     // Plains <-> Swamp
    "2,6": TileType.GrassToStone,     // Plains <-> Mountains
    "2,7": TileType.GrassToSnow,      // Plains <-> Tundra

    // Desert (3) transitions
    "3,6": TileType.SandToStone,      // Desert <-> Mountains

    // Forest (4) transitions
    "4,5": TileType.ForestToSwamp,    // Forest <-> Swamp
    "4,6": TileType.ForestToStone,    // Forest <-> Mountains

    // Swamp (5) transitions
    "5,6": TileType.SwampToStone,     // Swamp <-> Mountains

    // Mountains (6) transitions
    "6,7": TileType.StoneToSnow,      // Mountains <-> Tundra

    // Tundra (7) transitions
    "7,8": TileType.SnowToIce,        // Tundra <-> Ice
  };

  return transitions[key] ?? null;
}

/**
 * Two-pass tile resolution:
 * 1. First pass: compute base biome for each tile in chunk + neighbors
 * 2. Second pass: apply biome transitions (shore visuals are renderer-only overlay)
 */
export function resolveChunkTiles(
  chunkTiles: Biome[][],
  getNeighborBiome: (wx: number, wy: number) => Biome,
  chunkCx: number,
  chunkCy: number,
  CHUNK_SIZE: number,
  elevationGrid?: number[][],
): TileType[][] {
  const tiles: TileType[][] = new Array(CHUNK_SIZE);

  // Pass 1: Determine base tiles with variants
  const baseTiles: TileType[][] = new Array(CHUNK_SIZE);
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const row = new Array<TileType>(CHUNK_SIZE);
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const biome = chunkTiles[ly][lx];
      const wx = chunkCx * CHUNK_SIZE + lx;
      const wy = chunkCy * CHUNK_SIZE + ly;
      row[lx] = biomeToVariantTile(biome, wx, wy, elevationGrid?.[ly]?.[lx]);
    }
    baseTiles[ly] = row;
  }

  // Pass 2: Apply biome transitions (shore is renderer-only)
  // Helper: get biome at local coords (with neighbor fallback)
  function getBiomeAt(lx: number, ny: number): Biome {
    if (lx >= 0 && lx < CHUNK_SIZE && ny >= 0 && ny < CHUNK_SIZE) {
      return chunkTiles[ny][lx];
    }
    const wx2 = chunkCx * CHUNK_SIZE + lx;
    const wy2 = chunkCy * CHUNK_SIZE + ny;
    return getNeighborBiome(wx2, wy2);
  }

  // Helper: find closest land biome within radius
  function findLandBiomeInRange(clx: number, cly: number, radius: number): Biome | null {
    for (let r = 1; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // only check perimeter
          const n = getBiomeAt(clx + dx, cly + dy);
          if (!isWaterBiome(n)) return n;
        }
      }
    }
    return null;
  }

  const dirs4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const row = new Array<TileType>(CHUNK_SIZE);
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const biome = chunkTiles[ly][lx];
      let tile = baseTiles[ly][lx];

      // ── Water tiles ──
      // Water tiles keep their base type (Water / WaterVariant / DeepWater).
      // Shore visuals are applied by the renderer using 8-neighbor bitmask.
      // Only handle isolated single-tile water pockets here.
      if (isWaterBiome(biome)) {
        // Remove isolated one-tile water pockets: water must connect to at least
        // one other water tile via 4-connectivity.
        const hasWaterNeighbor = dirs4.some(([dx, dy]) =>
          isWaterBiome(getBiomeAt(lx + dx, ly + dy)),
        );
        if (!hasWaterNeighbor) {
          // Convert isolated water to the nearest land biome's base tile
          const nearestLand = findLandBiomeInRange(lx, ly, 1) ?? Biome.Plains;
          tile = biomeToTile(nearestLand);
          row[lx] = tile;
          continue;
        }
        // Keep the base water tile — no shore conversion here.
        // The renderer will overlay shore textures based on neighbor mask.
      }
      // ── Land tiles ──
      else {
        // Biome transitions (land-to-land only)
        for (const [dx, dy] of dirs4) {
          const n = getBiomeAt(lx + dx, ly + dy);
          if (!isWaterBiome(n) && n !== biome) {
            const transition = getTransitionTile(biome, n);
            if (transition) { tile = transition; break; }
          }
        }
      }

      row[lx] = tile;
    }
    tiles[ly] = row;
  }

  return tiles;
}

/**
 * Legacy single-tile resolver for backward compatibility.
 * Used by WorldGenerator for simple chunk generation without neighbor context.
 */
export function resolveTile(
  rawElevation: number,
  rawMoisture: number,
): TileType {
  const e = normalise(rawElevation);
  const m = normalise(rawMoisture);
  const biome = lookupBiome(e, m);
  return biomeToTile(biome);
}
