/** Tile types rendered on the map. */
export enum TileType {
  // Base terrain
  Grass = 0,
  Water = 1,
  Sand = 2,
  Stone = 3,
  Forest = 4,
  Snow = 5,
  DeepWater = 6,
  Swamp = 7,
  Ice = 8,

  // Shore / water-edge transitions
  ShoreSand = 9,
  ShoreGrass = 10,
  ShoreForest = 11,
  ShoreSwamp = 12,
  ShoreSnow = 13,
  ShoreStone = 14,

  // Biome transitions (blends)
  GrassToSand = 15,
  GrassToForest = 16,
  GrassToSwamp = 17,
  GrassToStone = 18,
  GrassToSnow = 19,
  SandToStone = 20,
  ForestToSwamp = 21,
  ForestToStone = 22,
  SwampToStone = 23,
  StoneToSnow = 24,
  SnowToIce = 25,

  // Variants for visual variety
  GrassVariant1 = 26,
  GrassVariant2 = 27,
  ForestVariant1 = 28,
  ForestVariant2 = 29,
  StoneVariant1 = 30,
  StoneVariant2 = 31,
  SandVariant1 = 32,
  SnowVariant1 = 33,
  SwampVariant1 = 34,
  WaterVariant1 = 35,
  WaterVariant2 = 36,
  DeepWaterVariant1 = 37,
}

/** High-level biome categories derived from noise layers. */
export enum Biome {
  Ocean = 0,
  Beach = 1,
  Plains = 2,
  Desert = 3,
  Forest = 4,
  Swamp = 5,
  Mountains = 6,
  Tundra = 7,
  Ice = 8,
}

/** A 32x32 chunk of tiles at world coordinates (cx, cy). */
export interface Chunk {
  readonly tiles: TileType[][];
  readonly cx: number;
  readonly cy: number;
}

/** Configuration knobs exposed by the generator. */
export interface WorldGenConfig {
  /** Base frequency for elevation noise (default: 0.05). */
  elevationFrequency: number;
  /** Base frequency for moisture noise (default: 0.04). */
  moistureFrequency: number;
  /** Octave count for fractal noise (default: 4). */
  octaveCount: number;
  /** Lacunarity multiplier per octave (default: 2.0). */
  lacunarity: number;
  /** Gain per octave (default: 0.5). */
  gain: number;

  // ── Layered noise extensions ──
  /** Very-low-frequency continentalness layer (default: 0.002).
   *  Drives macro landmass vs ocean. */
  continentalnessFrequency: number;
  /** Medium-frequency erosion layer (default: 0.008).
   *  Controls landform variety on land. */
  erosionFrequency: number;
  /** Medium-high-frequency peaks/ridges layer (default: 0.012).
   *  Drives mountain placement. */
  peaksFrequency: number;
  /** Low-frequency temperature layer (default: 0.003).
   *  Dedicated noise for temperature — avoids latitude formulas that
   *  break for negative/unbounded coordinates. */
  temperatureFrequency: number;
}

export { CHUNK_SIZE } from "../types/constants.js";

export const DEFAULT_CONFIG: Readonly<WorldGenConfig> = {
  elevationFrequency: 0.05,
  moistureFrequency: 0.04,
  octaveCount: 4,
  lacunarity: 2.0,
  gain: 0.5,
  continentalnessFrequency: 0.008,
  erosionFrequency: 0.008,
  peaksFrequency: 0.012,
  temperatureFrequency: 0.003,
};
