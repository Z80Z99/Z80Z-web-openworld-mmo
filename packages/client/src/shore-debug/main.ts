/**
 * shore-debug main — entry point that wires all debug components together.
 *
 * Pure Canvas 2D + DOM, no PixiJS. Builds layout, initializes components,
 * and routes events between them.
 */

import { getShoreTiles, maskToBinary, getActiveDirections } from '@mmo/shared';
import { loadShoreTextures } from './texture-loader.js';
import { createTerrainGrid, type CellState } from './terrain-grid.js';
import { createNeighborEditor } from './neighbor-editor.js';
import { createPreviewRenderer } from './preview-renderer.js';
import { generateAllTestCases, getTestCase, getTestCaseCount } from './test-generator.js';
import { createRuleEditor } from './rule-editor.js';
import { createDebugInfo, type DebugInfoData } from './debug-info.js';

// ── Helpers ────────────────────────────────────────────────────────

const NEIGHBOR_OFFSETS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1],
];
const DIR_NAMES = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'];

const btn = (label: string, parent: HTMLElement): HTMLButtonElement => {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'padding:6px 14px;border:1px solid #555;border-radius:4px;background:#2a2a2a;color:#ccc;cursor:pointer;font-family:monospace;font-size:13px;';
  parent.appendChild(b);
  return b;
};

// ── Build layout ───────────────────────────────────────────────────

const root = document.getElementById('app') ?? document.body;

const toolbar = document.createElement('div');
toolbar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#16213e;';
root.appendChild(toolbar);

const mainRow = document.createElement('div');
mainRow.style.cssText = 'display:flex;gap:8px;padding:8px;min-height:400px;';
root.appendChild(mainRow);

const gridPanel = document.createElement('div');
gridPanel.style.cssText = 'flex:0 0 auto;';
mainRow.appendChild(gridPanel);

const editorPanel = document.createElement('div');
editorPanel.style.cssText = 'flex:0 0 auto;';
mainRow.appendChild(editorPanel);

const previewPanel = document.createElement('div');
previewPanel.style.cssText = 'flex:1 1 auto;min-width:200px;';
mainRow.appendChild(previewPanel);

const statusBar = document.createElement('div');
statusBar.style.cssText =
  'padding:6px 10px;background:#16213e;color:#aaa;font:12px monospace;border-top:1px solid #333;';
root.appendChild(statusBar);

// Debug tooltip goes into a detached container (it uses position:fixed internally)
const debugContainer = document.createElement('div');
root.appendChild(debugContainer);

// ── Toolbar buttons ────────────────────────────────────────────────

const btnNew = btn('新建测试', toolbar);
const btnGenAll = btn('生成全部测试', toolbar);
const btnPrev = btn('上一个', toolbar);
const btnNext = btn('下一个', toolbar);
const btnSep = document.createElement('span');
btnSep.style.cssText = 'width:1px;background:#444;margin:0 4px;';
toolbar.appendChild(btnSep);
const btnSave = btn('保存规则', toolbar);
const btnReset = btn('重置规则', toolbar);
const btnExport = btn('导出规则', toolbar);

// ── State ──────────────────────────────────────────────────────────

let selectedRow = 3;
let selectedCol = 3;
let testCaseIndex = -1;
let testCases: ReturnType<typeof generateAllTestCases> = [];

// ── Derived state helpers ──────────────────────────────────────────

function computeMask(): number {
  return terrainGrid.getMaskAt(selectedRow, selectedCol);
}

function computeShoreTiles(mask: number) {
  return getShoreTiles(mask);
}

// ── Forward declarations (set after component creation) ────────────

let syncNeighborEditor: () => void;
let syncPreview: () => void;
let syncStatusBar: () => void;
let syncDebugInfo: (row: number, col: number) => void;
let applyTestCase: (index: number) => void;

// ── Create components ──────────────────────────────────────────────

const terrainGrid = createTerrainGrid({
  container: gridPanel,
  size: 7,
  cellSize: 48,
  onCellClick(row: number, col: number) {
    selectedRow = row;
    selectedCol = col;
    syncNeighborEditor();
    syncPreview();
    syncStatusBar();
  },
  onCellHover(row: number, col: number) {
    syncDebugInfo(row, col);
  },
});

const neighborEditor = createNeighborEditor({
  container: editorPanel,
  cellSize: 64,
  onMaskChange() {
    syncPreview();
    syncStatusBar();
  },
});

const preview = createPreviewRenderer({
  container: previewPanel,
  cellSize: 48,
  gridSize: 3,
});

const ruleEditor = createRuleEditor({
  container: editorPanel,
  cellSize: 48,
  onRuleChange() {
    syncPreview();
  },
});

const debugInfo = createDebugInfo({ container: debugContainer });

// ── Sync functions ─────────────────────────────────────────────────

syncNeighborEditor = (): void => {
  const mask = computeMask();
  neighborEditor.setMask(mask);
};

syncPreview = (): void => {
  const mask = computeMask();
  preview.setTerrain(terrainGrid.getGrid());
  preview.setShoreTiles(computeShoreTiles(mask));
  preview.render();
};

syncStatusBar = (): void => {
  const mask = computeMask();
  const binary = maskToBinary(mask);
  const active = getActiveDirections(mask);
  const tiles = computeShoreTiles(mask);
  const concave = tiles.filter((t) => t.type === 'concave').map((t) => `shore${t.index}`);
  const convex = tiles.filter((t) => t.type === 'convex').map((t) => `convex-shore${t.index}`);
  const selected = [...concave, ...convex];
  statusBar.textContent =
    `遮罩: ${mask}  二进制: ${binary}  激活方向: ${active.join(', ') || '无'}  ` +
    `选中: ${selected.join(', ') || '无'}`;
};

syncDebugInfo = (row: number, col: number): void => {
  const mask = terrainGrid.getMaskAt(row, col);
  const grid = terrainGrid.getGrid();
  const nbs = NEIGHBOR_OFFSETS.map(([dr, dc], i) => {
    const r = row + dr;
    const c = col + dc;
    const inBounds = r >= 0 && r < grid.length && c >= 0 && c < grid.length;
    return { name: DIR_NAMES[i], active: inBounds ? grid[r][c] === 'land' : false };
  });
  const neighborsObj = Object.fromEntries(nbs.map((n) => [n.name, n.active])) as DebugInfoData['neighbors'];
  const tiles = computeShoreTiles(mask);
  debugInfo.update({
    x: col,
    y: row,
    terrain: grid[row][col],
    neighbors: neighborsObj,
    mask,
    selectedConcave: tiles.filter((t) => t.type === 'concave').map((t) => t.index),
    selectedConvex: tiles.filter((t) => t.type === 'convex').map((t) => t.index),
  });
};

applyTestCase = (index: number): void => {
  if (index < 0 || index >= getTestCaseCount()) return;
  testCaseIndex = index;
  const tc = getTestCase(index);
  const grid: CellState[][] = Array.from({ length: 7 }, () => Array(7).fill('land') as CellState[]);
  grid[3][3] = 'water';
  for (let i = 0; i < 8; i++) {
    const [dr, dc] = NEIGHBOR_OFFSETS[i];
    grid[3 + dr][3 + dc] = tc.neighbors[i] ? 'land' : 'water';
  }
  terrainGrid.setGrid(grid);
  selectedRow = 3;
  selectedCol = 3;
  syncNeighborEditor();
  syncPreview();
  syncStatusBar();
  syncDebugInfo(selectedRow, selectedCol);
};

// ── Button handlers ────────────────────────────────────────────────

btnNew.addEventListener('click', () => {
  testCaseIndex = -1;
  terrainGrid.setGrid(
    Array.from({ length: 7 }, () => Array(7).fill('land') as CellState[]),
  );
  selectedRow = 3;
  selectedCol = 3;
  syncNeighborEditor();
  syncPreview();
  syncStatusBar();
  syncDebugInfo(selectedRow, selectedCol);
});

btnGenAll.addEventListener('click', () => {
  testCases = generateAllTestCases();
  if (testCases.length > 0) applyTestCase(0);
});

btnPrev.addEventListener('click', () => {
  if (testCases.length === 0) return;
  const idx = testCaseIndex <= 0 ? testCases.length - 1 : testCaseIndex - 1;
  applyTestCase(idx);
});

btnNext.addEventListener('click', () => {
  if (testCases.length === 0) return;
  const idx = testCaseIndex >= testCases.length - 1 ? 0 : testCaseIndex + 1;
  applyTestCase(idx);
});

btnSave.addEventListener('click', () => ruleEditor.saveRules());
btnReset.addEventListener('click', () => { ruleEditor.resetRule(); syncPreview(); });
btnExport.addEventListener('click', () => {
  const json = ruleEditor.exportRules();
  navigator.clipboard?.writeText(json);
  alert('规则已导出到剪贴板！');
});

// ── Init ───────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const result = await loadShoreTextures();
  preview.setTextures(result.textures);
  if (result.missing.length > 0) {
    console.warn('[shore-debug] Missing textures:', result.missing);
  }
  ruleEditor.setMask(0);
  syncPreview();
  syncStatusBar();
  syncDebugInfo(selectedRow, selectedCol);
}

init();
