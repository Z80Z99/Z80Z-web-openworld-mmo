import { describe, it, expect } from "vitest";
import { Direction } from "./shore-rules.js";
import type { GroundEdgeTile } from "./shore-rules.js";
import { getGroundEdgeTiles, isGrassFamilyTile, isSandFamilyTile } from "./shore-rules.js";
import { TileType } from "./types.js";

// ---------------------------------------------------------------------------
// getGroundEdgeTiles
// ---------------------------------------------------------------------------

describe("getGroundEdgeTiles", () => {
  it("returns [] for mask 0", () => {
    expect(getGroundEdgeTiles(0)).toEqual([]);
  });

  // ── Diagonal-only → corner tiles (edge-grass-dirt9..12) ──

  it("returns [{index:9}] for NW alone (grass top-left)", () => {
    expect(getGroundEdgeTiles(Direction.NW)).toEqual([{ index: 9 }]);
  });

  it("returns [{index:10}] for NE alone (grass top-right)", () => {
    expect(getGroundEdgeTiles(Direction.NE)).toEqual([{ index: 10 }]);
  });

  it("returns [{index:12}] for SW alone (grass bottom-left)", () => {
    expect(getGroundEdgeTiles(Direction.SW)).toEqual([{ index: 12 }]);
  });

  it("returns [{index:11}] for SE alone (grass bottom-right)", () => {
    expect(getGroundEdgeTiles(Direction.SE)).toEqual([{ index: 11 }]);
  });

  // ── Multiple diagonals → one corner tile per set bit, ascending bit order ──

  it("returns [9,10] for NW|NE", () => {
    expect(getGroundEdgeTiles(Direction.NW | Direction.NE)).toEqual([
      { index: 9 },
      { index: 10 },
    ]);
  });

  it("returns [9,12] for NW|SW", () => {
    expect(getGroundEdgeTiles(Direction.NW | Direction.SW)).toEqual([
      { index: 9 },
      { index: 12 },
    ]);
  });

  it("returns [9,11] for NW|SE — opposite corners stack", () => {
    expect(getGroundEdgeTiles(Direction.NW | Direction.SE)).toEqual([
      { index: 9 },
      { index: 11 },
    ]);
  });

  it("returns [10,12] for NE|SW — opposite corners stack", () => {
    expect(getGroundEdgeTiles(Direction.NE | Direction.SW)).toEqual([
      { index: 10 },
      { index: 12 },
    ]);
  });

  it("returns three corners for NW|NE|SW in bit order", () => {
    expect(getGroundEdgeTiles(Direction.NW | Direction.NE | Direction.SW)).toEqual([
      { index: 9 },
      { index: 10 },
      { index: 12 },
    ]);
  });

  it("returns all four corners for NW|NE|SW|SE", () => {
    expect(
      getGroundEdgeTiles(
        Direction.NW | Direction.NE | Direction.SW | Direction.SE,
      ),
    ).toEqual([{ index: 9 }, { index: 10 }, { index: 12 }, { index: 11 }]);
  });

  // ── Single cardinal edges ──

  it("returns [{index:2}] for N", () => {
    expect(getGroundEdgeTiles(Direction.N)).toEqual([{ index: 2 }]);
  });

  it("returns [{index:5}] for E", () => {
    expect(getGroundEdgeTiles(Direction.E)).toEqual([{ index: 5 }]);
  });

  it("returns [{index:7}] for S", () => {
    expect(getGroundEdgeTiles(Direction.S)).toEqual([{ index: 7 }]);
  });

  it("returns [{index:4}] for W", () => {
    expect(getGroundEdgeTiles(Direction.W)).toEqual([{ index: 4 }]);
  });

  // ── Quadrant pairs ──

  it("returns [{index:1}] for N|W (NW quadrant)", () => {
    expect(getGroundEdgeTiles(Direction.N | Direction.W)).toEqual([{ index: 1 }]);
  });

  it("returns [{index:3}] for N|E (NE quadrant)", () => {
    expect(getGroundEdgeTiles(Direction.N | Direction.E)).toEqual([{ index: 3 }]);
  });

  it("returns [{index:6}] for S|W (SW quadrant)", () => {
    expect(getGroundEdgeTiles(Direction.S | Direction.W)).toEqual([{ index: 6 }]);
  });

  it("returns [{index:8}] for S|E (SE quadrant)", () => {
    expect(getGroundEdgeTiles(Direction.S | Direction.E)).toEqual([{ index: 8 }]);
  });

  // ── Quadrant wins over extra cardinal edge ──

  it("returns [{index:3}] for N|E|S — quadrant beats extra edge", () => {
    expect(getGroundEdgeTiles(Direction.N | Direction.E | Direction.S)).toEqual([{ index: 3 }]);
  });

  it("returns [{index:1}] for N|E|S|W — first quadrant check wins", () => {
    expect(getGroundEdgeTiles(Direction.N | Direction.E | Direction.S | Direction.W)).toEqual([{ index: 1 }]);
  });

  // ── Opposite edges → single-edge priority N > E > S > W ──

  it("returns [{index:2}] for N|S — N has priority", () => {
    expect(getGroundEdgeTiles(Direction.N | Direction.S)).toEqual([{ index: 2 }]);
  });

  it("returns [{index:5}] for E|W — E has priority", () => {
    expect(getGroundEdgeTiles(Direction.E | Direction.W)).toEqual([{ index: 5 }]);
  });

  // ── Cardinal bits take priority over diagonals ──

  it("returns [{index:2}] for N|NW — cardinal wins, diagonal ignored", () => {
    expect(getGroundEdgeTiles(Direction.N | Direction.NW)).toEqual([{ index: 2 }]);
  });

  it("returns [{index:1}] for N|W|SE|SW — quadrant beats diagonals", () => {
    expect(
      getGroundEdgeTiles(Direction.N | Direction.W | Direction.SE | Direction.SW),
    ).toEqual([{ index: 1 }]);
  });

  // ── Exhaustive invariants for every mask 0..255 ──

  it("always returns 0..4 tiles with unique indices for every mask 0..255", () => {
    for (let mask = 0; mask <= 255; mask++) {
      const result = getGroundEdgeTiles(mask);
      expect(result.length).toBeLessThanOrEqual(4);
      const indices = result.map((t) => t.index);
      expect(new Set(indices).size).toBe(indices.length);
    }
  });

  it("returns ≥2 tiles only via diagonal-only masks", () => {
    const CARDINALS = Direction.N | Direction.E | Direction.S | Direction.W;
    for (let mask = 0; mask <= 255; mask++) {
      const result = getGroundEdgeTiles(mask);
      if (result.length >= 2) {
        expect(mask & CARDINALS).toBe(0);
      }
    }
  });

  // ── Determinism: same input → same output ──

  it("returns identical results on two calls for every mask 0..255", () => {
    for (let mask = 0; mask <= 255; mask++) {
      const first = getGroundEdgeTiles(mask);
      const second = getGroundEdgeTiles(mask);
      expect(first).toEqual(second);
    }
  });
});

// ---------------------------------------------------------------------------
// isGrassFamilyTile
// ---------------------------------------------------------------------------

describe("isGrassFamilyTile", () => {
  it("returns true for Grass", () => {
    expect(isGrassFamilyTile(TileType.Grass)).toBe(true);
  });

  it("returns true for GrassVariant1", () => {
    expect(isGrassFamilyTile(TileType.GrassVariant1)).toBe(true);
  });

  it("returns true for GrassVariant2", () => {
    expect(isGrassFamilyTile(TileType.GrassVariant2)).toBe(true);
  });

  it("returns true for Forest", () => {
    expect(isGrassFamilyTile(TileType.Forest)).toBe(true);
  });

  it("returns true for ForestVariant1", () => {
    expect(isGrassFamilyTile(TileType.ForestVariant1)).toBe(true);
  });

  it("returns true for ForestVariant2", () => {
    expect(isGrassFamilyTile(TileType.ForestVariant2)).toBe(true);
  });

  it("returns true for GrassToForest", () => {
    expect(isGrassFamilyTile(TileType.GrassToForest)).toBe(true);
  });

  it("returns true for GrassToSand", () => {
    expect(isGrassFamilyTile(TileType.GrassToSand)).toBe(true);
  });

  it("returns false for Sand", () => {
    expect(isGrassFamilyTile(TileType.Sand)).toBe(false);
  });

  it("returns false for SandVariant1", () => {
    expect(isGrassFamilyTile(TileType.SandVariant1)).toBe(false);
  });

  it("returns false for Water", () => {
    expect(isGrassFamilyTile(TileType.Water)).toBe(false);
  });

  it("returns false for DeepWater", () => {
    expect(isGrassFamilyTile(TileType.DeepWater)).toBe(false);
  });

  it("returns false for Stone", () => {
    expect(isGrassFamilyTile(TileType.Stone)).toBe(false);
  });

  it("returns false for Swamp", () => {
    expect(isGrassFamilyTile(TileType.Swamp)).toBe(false);
  });

  it("returns false for ShoreSand", () => {
    expect(isGrassFamilyTile(TileType.ShoreSand)).toBe(false);
  });

  it("returns false for GrassToStone", () => {
    expect(isGrassFamilyTile(TileType.GrassToStone)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSandFamilyTile
// ---------------------------------------------------------------------------

describe("isSandFamilyTile", () => {
  it("returns true for Sand", () => {
    expect(isSandFamilyTile(TileType.Sand)).toBe(true);
  });

  it("returns true for SandVariant1", () => {
    expect(isSandFamilyTile(TileType.SandVariant1)).toBe(true);
  });

  it("returns false for Grass", () => {
    expect(isSandFamilyTile(TileType.Grass)).toBe(false);
  });

  it("returns false for ShoreSand", () => {
    expect(isSandFamilyTile(TileType.ShoreSand)).toBe(false);
  });

  it("returns false for GrassToSand", () => {
    expect(isSandFamilyTile(TileType.GrassToSand)).toBe(false);
  });

  it("returns false for SandToStone", () => {
    expect(isSandFamilyTile(TileType.SandToStone)).toBe(false);
  });

  it("returns false for Water", () => {
    expect(isSandFamilyTile(TileType.Water)).toBe(false);
  });
});
