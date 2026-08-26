import { describe, it, expect } from "vitest";
import {
  Direction,
  computeNeighborMask,
  getGroundEdgeTiles,
  getShoreTiles,
  getCoastalInnerTiles,
  invert180,
} from "./shore-rules.js";
import { TileType } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Indices shorthand: [2] -> [{ index: 2 }] */
const idx = (...indices: number[]) => indices.map((index) => ({ index }));

/**
 * Chunk-emulating world lookup: stores overrides per simulated 32×32 chunk
 * exactly like GameState.getTileAt does (floor-div for chunk id, positive
 * modulo for local coords). Proves that neighbour queries expressed in WORLD
 * coordinates resolve correctly across chunk borders.
 */
const CHUNK = 32;
function makeChunkedLookup(
  overrides: Array<[wx: number, wy: number, t: TileType]>,
  base: TileType = TileType.Grass,
): (x: number, y: number) => TileType | null {
  const chunkCache = new Map<string, Map<number, TileType>>();
  const localKey = (lx: number, ly: number) => ly * CHUNK + lx;
  return (wx, wy) => {
    const cx = Math.floor(wx / CHUNK);
    const cy = Math.floor(wy / CHUNK);
    const lx = ((wx % CHUNK) + CHUNK) % CHUNK;
    const ly = ((wy % CHUNK) + CHUNK) % CHUNK;
    const key = `${cx},${cy}`;
    let cells = chunkCache.get(key);
    if (!cells) {
      cells = new Map<number, TileType>();
      for (const [X, Y, T] of overrides) {
        if (
          Math.floor(X / CHUNK) === cx &&
          Math.floor(Y / CHUNK) === cy
        ) {
          cells.set(
            localKey(((X % CHUNK) + CHUNK) % CHUNK, ((Y % CHUNK) + CHUNK) % CHUNK),
            T,
          );
        }
      }
      chunkCache.set(key, cells);
    }
    return cells.get(localKey(lx, ly)) ?? base;
  };
}

/** Coastal mask: bits set where the neighbour is water. */
function waterNeighborMask(
  wx: number,
  wy: number,
  lookup: (x: number, y: number) => TileType | null,
): number {
  return computeNeighborMask(wx, wy, (x, y) => {
    const t = lookup(x, y);
    return t !== null && (t === TileType.Water || t === TileType.DeepWater);
  });
}

// ---------------------------------------------------------------------------
// Sand-family centers: waterMask decomposed AS-IS (band toward the water)
// ---------------------------------------------------------------------------

describe("getCoastalInnerTiles — sand-family center", () => {
  it("S1: single-side coast, one straight band facing the water", () => {
    expect(getCoastalInnerTiles(TileType.Sand, Direction.N)).toEqual(idx(2));
    expect(getCoastalInnerTiles(TileType.Sand, Direction.E)).toEqual(idx(5));
    expect(getCoastalInnerTiles(TileType.Sand, Direction.S)).toEqual(idx(7));
    expect(getCoastalInnerTiles(TileType.Sand, Direction.W)).toEqual(idx(4));
  });

  it("S1: variant tiles behave like their family base", () => {
    expect(getCoastalInnerTiles(TileType.SandVariant1, Direction.N)).toEqual(idx(2));
  });

  it("S2: four-sided water stacks two disjoint L-tiles [1,8]", () => {
    expect(
      getCoastalInnerTiles(TileType.Sand, Direction.N | Direction.E | Direction.S | Direction.W),
    ).toEqual(idx(1, 8));
  });

  it("S3: diagonal-only water yields outer corners", () => {
    expect(getCoastalInnerTiles(TileType.Sand, Direction.NW)).toEqual(idx(9));
    expect(getCoastalInnerTiles(TileType.Sand, Direction.NE)).toEqual(idx(10));
    expect(getCoastalInnerTiles(TileType.Sand, Direction.SW)).toEqual(idx(12));
    expect(getCoastalInnerTiles(TileType.Sand, Direction.SE)).toEqual(idx(11));
  });

  it("S4a: cape (water N+E+W, land S) → [1,5] (N&W pair consumes N, leftover E goes straight)", () => {
    expect(
      getCoastalInnerTiles(TileType.Sand, Direction.N | Direction.E | Direction.W),
    ).toEqual(idx(1, 5));
  });

  it("S4b: bay (water S+E+W, land N) → [6,5] (S&W pair wins, leftover E goes straight)", () => {
    expect(
      getCoastalInnerTiles(TileType.Sand, Direction.E | Direction.S | Direction.W),
    ).toEqual(idx(6, 5));
  });

  it("S5: island (all 8 neighbours water) → [1,8] ring, corners suppressed by flanks", () => {
    expect(getCoastalInnerTiles(TileType.Sand, 255)).toEqual(idx(1, 8));
  });

  it("S6: narrow strait bank (water E+W) → both bands [5,4]", () => {
    expect(
      getCoastalInnerTiles(TileType.Sand, Direction.E | Direction.W),
    ).toEqual(idx(5, 4));
  });

  it("cardinal+diagonal mix: N|SE → [2,11] (corner kept, flank band wins its own)", () => {
    expect(
      getCoastalInnerTiles(TileType.Sand, Direction.N | Direction.SE),
    ).toEqual(idx(2, 11));
  });
});

// ---------------------------------------------------------------------------
// Grass-family centers: waterMask inverted 180° (dirt toward water, band inland)
// ---------------------------------------------------------------------------

describe("getCoastalInnerTiles — grass-family center", () => {
  it("G1: single-side coast, band points inland", () => {
    expect(getCoastalInnerTiles(TileType.Grass, Direction.N)).toEqual(idx(7));
    expect(getCoastalInnerTiles(TileType.Grass, Direction.S)).toEqual(idx(2));
    expect(getCoastalInnerTiles(TileType.Grass, Direction.E)).toEqual(idx(4));
    expect(getCoastalInnerTiles(TileType.Grass, Direction.W)).toEqual(idx(5));
  });

  it("G1: forest behaves like grass family", () => {
    expect(getCoastalInnerTiles(TileType.Forest, Direction.N)).toEqual(idx(7));
  });

  it("G2: four-sided water → [1,8] (rotation-invariant)", () => {
    expect(
      getCoastalInnerTiles(TileType.Grass, Direction.N | Direction.E | Direction.S | Direction.W),
    ).toEqual(idx(1, 8));
  });

  it("G3: diagonal-only water yields opposite corners", () => {
    expect(getCoastalInnerTiles(TileType.Grass, Direction.NW)).toEqual(idx(11));
    expect(getCoastalInnerTiles(TileType.Grass, Direction.NE)).toEqual(idx(12));
    expect(getCoastalInnerTiles(TileType.Grass, Direction.SE)).toEqual(idx(9));
    expect(getCoastalInnerTiles(TileType.Grass, Direction.SW)).toEqual(idx(10));
  });

  it("G4: cape-like water N+E → [6]", () => {
    expect(
      getCoastalInnerTiles(TileType.Grass, Direction.N | Direction.E),
    ).toEqual(idx(6));
  });

  it("G4: strait bank grass with water E+W → [5,4]", () => {
    expect(
      getCoastalInnerTiles(TileType.Grass, Direction.E | Direction.W),
    ).toEqual(idx(5, 4));
  });
});

// ---------------------------------------------------------------------------
// Eligibility: only grass/sand families host coastal overlays
// ---------------------------------------------------------------------------

describe("getCoastalInnerTiles — eligibility", () => {
  it("returns [] for non grass/sand tiles even with water neighbours", () => {
    const mask = Direction.N | Direction.SE;
    for (const t of [
      TileType.Stone,
      TileType.Water,
      TileType.DeepWater,
      TileType.Snow,
      TileType.Swamp,
      TileType.Ice,
    ]) {
      expect(getCoastalInnerTiles(t, mask)).toEqual([]);
    }
  });

  it("returns [] for mask 0 regardless of tile type", () => {
    expect(getCoastalInnerTiles(TileType.Sand, 0)).toEqual([]);
    expect(getCoastalInnerTiles(TileType.Grass, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chunk boundaries: world-coordinate neighbour queries across simulated chunks
// ---------------------------------------------------------------------------

describe("getCoastalInnerTiles — chunk boundaries via world-coord queries", () => {
  it("S7: centre on right chunk edge, water in next chunk to the east", () => {
    // Centre (31, 5) lives in chunk (0,0); water at (32, 5) lives in chunk (1,0).
    const lookup = makeChunkedLookup([[32, 5, TileType.Water]]);
    const mask = waterNeighborMask(31, 5, lookup);
    expect(mask).toBe(Direction.E);
    expect(getCoastalInnerTiles(TileType.Sand, mask)).toEqual(idx(5));
  });

  it("S8: centre on left chunk edge, water in previous chunk to the west", () => {
    const lookup = makeChunkedLookup([[-1, 5, TileType.Water]]);
    const mask = waterNeighborMask(0, 5, lookup);
    expect(mask).toBe(Direction.W);
    expect(getCoastalInnerTiles(TileType.Sand, mask)).toEqual(idx(4));
  });

  it("S9: centre on top chunk edge, water in chunk above", () => {
    const lookup = makeChunkedLookup([[10, -1, TileType.Water]]);
    const mask = waterNeighborMask(10, 0, lookup);
    expect(mask).toBe(Direction.N);
    expect(getCoastalInnerTiles(TileType.Grass, mask)).toEqual(idx(7));
  });

  it("S10: centre on bottom chunk edge, water in chunk below", () => {
    const lookup = makeChunkedLookup([[10, 32, TileType.Water]]);
    const mask = waterNeighborMask(10, 31, lookup);
    expect(mask).toBe(Direction.S);
    expect(getCoastalInnerTiles(TileType.Grass, mask)).toEqual(idx(2));
  });

  it("S10b: corner tile sees diagonal water across two chunk borders", () => {
    // Centre (0,0) in chunk (0,0); NW-diagonal water at (-1,-1) lives in
    // chunk (-1,-1) — only world-coordinate math can find it.
    const lookup = makeChunkedLookup([[-1, -1, TileType.Water]]);
    const mask = waterNeighborMask(0, 0, lookup);
    expect(mask).toBe(Direction.NW);
    expect(getCoastalInnerTiles(TileType.Sand, mask)).toEqual(idx(9));
  });
});

// ---------------------------------------------------------------------------
// S11: complex coastline fixture, hand-computed expectations
// ---------------------------------------------------------------------------

describe("getCoastalInnerTiles — complex coastline fixture", () => {
  //      x0 x1 x2 x3 x4 x5
  const GRID = [
    "~ ~ ~ ~ ~ ~", // y0
    "~ s s s ~ ~", // y1
    "~ s . s ~ .", // y2
    "~ s s s ~ .", // y3
    "~ ~ . ~ ~ .", // y4
    "~ ~ . ~ ~ ~", // y5
  ];
  const CHAR_TO_TILE: Record<string, TileType> = {
    "~": TileType.Water,
    s: TileType.Sand,
    ".": TileType.Grass,
  };
  function tileAt(x: number, y: number): TileType {
    if (y < 0 || y >= GRID.length) return TileType.Grass;
    const row = GRID[y].split(" ");
    if (x < 0 || x >= row.length) return TileType.Grass;
    return CHAR_TO_TILE[row[x]];
  }

  it("hand-computed coastal cells match exactly", () => {
    const cases: Array<[x: number, y: number, expected: number[]]> = [
      // Beach top-row middle: water only to the north.
      [2, 1, [2]],
      // Beach NW corner: water north AND west → quadrant L.
      [1, 1, [1]],
      // Ring centre: fully enclosed by land → no coastal overlay.
      [2, 2, []],
      // Inner grass pocket south of the ring: water west+east → strait bands.
      [2, 4, [5, 4]],
      // Eastern strait bank grass: water only to the west.
      [5, 3, [5]],
      // Beach east edge: water east + NE + SE diagonals → straight band only.
      [3, 2, [5]],
    ];
    for (const [x, y, expected] of cases) {
      const mask = waterNeighborMask(x, y, tileAt);
      const center = tileAt(x, y);
      expect(getCoastalInnerTiles(center, mask), `cell (${x},${y})`).toEqual(
        idx(...expected),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// R1: regressions — interior silence + untouched sibling systems
// ---------------------------------------------------------------------------

describe("coastal inner — regression guards", () => {
  it("R1: interior land (no water neighbours) never emits overlays", () => {
    for (let m = 0; m <= 255; m++) {
      const cardinalsOnly = m & 0b01011010; // any cardinal bit set
      if (cardinalsOnly !== 0) continue; // skip: not "no water neighbours"
    }
    expect(getCoastalInnerTiles(TileType.Sand, 0)).toEqual([]);
    expect(getCoastalInnerTiles(TileType.Grass, 0)).toEqual([]);
    expect(getCoastalInnerTiles(TileType.ForestVariant1, 0)).toEqual([]);
  });

  it("R1: getGroundEdgeTiles behaviour unchanged on pinned fixtures", () => {
    expect(getGroundEdgeTiles(Direction.N)).toEqual(idx(2));
    expect(getGroundEdgeTiles(Direction.N | Direction.W)).toEqual(idx(1));
    expect(getGroundEdgeTiles(Direction.NW)).toEqual(idx(9));
    expect(getGroundEdgeTiles(Direction.N | Direction.E | Direction.S | Direction.W)).toEqual(
      idx(1, 8),
    );
  });

  it("R1: getShoreTiles behaviour unchanged on pinned fixtures", () => {
    expect(getShoreTiles(Direction.N)).toEqual([
      { type: "concave", index: 2, direction: "N" },
    ]);
    expect(getShoreTiles(Direction.NW)).toEqual([
      { type: "convex", index: 1, direction: "NW" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// R2: determinism + exhaustive composition properties
// ---------------------------------------------------------------------------

describe("coastal inner — exhaustive 256-mask properties", () => {
  it("R2: sand path == getGroundEdgeTiles(mask) for ALL masks, deterministic", () => {
    for (let m = 0; m <= 255; m++) {
      const once = getCoastalInnerTiles(TileType.Sand, m);
      expect(once).toEqual(getCoastalInnerTiles(TileType.Sand, m));
      expect(once).toEqual(getGroundEdgeTiles(m));
      expect(once.length).toBeLessThanOrEqual(4);
      for (const t of once) {
        expect(t.index).toBeGreaterThanOrEqual(1);
        expect(t.index).toBeLessThanOrEqual(12);
      }
    }
  });

  it("R2: grass path == getGroundEdgeTiles(invert180(mask)) for ALL masks", () => {
    for (let m = 0; m <= 255; m++) {
      expect(getCoastalInnerTiles(TileType.Grass, m)).toEqual(
        getGroundEdgeTiles(invert180(m)),
      );
    }
  });

  it("R2: invert180 is an involution and fixes 0/255", () => {
    expect(invert180(0)).toBe(0);
    expect(invert180(255)).toBe(255);
    for (let m = 0; m <= 255; m++) {
      expect(invert180(invert180(m))).toBe(m);
    }
  });
});
