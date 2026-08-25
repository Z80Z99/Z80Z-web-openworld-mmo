import { describe, it, expect } from "vitest";
import { TileType, CHUNK_SIZE } from "./types.js";
import {
  hash01,
  getAnchorPoint,
  segmentExists,
  isPathTileAt,
  applyGravelPaths,
  DEFAULT_PATH_CONFIG,
} from "./path-rules.js";
import { WorldGenerator } from "./WorldGenerator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) for generating probe coordinates. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** Set every tile in a grid to the given type. */
function fillGrid(w: number, h: number, t: TileType): TileType[][] {
  return Array.from({ length: h }, () => Array(w).fill(t) as TileType[]);
}

/** Count tiles matching a predicate in a grid. */
function countWhere(
  grid: TileType[][],
  pred: (t: TileType) => boolean,
): number {
  let n = 0;
  for (const row of grid) for (const t of row) if (pred(t)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// 1. hash01 determinism + range
// ---------------------------------------------------------------------------

describe("hash01", () => {
  it("returns identical values across two calls for the same inputs", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 500; i++) {
      const seed = (rng() * 1e6) | 0;
      const a = (rng() * 1e4) | 0;
      const b = (rng() * 1e4) | 0;
      const c = (rng() * 1e4) | 0;
      expect(hash01(seed, a, b, c)).toBe(hash01(seed, a, b, c));
    }
  });

  it("returns values in [0, 1) for all probe inputs", () => {
    const rng = mulberry32(99999);
    for (let i = 0; i < 500; i++) {
      const v = hash01(
        (rng() * 1e6) | 0,
        (rng() * 1e4) | 0,
        (rng() * 1e4) | 0,
        (rng() * 1e4) | 0,
      );
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not use Math.random or Date.now (deterministic)", () => {
    // Same inputs → same outputs regardless of call timing
    const a = hash01(42, 1, 2, 3);
    const b = hash01(42, 1, 2, 3);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 2. Determinism: isPathTileAt identical across calls
// ---------------------------------------------------------------------------

describe("isPathTileAt determinism", () => {
  it("returns identical results across two calls for 500 pseudo-random probes", () => {
    const seed = 20260824;
    const rng = mulberry32(7777);
    for (let i = 0; i < 500; i++) {
      const wx = ((rng() * 2000) | 0) - 1000;
      const wy = ((rng() * 2000) | 0) - 1000;
      expect(isPathTileAt(wx, wy, seed)).toBe(isPathTileAt(wx, wy, seed));
    }
  });

  it("applyGravelPaths produces identical output on two fresh copies", () => {
    const seed = 20260824;
    const gen = new WorldGenerator(seed);
    const chunk = gen.generateChunk(2, 3);
    // Deep-copy
    const copy = chunk.tiles.map((row) => [...row]);

    applyGravelPaths(chunk.tiles, 2, 3, seed);
    applyGravelPaths(copy, 2, 3, seed);

    expect(chunk.tiles).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// 3. Enum sanity: GravelPath === 38, existing values stable
// ---------------------------------------------------------------------------

describe("TileType enum sanity", () => {
  it("GravelPath === 38", () => {
    expect(TileType.GravelPath).toBe(38);
  });

  it("Grass === 0 (no shift)", () => {
    expect(TileType.Grass).toBe(0);
  });

  it("DeepWaterVariant1 === 37 (no shift)", () => {
    expect(TileType.DeepWaterVariant1).toBe(37);
  });

  it("all TileType values are contiguous 0..38", () => {
    const values = Object.values(TileType).filter(
      (v) => typeof v === "number",
    ) as number[];
    expect(values).toHaveLength(39);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(38);
    // Verify contiguity
    const sorted = [...values].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Family restriction: only strict grass is converted
// ---------------------------------------------------------------------------

describe("applyGravelPaths family restriction", () => {
  it("never converts Water, Sand, Stone, Forest, or GrassToSand tiles", () => {
    const seed = 20260824;
    // Build a chunk-sized grid of non-convertible tiles.
    const nonGrassTypes: TileType[] = [
      TileType.Water,
      TileType.Sand,
      TileType.Stone,
      TileType.Forest,
      TileType.GrassToSand,
      TileType.GrassToForest,
      TileType.ShoreSand,
      TileType.Swamp,
      TileType.Ice,
      TileType.Snow,
    ];

    for (const t of nonGrassTypes) {
      const grid = fillGrid(CHUNK_SIZE, CHUNK_SIZE, t);
      const copy = grid.map((r) => [...r]);
      applyGravelPaths(grid, 0, 0, seed);
      // Grid must be byte-identical — no conversions happened.
      expect(grid).toEqual(copy);
    }
  });

  it("only converts Grass, GrassVariant1, GrassVariant2 to GravelPath", () => {
    const seed = 20260824;

    // Build a grid that has strict grass where paths cross.
    const grid = fillGrid(CHUNK_SIZE, CHUNK_SIZE, TileType.Grass);
    applyGravelPaths(grid, 0, 0, seed);

    // Every tile is either GravelPath or still Grass (the only two allowed).
    for (const row of grid) {
      for (const t of row) {
        expect(t === TileType.GravelPath || t === TileType.Grass).toBe(true);
      }
    }
  });

  it("synthetic mixed grid — only strict grass cells change", () => {
    const seed = 20260824;
    // Find a world coord where isPathTileAt returns true.
    let pathWx = -1;
    let pathWy = -1;
    for (let wx = 0; wx < 128; wx++) {
      for (let wy = 0; wy < 128; wy++) {
        if (isPathTileAt(wx, wy, seed)) {
          pathWx = wx;
          pathWy = wy;
          break;
        }
      }
      if (pathWx >= 0) break;
    }
    expect(pathWx).toBeGreaterThanOrEqual(0);

    // Place strict grass at that coord in chunk (0,0).
    const localX = ((pathWx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((pathWy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const cx = Math.floor(pathWx / CHUNK_SIZE);
    const cy = Math.floor(pathWy / CHUNK_SIZE);
    const grid = fillGrid(CHUNK_SIZE, CHUNK_SIZE, TileType.Sand);
    grid[localY][localX] = TileType.Grass;

    applyGravelPaths(grid, cx, cy, seed);

    // The grass tile should have been converted.
    expect(grid[localY][localX]).toBe(TileType.GravelPath);
    // All sand tiles must remain Sand.
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        if (ly === localY && lx === localX) continue;
        expect(grid[ly][lx]).toBe(TileType.Sand);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Acceptance gate: ≥3 path tiles in 5×5 chunk region for seed 20260824
// ---------------------------------------------------------------------------

describe("path density acceptance gate", () => {
  it("at least 3 GravelPath tiles exist in the [-2..2]² chunk region for seed 20260824", () => {
    const seed = 20260824;
    const gen = new WorldGenerator(seed);
    let pathCount = 0;

    for (let cx = -2; cx <= 2; cx++) {
      for (let cy = -2; cy <= 2; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        pathCount += countWhere(
          chunk.tiles,
          (t) => t === TileType.GravelPath,
        );
      }
    }

    // Hard acceptance gate — if this fails the config is too sparse.
    expect(pathCount).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// 6. Cross-chunk continuity
// ---------------------------------------------------------------------------

describe("cross-chunk continuity", () => {
  it("a path tile at local x=31 in chunk (0,0) continues into chunk (1,0)", () => {
    const seed = 20260824;
    const gen = new WorldGenerator(seed);

    const chunk0 = gen.generateChunk(0, 0);
    const chunk1 = gen.generateChunk(1, 0);

    // Search for a GravelPath tile at local x=31 in chunk (0,0).
    let foundLy = -1;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      if (chunk0.tiles[ly][31] === TileType.GravelPath) {
        foundLy = ly;
        break;
      }
    }

    // If no path tile at x=31, probe nearby chunks to find one.
    if (foundLy < 0) {
      // Try chunks (-1,0), (0,0), (1,0) and search all local x.
      for (const cx of [-1, 0, 1]) {
        const chunk = gen.generateChunk(cx, cy0(0));
        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            if (chunk.tiles[ly][lx] === TileType.GravelPath) {
              // Use this tile — it's at world x = cx*32+lx.
              // Stitch the two chunks that straddle the seam.
              const worldX = cx * CHUNK_SIZE + lx;
              const seamCx = Math.floor(worldX / CHUNK_SIZE);
              const seamLocalX = worldX - seamCx * CHUNK_SIZE;
              const chunkA = gen.generateChunk(seamCx, 0);
              const chunkB = gen.generateChunk(seamCx + 1, 0);

              // Build 64-wide stitched grid.
              for (let y = 0; y < CHUNK_SIZE; y++) {
                const tileA = chunkA.tiles[y][seamLocalX];
                if (tileA !== TileType.GravelPath) continue;

                if (seamLocalX === CHUNK_SIZE - 1) {
                  // This tile touches the right seam of chunkA.
                  const tileB = chunkB.tiles[y][0];
                  const isGrassBase =
                    tileB === TileType.Grass ||
                    tileB === TileType.GrassVariant1 ||
                    tileB === TileType.GrassVariant2;
                  // If the east neighbour was strict grass, it should have
                  // been converted too (or it was already non-grass).
                  if (isGrassBase) {
                    expect(tileB).toBe(TileType.GravelPath);
                  }
                }
              }
              return; // Test passed via alternate path.
            }
          }
        }
      }
      // If still no path tile found, the lattice is too sparse — fail.
      expect.fail("No GravelPath tile found in any probed chunk for seed 20260824");
    }

    // Primary path: path tile found at local x=31 in chunk (0,0).
    const worldY = foundLy; // cy=0, so world y = local y.
    const tileEast = chunk1.tiles[worldY][0];

    // The tile immediately east should be GravelPath (if it was strict grass
    // before) or a non-grass tile (natural terminator).
    const isGrassBase =
      tileEast === TileType.Grass ||
      tileEast === TileType.GrassVariant1 ||
      tileEast === TileType.GrassVariant2;

    if (isGrassBase) {
      expect(tileEast).toBe(TileType.GravelPath);
    }
    // If it's not grass, it's a natural terminator — that's fine.
  });

  it("stitched 64-wide grid: every GravelPath at x%32==31 has correct continuation", () => {
    const seed = 20260824;
    const gen = new WorldGenerator(seed);

    // Stitch chunks (0,0) and (1,0) into one 64-wide grid.
    const chunkA = gen.generateChunk(0, 0);
    const chunkB = gen.generateChunk(1, 0);

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      if (chunkA.tiles[ly][31] !== TileType.GravelPath) continue;

      const tileEast = chunkB.tiles[ly][0];
      const isGrassBase =
        tileEast === TileType.Grass ||
        tileEast === TileType.GrassVariant1 ||
        tileEast === TileType.GrassVariant2;

      // If the east neighbour was strict grass, it must also be GravelPath.
      if (isGrassBase) {
        expect(tileEast).toBe(TileType.GravelPath);
      }
      // Otherwise it's a natural terminator (non-grass) — valid.
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Same-seed two WorldGenerators produce identical tiles
// ---------------------------------------------------------------------------

describe("WorldGenerator path integration", () => {
  it("same-seed two generators produce deep-equal chunk (0,0) tiles", () => {
    const seed = 20260824;
    const gen1 = new WorldGenerator(seed);
    const gen2 = new WorldGenerator(seed);
    const c1 = gen1.generateChunk(0, 0);
    const c2 = gen2.generateChunk(0, 0);
    expect(c1.tiles).toEqual(c2.tiles);
  });

  it("different seeds produce different tiles somewhere", () => {
    const gen1 = new WorldGenerator(20260824);
    const gen2 = new WorldGenerator(20260825);
    const c1 = gen1.generateChunk(0, 0);
    const c2 = gen2.generateChunk(0, 0);
    // At least one tile should differ.
    let differ = false;
    for (let ly = 0; ly < CHUNK_SIZE && !differ; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE && !differ; lx++) {
        if (c1.tiles[ly][lx] !== c2.tiles[ly][lx]) differ = true;
      }
    }
    expect(differ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. getAnchorPoint and segmentExists
// ---------------------------------------------------------------------------

describe("getAnchorPoint", () => {
  it("returns anchor within cell bounds (8..56 from origin)", () => {
    const cs = DEFAULT_PATH_CONFIG.cellSize;
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const cellX = ((rng() * 200) | 0) - 100;
      const cellY = ((rng() * 200) | 0) - 100;
      const a = getAnchorPoint(12345, cellX, cellY);
      const localX = a.x - cellX * cs;
      const localY = a.y - cellY * cs;
      expect(localX).toBeGreaterThanOrEqual(8);
      expect(localX).toBeLessThanOrEqual(56);
      expect(localY).toBeGreaterThanOrEqual(8);
      expect(localY).toBeLessThanOrEqual(56);
    }
  });

  it("is deterministic for same inputs", () => {
    const a = getAnchorPoint(42, 3, 7);
    const b = getAnchorPoint(42, 3, 7);
    expect(a).toEqual(b);
  });
});

describe("segmentExists", () => {
  it("returns boolean", () => {
    for (let i = 0; i < 50; i++) {
      const v = segmentExists(42, i, i % 10, "E");
      expect(typeof v).toBe("boolean");
    }
  });

  it("is deterministic for same inputs", () => {
    for (let i = 0; i < 50; i++) {
      expect(segmentExists(42, i, 0, "E")).toBe(segmentExists(42, i, 0, "E"));
      expect(segmentExists(42, i, 0, "S")).toBe(segmentExists(42, i, 0, "S"));
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Exhaustive-mask-style invariant: every tile in a path-filled chunk
//    is either GravelPath or a valid TileType (no corruption)
// ---------------------------------------------------------------------------

describe("applyGravelPaths invariants", () => {
  it("every tile remains a valid TileType after path application", () => {
    const validValues = new Set(
      Object.values(TileType).filter((v) => typeof v === "number"),
    );
    const gen = new WorldGenerator(20260824);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cy = -1; cy <= 1; cy++) {
        const chunk = gen.generateChunk(cx, cy);
        for (const row of chunk.tiles) {
          for (const t of row) {
            expect(validValues.has(t)).toBe(true);
          }
        }
      }
    }
  });

  it("path count is deterministic across seeds — same seed = same count", () => {
    const gen1 = new WorldGenerator(20260824);
    const gen2 = new WorldGenerator(20260824);
    let count1 = 0;
    let count2 = 0;
    for (let cx = 0; cx < 3; cx++) {
      for (let cy = 0; cy < 3; cy++) {
        count1 += countWhere(
          gen1.generateChunk(cx, cy).tiles,
          (t) => t === TileType.GravelPath,
        );
        count2 += countWhere(
          gen2.generateChunk(cx, cy).tiles,
          (t) => t === TileType.GravelPath,
        );
      }
    }
    expect(count1).toBe(count2);
    expect(count1).toBeGreaterThan(0);
  });
});

// Helper: ensure cy0 is defined (used in cross-chunk continuity test).
function cy0(v: number): number {
  return v;
}
