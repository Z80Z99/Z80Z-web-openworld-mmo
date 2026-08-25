/**
 * preview-renderer — Canvas-based preview of the shore tile composition pipeline.
 *
 * Three modes: raw terrain, shore overlay, final composite.
 * Display-only; no click handling.
 */

import type { ShoreTextures } from './texture-loader.js';
import type { ShoreTile } from '@mmo/shared';

// ── Types ────────────────────────────────────────────────────────────────────

export type PreviewMode = 'raw' | 'shore' | 'final';

export interface PreviewRendererOptions {
  container: HTMLElement;
  cellSize?: number;
  gridSize?: number;
}

export interface PreviewRenderer {
  canvas: HTMLCanvasElement;
  setMode(mode: PreviewMode): void;
  setTerrain(grid: ('land' | 'water')[][]): void;
  setShoreTiles(tiles: { type: 'concave' | 'convex'; index: number }[]): void;
  setTextures(textures: ShoreTextures): void;
  render(): void;
  destroy(): void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const LAND_COLOR = '#E8913A';
const WATER_COLOR = '#3A7BE8';
const BG_COLOR = '#1a1a1a';

const MODE_LABELS: Record<PreviewMode, string> = {
  raw: '原始地形',
  shore: '海岸叠加',
  final: '最终效果',
};

const PIPELINE_ORDER: PreviewMode[] = ['raw', 'shore', 'final'];

// ── Factory ──────────────────────────────────────────────────────────────────

export function createPreviewRenderer(
  options: PreviewRendererOptions,
): PreviewRenderer {
  const cellSize = options.cellSize ?? 48;
  const gridSize = options.gridSize ?? 3;
  const canvasSize = gridSize * cellSize;

  // ── State ────────────────────────────────────────────────────────────────
  let mode: PreviewMode = 'raw';
  let terrain: ('land' | 'water')[][] = [];
  let shoreTiles: ShoreTile[] = [];
  let textures: ShoreTextures | null = null;

  // ── Canvas ───────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  canvas.style.background = BG_COLOR;
  options.container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  // ── Pipeline bar (below canvas) ──────────────────────────────────────────
  const pipelineBar = document.createElement('div');
  pipelineBar.style.cssText =
    'display:flex;align-items:center;gap:8px;margin-top:8px;font-family:monospace;font-size:13px;color:#fff;';
  options.container.appendChild(pipelineBar);

  const pipelineButtons: HTMLButtonElement[] = [];

  for (let i = 0; i < PIPELINE_ORDER.length; i++) {
    const m = PIPELINE_ORDER[i];
    const btn = document.createElement('button');
    btn.textContent = MODE_LABELS[m];
    btn.dataset.mode = m;
    btn.style.cssText =
      'padding:4px 10px;border:1px solid #555;border-radius:4px;background:#2a2a2a;color:#ccc;cursor:pointer;font-family:monospace;font-size:12px;';
    btn.addEventListener('click', () => {
      setMode(m);
    });
    pipelineBar.appendChild(btn);
    pipelineButtons.push(btn);

    if (i < PIPELINE_ORDER.length - 1) {
      const arrow = document.createElement('span');
      arrow.textContent = ' → ';
      arrow.style.color = '#666';
      pipelineBar.appendChild(arrow);
    }
  }

  function updatePipelineHighlight(): void {
    for (const btn of pipelineButtons) {
      const isActive = btn.dataset.mode === mode;
      btn.style.background = isActive ? '#4a9eff' : '#2a2a2a';
      btn.style.color = isActive ? '#fff' : '#ccc';
      btn.style.borderColor = isActive ? '#4a9eff' : '#555';
    }
  }

  // ── Drawing helpers ──────────────────────────────────────────────────────

  function drawTerrain(): void {
    if (terrain.length === 0) return;
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cell = terrain[row]?.[col];
        ctx.fillStyle = cell === 'water' ? WATER_COLOR : LAND_COLOR;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }

  function drawShoreTextures(opaque: boolean): void {
    if (!textures || shoreTiles.length === 0) return;

    // Draw on the center cell (gridSize/2, gridSize/2)
    const cx = Math.floor(gridSize / 2) * cellSize;
    const cy = Math.floor(gridSize / 2) * cellSize;

    if (!opaque) {
      ctx.clearRect(cx, cy, cellSize, cellSize);
    }

    for (const tile of shoreTiles) {
      let img: HTMLImageElement | undefined;
      if (tile.type === 'concave') {
        img = textures.concave.get(tile.index);
      } else {
        img = textures.convex.get(tile.index);
      }
      if (img) {
        ctx.drawImage(img, cx, cy, cellSize, cellSize);
      }
    }
  }

  function drawCenterCellBackground(): void {
    if (terrain.length === 0) return;
    const row = Math.floor(gridSize / 2);
    const col = Math.floor(gridSize / 2);
    const cell = terrain[row]?.[col];
    ctx.fillStyle = cell === 'water' ? WATER_COLOR : LAND_COLOR;
    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function setMode(m: PreviewMode): void {
    mode = m;
    updatePipelineHighlight();
    render();
  }

  function setTerrain(grid: ('land' | 'water')[][]): void {
    terrain = grid;
    render();
  }

  function setShoreTiles(tiles: { type: 'concave' | 'convex'; index: number }[]): void {
    shoreTiles = tiles as ShoreTile[];
    render();
  }

  function setTextures(t: ShoreTextures): void {
    textures = t;
    render();
  }

  function render(): void {
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    switch (mode) {
      case 'raw':
        drawTerrain();
        break;
      case 'shore':
        drawCenterCellBackground();
        drawShoreTextures(false);
        break;
      case 'final':
        drawTerrain();
        drawShoreTextures(true);
        break;
    }
  }

  function destroy(): void {
    canvas.remove();
    pipelineBar.remove();
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  updatePipelineHighlight();

  return {
    canvas,
    setMode,
    setTerrain,
    setShoreTiles,
    setTextures,
    render,
    destroy,
  };
}
