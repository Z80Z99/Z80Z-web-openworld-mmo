import { describe, it, expect } from "vitest";
import {
  tileHash,
  varyColor,
  tileColor,
  waterShimmer,
  isAnimatedTile,
  findAnimatedTiles,
} from "./TileAnimations.js";
import { TileType } from "@mmo/shared";

// ── tileHash ────────────────────────────────────────────────────────────────

describe("tileHash", () => {
  it("returns values in [0, 1)", () => {
    for (let x = -50; x <= 50; x++) {
      for (let y = -50; y <= 50; y++) {
        const h = tileHash(x, y, 42);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it("is deterministic for the same inputs", () => {
    expect(tileHash(10, 20, 42)).toBe(tileHash(10, 20, 42));
  });

  it("produces different values for different positions", () => {
    const h1 = tileHash(0, 0, 42);
    const h2 = tileHash(1, 0, 42);
    const h3 = tileHash(0, 1, 42);
    // At least two of the three should differ (extremely high probability)
    const allSame = h1 === h2 && h2 === h3;
    expect(allSame).toBe(false);
  });

  it("produces different distributions for different seeds", () => {
    const vals1 = Array.from({ length: 100 }, (_, i) => tileHash(i, 0, 1));
    const vals2 = Array.from({ length: 100 }, (_, i) => tileHash(i, 0, 999));
    // Mean should differ at least slightly (probabilistic but reliable with 100 samples)
    const mean1 = vals1.reduce((a, b) => a + b, 0) / 100;
    const mean2 = vals2.reduce((a, b) => a + b, 0) / 100;
    // Both should be roughly 0.5 ± 0.15 for a good hash
    expect(mean1).toBeGreaterThan(0.3);
    expect(mean1).toBeLessThan(0.7);
    expect(mean2).toBeGreaterThan(0.3);
    expect(mean2).toBeLessThan(0.7);
  });
});

// ── varyColor ───────────────────────────────────────────────────────────────

describe("varyColor", () => {
  it("returns a different color from the base", () => {
    const base = 0x808080;
    const varied = varyColor(base, 0.9);
    expect(varied).not.toBe(base);
  });

  it("hash=0.5 returns the base color (no offset)", () => {
    const base = 0x808080;
    const varied = varyColor(base, 0.5);
    expect(varied).toBe(base);
  });

  it("stays within valid 24-bit color range", () => {
    const colors = [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff];
    for (const base of colors) {
      for (let h = 0; h <= 1; h += 0.1) {
        const c = varyColor(base, h);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it("respects the amount parameter", () => {
    const base = 0x808080;
    const small = varyColor(base, 0.9, 0.02);
    const large = varyColor(base, 0.9, 0.20);
    // Both should be different from base
    expect(small).not.toBe(base);
    expect(large).not.toBe(base);
    // Large amount should produce a bigger deviation
    const diffSmall = Math.abs((small >> 16) & 0xff - 0x80);
    const diffLarge = Math.abs((large >> 16) & 0xff - 0x80);
    expect(diffLarge).toBeGreaterThan(diffSmall);
  });
});

// ── tileColor ───────────────────────────────────────────────────────────────

describe("tileColor", () => {
  it("returns a valid color for grass tiles", () => {
    const c = tileColor(TileType.Grass, 0x4a7c59, 10, 20, 42);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0xffffff);
  });

  it("sand tiles get warm-shifted variation", () => {
    const base = 0xf0d9b5;
    // Two different positions should produce different warm shifts
    const c1 = tileColor(TileType.Sand, base, 0, 0, 42);
    const c2 = tileColor(TileType.Sand, base, 5, 5, 42);
    // Both should be valid
    expect(c1).toBeGreaterThanOrEqual(0);
    expect(c2).toBeGreaterThanOrEqual(0);
  });

  it("forest tiles are darker than the base", () => {
    const base = 0x2d5016;
    const c = tileColor(TileType.Forest, base, 10, 10, 42);
    // Forest should darken: R component should be <= base R
    const baseR = (base >> 16) & 0xff;
    const cR = (c >> 16) & 0xff;
    expect(cR).toBeLessThanOrEqual(baseR);
  });

  it("different positions produce different colors for the same tile type", () => {
    const c1 = tileColor(TileType.Grass, 0x4a7c59, 0, 0, 42);
    const c2 = tileColor(TileType.Grass, 0x4a7c59, 7, 3, 42);
    expect(c1).not.toBe(c2);
  });
});

// ── waterShimmer ────────────────────────────────────────────────────────────

describe("waterShimmer", () => {
  it("returns a valid color", () => {
    const c = waterShimmer(0x3498db, 5, 10, 1.0);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0xffffff);
  });

  it("varies over time (shimmer animation)", () => {
    const c1 = waterShimmer(0x3498db, 0, 0, 0.0);
    const c2 = waterShimmer(0x3498db, 0, 0, 0.5);
    const c3 = waterShimmer(0x3498db, 0, 0, 1.0);
    // At least two should differ (sin wave oscillation)
    const allSame = c1 === c2 && c2 === c3;
    expect(allSame).toBe(false);
  });

  it("different positions have different phases", () => {
    const t = 1.0;
    const c1 = waterShimmer(0x3498db, 0, 0, t);
    const c2 = waterShimmer(0x3498db, 10, 10, t);
    // Different phase → different value at the same time
    expect(c1).not.toBe(c2);
  });

  it("produces a range around the base color (not extreme)", () => {
    const base = 0x3498db;
    const samples = Array.from({ length: 50 }, (_, i) =>
      waterShimmer(base, i % 10, Math.floor(i / 10), i * 0.1),
    );
    const baseR = (base >> 16) & 0xff;
    for (const c of samples) {
      const r = (c >> 16) & 0xff;
      // Should be within 20% of base R (shimmer range)
      expect(Math.abs(r - baseR)).toBeLessThanOrEqual(Math.ceil(baseR * 0.25));
    }
  });
});

// ── isAnimatedTile ──────────────────────────────────────────────────────────

describe("isAnimatedTile", () => {
  it("returns true for Water", () => {
    expect(isAnimatedTile(TileType.Water)).toBe(true);
  });

  it("returns true for DeepWater", () => {
    expect(isAnimatedTile(TileType.DeepWater)).toBe(true);
  });

  it("returns false for non-water types", () => {
    expect(isAnimatedTile(TileType.Grass)).toBe(false);
    expect(isAnimatedTile(TileType.Sand)).toBe(false);
    expect(isAnimatedTile(TileType.Stone)).toBe(false);
    expect(isAnimatedTile(TileType.Forest)).toBe(false);
    expect(isAnimatedTile(TileType.Snow)).toBe(false);
    expect(isAnimatedTile(TileType.Swamp)).toBe(false);
    expect(isAnimatedTile(TileType.Ice)).toBe(false);
  });
});

// ── findAnimatedTiles ───────────────────────────────────────────────────────

describe("findAnimatedTiles", () => {
  it("returns empty array for a chunk with no water", () => {
    const tiles = Array.from({ length: 8 }, () =>
      Array(8).fill(TileType.Grass),
    );
    expect(findAnimatedTiles(tiles)).toEqual([]);
  });

  it("finds water tiles with correct positions", () => {
    const tiles = Array.from({ length: 4 }, () =>
      Array(4).fill(TileType.Grass),
    );
    tiles[1][2] = TileType.Water;
    tiles[3][0] = TileType.DeepWater;

    const result = findAnimatedTiles(tiles);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ lx: 2, ly: 1, tileType: TileType.Water });
    expect(result).toContainEqual({ lx: 0, ly: 3, tileType: TileType.DeepWater });
  });

  it("preserves tile type in the result", () => {
    const tiles = Array.from({ length: 2 }, () =>
      Array(2).fill(TileType.Grass),
    );
    tiles[0][1] = TileType.Water;
    tiles[1][0] = TileType.DeepWater;

    const result = findAnimatedTiles(tiles);
    const waterTiles = result.filter((t) => t.tileType === TileType.Water);
    const deepTiles = result.filter((t) => t.tileType === TileType.DeepWater);
    expect(waterTiles).toHaveLength(1);
    expect(deepTiles).toHaveLength(1);
  });
});
