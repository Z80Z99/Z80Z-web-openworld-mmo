import { maskToBinary, getActiveDirections } from '@mmo/shared';

// ── Types ──────────────────────────────────────────────────────────

export interface DebugInfoOptions {
  container: HTMLElement;
}

export interface DebugInfo {
  element: HTMLElement;
  update(info: DebugInfoData): void;
  clear(): void;
  destroy(): void;
}

export interface DebugInfoData {
  x: number;
  y: number;
  terrain: 'land' | 'water';
  neighbors: {
    NW: boolean;
    N: boolean;
    NE: boolean;
    W: boolean;
    E: boolean;
    SW: boolean;
    S: boolean;
    SE: boolean;
  };
  mask: number;
  selectedConcave: number[];
  selectedConvex: number[];
}

// ── Styles ─────────────────────────────────────────────────────────

const STYLES = `
  position: fixed;
  z-index: 1000;
  background: #2a2a3e;
  border: 1px solid #444;
  color: #fff;
  font-family: monospace;
  font-size: 12px;
  padding: 8px 10px;
  pointer-events: none;
  white-space: pre;
  line-height: 1.4;
`;

const HEADER_STYLE = 'font-weight: bold; font-size: 13px; margin-top: 6px;';
const LAND_STYLE = 'color: #E8913A;';
const WATER_STYLE = 'color: #3A7BE8;';

// ── Factory ────────────────────────────────────────────────────────

export function createDebugInfo(options: DebugInfoOptions): DebugInfo {
  const { container } = options;

  const element = document.createElement('div');
  element.style.cssText = STYLES;
  container.appendChild(element);

  function update(info: DebugInfoData): void {
    const terrainStyle = info.terrain === 'land' ? LAND_STYLE : WATER_STYLE;
    const terrainText = info.terrain === 'land' ? '陆地' : '水域';

    const n = info.neighbors;
    const row1 = `NW=${bool(n.NW)}  N=${bool(n.N)}   NE=${bool(n.NE)}`;
    const row2 = `W=${bool(n.W)}   [${info.terrain === 'land' ? 'C' : '~'}]   E=${bool(n.E)}`;
    const row3 = `SW=${bool(n.SW)}  S=${bool(n.S)}   SE=${bool(n.SE)}`;

    const binary = maskToBinary(info.mask);
    const active = getActiveDirections(info.mask);
    const activeText = active.length > 0 ? active.join(', ') : '无';

    const concaveText = info.selectedConcave.length > 0
      ? info.selectedConcave.map((i) => `shore${i}`).join(', ')
      : '无';
    const convexText = info.selectedConvex.length > 0
      ? info.selectedConvex.map((i) => `convex-shore${i}`).join(', ')
      : '无';

    element.innerHTML = `
<span style="${HEADER_STYLE}">位置</span>
  X: ${info.x}  Y: ${info.y}

<span style="${HEADER_STYLE}">地形</span>
  <span style="${terrainStyle}">${terrainText}</span>

<span style="${HEADER_STYLE}">邻居</span>
  ${row1}
  ${row2}
  ${row3}

<span style="${HEADER_STYLE}">遮罩</span>
  ${info.mask}  (${binary})
  激活方向: ${activeText}

<span style="${HEADER_STYLE}">选中海岸</span>
  凹角: ${concaveText}
  凸角: ${convexText}
`.trim();
  }

  function clear(): void {
    element.innerHTML = `<span style="${HEADER_STYLE}">未选中任何格子</span>\n将鼠标悬停在网格上查看调试信息。`;
  }

  function destroy(): void {
    element.remove();
  }

  // Show initial empty state
  clear();

  return { element, update, clear, destroy };
}

// ── Helpers ────────────────────────────────────────────────────────

function bool(v: boolean): string {
  return v ? '1' : '0';
}
