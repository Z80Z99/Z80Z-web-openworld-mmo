import { describe, it, expect } from "vitest";
import {
  computeNeighborMask,
  getGroundEdgeTiles,
  isGrassFamilyTile,
  isSandFamilyTile,
} from "./shore-rules.js";
import { TileType } from "./types.js";

// ---------------------------------------------------------------------------
// Biome boundary responsibility characterization.
//
// Pins WHO expresses a terrain blend and WHERE:
//   - World generation decides the TileType layout (inserting transition
//     tiles such as GrassToSand between biomes).
//   - The renderer's Ground Edge system expresses the grass<->sand blend as
//     overlay bands ON SAND-FAMILY CENTERS ONLY (TileRenderer gates on
//     isSandFamilyTile before calling getGroundEdgeTiles), treating every
//     grass-family neighbour (incl. GrassToSand / Forest family) as the
//     fringe direction. Diagonal-only grass contacts yield outer-corner
//     rounding tiles exactly like any other ground edge.
//   - Transition tiles themselves are grass-family: they render as grass
//     ground (TextureManager GROUND_TILE_FILES -> grass1.png) and NEVER host
//     a band, so a boundary is blended exactly once and never double-drawn.
//
// Grids are explicitly padded so every mask bit is intentional; out-of-bounds
// reads fall back to Grass exactly like the renderer fixtures do.
//
// These are characterization tests: they lock current observable behaviour of
// the pure rule functions that the renderer delegates to (refactor-exception
// style — GREEN against existing code by design).
// ---------------------------------------------------------------------------

/** Grid chars: G grass, S sand, F forest, T grass-to-sand transition, R stone. */
const CHAR_TO_TILE: Record<string, TileType> = {
  G: TileType.Grass,
  S: TileType.Sand,
  F: TileType.Forest,
  T: TileType.GrassToSand,
  R: TileType.Stone,
};

function makeLookup(rows: string[]) {
  return (x: number, y: number): TileType => {
    if (y < 0 || y >= rows.length) return TileType.Grass;
    const row = rows[y].split(" ");
    if (x < 0 || x >= row.length) return TileType.Grass;
    return CHAR_TO_TILE[row[x]];
  };
}

/**
 * Exactly what TileRenderer PASS1 does per cell: only sand-family centers
 * decompose a grass-family neighbour mask into overlay bands.
 */
function sandHostOverlay(
  x: number,
  y: number,
  lookup: (x: number, y: number) => TileType,
): { host: boolean; indices: number[] } {
  const center = lookup(x, y);
  if (!isSandFamilyTile(center)) return { host: false, indices: [] };
  const mask = computeNeighborMask(x, y, (ax, ay) => {
    const t = lookup(ax, ay);
    return t !== null && isGrassFamilyTile(t);
  });
  return { host: true, indices: getGroundEdgeTiles(mask).map((t) => t.index) };
}

describe("biome boundary vs Ground Edge — responsibility split", () => {
  it("eligibility: GrassToSand is grass-family, never a band host", () => {
    expect(isGrassFamilyTile(TileType.GrassToSand)).toBe(true);
    expect(isSandFamilyTile(TileType.GrassToSand)).toBe(false);
    expect(isSandFamilyTile(TileType.Forest)).toBe(false);
    expect(isSandFamilyTile(TileType.Stone)).toBe(false);
  });

  it("Scenario A: 3x3 grass|sand block (sand-padded) — only sand facing grass gets bands", () => {
    const rows = [
      "G G G S",
      "G S S S",
      "G S S S",
      "S S S S",
    ];
    const lookup = makeLookup(rows);

    expect(sandHostOverlay(1, 1, lookup)).toEqual({ host: true, indices: [1] }); // N+W quadrant L
    expect(sandHostOverlay(2, 1, lookup)).toEqual({ host: true, indices: [2] }); // N straight
    expect(sandHostOverlay(1, 2, lookup)).toEqual({ host: true, indices: [4] }); // W straight
    // Interior sand fully enclosed by sand -> nothing (no internal doubling).
    expect(sandHostOverlay(2, 2, lookup)).toEqual({ host: true, indices: [] });
  });

  it("Scenario B: forest/forest/sand over grass/grass/sand — forest counts as grass-family", () => {
    const rows = [
      "F F S S",
      "F F S S",
      "G G S S",
      "S S S S",
    ];
    const lookup = makeLookup(rows);

    // Top sand: oob-grass north + forest west -> quadrant L.
    expect(sandHostOverlay(2, 0, lookup)).toEqual({ host: true, indices: [1] });
    // Middle/bottom sand: single grass-family west -> west straight
    // (forest behaves identically to plain grass as fringe direction).
    expect(sandHostOverlay(2, 1, lookup)).toEqual({ host: true, indices: [4] });
    expect(sandHostOverlay(2, 2, lookup)).toEqual({ host: true, indices: [4] });
    // Forest centers never host.
    expect(sandHostOverlay(0, 0, lookup)).toEqual({ host: false, indices: [] });
    expect(sandHostOverlay(1, 1, lookup)).toEqual({ host: false, indices: [] });
  });

  it("Scenario C: GrassToSand / Grass / Sand column — transition tile stays bare", () => {
    const rows = [
      "F T S",
      "F G S",
      "F S S",
      "F S S",
    ];
    const lookup = makeLookup(rows);

    // Transition tile renders as grass ground and hosts no band itself…
    expect(sandHostOverlay(1, 0, lookup)).toEqual({ host: false, indices: [] });
    // …the grass cell neither…
    expect(sandHostOverlay(1, 1, lookup)).toEqual({ host: false, indices: [] });
    // …and its sand fringes exactly once toward the grass/transition side.
    expect(sandHostOverlay(1, 2, lookup)).toEqual({ host: true, indices: [1] });
  });

  it("Scenario D: Forest / Grass / Sand column — same single-blend guarantee", () => {
    const rows = [
      "F S S",
      "G S S",
      "S S S",
      "S S S",
    ];
    const lookup = makeLookup(rows);

    expect(sandHostOverlay(0, 0, lookup)).toEqual({ host: false, indices: [] }); // forest
    expect(sandHostOverlay(0, 1, lookup)).toEqual({ host: false, indices: [] }); // grass
    // Sand below grass: north grass + west oob grass -> quadrant L once.
    expect(sandHostOverlay(0, 2, lookup)).toEqual({ host: true, indices: [1] });
  });

  it("Scenario E: multi-biome contact — stone contributes no bits, diagonal gets corner rounding", () => {
    const rows = [
      "G S S",
      "R S S",
      "R R R",
    ];
    const lookup = makeLookup(rows);

    // Sand between grass west + oob-grass north -> quadrant L.
    expect(sandHostOverlay(1, 0, lookup)).toEqual({ host: true, indices: [1] });
    // Sand walled by stone/sand on cardinals but grass touching NW diagonally
    // -> lone outer-corner rounding tile (standard ground-edge behaviour).
    expect(sandHostOverlay(1, 1, lookup)).toEqual({ host: true, indices: [9] });
    // Stone itself never hosts.
    expect(sandHostOverlay(0, 1, lookup)).toEqual({ host: false, indices: [] });
  });
});
