import { Biome, TileType } from "./types.js";

/**
 * Elevation and moisture values are normalised from raw noise (-1..1) to 0..1
 * then sampled against thresholds to pick a biome.
 *
 * Thresholds are calibrated so that with OpenSimplex2 FBm (centred near 0.5
 * after normalisation) the map produces a reasonable land/water split.
 *
 *   normalised elevation ↑
 *   0.78+          Tundra / Ice (moisture-dependent)
 *   0.65–0.78      Mountains
 *   0.42–0.65      Plains / Desert / Forest  (moisture-dependent)
 *   0.38–0.42      Beach
 *   0.30–0.38      Swamp (high moisture) or Grass
 *   < 0.30         Water / Ocean
 *   < 0.18         Deep Water
 */

/** Normalise noise [-1, 1] → [0, 1]. */
export function normalise(v: number): number {
  return (v + 1) * 0.5;
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

/** Map a biome to its representative tile type. */
export function biomeToTile(biome: Biome): TileType {
  switch (biome) {
    case Biome.Ocean:     return TileType.Water;
    case Biome.Beach:     return TileType.Sand;
    case Biome.Plains:    return TileType.Grass;
    case Biome.Desert:    return TileType.Sand;
    case Biome.Forest:    return TileType.Forest;
    case Biome.Swamp:     return TileType.Swamp;
    case Biome.Mountains: return TileType.Stone;
    case Biome.Tundra:    return TileType.Snow;
    case Biome.Ice:       return TileType.Ice;
  }
}

/**
 * Combined lookup: raw elevation + moisture → TileType.
 * Used by the generator for each tile.
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
