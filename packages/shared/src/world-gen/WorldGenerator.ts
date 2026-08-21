import FastNoiseLite from "fastnoise-lite";
import {
  type Chunk,
  type WorldGenConfig,
  CHUNK_SIZE,
  DEFAULT_CONFIG,
  TileType,
} from "./types.js";
import { resolveTile } from "./biomes.js";

/**
 * Deterministic world-generation kernel.
 *
 * Usage:
 * ```ts
 * const gen = new WorldGenerator(42);
 * const chunk = gen.generateChunk(0, 0);
 * ```
 *
 * The same seed + chunk coordinates always produce identical tile grids.
 */
export class WorldGenerator {
  private readonly seed: number;
  private readonly config: WorldGenConfig;
  private readonly elevationNoise: InstanceType<typeof FastNoiseLite>;
  private readonly moistureNoise: InstanceType<typeof FastNoiseLite>;

  constructor(seed: number, config?: Partial<WorldGenConfig>) {
    this.seed = seed;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.elevationNoise = this.createNoise(seed, this.config.elevationFrequency);
    this.moistureNoise = this.createNoise(seed + 7919, this.config.moistureFrequency); // prime offset for decorrelation
  }

  /** Create and configure a seeded FastNoiseLite instance. */
  private createNoise(seed: number, frequency: number): InstanceType<typeof FastNoiseLite> {
    const n = new FastNoiseLite(seed);
    n.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    n.SetFractalType(FastNoiseLite.FractalType.FBm);
    n.SetFractalOctaves(this.config.octaveCount);
    n.SetFractalLacunarity(this.config.lacunarity);
    n.SetFractalGain(this.config.gain);
    n.SetFrequency(frequency);
    return n;
  }

  /**
   * Generate a 32×32 chunk at chunk coordinates (cx, cy).
   * World-space tile coordinates are (cx * CHUNK_SIZE + localX, cy * CHUNK_SIZE + localY).
   */
  generateChunk(cx: number, cy: number): Chunk {
    const tiles: TileType[][] = new Array(CHUNK_SIZE);

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const row = new Array<TileType>(CHUNK_SIZE);
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = cx * CHUNK_SIZE + lx;
        const wy = cy * CHUNK_SIZE + ly;

        const rawElevation = this.elevationNoise.GetNoise(wx, wy);
        const rawMoisture = this.moistureNoise.GetNoise(wx, wy);

        row[lx] = resolveTile(rawElevation, rawMoisture);
      }
      tiles[ly] = row;
    }

    return { tiles, cx, cy };
  }
}
