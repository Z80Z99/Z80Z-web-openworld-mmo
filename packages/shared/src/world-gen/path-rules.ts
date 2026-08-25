/**
 * Deterministic winding gravel-path generation.
 *
 * Paths follow a global anchor lattice independent of chunks, guaranteeing
 * cross-chunk continuity. Each lattice cell has up to two outgoing segments
 * (East and South) that trace parametric sinusoidal curves between anchor
 * points. The curve parameters — wavenumber, phase, amplitude — are derived
 * from a platform-stable integer-avalanche hash, so every tile is fully
 * deterministic given the world seed.
 *
 * Paths overwrite only strict grass tiles (Grass / GrassVariant1 /
 * GrassVariant2). Non-grass tiles act as natural terminators — paths fade
 * out at beaches, swamps, forests, and other biome boundaries.
 */

import { CHUNK_SIZE, TileType } from "./types.js";

// ── Configuration ──────────────────────────────────────────────────

/** Tunable knobs for the path lattice. All fields are readonly after creation. */
export interface PathLatticeConfig {
  /** Lattice spacing in tiles (default: 64). */
  readonly cellSize: number;
  /** Probability that a segment exists (0..1, default: 0.78). */
  readonly keepProbability: number;
  /** Maximum perpendicular displacement amplitude in tiles (default: 6). */
  readonly maxAmplitude: number;
  /** Half-width threshold for tile marking — a sample marks a tile if its
   *  distance to the tile centre is ≤ this value (default: 0.72). */
  readonly halfWidth: number;
}

export const DEFAULT_PATH_CONFIG: Readonly<PathLatticeConfig> = {
  cellSize: 64,
  keepProbability: 0.78,
  maxAmplitude: 6,
  halfWidth: 0.72,
} as const;

/** Tiles that a path may overwrite. Strict grass only — no forest, no
 *  transitions, no shore. */
const CONVERTIBLE_TILES = new Set([
  TileType.Grass,
  TileType.GrassVariant1,
  TileType.GrassVariant2,
]);

// ── Hash utility ───────────────────────────────────────────────────

/**
 * Integer-avalanche hash mapped to [0, 1).
 *
 * Platform-stable: uses Math.imul 32-bit ops only. No Math.random, no
 * Date.now. The same (seed, a, b, c) always returns the same float on
 * every JS engine.
 */
export function hash01(seed: number, a: number, b: number, c: number): number {
  let h = (seed | 0);
  h = (h + Math.imul(a | 0, 73856093)) | 0;
  h = (h + Math.imul(b | 0, 19349663)) | 0;
  h = (h + Math.imul(c | 0, 83492791)) | 0;
  // Avalanche mix (same constants as the existing variantHash in biomes.ts)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = h ^ (h >>> 16);
  // Map to [0, 1) via unsigned reinterpretation
  return (h >>> 0) / 0x100000000;
}

// ── Anchor lattice ─────────────────────────────────────────────────

/**
 * Compute the anchor point for lattice cell (cellX, cellY).
 *
 * Anchors sit 8..56 tiles from the cell origin, ensuring they stay
 * ≥8 tiles from every cell edge.
 */
export function getAnchorPoint(
  seed: number,
  cellX: number,
  cellY: number,
  config?: Pick<PathLatticeConfig, "cellSize">,
): { readonly x: number; readonly y: number } {
  const cs = config?.cellSize ?? DEFAULT_PATH_CONFIG.cellSize;
  const x = cellX * cs + 8 + hash01(seed, cellX, cellY, 11) * (cs - 16);
  const y = cellY * cs + 8 + hash01(seed, cellX, cellY, 23) * (cs - 16);
  return { x, y };
}

/**
 * Determine whether a segment exists from cell (cellX, cellY) towards
 * direction `dir` ("E" → East, "S" → South).
 *
 * Uses a dedicated salt per direction so East and South existence are
 * independent.
 */
export function segmentExists(
  seed: number,
  cellX: number,
  cellY: number,
  dir: "E" | "S",
  config?: Pick<PathLatticeConfig, "keepProbability">,
): boolean {
  const kp = config?.keepProbability ?? DEFAULT_PATH_CONFIG.keepProbability;
  const salt = dir === "E" ? 37 : 53;
  return hash01(seed, cellX, cellY, salt) < kp;
}

// ── Segment rasterisation (internal) ───────────────────────────────

/**
 * Evaluate a single segment and collect the world-tile keys it marks.
 *
 * The curve is:
 *   P(t) = A + t·(B−A) + perp(B−A)·sin(t·π·k + φ)·amp
 *
 * where t ∈ [0, 1], k ∈ {1, 2, 3}, φ ∈ [0, 2π), amp ∈ [0, maxAmplitude).
 *
 * @returns A Set of "wx,wy" keys for every tile the segment marks.
 */
function rasteriseSegment(
  seed: number,
  cellX: number,
  cellY: number,
  dir: "E" | "S",
  config: PathLatticeConfig,
): Set<string> {
  const marks = new Set<string>();
  if (!segmentExists(seed, cellX, cellY, dir, config)) return marks;

  const A = getAnchorPoint(seed, cellX, cellY, config);
  const B =
    dir === "E"
      ? getAnchorPoint(seed, cellX + 1, cellY, config)
      : getAnchorPoint(seed, cellX, cellY + 1, config);

  const salt = dir === "E" ? 37 : 53;
  const k = 1 + Math.floor(hash01(seed, cellX, cellY, salt + 100) * 3);
  const phi = hash01(seed, cellX, cellY, salt + 200) * 2 * Math.PI;
  const amp = hash01(seed, cellX, cellY, salt + 300) * config.maxAmplitude;

  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Degenerate segment (A ≈ B): mark the tile at A if within halfWidth.
  if (len < 0.001) {
    const twx = Math.floor(A.x);
    const twy = Math.floor(A.y);
    const cx = twx + 0.5;
    const cy = twy + 0.5;
    if (Math.sqrt((cx - A.x) ** 2 + (cy - A.y) ** 2) <= config.halfWidth) {
      marks.add(`${twx},${twy}`);
    }
    return marks;
  }

  // Unit perpendicular: (-dy/len, dx/len)
  const px = -dy / len;
  const py = dx / len;

  // Step so consecutive samples are ≤1 tile apart along the straight line.
  const samples = Math.max(1, Math.round(len));
  const step = 1 / samples;

  for (let i = 0; i <= samples; i++) {
    const t = i * step;
    const sx = A.x + t * dx + px * Math.sin(t * Math.PI * k + phi) * amp;
    const sy = A.y + t * dy + py * Math.sin(t * Math.PI * k + phi) * amp;

    // Check the 2×2 block of tiles the sample could fall in the corner of.
    const fx = Math.floor(sx);
    const fy = Math.floor(sy);
    for (let ox = 0; ox <= 1; ox++) {
      for (let oy = 0; oy <= 1; oy++) {
        const twx = fx + ox;
        const twy = fy + oy;
        const tcx = twx + 0.5;
        const tcy = twy + 0.5;
        if (Math.sqrt((tcx - sx) ** 2 + (tcy - sy) ** 2) <= config.halfWidth) {
          marks.add(`${twx},${twy}`);
        }
      }
    }
  }

  return marks;
}

// ── Public query API ───────────────────────────────────────────────

/**
 * Check whether a single world tile is on a gravel path.
 *
 * Examines the ≤18 segments (3×3 neighbourhood of lattice cells × 2
 * directions) whose anchor cells could influence this tile. Correct and
 * simple beats clever.
 */
export function isPathTileAt(
  wx: number,
  wy: number,
  seed: number,
  config?: PathLatticeConfig,
): boolean {
  const cfg = config ?? DEFAULT_PATH_CONFIG;
  const cs = cfg.cellSize;

  // Lattice cell containing this tile.
  const baseCx = Math.floor(wx / cs);
  const baseCy = Math.floor(wy / cs);

  // Check the 3×3 neighbourhood of lattice cells.
  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcy = -1; dcy <= 1; dcy++) {
      const cx = baseCx + dcx;
      const cy = baseCy + dcy;

      // East segment: cell (cx, cy) → (cx+1, cy)
      if (segmentExists(seed, cx, cy, "E", cfg)) {
        if (tileOnSegment(wx, wy, seed, cx, cy, "E", cfg)) return true;
      }

      // South segment: cell (cx, cy) → (cx, cy+1)
      if (segmentExists(seed, cx, cy, "S", cfg)) {
        if (tileOnSegment(wx, wy, seed, cx, cy, "S", cfg)) return true;
      }
    }
  }

  return false;
}

/**
 * Fast check: does any sample on the segment fall close enough to
 * tile (wx, wy)?
 */
function tileOnSegment(
  wx: number,
  wy: number,
  seed: number,
  cellX: number,
  cellY: number,
  dir: "E" | "S",
  config: PathLatticeConfig,
): boolean {
  const A = getAnchorPoint(seed, cellX, cellY, config);
  const B =
    dir === "E"
      ? getAnchorPoint(seed, cellX + 1, cellY, config)
      : getAnchorPoint(seed, cellX, cellY + 1, config);

  const salt = dir === "E" ? 37 : 53;
  const k = 1 + Math.floor(hash01(seed, cellX, cellY, salt + 100) * 3);
  const phi = hash01(seed, cellX, cellY, salt + 200) * 2 * Math.PI;
  const amp = hash01(seed, cellX, cellY, salt + 300) * config.maxAmplitude;

  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Degenerate segment.
  if (len < 0.001) {
    const cx2 = Math.floor(A.x) + 0.5;
    const cy2 = Math.floor(A.y) + 0.5;
    return (
      wx === Math.floor(A.x) &&
      wy === Math.floor(A.y) &&
      Math.sqrt((cx2 - A.x) ** 2 + (cy2 - A.y) ** 2) <= config.halfWidth
    );
  }

  const px = -dy / len;
  const py = dx / len;

  const samples = Math.max(1, Math.round(len));
  const step = 1 / samples;
  const tcx = wx + 0.5;
  const tcy = wy + 0.5;
  const hw = config.halfWidth;
  const hw2 = hw * hw;

  for (let i = 0; i <= samples; i++) {
    const t = i * step;
    const sx = A.x + t * dx + px * Math.sin(t * Math.PI * k + phi) * amp;
    const sy = A.y + t * dy + py * Math.sin(t * Math.PI * k + phi) * amp;

    // Quick AABB reject before expensive sqrt.
    if (Math.abs(sx - tcx) > hw || Math.abs(sy - tcy) > hw) continue;
    if ((sx - tcx) ** 2 + (sy - tcy) ** 2 <= hw2) return true;
  }

  return false;
}

// ── Chunk mutation ─────────────────────────────────────────────────

/**
 * Overwrite strict-grass tiles with GravelPath where the global path
 * lattice intersects the chunk.
 *
 * Mutates `tiles` in place. Non-grass tiles (water, sand, stone, forest,
 * transitions) act as natural path terminators — the path fades out.
 *
 * Must be called **after** resolveChunkTiles (Pass 1 + Pass 2) so that
 * variant/transition tiles are already resolved.
 */
export function applyGravelPaths(
  tiles: TileType[][],
  chunkCx: number,
  chunkCy: number,
  seed: number,
  config?: PathLatticeConfig,
): void {
  const cfg = config ?? DEFAULT_PATH_CONFIG;
  const cs = cfg.cellSize;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const current = tiles[ly][lx];
      if (!CONVERTIBLE_TILES.has(current)) continue;

      const wx = chunkCx * CHUNK_SIZE + lx;
      const wy = chunkCy * CHUNK_SIZE + ly;

      if (isPathTileAt(wx, wy, seed, cfg)) {
        tiles[ly][lx] = TileType.GravelPath;
      }
    }
  }
}
