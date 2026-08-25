import { describe, it, expect } from "vitest";
import {
  classifyTerrain,
  selectDecoration,
  selectDecorationWithOffset,
  selectOneTileTree,
  selectTwoTileTree,
  selectEdgeTransition,
  TERRAIN_DECORATIONS,
  ONE_TILE_TREES,
  TWO_TILE_TREES,
  EDGE_TRANSITIONS,
  type TerrainCategory,
} from "./DecorationRegistry.js";
import { TileType } from "@mmo/shared";

// ── Atlas index validity ────────────────────────────────────────────────────

describe("TERRAIN_DECORATIONS index validity", () => {
  const MAX_ATLAS_INDEX = 131; // 12 columns x 11 rows - 1

  for (const [category, indices] of Object.entries(TERRAIN_DECORATIONS)) {
    describe(category, () => {
      it("all categories are disabled (no generic atlas decorations)", () => {
        expect(indices.length).toBe(0);
      });

      it("all indices are within valid atlas range (0-131)", () => {
        for (const idx of indices) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThanOrEqual(MAX_ATLAS_INDEX);
        }
      });

      it("indices are unique within category", () => {
        const unique = new Set(indices);
        expect(unique.size).toBe(indices.length);
      });
    });
  }
});

// ── classifyTerrain ─────────────────────────────────────────────────────────

describe("classifyTerrain", () => {
  it("classifies Grass types as grass", () => {
    expect(classifyTerrain(TileType.Grass)).toBe("grass");
    expect(classifyTerrain(TileType.GrassVariant1)).toBe("grass");
    expect(classifyTerrain(TileType.GrassVariant2)).toBe("grass");
  });

  it("classifies Forest types as forest", () => {
    expect(classifyTerrain(TileType.Forest)).toBe("forest");
    expect(classifyTerrain(TileType.ForestVariant1)).toBe("forest");
    expect(classifyTerrain(TileType.ForestVariant2)).toBe("forest");
  });

  it("classifies Water types as water", () => {
    expect(classifyTerrain(TileType.Water)).toBe("water");
    expect(classifyTerrain(TileType.DeepWater)).toBe("water");
    expect(classifyTerrain(TileType.WaterVariant1)).toBe("water");
    expect(classifyTerrain(TileType.WaterVariant2)).toBe("water");
    expect(classifyTerrain(TileType.DeepWaterVariant1)).toBe("water");
  });

  it("classifies Sand types as sand", () => {
    expect(classifyTerrain(TileType.Sand)).toBe("sand");
    expect(classifyTerrain(TileType.SandVariant1)).toBe("sand");
  });

  it("classifies Stone types as stone", () => {
    expect(classifyTerrain(TileType.Stone)).toBe("stone");
    expect(classifyTerrain(TileType.StoneVariant1)).toBe("stone");
    expect(classifyTerrain(TileType.StoneVariant2)).toBe("stone");
  });

  it("classifies Snow types as snow", () => {
    expect(classifyTerrain(TileType.Snow)).toBe("snow");
    expect(classifyTerrain(TileType.SnowVariant1)).toBe("snow");
  });

  it("classifies Swamp types as swamp", () => {
    expect(classifyTerrain(TileType.Swamp)).toBe("swamp");
    expect(classifyTerrain(TileType.SwampVariant1)).toBe("swamp");
  });

  it("classifies Ice types as ice", () => {
    expect(classifyTerrain(TileType.Ice)).toBe("ice");
  });

  it("classifies Shore types as shore", () => {
    expect(classifyTerrain(TileType.ShoreSand)).toBe("shore");
    expect(classifyTerrain(TileType.ShoreGrass)).toBe("shore");
    expect(classifyTerrain(TileType.ShoreForest)).toBe("shore");
    expect(classifyTerrain(TileType.ShoreSwamp)).toBe("shore");
    expect(classifyTerrain(TileType.ShoreSnow)).toBe("shore");
    expect(classifyTerrain(TileType.ShoreStone)).toBe("shore");
  });

  it("classifies transition types to their primary terrain", () => {
    expect(classifyTerrain(TileType.GrassToSand)).toBe("sand");
    expect(classifyTerrain(TileType.GrassToForest)).toBe("forest");
    expect(classifyTerrain(TileType.GrassToSwamp)).toBe("swamp");
    expect(classifyTerrain(TileType.GrassToStone)).toBe("stone");
    expect(classifyTerrain(TileType.GrassToSnow)).toBe("snow");
    expect(classifyTerrain(TileType.SandToStone)).toBe("stone");
    // ForestTo* transitions match the forest check first since it runs earlier
    expect(classifyTerrain(TileType.ForestToSwamp)).toBe("forest");
    expect(classifyTerrain(TileType.ForestToStone)).toBe("forest");
    expect(classifyTerrain(TileType.SwampToStone)).toBe("stone");
    expect(classifyTerrain(TileType.StoneToSnow)).toBe("snow");
    expect(classifyTerrain(TileType.SnowToIce)).toBe("ice");
  });
});

// ── selectDecoration determinism ────────────────────────────────────────────

describe("selectDecoration determinism", () => {
  it("same inputs always produce the same output", () => {
    const results = Array.from({ length: 100 }, () =>
      selectDecoration(TileType.Forest, 10, 20, 1337, 132),
    );
    const first = results[0];
    for (const r of results) {
      expect(r).toBe(first);
    }
  });

  it("all generic atlas decorations are disabled — selectDecoration returns null", () => {
    const results = new Set<number | null>();
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        results.add(selectDecoration(TileType.Forest, x, y, 1337, 132));
      }
    }
    // With generic decorations disabled, every result is null
    expect(results.size).toBe(1);
    expect(results.has(null)).toBe(true);
  });

  it("returns null for water tiles (no static decorations)", () => {
    for (let x = 0; x < 20; x++) {
      expect(selectDecoration(TileType.Water, x, 0, 1337, 132)).toBeNull();
    }
  });

  it("returns valid atlas index for forest tiles", () => {
    for (let x = 0; x < 30; x++) {
      const result = selectDecoration(TileType.Forest, x, 0, 1337, 132);
      if (result !== null) {
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(131);
      }
    }
  });

  it("returns valid atlas index for grass tiles", () => {
    for (let x = 0; x < 30; x++) {
      const result = selectDecoration(TileType.Grass, x, 0, 1337, 132);
      if (result !== null) {
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(131);
      }
    }
  });

  it("returns null when atlasCount is 0", () => {
    expect(selectDecoration(TileType.Forest, 0, 0, 1337, 0)).toBeNull();
  });

  it("returns null for unknown tile type", () => {
    expect(selectDecoration(9999, 0, 0, 1337, 132)).toBeNull();
  });

  it("generic decorations are disabled: no selectDecoration hits", () => {
    let decorationCount = 0;
    const total = 200;
    for (let x = 0; x < total; x++) {
      if (selectDecoration(TileType.Forest, x, 0, 1337, 132) !== null) {
        decorationCount++;
      }
    }
    // All generic atlas decorations are intentionally disabled
    expect(decorationCount).toBe(0);
  });
});

// ── selectDecorationWithOffset ──────────────────────────────────────────────

describe("selectDecorationWithOffset", () => {
  it("same inputs always produce the same output", () => {
    const results = Array.from({ length: 50 }, () =>
      selectDecorationWithOffset(TileType.Grass, 5, 10, 1337, 132),
    );
    const first = results[0];
    for (const r of results) {
      expect(r).toEqual(first);
    }
  });

  it("returns null when selectDecoration returns null", () => {
    expect(selectDecorationWithOffset(TileType.Water, 0, 0, 1337, 132)).toBeNull();
  });

  it("returns valid offset ranges when decoration is selected", () => {
    // Find a position that produces a decoration
    for (let x = 0; x < 100; x++) {
      const result = selectDecorationWithOffset(TileType.Forest, x, 0, 1337, 132);
      if (result !== null) {
        expect(result.atlasIndex).toBeGreaterThanOrEqual(0);
        expect(result.atlasIndex).toBeLessThanOrEqual(131);
        expect(result.xOffset).toBeGreaterThanOrEqual(0);
        expect(result.xOffset).toBeLessThanOrEqual(5);
        expect(result.yOffset).toBeGreaterThanOrEqual(0);
        expect(result.yOffset).toBeLessThanOrEqual(3);
        return; // Found one, test passes
      }
    }
    // If no decoration found in first 100 tiles, that's valid (density gate)
  });
});

// ── Tree constants — exact index validation ─────────────────────────────────

describe("ONE_TILE_TREES", () => {
  it("contains exactly [27, 28]", () => {
    expect(ONE_TILE_TREES).toEqual([27, 28]);
  });

  it("all indices within valid atlas range", () => {
    for (const idx of ONE_TILE_TREES) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(131);
    }
  });

  it("indices are unique", () => {
    expect(new Set(ONE_TILE_TREES).size).toBe(ONE_TILE_TREES.length);
  });
});

describe("TWO_TILE_TREES", () => {
  it("contains exactly the specified canopy/trunk pairs", () => {
    expect(TWO_TILE_TREES).toEqual([
      { canopy: 3, trunk: 15 },
      { canopy: 4, trunk: 16 },
    ]);
  });

  it("all indices within valid atlas range", () => {
    for (const pair of TWO_TILE_TREES) {
      expect(pair.canopy).toBeGreaterThanOrEqual(0);
      expect(pair.canopy).toBeLessThanOrEqual(131);
      expect(pair.trunk).toBeGreaterThanOrEqual(0);
      expect(pair.trunk).toBeLessThanOrEqual(131);
    }
  });

  it("canopy and trunk indices are distinct across all pairs", () => {
    const all = TWO_TILE_TREES.flatMap(p => [p.canopy, p.trunk]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("EDGE_TRANSITIONS", () => {
  it("contains exactly [12, 13, 14, 24, 26, 36, 37, 38]", () => {
    expect(EDGE_TRANSITIONS).toEqual([12, 13, 14, 24, 26, 36, 37, 38]);
  });

  it("has exactly 8 entries", () => {
    expect(EDGE_TRANSITIONS.length).toBe(8);
  });

  it("all indices within valid atlas range", () => {
    for (const idx of EDGE_TRANSITIONS) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(131);
    }
  });

  it("indices are unique", () => {
    expect(new Set(EDGE_TRANSITIONS).size).toBe(EDGE_TRANSITIONS.length);
  });
});

// ── Tree index reservation — verify excluded from generic lists ─────────────

describe("tree indices reserved in TERRAIN_DECORATIONS", () => {
  it("one-tile tree indices (27, 28) are NOT in grass list", () => {
    expect(TERRAIN_DECORATIONS.grass).not.toContain(27);
    expect(TERRAIN_DECORATIONS.grass).not.toContain(28);
  });

  it("one-tile tree indices (27) are NOT in sand list", () => {
    expect(TERRAIN_DECORATIONS.sand).not.toContain(27);
  });

  it("two-tile canopy indices (15, 16) are NOT in grass list", () => {
    expect(TERRAIN_DECORATIONS.grass).not.toContain(15);
    expect(TERRAIN_DECORATIONS.grass).not.toContain(16);
  });

  it("two-tile trunk indices (3, 4) are NOT in forest list", () => {
    expect(TERRAIN_DECORATIONS.forest).not.toContain(3);
    expect(TERRAIN_DECORATIONS.forest).not.toContain(4);
  });

  it("two-tile canopy indices (15, 16) are NOT in forest list", () => {
    expect(TERRAIN_DECORATIONS.forest).not.toContain(15);
    expect(TERRAIN_DECORATIONS.forest).not.toContain(16);
  });

  it("all generic atlas decorations remain disabled", () => {
      for (const indices of Object.values(TERRAIN_DECORATIONS)) {
        expect(indices).toEqual([]);
      }
  });
});

// ── selectOneTileTree ───────────────────────────────────────────────────────

describe("selectOneTileTree", () => {
  it("is deterministic for same inputs", () => {
    const results = Array.from({ length: 50 }, () =>
      selectOneTileTree(10, 20, 1337, 132),
    );
    const first = results[0];
    for (const r of results) {
      expect(r).toBe(first);
    }
  });

  it("returns only 27 or 28 when decoration is placed", () => {
    const validIndices = new Set([27, 28]);
    for (let x = 0; x < 200; x++) {
      const result = selectOneTileTree(x, 0, 1337, 132);
      if (result !== null) {
        expect(validIndices.has(result)).toBe(true);
      }
    }
  });

  it("returns null when atlasCount is 0", () => {
    expect(selectOneTileTree(0, 0, 1337, 0)).toBeNull();
  });

  it("returns null when atlasCount is below tree index", () => {
    // Only 20 atlas tiles loaded — indices 27/28 not available
    expect(selectOneTileTree(0, 0, 1337, 20)).toBeNull();
  });

  it("respects density: not every forest tile gets a one-tile tree", () => {
    let treeCount = 0;
    const total = 200;
    for (let x = 0; x < total; x++) {
      if (selectOneTileTree(x, 0, 1337, 132) !== null) treeCount++;
    }
    expect(treeCount).toBeGreaterThan(0);
    expect(treeCount).toBeLessThan(total);
  });
});

// ── selectTwoTileTree ───────────────────────────────────────────────────────

describe("selectTwoTileTree", () => {
  it("is deterministic for same inputs", () => {
    const results = Array.from({ length: 50 }, () =>
      selectTwoTileTree(10, 20, 1337, 132),
    );
    const first = results[0];
    for (const r of results) {
      expect(r).toEqual(first);
    }
  });

  it("returns valid canopy/trunk pairs when decoration is placed", () => {
    const validPairs = new Set([
      "3-15",
      "4-16",
    ]);
    for (let x = 0; x < 200; x++) {
      const result = selectTwoTileTree(x, 0, 1337, 132);
      if (result !== null) {
        expect(validPairs.has(`${result.canopy}-${result.trunk}`)).toBe(true);
        expect(result.canopyDy).toBe(-1);
      }
    }
  });

  it("always sets canopyDy to -1 (canopy above trunk)", () => {
    for (let x = 0; x < 300; x++) {
      const result = selectTwoTileTree(x, 50, 1337, 132);
      if (result !== null) {
        expect(result.canopyDy).toBe(-1);
      }
    }
  });

  it("returns null when atlasCount is 0", () => {
    expect(selectTwoTileTree(0, 0, 1337, 0)).toBeNull();
  });

  it("returns null when atlasCount is below tree index", () => {
    // Only 10 atlas tiles loaded — none of 3/4/15/16 available
    expect(selectTwoTileTree(0, 0, 1337, 10)).toBeNull();
  });

  it("respects density: not every forest tile gets a two-tile tree", () => {
    let treeCount = 0;
    const total = 200;
    for (let x = 0; x < total; x++) {
      if (selectTwoTileTree(x, 0, 1337, 132) !== null) treeCount++;
    }
    expect(treeCount).toBeGreaterThan(0);
    expect(treeCount).toBeLessThan(total);
  });
});

// ── selectEdgeTransition ────────────────────────────────────────────────────

describe("selectEdgeTransition", () => {
  it("is deterministic for same inputs", () => {
    const results = Array.from({ length: 50 }, () =>
      selectEdgeTransition(10, 20, 1337, 132),
    );
    const first = results[0];
    for (const r of results) {
      expect(r).toBe(first);
    }
  });

  it("returns only indices from the EDGE_TRANSITIONS set", () => {
    const validSet = new Set(EDGE_TRANSITIONS);
    for (let x = 0; x < 200; x++) {
      for (let y = 0; y < 10; y++) {
        const result = selectEdgeTransition(x, y, 1337, 132);
        if (result !== null) {
          expect(validSet.has(result)).toBe(true);
        }
      }
    }
  });

  it("returns all 8 edge indices over a large area (coverage)", () => {
    const seen = new Set<number>();
    for (let x = 0; x < 500; x++) {
      for (let y = 0; y < 10; y++) {
        const result = selectEdgeTransition(x, y, 1337, 132);
        if (result !== null) seen.add(result);
      }
    }
    // Should hit all 8 edge indices over 5000 tiles
    for (const idx of EDGE_TRANSITIONS) {
      expect(seen.has(idx)).toBe(true);
    }
  });

  it("returns null when atlasCount is 0", () => {
    expect(selectEdgeTransition(0, 0, 1337, 0)).toBeNull();
  });

  it("returns null when atlasCount is below edge index", () => {
    // Only 10 atlas tiles loaded — none of 12/13/14/24/26/36/37/38 available
    expect(selectEdgeTransition(0, 0, 1337, 10)).toBeNull();
  });
});
