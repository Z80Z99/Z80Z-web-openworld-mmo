import { describe, it, expect, beforeEach } from 'vitest';
import {
  Direction,
  DIRECTION_NAMES,
  DIRECTION_MASK,
  getShoreTiles,
  getMaskFromNeighbors,
  getNeighborsFromMask,
  maskToBinary,
  getActiveDirections,
  registerShoreRule,
  getShoreRule,
  clearShoreRules,
} from '@mmo/shared';

describe('shore-rules', () => {
  beforeEach(() => {
    clearShoreRules();
  });

  describe('Direction constants', () => {
    it('should have correct bitmask values', () => {
      expect(Direction.NW).toBe(1);
      expect(Direction.N).toBe(2);
      expect(Direction.NE).toBe(4);
      expect(Direction.W).toBe(8);
      expect(Direction.E).toBe(16);
      expect(Direction.SW).toBe(32);
      expect(Direction.S).toBe(64);
      expect(Direction.SE).toBe(128);
    });

    it('should have unique bitmask values', () => {
      const values = Object.values(Direction);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it('should be powers of 2', () => {
      for (const value of Object.values(Direction)) {
        expect(value & (value - 1)).toBe(0);
      }
    });
  });

  describe('DIRECTION_NAMES', () => {
    it('should have 8 direction names', () => {
      expect(DIRECTION_NAMES.length).toBe(8);
    });

    it('should be in correct order', () => {
      expect(DIRECTION_NAMES).toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE']);
    });
  });

  describe('DIRECTION_MASK', () => {
    it('should have all 8 directions', () => {
      expect(Object.keys(DIRECTION_MASK).length).toBe(8);
    });

    it('should match Direction constants', () => {
      expect(DIRECTION_MASK['NW']).toBe(Direction.NW);
      expect(DIRECTION_MASK['N']).toBe(Direction.N);
      expect(DIRECTION_MASK['NE']).toBe(Direction.NE);
      expect(DIRECTION_MASK['W']).toBe(Direction.W);
      expect(DIRECTION_MASK['E']).toBe(Direction.E);
      expect(DIRECTION_MASK['SW']).toBe(Direction.SW);
      expect(DIRECTION_MASK['S']).toBe(Direction.S);
      expect(DIRECTION_MASK['SE']).toBe(Direction.SE);
    });
  });

  describe('getMaskFromNeighbors', () => {
    it('should return 0 for empty array', () => {
      expect(getMaskFromNeighbors([])).toBe(0);
    });

    it('should return 0 for all false', () => {
      expect(getMaskFromNeighbors([false, false, false, false, false, false, false, false])).toBe(0);
    });

    it('should return correct mask for single true values', () => {
      expect(getMaskFromNeighbors([true, false, false, false, false, false, false, false])).toBe(1);
      expect(getMaskFromNeighbors([false, true, false, false, false, false, false, false])).toBe(2);
      expect(getMaskFromNeighbors([false, false, true, false, false, false, false, false])).toBe(4);
      expect(getMaskFromNeighbors([false, false, false, true, false, false, false, false])).toBe(8);
      expect(getMaskFromNeighbors([false, false, false, false, true, false, false, false])).toBe(16);
      expect(getMaskFromNeighbors([false, false, false, false, false, true, false, false])).toBe(32);
      expect(getMaskFromNeighbors([false, false, false, false, false, false, true, false])).toBe(64);
      expect(getMaskFromNeighbors([false, false, false, false, false, false, false, true])).toBe(128);
    });

    it('should combine multiple true values', () => {
      expect(getMaskFromNeighbors([true, true, false, false, false, false, false, false])).toBe(3);
      expect(getMaskFromNeighbors([false, true, true, false, false, false, false, false])).toBe(6);
      expect(getMaskFromNeighbors([true, true, true, true, true, true, true, true])).toBe(255);
    });
  });

  describe('getNeighborsFromMask', () => {
    it('should return all false for mask 0', () => {
      expect(getNeighborsFromMask(0)).toEqual([false, false, false, false, false, false, false, false]);
    });

    it('should return correct neighbors for single bits', () => {
      expect(getNeighborsFromMask(1)).toEqual([true, false, false, false, false, false, false, false]);
      expect(getNeighborsFromMask(2)).toEqual([false, true, false, false, false, false, false, false]);
      expect(getNeighborsFromMask(4)).toEqual([false, false, true, false, false, false, false, false]);
      expect(getNeighborsFromMask(8)).toEqual([false, false, false, true, false, false, false, false]);
      expect(getNeighborsFromMask(16)).toEqual([false, false, false, false, true, false, false, false]);
      expect(getNeighborsFromMask(32)).toEqual([false, false, false, false, false, true, false, false]);
      expect(getNeighborsFromMask(64)).toEqual([false, false, false, false, false, false, true, false]);
      expect(getNeighborsFromMask(128)).toEqual([false, false, false, false, false, false, false, true]);
    });

    it('should return all true for mask 255', () => {
      expect(getNeighborsFromMask(255)).toEqual([true, true, true, true, true, true, true, true]);
    });
  });

  describe('getMaskFromNeighbors round-trip', () => {
    it('should round-trip correctly for all masks', () => {
      for (let mask = 0; mask < 256; mask++) {
        const neighbors = getNeighborsFromMask(mask);
        const roundTripped = getMaskFromNeighbors(neighbors);
        expect(roundTripped).toBe(mask);
      }
    });
  });

  describe('maskToBinary', () => {
    it('should return 8-bit binary string', () => {
      expect(maskToBinary(0)).toBe('00000000');
      expect(maskToBinary(1)).toBe('00000001');
      expect(maskToBinary(2)).toBe('00000010');
      expect(maskToBinary(255)).toBe('11111111');
    });

    it('should pad to 8 characters', () => {
      expect(maskToBinary(1).length).toBe(8);
      expect(maskToBinary(128).length).toBe(8);
    });

    it('should show correct bit order', () => {
      expect(maskToBinary(1)).toBe('00000001');
      expect(maskToBinary(128)).toBe('10000000');
    });
  });

  describe('getActiveDirections', () => {
    it('should return empty array for mask 0', () => {
      expect(getActiveDirections(0)).toEqual([]);
    });

    it('should return single direction for single bit', () => {
      expect(getActiveDirections(1)).toEqual(['NW']);
      expect(getActiveDirections(2)).toEqual(['N']);
      expect(getActiveDirections(4)).toEqual(['NE']);
      expect(getActiveDirections(8)).toEqual(['W']);
      expect(getActiveDirections(16)).toEqual(['E']);
      expect(getActiveDirections(32)).toEqual(['SW']);
      expect(getActiveDirections(64)).toEqual(['S']);
      expect(getActiveDirections(128)).toEqual(['SE']);
    });

    it('should return all directions for mask 255', () => {
      expect(getActiveDirections(255)).toEqual(['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE']);
    });

    it('should return multiple directions for combined mask', () => {
      expect(getActiveDirections(3)).toEqual(['NW', 'N']);       // 1+2
      expect(getActiveDirections(6)).toEqual(['N', 'NE']);       // 2+4
      expect(getActiveDirections(20)).toEqual(['NE', 'E']);      // 4+16
    });
  });

  // ── getShoreTiles: multi-overlay decomposition (0-4 tiles per mask) ─

  describe('getShoreTiles - mask 0', () => {
    it('mask=0 returns empty array', () => {
      expect(getShoreTiles(0)).toEqual([]);
    });
  });

  describe('getShoreTiles - single direction masks', () => {
    it('mask=1 (NW) → convex1 NW', () => {
      const tiles = getShoreTiles(1);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
    });

    it('mask=2 (N) → concave2 N', () => {
      const tiles = getShoreTiles(2);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 2, direction: 'N' });
    });

    it('mask=4 (NE) → convex2 NE', () => {
      const tiles = getShoreTiles(4);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
    });

    it('mask=8 (W) → concave4 W', () => {
      const tiles = getShoreTiles(8);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 4, direction: 'W' });
    });

    it('mask=16 (E) → concave5 E', () => {
      const tiles = getShoreTiles(16);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
    });

    it('mask=32 (SW) → convex4 SW', () => {
      const tiles = getShoreTiles(32);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
    });

    it('mask=64 (S) → concave7 S', () => {
      const tiles = getShoreTiles(64);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 7, direction: 'S' });
    });

    it('mask=128 (SE) → convex3 SE', () => {
      const tiles = getShoreTiles(128);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'convex', index: 3, direction: 'SE' });
    });
  });

  describe('getShoreTiles - quadrant pairs (N&W, N&E, S&W, S&E)', () => {
    it('mask=10 (N+W) → concave1 NW', () => {
      const tiles = getShoreTiles(10);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
    });

    it('mask=18 (N+E) → concave3 NE', () => {
      const tiles = getShoreTiles(18);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 3, direction: 'NE' });
    });

    it('mask=72 (S+W) → concave6 SW', () => {
      const tiles = getShoreTiles(72);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 6, direction: 'SW' });
    });

    it('mask=80 (S+E) → concave8 SE', () => {
      const tiles = getShoreTiles(80);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 8, direction: 'SE' });
    });
  });

  describe('getShoreTiles - edge pairs (non-quadrant, single-edge priority)', () => {
    it('mask=3 (NW+N) → concave2 N', () => {
      const tiles = getShoreTiles(3);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 2, direction: 'N' });
    });

    it('mask=6 (N+NE) → concave2 N', () => {
      const tiles = getShoreTiles(6);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 2, direction: 'N' });
    });

    it('mask=20 (NE+E) → concave5 E', () => {
      const tiles = getShoreTiles(20);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
    });

    it('mask=24 (W+E) → both straights [E, W] (multi-overlay)', () => {
      const tiles = getShoreTiles(24);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 4, direction: 'W' });
    });

    it('mask=40 (SW+W) → concave4 W', () => {
      const tiles = getShoreTiles(40);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 4, direction: 'W' });
    });

    it('mask=96 (S+SW) → concave7 S', () => {
      const tiles = getShoreTiles(96);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 7, direction: 'S' });
    });

    it('mask=144 (E+SE) → concave5 E', () => {
      const tiles = getShoreTiles(144);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
    });

    it('mask=192 (SE+S) → concave7 S', () => {
      const tiles = getShoreTiles(192);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 7, direction: 'S' });
    });
  });

  describe('getShoreTiles - mixed edge+diagonal pairs', () => {
    it('mask=17 (NW+E) → convex1 NW + concave5 E (flank-free diagonal stacks under band)', () => {
      const tiles = getShoreTiles(17);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 5, direction: 'E' });
    });

    it('mask=12 (NE+W) → convex2 NE + concave4 W (flank-free diagonal stacks under band)', () => {
      const tiles = getShoreTiles(12);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 4, direction: 'W' });
    });

    it('mask=48 (E+SW) → convex4 SW + concave5 E (flank-free diagonal stacks under band)', () => {
      const tiles = getShoreTiles(48);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 5, direction: 'E' });
    });

    it('mask=66 (N+S) → both straights [N, S] (multi-overlay)', () => {
      const tiles = getShoreTiles(66);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'concave', index: 2, direction: 'N' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 7, direction: 'S' });
    });
  });

  describe('getShoreTiles - diagonal-only pairs', () => {
    it('mask=5 (NW+NE) → both corners [NW, NE] (multi-overlay)', () => {
      const tiles = getShoreTiles(5);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
    });

    it('mask=33 (SW+NW) → both corners [NW, SW] (multi-overlay)', () => {
      const tiles = getShoreTiles(33);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
    });

    it('mask=129 (NW+SE) → both corners [NW, SE] (multi-overlay)', () => {
      const tiles = getShoreTiles(129);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 3, direction: 'SE' });
    });

    it('mask=36 (NE+SW) → both corners [NE, SW] (multi-overlay)', () => {
      const tiles = getShoreTiles(36);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
    });

    it('mask=132 (NE+SE) → both corners [NE, SE] (multi-overlay)', () => {
      const tiles = getShoreTiles(132);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 3, direction: 'SE' });
    });

    it('mask=160 (SW+SE) → both corners [SW, SE] (multi-overlay)', () => {
      const tiles = getShoreTiles(160);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 3, direction: 'SE' });
    });
  });

  describe('getShoreTiles - three-way combinations', () => {
    it('mask=7 (NW+N+NE) → concave2 N', () => {
      const tiles = getShoreTiles(7);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 2, direction: 'N' });
    });

    it('mask=14 (N+NE+W) → concave1 NW (N&W quadrant wins)', () => {
      const tiles = getShoreTiles(14);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
    });

    it('mask=28 (NE+W+E) → opposite straights [E, W] (NE suppressed by E flank)', () => {
      const tiles = getShoreTiles(28);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 4, direction: 'W' });
    });

    it('mask=22 (N+NE+E) → concave3 NE (N&E quadrant wins)', () => {
      const tiles = getShoreTiles(22);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 3, direction: 'NE' });
    });

    it('mask=11 (NW+N+W) → concave1 NW (N&W quadrant wins)', () => {
      const tiles = getShoreTiles(11);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
    });

    it('mask=15 (NW+N+NE+W) → concave1 NW (N&W quadrant wins)', () => {
      const tiles = getShoreTiles(15);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
    });

    it('mask=31 (NW+N+NE+W+E) → NW pair + lone E straight (multi-overlay)', () => {
      const tiles = getShoreTiles(31);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
    });

    it('mask=104 (S+SW+W) → concave6 SW (S&W quadrant wins)', () => {
      const tiles = getShoreTiles(104);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 6, direction: 'SW' });
    });

    it('mask=41 (SW+W+NW) → concave4 W (single edge W)', () => {
      const tiles = getShoreTiles(41);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 4, direction: 'W' });
    });

    it('mask=208 (E+SE+S) → concave8 SE (S&E quadrant wins)', () => {
      const tiles = getShoreTiles(208);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 8, direction: 'SE' });
    });

    it('mask=224 (SE+S+SW) → concave7 S (single edge S)', () => {
      const tiles = getShoreTiles(224);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 7, direction: 'S' });
    });

    it('mask=148 (NE+E+SE) → concave5 E (single edge E)', () => {
      const tiles = getShoreTiles(148);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ type: 'concave', index: 5, direction: 'E' });
    });
  });

  describe('getShoreTiles - four+ direction masks', () => {
    it('mask=90 (N+E+S+W) → two disjoint L-pairs [NW, SE] (multi-overlay)', () => {
      const tiles = getShoreTiles(90);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 8, direction: 'SE' });
    });

    it('mask=165 (4 diagonals) → all four corners ascending bit order (multi-overlay)', () => {
      const tiles = getShoreTiles(165);
      expect(tiles).toHaveLength(4);
      expect(tiles[0]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
      expect(tiles[2]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
      expect(tiles[3]).toEqual({ type: 'convex', index: 3, direction: 'SE' });
    });

    it('mask=255 (full ring) → two disjoint L-pairs [NW, SE], diagonals suppressed (multi-overlay)', () => {
      const tiles = getShoreTiles(255);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 8, direction: 'SE' });
    });
  });

  // ── Multi-overlay decomposition contract ─────────────────────────────
  // Complex masks decompose into ORDERED overlay sets:
  //   [convex corners (asc bit NW,NE,SW,SE)] → [straights (N,E,S,W)] → [L-pairs]
  // Rationale: shore PNGs are fully opaque; sequential drawing is last-wins,
  // so the widest-coverage texture (quadrant L) draws last and dominates
  // visually, while the full deterministic set stays available to the API,
  // debug tooling and any future transparent variants.
  describe('getShoreTiles - multi-overlay decomposition', () => {
    it('is deterministic for complex masks (same input -> same array)', () => {
      expect(getShoreTiles(90)).toEqual(getShoreTiles(90));
      expect(getShoreTiles(255)).toEqual(getShoreTiles(255));
      expect(getShoreTiles(82)).toEqual(getShoreTiles(82));
    });

    it('emits no duplicate type+index entries (mask=255)', () => {
      const tiles = getShoreTiles(255);
      const keys = tiles.map((t) => `${t.type}:${t.index}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('orders corners before straights before L-pairs (mask=N+E+SW)', () => {
      // N+E form the NE quadrant pair; SW diagonal flanks are absent -> convex.
      const tiles = getShoreTiles(Direction.N | Direction.E | Direction.SW);
      expect(tiles).toEqual([
        { type: 'convex', index: 4, direction: 'SW' },
        { type: 'concave', index: 3, direction: 'NE' },
      ]);
    });

    it('opposite pair N+S emits both straights in N,E,S,W order', () => {
      expect(getShoreTiles(Direction.N | Direction.S)).toEqual([
        { type: 'concave', index: 2, direction: 'N' },
        { type: 'concave', index: 7, direction: 'S' },
      ]);
    });

    it('opposite pair E+W emits both straights', () => {
      expect(getShoreTiles(Direction.E | Direction.W)).toEqual([
        { type: 'concave', index: 5, direction: 'E' },
        { type: 'concave', index: 4, direction: 'W' },
      ]);
    });

    it('triple N+E+S (bay open south): NE pair + S straight', () => {
      expect(getShoreTiles(Direction.N | Direction.E | Direction.S)).toEqual([
        { type: 'concave', index: 7, direction: 'S' },
        { type: 'concave', index: 3, direction: 'NE' },
      ]);
    });

    it('triple N+E+W: NW pair + E straight', () => {
      expect(getShoreTiles(Direction.N | Direction.E | Direction.W)).toEqual([
        { type: 'concave', index: 5, direction: 'E' },
        { type: 'concave', index: 1, direction: 'NW' },
      ]);
    });

    it('quad cardinals: two disjoint L-pairs [NW, SE]', () => {
      expect(
        getShoreTiles(Direction.N | Direction.E | Direction.S | Direction.W),
      ).toEqual([
        { type: 'concave', index: 1, direction: 'NW' },
        { type: 'concave', index: 8, direction: 'SE' },
      ]);
    });

    it('full ring (all 8 land neighbours): two disjoint L-pairs, diagonals suppressed', () => {
      expect(getShoreTiles(255)).toEqual([
        { type: 'concave', index: 1, direction: 'NW' },
        { type: 'concave', index: 8, direction: 'SE' },
      ]);
    });

    it('all four diagonals emit all four convex corners ascending by bit', () => {
      expect(getShoreTiles(165)).toEqual([
        { type: 'convex', index: 1, direction: 'NW' },
        { type: 'convex', index: 2, direction: 'NE' },
        { type: 'convex', index: 4, direction: 'SW' },
        { type: 'convex', index: 3, direction: 'SE' },
      ]);
    });

    it('cardinal + non-flanking diagonal stacks convex under straight (N+SW)', () => {
      expect(getShoreTiles(Direction.N | Direction.SW)).toEqual([
        { type: 'convex', index: 4, direction: 'SW' },
        { type: 'concave', index: 2, direction: 'N' },
      ]);
    });
  });

  describe('rule registration', () => {
    it('should register and retrieve custom rules', () => {
      registerShoreRule({
        mask: 3,
        concave: [1, 2],
        convex: [1],
      });
      const rule = getShoreRule(3);
      expect(rule).toBeDefined();
      expect(rule?.concave).toEqual([1, 2]);
      expect(rule?.convex).toEqual([1]);
    });

    it('should use custom rules in getShoreTiles', () => {
      registerShoreRule({
        mask: 5,
        concave: [1, 3],
        convex: [1, 2],
      });
      const tiles = getShoreTiles(5);
      expect(tiles).toHaveLength(4);
      expect(tiles[0]).toEqual({ type: 'concave', index: 1, direction: 'NW' });
      expect(tiles[1]).toEqual({ type: 'concave', index: 3, direction: 'NE' });
      expect(tiles[2]).toEqual({ type: 'convex', index: 1, direction: 'NW' });
      expect(tiles[3]).toEqual({ type: 'convex', index: 2, direction: 'NE' });
    });

    it('should map convex idx3=SE and idx4=SW with new direction mapping', () => {
      registerShoreRule({
        mask: 5,
        concave: [],
        convex: [3, 4],
      });
      const tiles = getShoreTiles(5);
      expect(tiles).toHaveLength(2);
      expect(tiles[0]).toEqual({ type: 'convex', index: 3, direction: 'SE' });
      expect(tiles[1]).toEqual({ type: 'convex', index: 4, direction: 'SW' });
    });

    it('should clear all rules', () => {
      registerShoreRule({ mask: 3, concave: [1], convex: [] });
      clearShoreRules();
      expect(getShoreRule(3)).toBeUndefined();
    });
  });
});
