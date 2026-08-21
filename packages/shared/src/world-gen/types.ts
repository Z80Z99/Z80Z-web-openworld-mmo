/** Tile types rendered on the map. */
export enum TileType {
  Grass = 0,
  Water = 1,
  Sand = 2,
  Stone = 3,
  Forest = 4,
  Snow = 5,
  DeepWater = 6,
  Swamp = 7,
  Ice = 8,
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
  /** Base frequency for elevation noise (default: 0.005). */
  elevationFrequency: number;
  /** Base frequency for moisture noise (default: 0.008). */
  moistureFrequency: number;
  /** Octave count for fractal noise (default: 4). */
  octaveCount: number;
  /** Lacunarity multiplier per octave (default: 2.0). */
  lacunarity: number;
  /** Gain per octave (default: 0.5). */
  gain: number;
}

export { CHUNK_SIZE } from "../types/constants.js";

export const DEFAULT_CONFIG: Readonly<WorldGenConfig> = {
  elevationFrequency: 0.05,
  moistureFrequency: 0.04,
  octaveCount: 4,
  lacunarity: 2.0,
  gain: 0.5,
};
