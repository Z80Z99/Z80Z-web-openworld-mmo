import FastNoiseLite from "fastnoise-lite";
import {
  type Chunk,
  type WorldGenConfig,
  CHUNK_SIZE,
  DEFAULT_CONFIG,
  TileType,
  Biome,
} from "./types.js";
import {
  resolveTile,
  resolveChunkTiles,
  lookupBiome,
  lookupBiomeLayered,
  normalise,
  biomeToVariantTile,
} from "./biomes.js";
import type { LayeredBiomeParams } from "./biomes.js";

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
  /** Fine-grained elevation for DeepWater / mountain-variant thresholds. */
  private readonly elevationNoise: InstanceType<typeof FastNoiseLite>;
  /** Macro continentalness (very-low-frequency). */
  private readonly continentalnessNoise: InstanceType<typeof FastNoiseLite>;
  /** Landform roughness (medium-frequency). */
  private readonly erosionNoise: InstanceType<typeof FastNoiseLite>;
  /** Mountain-ridge intensity (medium-high-frequency). */
  private readonly peaksNoise: InstanceType<typeof FastNoiseLite>;
  /** Moisture (existing). */
  private readonly moistureNoise: InstanceType<typeof FastNoiseLite>;
  /** Temperature (dedicated noise — no latitude). */
  private readonly temperatureNoise: InstanceType<typeof FastNoiseLite>;

  constructor(seed: number, config?: Partial<WorldGenConfig>) {
    this.seed = seed;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Prime offsets for decorrelation between layers
    this.elevationNoise = this.createNoise(seed, this.config.elevationFrequency);
    this.continentalnessNoise = this.createNoise(seed + 3571, this.config.continentalnessFrequency);
    this.erosionNoise = this.createNoise(seed + 5381, this.config.erosionFrequency);
    this.peaksNoise = this.createNoise(seed + 7919, this.config.peaksFrequency);
    this.moistureNoise = this.createNoise(seed + 104729, this.config.moistureFrequency);
    this.temperatureNoise = this.createNoise(seed + 131071, this.config.temperatureFrequency);
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

  /** Sample all noise layers at world coordinates and return layered biome params + elevation. */
  private sampleLayers(wx: number, wy: number): { params: LayeredBiomeParams; elevation: number } {
    const continentalness = normalise(this.continentalnessNoise.GetNoise(wx, wy));
    const erosion = normalise(this.erosionNoise.GetNoise(wx, wy));
    const peaks = normalise(this.peaksNoise.GetNoise(wx, wy));
    const moisture = normalise(this.moistureNoise.GetNoise(wx, wy));
    const temperature = normalise(this.temperatureNoise.GetNoise(wx, wy));
    const elevation = normalise(this.elevationNoise.GetNoise(wx, wy));
    return { params: { continentalness, erosion, peaks, moisture, temperature }, elevation };
  }

  /**
   * Generate a 32×32 chunk at chunk coordinates (cx, cy).
   * World-space tile coordinates are (cx * CHUNK_SIZE + localX, cy * CHUNK_SIZE + localY).
   *
   * Uses full neighbor-aware resolution for consistent shore/transition tiles.
   */
  generateChunk(cx: number, cy: number): Chunk {
    return this.generateChunkWithNeighbors(cx, cy, (wx, wy) => this.getBiomeAt(wx, wy));
  }

  /**
   * Generate a chunk with full neighbor context for proper transitions/shores.
   * @param getNeighborBiome - function to get biome at world coords, or null for simple mode
   */
  generateChunkWithNeighbors(
    cx: number,
    cy: number,
    getNeighborBiome: ((wx: number, wy: number) => Biome) | null
  ): Chunk {
    // First pass: compute biome grid for this chunk using layered noise
    const biomeGrid: Biome[][] = new Array(CHUNK_SIZE);
    const elevationGrid: number[][] = new Array(CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      const row = new Array<Biome>(CHUNK_SIZE);
      const elevationRow = new Array<number>(CHUNK_SIZE);
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = cx * CHUNK_SIZE + lx;
        const wy = cy * CHUNK_SIZE + ly;

        const { params, elevation } = this.sampleLayers(wx, wy);
        elevationRow[lx] = elevation;
        row[lx] = lookupBiomeLayered(params);
      }
      biomeGrid[ly] = row;
      elevationGrid[ly] = elevationRow;
    }

    // Second pass: resolve tiles with transitions/shores
    let tiles: TileType[][];
    if (getNeighborBiome) {
      tiles = resolveChunkTiles(biomeGrid, getNeighborBiome, cx, cy, CHUNK_SIZE, elevationGrid);
    } else {
      // Simple mode: no neighbor context, use variant tiles only
      tiles = new Array(CHUNK_SIZE);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const row = new Array<TileType>(CHUNK_SIZE);
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const biome = biomeGrid[ly][lx];
          const wx = cx * CHUNK_SIZE + lx;
          const wy = cy * CHUNK_SIZE + ly;
          row[lx] = biomeToVariantTile(biome, wx, wy, elevationGrid[ly][lx]);
        }
        tiles[ly] = row;
      }
    }

    return { tiles, cx, cy };
  }

  /**
   * Get biome at world coordinates (for external use).
   */
  getBiomeAt(wx: number, wy: number): Biome {
    const { params } = this.sampleLayers(wx, wy);
    return lookupBiomeLayered(params);
  }
}
