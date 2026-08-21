import { describe, it, expect } from "vitest";
import { WorldGenerator } from "./WorldGenerator.js";
import { TileType, Biome, CHUNK_SIZE } from "./types.js";
import { normalise, lookupBiome, biomeToTile } from "./biomes.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Count how many tiles in a chunk match a predicate. */
function countTiles(
  chunk: ReturnType<WorldGenerator["generateChunk"]>,
  predicate: (t: TileType) => boolean,
): number {
  let n = 0;
  for (const row of chunk.tiles) {
    for (const t of row) {
      if (predicate(t)) n++;
    }
  }
  return n;
}

/** Return the set of distinct biomes present in a chunk (via tile→biome reverse). */
function uniqueBiomes(chunk: ReturnType<WorldGenerator["generateChunk"]>): Set<Biome> {
  const biomeMap = new Map<TileType, Biome>();
  for (const b of Object.values(Biome).filter((v) => typeof v === "number") as Biome[]) {
    biomeMap.set(biomeToTile(b), b);
  }
  const biomes = new Set<Biome>();
  for (const row of chunk.tiles) {
    for (const t of row) {
      const b = biomeMap.get(t);
      if (b !== undefined) biomes.add(b);
    }
  }
  return biomes;
}

// ---------------------------------------------------------------------------
// 1. Seed determinism
// ---------------------------------------------------------------------------

describe("WorldGenerator seed determinism", () => {
  it("same seed produces identical JSON output", () => {
    const gen1 = new WorldGenerator(42);
    const gen2 = new WorldGenerator(42);
    const chunk1 = gen1.generateChunk(0, 0);
    const chunk2 = gen2.generateChunk(0, 0);
    expect(JSON.stringify(chunk1)).toBe(JSON.stringify(chunk2));
  });

  it("same seed produces identical chunks across multiple calls", () => {
    const gen = new WorldGenerator(999);
    const a = gen.generateChunk(5, 5);
    const b = gen.generateChunk(5, 5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different seeds produce different chunks", () => {
    const gen1 = new WorldGenerator(1);
    const gen2 = new WorldGenerator(2);
    const c1 = gen1.generateChunk(0, 0);
    const c2 = gen2.generateChunk(0, 0);
    expect(JSON.stringify(c1)).not.toBe(JSON.stringify(c2));
  });

  it("seed 0 is valid and deterministic", () => {
    const gen1 = new WorldGenerator(0);
    const gen2 = new WorldGenerator(0);
    expect(JSON.stringify(gen1.generateChunk(0, 0))).toBe(
      JSON.stringify(gen2.generateChunk(0, 0)),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Biome distribution
// ---------------------------------------------------------------------------

describe("WorldGenerator biome distribution", () => {
  it("seed 12345 in 64x64 area has at least 3 biome types", () => {
    const gen = new WorldGenerator(12345);
    const allBiomes = new Set<Biome>();

    // 2×2 chunk area = 64×64 tiles
    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const b of uniqueBiomes(chunk)) {
          allBiomes.add(b);
        }
      }
    }

    expect(allBiomes.size).toBeGreaterThanOrEqual(3);
  });

  it("seed 12345 in 64x64 area has water 10-40%", () => {
    const gen = new WorldGenerator(12345);
    let totalTiles = 0;
    let waterTiles = 0;

    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        totalTiles += CHUNK_SIZE * CHUNK_SIZE;
        waterTiles += countTiles(
          chunk,
          (t) => t === TileType.Water,
        );
      }
    }

    const waterPct = waterTiles / totalTiles;
    expect(waterPct).toBeGreaterThanOrEqual(0.1);
    expect(waterPct).toBeLessThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-platform determinism (JSON serialization avoids float direct comparison)
// ---------------------------------------------------------------------------

describe("WorldGenerator cross-platform determinism", () => {
  it("serialised tile grid is stable across two independent generators", () => {
    const seed = 12345;
    const gen1 = new WorldGenerator(seed);
    const gen2 = new WorldGenerator(seed);

    const snapshot1 = JSON.stringify(gen1.generateChunk(3, -7));
    const snapshot2 = JSON.stringify(gen2.generateChunk(3, -7));
    expect(snapshot1).toBe(snapshot2);
  });

  it("chunk coordinates are preserved in serialised output", () => {
    const gen = new WorldGenerator(100);
    const chunk = gen.generateChunk(-5, 12);
    expect(chunk.cx).toBe(-5);
    expect(chunk.cy).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge cases: negative chunk coordinates
// ---------------------------------------------------------------------------

describe("WorldGenerator edge cases", () => {
  it("works with negative chunk coordinates", () => {
    const gen = new WorldGenerator(42);
    const chunk = gen.generateChunk(-10, -20);
    expect(chunk.tiles).toHaveLength(CHUNK_SIZE);
    expect(chunk.tiles[0]).toHaveLength(CHUNK_SIZE);
    expect(chunk.cx).toBe(-10);
    expect(chunk.cy).toBe(-20);
  });

  it("works with mixed positive/negative coordinates", () => {
    const gen = new WorldGenerator(7);
    const chunk = gen.generateChunk(-1, 3);
    expect(JSON.stringify(gen.generateChunk(-1, 3))).toBe(
      JSON.stringify(gen.generateChunk(-1, 3)),
    );
  });

  it("very large chunk coordinates don't throw", () => {
    const gen = new WorldGenerator(1);
    expect(() => gen.generateChunk(100000, -100000)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Chunk structure
// ---------------------------------------------------------------------------

describe("WorldGenerator chunk structure", () => {
  it("generates CHUNK_SIZE x CHUNK_SIZE grid", () => {
    const gen = new WorldGenerator(42);
    const chunk = gen.generateChunk(0, 0);
    expect(chunk.tiles).toHaveLength(CHUNK_SIZE);
    for (const row of chunk.tiles) {
      expect(row).toHaveLength(CHUNK_SIZE);
    }
  });

  it("every tile is a valid TileType value", () => {
    const gen = new WorldGenerator(42);
    const chunk = gen.generateChunk(0, 0);
    const validValues = new Set(
      Object.values(TileType).filter((v) => typeof v === "number"),
    );
    for (const row of chunk.tiles) {
      for (const t of row) {
        expect(validValues.has(t)).toBe(true);
      }
    }
  });

  it("adjacent chunks share no mutable references", () => {
    const gen = new WorldGenerator(42);
    const a = gen.generateChunk(0, 0);
    const b = gen.generateChunk(1, 0);
    // Mutating b's first row must not affect a
    const origA = JSON.stringify(a.tiles[0]);
    b.tiles[0][0] = TileType.Ice;
    expect(JSON.stringify(a.tiles[0])).toBe(origA);
  });
});

// ---------------------------------------------------------------------------
// 6. Biome helper functions
// ---------------------------------------------------------------------------

describe("biome helpers", () => {
  it("normalise maps -1 to 0 and 1 to 1", () => {
    expect(normalise(-1)).toBeCloseTo(0);
    expect(normalise(1)).toBeCloseTo(1);
    expect(normalise(0)).toBeCloseTo(0.5);
  });

  it("lookupBiome returns Ocean for very low elevation", () => {
    expect(lookupBiome(0.10, 0.5)).toBe(Biome.Ocean);
  });

  it("lookupBiome returns Beach around elevation 0.40", () => {
    expect(lookupBiome(0.40, 0.5)).toBe(Biome.Beach);
  });

  it("lookupBiome is moisture-dependent in mid-elevation", () => {
    expect(lookupBiome(0.52, 0.15)).toBe(Biome.Desert);
    expect(lookupBiome(0.52, 0.50)).toBe(Biome.Plains);
    expect(lookupBiome(0.52, 0.80)).toBe(Biome.Forest);
  });

  it("lookupBiome returns Mountains for high elevation", () => {
    expect(lookupBiome(0.72, 0.5)).toBe(Biome.Mountains);
  });

  it("biomeToTile returns consistent mapping", () => {
    expect(biomeToTile(Biome.Ocean)).toBe(TileType.Water);
    expect(biomeToTile(Biome.Forest)).toBe(TileType.Forest);
    expect(biomeToTile(Biome.Desert)).toBe(TileType.Sand);
    expect(biomeToTile(Biome.Mountains)).toBe(TileType.Stone);
    expect(biomeToTile(Biome.Tundra)).toBe(TileType.Snow);
  });
});

// ---------------------------------------------------------------------------
// 7. Custom config
// ---------------------------------------------------------------------------

describe("WorldGenerator custom config", () => {
  it("accepts partial config override", () => {
    const gen = new WorldGenerator(42, { octaveCount: 1 });
    const chunk = gen.generateChunk(0, 0);
    expect(chunk.tiles).toHaveLength(CHUNK_SIZE);
  });

  it("different frequencies change the output", () => {
    const a = new WorldGenerator(42, { elevationFrequency: 0.02 });
    const b = new WorldGenerator(42, { elevationFrequency: 0.1 });
    expect(JSON.stringify(a.generateChunk(0, 0))).not.toBe(
      JSON.stringify(b.generateChunk(0, 0)),
    );
  });
});
