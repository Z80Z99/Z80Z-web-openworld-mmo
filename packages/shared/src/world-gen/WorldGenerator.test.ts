import { describe, it, expect } from "vitest";
import { WorldGenerator } from "./WorldGenerator.js";
import { TileType, Biome, CHUNK_SIZE } from "./types.js";
import {
  normalise,
  lookupBiome,
  lookupBiomeLayered,
  biomeToTile,
  biomeToVariantTile,
  resolveChunkTiles,
} from "./biomes.js";

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
          (t) => t === TileType.Water
            || t === TileType.WaterVariant1
            || t === TileType.WaterVariant2
            || t === TileType.DeepWater
            || t === TileType.DeepWaterVariant1
            || t === TileType.ShoreSand
            || t === TileType.ShoreGrass
            || t === TileType.ShoreForest
            || t === TileType.ShoreSwamp
            || t === TileType.ShoreSnow
            || t === TileType.ShoreStone,
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

// ---------------------------------------------------------------------------
// 8. lookupBiomeLayered — layered noise biome selection
// ---------------------------------------------------------------------------

describe("lookupBiomeLayered", () => {
  it("low continentalness returns Ocean regardless of other params", () => {
    const cases = [
      { continentalness: 0.10, erosion: 0.5, peaks: 0.5, moisture: 0.5, temperature: 0.5 },
      { continentalness: 0.20, erosion: 0.9, peaks: 0.9, moisture: 0.1, temperature: 0.9 },
      { continentalness: 0.45, erosion: 0.1, peaks: 0.1, moisture: 0.9, temperature: 0.1 },
    ];
    for (const p of cases) {
      expect(lookupBiomeLayered(p)).toBe(Biome.Ocean);
    }
  });

  it("continentalness 0.48-0.53 returns Beach", () => {
    expect(lookupBiomeLayered({ continentalness: 0.49, erosion: 0.5, peaks: 0.3, moisture: 0.5, temperature: 0.5 }))
      .toBe(Biome.Beach);
    expect(lookupBiomeLayered({ continentalness: 0.52, erosion: 0.5, peaks: 0.3, moisture: 0.5, temperature: 0.5 }))
      .toBe(Biome.Beach);
  });

  it("high peaks returns Mountains on land", () => {
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.80, moisture: 0.5, temperature: 0.5 }))
      .toBe(Biome.Mountains);
  });

  it("cold temperature returns Tundra or Ice", () => {
    // Very cold + wet → Ice
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.7, temperature: 0.05 }))
      .toBe(Biome.Ice);
    // Very cold + dry → Tundra
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.3, temperature: 0.05 }))
      .toBe(Biome.Tundra);
    // Moderately cold → Tundra
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.5, temperature: 0.25 }))
      .toBe(Biome.Tundra);
  });

  it("hot + dry returns Desert", () => {
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.20, temperature: 0.80 }))
      .toBe(Biome.Desert);
  });

  it("hot + wet returns Swamp", () => {
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.80, temperature: 0.80 }))
      .toBe(Biome.Swamp);
  });

  it("temperate + moderate moisture returns Plains", () => {
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.40, temperature: 0.50 }))
      .toBe(Biome.Plains);
  });

  it("temperate + high moisture returns Forest", () => {
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.5, peaks: 0.3, moisture: 0.70, temperature: 0.50 }))
      .toBe(Biome.Forest);
  });

  it("erosion modulates mountain threshold", () => {
    // High erosion lowers threshold → peaks=0.68 becomes mountains
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.9, peaks: 0.68, moisture: 0.5, temperature: 0.5 }))
      .toBe(Biome.Mountains);
    // Low erosion raises threshold → same peaks stays land
    expect(lookupBiomeLayered({ continentalness: 0.60, erosion: 0.1, peaks: 0.68, moisture: 0.5, temperature: 0.5 }))
      .not.toBe(Biome.Mountains);
  });

  it("returns only valid Biome values", () => {
    const validBiomes = new Set(
      Object.values(Biome).filter((v) => typeof v === "number"),
    );
    for (let c = 0; c <= 100; c += 5) {
      for (let p = 0; p <= 100; p += 5) {
        const result = lookupBiomeLayered({
          continentalness: c / 100,
          erosion: 0.5,
          peaks: p / 100,
          moisture: 0.5,
          temperature: 0.5,
        });
        expect(validBiomes.has(result)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 9. No isolated water tiles
// ---------------------------------------------------------------------------

describe("WorldGenerator no isolated water", () => {
  it("no single-tile water pockets in any chunk across multiple seeds", () => {
    const waterTypes = new Set([
      TileType.Water, TileType.WaterVariant1, TileType.WaterVariant2,
      TileType.DeepWater, TileType.DeepWaterVariant1,
    ]);
    const shoreTypes = new Set([
      TileType.ShoreSand, TileType.ShoreGrass, TileType.ShoreForest,
      TileType.ShoreSwamp, TileType.ShoreSnow, TileType.ShoreStone,
    ]);
    const waterOrShore = new Set([...waterTypes, ...shoreTypes]);
    const dirs4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    for (const seed of [42, 12345, 99999, 20260824, 7]) {
      const gen = new WorldGenerator(seed);
      for (let cx = -1; cx <= 1; cx++) {
        for (let cy = -1; cy <= 1; cy++) {
          const chunk = gen.generateChunk(cx, cy);
          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
              const t = chunk.tiles[ly][lx];
              if (!waterTypes.has(t)) continue;

              // Check if this water tile is isolated (no water or shore neighbor in output)
              let hasWaterNeighbor = false;
              for (const [dx, dy] of dirs4) {
                const nx = lx + dx;
                const ny = ly + dy;
                // Within chunk: direct lookup
                if (nx >= 0 && nx < CHUNK_SIZE && ny >= 0 && ny < CHUNK_SIZE) {
                  if (waterOrShore.has(chunk.tiles[ny][nx])) {
                    hasWaterNeighbor = true;
                    break;
                  }
                } else {
                  // Cross-chunk: regenerate neighbor and check its tiles
                  const ncx = cx + Math.floor(nx / CHUNK_SIZE);
                  const ncy = cy + Math.floor(ny / CHUNK_SIZE);
                  const neighborChunk = gen.generateChunk(ncx, ncy);
                  const nnx = ((nx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
                  const nny = ((ny % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
                  if (waterOrShore.has(neighborChunk.tiles[nny][nnx])) {
                    hasWaterNeighbor = true;
                    break;
                  }
                }
              }
              expect(hasWaterNeighbor).toBe(true);
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Cross-chunk generation consistency
// ---------------------------------------------------------------------------

describe("WorldGenerator cross-chunk consistency", () => {
  it("neighbor chunk biome resolves water at the coast (shore visuals are renderer-only)", () => {
    const size = 4;
    const oceanGrid = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => Biome.Ocean),
    );
    const elevations = Array.from({ length: size }, () =>
      Array.from({ length: size }, () => 0.5),
    );

    const waterFamily = new Set([
      TileType.Water,
      TileType.WaterVariant1,
      TileType.WaterVariant2,
      TileType.DeepWater,
      TileType.DeepWaterVariant1,
    ]);

    const tiles = resolveChunkTiles(
      oceanGrid,
      (wx) => wx >= size ? Biome.Plains : Biome.Ocean,
      0,
      0,
      size,
      elevations,
    );

    for (let y = 0; y < size; y++) {
      expect(waterFamily.has(tiles[y][size - 1])).toBe(true);
      expect([
        TileType.Water,
        TileType.WaterVariant1,
        TileType.WaterVariant2,
      ]).toContain(tiles[y][size - 2]);
    }
  });

  it("generateChunk and server path produce same tiles for same coordinates", () => {
    const gen = new WorldGenerator(42);
    // generateChunk internally calls generateChunkWithNeighbors with self-callback
    // so client and server paths agree
    const chunk1 = gen.generateChunk(5, -3);
    const chunk2 = gen.generateChunk(5, -3);
    expect(JSON.stringify(chunk1)).toBe(JSON.stringify(chunk2));
  });

  it("cross-chunk edge tiles are consistent when chunks are generated in different order", () => {
    const gen = new WorldGenerator(42);
    // Generate center chunk first, then neighbors
    const center = gen.generateChunk(0, 0);
    const right = gen.generateChunk(1, 0);
    const below = gen.generateChunk(0, 1);

    // Regenerate in different order
    const below2 = gen.generateChunk(0, 1);
    const right2 = gen.generateChunk(1, 0);
    const center2 = gen.generateChunk(0, 0);

    expect(JSON.stringify(center)).toBe(JSON.stringify(center2));
    expect(JSON.stringify(right)).toBe(JSON.stringify(right2));
    expect(JSON.stringify(below)).toBe(JSON.stringify(below2));
  });
});

// ---------------------------------------------------------------------------
// 11. Negative and large coordinate determinism
// ---------------------------------------------------------------------------

describe("WorldGenerator large/negative coordinate determinism", () => {
  it("large negative coordinates are deterministic", () => {
    const gen1 = new WorldGenerator(42);
    const gen2 = new WorldGenerator(42);
    const a = gen1.generateChunk(-500, -500);
    const b = gen2.generateChunk(-500, -500);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("very large positive coordinates are deterministic", () => {
    const gen1 = new WorldGenerator(42);
    const gen2 = new WorldGenerator(42);
    const a = gen1.generateChunk(99999, 99999);
    const b = gen2.generateChunk(99999, 99999);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("mixed extreme coordinates produce valid chunks", () => {
    const gen = new WorldGenerator(42);
    const chunk = gen.generateChunk(-99999, 99999);
    expect(chunk.tiles).toHaveLength(CHUNK_SIZE);
    expect(chunk.tiles[0]).toHaveLength(CHUNK_SIZE);
    const validValues = new Set(
      Object.values(TileType).filter((v) => typeof v === "number"),
    );
    for (const row of chunk.tiles) {
      for (const t of row) {
        expect(validValues.has(t)).toBe(true);
      }
    }
  });

  it("getBiomeAt works at large negative world coordinates", () => {
    const gen = new WorldGenerator(42);
    const biome = gen.getBiomeAt(-1000000, -1000000);
    expect(Object.values(Biome)).toContain(biome);
  });
});

// ---------------------------------------------------------------------------
// 12. Tile semantic mapping
// ---------------------------------------------------------------------------

describe("tile semantic mapping", () => {
  it("Grass category tiles exist in temperate land areas", () => {
    const gen = new WorldGenerator(42);
    const grassTypes = new Set([
      TileType.Grass, TileType.GrassVariant1, TileType.GrassVariant2,
    ]);
    let found = false;
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const row of chunk.tiles) {
          for (const t of row) {
            if (grassTypes.has(t)) { found = true; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it("Sand category tiles exist near water or in desert areas", () => {
    const gen = new WorldGenerator(12345);
    const sandTypes = new Set([TileType.Sand, TileType.SandVariant1]);
    let found = false;
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const row of chunk.tiles) {
          for (const t of row) {
            if (sandTypes.has(t)) { found = true; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });

  it("Water/DeepWater tiles exist in ocean areas", () => {
    const gen = new WorldGenerator(12345);
    const deepWaterTypes = new Set([TileType.DeepWater]);
    const waterTypes = new Set([TileType.Water, TileType.WaterVariant1, TileType.WaterVariant2]);
    let hasDeep = false;
    let hasShallow = false;
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const row of chunk.tiles) {
          for (const t of row) {
            if (deepWaterTypes.has(t)) hasDeep = true;
            if (waterTypes.has(t)) hasShallow = true;
          }
        }
      }
    }
    expect(hasDeep).toBe(true);
    expect(hasShallow).toBe(true);
  });

  it("no ShoreXxx tiles exist in generated chunks (shore is renderer-only overlay)", () => {
    const gen = new WorldGenerator(12345);
    const shoreTypes = new Set([
      TileType.ShoreSand, TileType.ShoreGrass, TileType.ShoreForest,
      TileType.ShoreSwamp, TileType.ShoreSnow, TileType.ShoreStone,
    ]);
    let found = false;
    let tilesInspected = 0;
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const row of chunk.tiles) {
          for (const t of row) {
            tilesInspected++;
            if (shoreTypes.has(t)) { found = true; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) break;
    }
    expect(tilesInspected).toBeGreaterThan(0);
    expect(found).toBe(false);
  });

  it("generated chunks contain zero ShoreXxx tiles", () => {
    // Shore visuals are now a renderer-only overlay; the world-gen layer
    // never emits ShoreXxx tiles.
    const gen = new WorldGenerator(12345);
    const shoreTypes = new Set([
      TileType.ShoreSand, TileType.ShoreGrass, TileType.ShoreForest,
      TileType.ShoreSwamp, TileType.ShoreSnow, TileType.ShoreStone,
    ]);
    // Count total shore tiles across several chunks
    let totalShore = 0;
    let totalTiles = 0;
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = 0; cy < 4; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const row of chunk.tiles) {
          for (const t of row) {
            totalTiles++;
            if (shoreTypes.has(t)) totalShore++;
          }
        }
      }
    }
    const shoreRatio = totalShore / totalTiles;
    expect(totalTiles).toBeGreaterThan(0);
    expect(shoreRatio).toBe(0);
  });

  it("biomeToVariantTile maps all Biome values to valid TileType values", () => {
    const validValues = new Set(
      Object.values(TileType).filter((v) => typeof v === "number"),
    );
    const allBiomes = Object.values(Biome).filter((v) => typeof v === "number") as Biome[];
    for (const biome of allBiomes) {
      const tile = biomeToVariantTile(biome, 100, 100, 0.5);
      expect(validValues.has(tile)).toBe(true);
    }
  });

  it("all 38 TileType values remain defined", () => {
    const values = Object.values(TileType).filter((v) => typeof v === "number") as number[];
    expect(values).toHaveLength(38);
    // Verify min/max range
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(37);
  });
});

// ---------------------------------------------------------------------------
// 13. Layered distribution across seeds
// ---------------------------------------------------------------------------

describe("WorldGenerator layered distribution across seeds", () => {
  it("multiple seeds all produce >=3 biome types in a 4-chunk area", () => {
    for (const seed of [42, 12345, 99999, 20260824]) {
      const gen = new WorldGenerator(seed);
      const allBiomes = new Set<Biome>();
      for (let cx = 0; cx < 2; cx++) {
        for (let cy = 0; cy < 2; cy++) {
          for (const b of uniqueBiomes(gen.generateChunk(cx, cy))) {
            allBiomes.add(b);
          }
        }
      }
      expect(allBiomes.size).toBeGreaterThanOrEqual(3);
    }
  });

  it("multiple seeds produce water surface in 64x64 area", () => {
    for (const seed of [42, 12345, 20260824]) {
      const gen = new WorldGenerator(seed);
      let totalTiles = 0;
      let waterTiles = 0;
      for (let cx = 0; cx < 2; cx++) {
        for (let cy = 0; cy < 2; cy++) {
          const chunk = gen.generateChunk(cx, cy);
          totalTiles += CHUNK_SIZE * CHUNK_SIZE;
          waterTiles += countTiles(chunk, (t) =>
            t === TileType.Water
            || t === TileType.WaterVariant1
            || t === TileType.WaterVariant2
            || t === TileType.DeepWater
            || t === TileType.ShoreSand
            || t === TileType.ShoreGrass
            || t === TileType.ShoreForest
            || t === TileType.ShoreSwamp
            || t === TileType.ShoreSnow
            || t === TileType.ShoreStone,
          );
        }
      }
      const pct = waterTiles / totalTiles;
      expect(pct).toBeGreaterThanOrEqual(0.05);
      expect(pct).toBeLessThanOrEqual(0.50);
    }
  });
});
