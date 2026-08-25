import {
  DIRECTION_NAMES,
  getActiveDirections,
  maskToBinary,
  getNeighborsFromMask,
  getMaskFromNeighbors,
} from '@mmo/shared';

export interface NeighborEditorOptions {
  container: HTMLElement;
  cellSize?: number;
  onMaskChange?: (mask: number, neighbors: boolean[]) => void;
}

export interface NeighborEditor {
  canvas: HTMLCanvasElement;
  getMask(): number;
  getNeighbors(): boolean[];
  setNeighbors(neighbors: boolean[]): void;
  setMask(mask: number): void;
  getInfo(): {
    mask: number;
    binary: string;
    directions: string[];
    activeDirections: string[];
  };
  destroy(): void;
}

const LAND_COLOR = '#E8913A';
const WATER_COLOR = '#3A7BE8';
const CENTER_COLOR = '#666';
const BORDER_COLOR = '#555';
const TEXT_COLOR = '#fff';

// Grid position → neighbor index mapping
// Row 0: NW(0) N(1) NE(2) | Row 1: W(3) C(-1) E(4) | Row 2: SW(5) S(6) SE(7)
const GRID_TO_INDEX: number[][] = [
  [0, 1, 2],
  [3, -1, 4],
  [5, 6, 7],
];

export function createNeighborEditor(options: NeighborEditorOptions): NeighborEditor {
  const cellSize = options.cellSize ?? 64;
  const infoHeight = 60; // space for info text below grid

  const canvas = document.createElement('canvas');
  canvas.width = 3 * cellSize;
  canvas.height = 3 * cellSize + infoHeight;
  canvas.style.display = 'block';
  canvas.style.cursor = 'pointer';
  options.container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  const neighbors: boolean[] = [false, false, false, false, false, false, false, false];
  let flashCell = -1;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function computeMask(): number {
    return getMaskFromNeighbors(neighbors);
  }

  function render(): void {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const idx = GRID_TO_INDEX[row][col];
        const x = col * cellSize;
        const y = row * cellSize;
        const isCenter = idx === -1;

        // Cell fill
        if (isCenter) {
          ctx.fillStyle = CENTER_COLOR;
        } else if (neighbors[idx]) {
          ctx.fillStyle = LAND_COLOR;
        } else {
          ctx.fillStyle = WATER_COLOR;
        }

        // Flash effect
        if (!isCenter && idx === flashCell) {
          ctx.fillStyle = '#fff';
        }

        ctx.fillRect(x, y, cellSize, cellSize);

        // Border
        ctx.strokeStyle = BORDER_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2);

        // Direction label (top-left)
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `bold ${Math.max(10, cellSize / 5)}px monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const label = isCenter ? 'C' : DIRECTION_NAMES[idx];
        ctx.fillText(label, x + 4, y + 4);

        // State text (center)
        ctx.fillStyle = TEXT_COLOR;
        ctx.font = `${Math.max(10, cellSize / 4)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = isCenter ? 'C' : (neighbors[idx] ? '陆地' : '水域');
        ctx.fillText(text, x + cellSize / 2, y + cellSize / 2 + 6);
      }
    }

    // Info text below grid
    const mask = computeMask();
    const y0 = 3 * cellSize + 4;
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`遮罩: ${mask}`, 4, y0);
    ctx.fillText(`二进制: ${maskToBinary(mask)}`, 4, y0 + 16);
    const active = getActiveDirections(mask);
    ctx.fillText(`激活方向: ${active.length > 0 ? active.join(', ') : '无'}`, 4, y0 + 32);
  }

  function handleFlash(idx: number): void {
    flashCell = idx;
    render();
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashCell = -1;
      render();
      flashTimer = null;
    }, 120);
  }

  function handleClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);

    if (row < 0 || row > 2 || col < 0 || col > 2) return;

    const idx = GRID_TO_INDEX[row][col];
    if (idx === -1) return; // center — ignore

    neighbors[idx] = !neighbors[idx];
    handleFlash(idx);

    options.onMaskChange?.(computeMask(), [...neighbors]);
  }

  canvas.addEventListener('click', handleClick);
  render();

  return {
    canvas,

    getMask(): number {
      return computeMask();
    },

    getNeighbors(): boolean[] {
      return [...neighbors];
    },

    setNeighbors(n: boolean[]): void {
      for (let i = 0; i < 8; i++) {
        neighbors[i] = n[i] ?? false;
      }
      render();
    },

    setMask(mask: number): void {
      const n = getNeighborsFromMask(mask);
      for (let i = 0; i < 8; i++) {
        neighbors[i] = n[i];
      }
      render();
    },

    getInfo() {
      const mask = computeMask();
      return {
        mask,
        binary: maskToBinary(mask),
        directions: [...DIRECTION_NAMES],
        activeDirections: getActiveDirections(mask),
      };
    },

    destroy(): void {
      canvas.removeEventListener('click', handleClick);
      if (flashTimer) clearTimeout(flashTimer);
      canvas.remove();
    },
  };
}
