/**
 * terrain-grid — 7×7 Canvas-based terrain editing grid.
 *
 * Pure Canvas 2D, no PixiJS. Each cell is Land (orange) or Water (blue).
 * Click toggles; mask values computed from 8-neighbor bitmask.
 */

import { Direction } from '@mmo/shared';

// ── Types ──────────────────────────────────────────────────────────

export type CellState = 'land' | 'water';

export interface TerrainGridOptions {
  container: HTMLElement;
  size?: number;
  cellSize?: number;
  onCellClick?: (row: number, col: number, state: CellState) => void;
  onCellHover?: (row: number, col: number) => void;
}

export interface TerrainGrid {
  canvas: HTMLCanvasElement;
  getGrid(): CellState[][];
  setCell(row: number, col: number, state: CellState): void;
  setGrid(grid: CellState[][]): void;
  getMaskAt(row: number, col: number): number;
  destroy(): void;
}

// ── Colors ─────────────────────────────────────────────────────────

const COLORS = {
  land: '#E8913A',
  water: '#3A7BE8',
  bg: '#1a1a2e',
  border: '#333',
  hoverBorder: '#fff',
  gridLine: '#444',
  maskText: '#fff',
} as const;

// Neighbor offsets in mask order: NW, N, NE, W, E, SW, S, SE
const NEIGHBOR_BITS: readonly [number, number, number][] = [
  [-1, -1, Direction.NW],
  [-1,  0, Direction.N],
  [-1,  1, Direction.NE],
  [ 0, -1, Direction.W],
  [ 0,  1, Direction.E],
  [ 1, -1, Direction.SW],
  [ 1,  0, Direction.S],
  [ 1,  1, Direction.SE],
];

// ── Helpers ────────────────────────────────────────────────────────

function makeEmptyGrid(size: number): CellState[][] {
  return Array.from({ length: size }, () => Array(size).fill('land') as CellState[]);
}

function computeMask(grid: CellState[][], row: number, col: number): number {
  const size = grid.length;
  let mask = 0;
  for (const [dr, dc, bit] of NEIGHBOR_BITS) {
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < size && c >= 0 && c < size && grid[r][c] === 'land') {
      mask |= bit;
    }
  }
  return mask;
}

function rebuildMasks(grid: CellState[][]): number[][] {
  const size = grid.length;
  const masks = Array.from({ length: size }, () => Array(size).fill(0));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      masks[r][c] = computeMask(grid, r, c);
    }
  }
  return masks;
}

// ── Factory ────────────────────────────────────────────────────────

export function createTerrainGrid(options: TerrainGridOptions): TerrainGrid {
  const {
    container,
    size = 7,
    cellSize = 48,
    onCellClick,
    onCellHover,
  } = options;

  let grid: CellState[][] = makeEmptyGrid(size);
  let masks: number[][] = rebuildMasks(grid);
  let hoverRow = -1;
  let hoverCol = -1;
  let rafId = 0;

  // Canvas setup
  const canvas = document.createElement('canvas');
  canvas.width = size * cellSize;
  canvas.height = size * cellSize;
  canvas.style.background = COLORS.bg;
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  // ── Rendering ──────────────────────────────────────────────────

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const x = c * cellSize;
        const y = r * cellSize;
        const isHovered = r === hoverRow && c === hoverCol;

        // Cell fill
        ctx.fillStyle = grid[r][c] === 'land' ? COLORS.land : COLORS.water;
        ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

        // Border
        ctx.strokeStyle = isHovered ? COLORS.hoverBorder : COLORS.border;
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

        // Mask text
        ctx.fillStyle = COLORS.maskText;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(masks[r][c]), x + cellSize / 2, y + cellSize / 2);
      }
    }

    // Grid lines
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i++) {
      const pos = i * cellSize;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(canvas.width, pos);
      ctx.stroke();
    }
  }

  function scheduleRender() {
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        draw();
      });
    }
  }

  // ── Cell lookup ────────────────────────────────────────────────

  function cellAt(clientX: number, clientY: number): [number, number] | null {
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((clientX - rect.left) / cellSize);
    const row = Math.floor((clientY - rect.top) / cellSize);
    if (row >= 0 && row < size && col >= 0 && col < size) return [row, col];
    return null;
  }

  // ── Event handlers ────────────────────────────────────────────

  function handleClick(e: MouseEvent) {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    const [row, col] = cell;
    grid[row][col] = grid[row][col] === 'land' ? 'water' : 'land';
    masks = rebuildMasks(grid);
    scheduleRender();
    onCellClick?.(row, col, grid[row][col]);
  }

  function handleMouseMove(e: MouseEvent) {
    const cell = cellAt(e.clientX, e.clientY);
    const [r, c] = cell ?? [-1, -1];
    if (r !== hoverRow || c !== hoverCol) {
      hoverRow = r;
      hoverCol = c;
      scheduleRender();
      if (cell) onCellHover?.(r, c);
    }
  }

  function handleMouseLeave() {
    hoverRow = -1;
    hoverCol = -1;
    scheduleRender();
  }

  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseleave', handleMouseLeave);

  // Initial render
  scheduleRender();

  // ── Public API ────────────────────────────────────────────────

  return {
    canvas,

    getGrid(): CellState[][] {
      return grid.map((row) => [...row]);
    },

    setCell(row: number, col: number, state: CellState) {
      if (row < 0 || row >= size || col < 0 || col >= size) return;
      grid[row][col] = state;
      masks = rebuildMasks(grid);
      scheduleRender();
    },

    setGrid(newGrid: CellState[][]) {
      grid = newGrid.map((row) => [...row]);
      masks = rebuildMasks(grid);
      scheduleRender();
    },

    getMaskAt(row: number, col: number): number {
      if (row < 0 || row >= size || col < 0 || col >= size) return 0;
      return masks[row][col];
    },

    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.remove();
    },
  };
}
