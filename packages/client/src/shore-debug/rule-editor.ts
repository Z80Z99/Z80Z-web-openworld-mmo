import {
  type ShoreRule, getShoreTiles, DIRECTION_NAMES,
  maskToBinary, getNeighborsFromMask,
} from '@mmo/shared';

export interface RuleEditorOptions {
  container: HTMLElement;
  cellSize?: number;
  onRuleChange?: (mask: number, rule: ShoreRule) => void;
}

export interface RuleEditor {
  canvas: HTMLCanvasElement;
  setMask(mask: number): void;
  getCurrentRule(): ShoreRule;
  resetRule(): void;
  saveRules(): void;
  loadRules(): void;
  exportRules(): string;
  importRules(json: string): void;
  destroy(): void;
}

const BG = '#1a1a1a';
const LAND = '#E8913A';
const WATER = '#3A7BE8';
const CENTER = '#666';
const BORDER = '#555';
const TEXT = '#fff';
const TOGL_C = '#E8913A';
const TOGL_V = '#3A8EE8';
const TOGL_OFF = '#444';
const BTN_BG = '#333';
const KEY = 'shore-debug-rules';

export function createRuleEditor(options: RuleEditorOptions): RuleEditor {
  const cs = options.cellSize ?? 48;
  const gw = 3 * cs;
  const mrH = 28;
  const gsY = 8;
  const nEndY = gsY + gw;
  const cY = nEndY + 8;
  const cvY = cY + 36;
  const bY = cvY + 36;
  const cH = bY + 36;
  const cW = Math.max(gw + 16, 300);

  const canvas = document.createElement('canvas');
  canvas.width = cW; canvas.height = cH;
  canvas.style.display = 'block';
  canvas.style.cursor = 'pointer';
  options.container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const rules = new Map<number, ShoreRule>();
  let mask = 0;
  let conc: boolean[] = new Array(8).fill(false);
  let conv: boolean[] = new Array(4).fill(false);

  const curRule = (): ShoreRule => ({
    mask,
    concave: conc.map((v, i) => v ? i + 1 : -1).filter(v => v > 0),
    convex: conv.map((v, i) => v ? i + 1 : -1).filter(v => v > 0),
  });

  const applyRule = (r: ShoreRule): void => {
    conc = new Array(8).fill(false);
    conv = new Array(4).fill(false);
    for (const i of r.concave) if (i >= 1 && i <= 8) conc[i - 1] = true;
    for (const i of r.convex) if (i >= 1 && i <= 4) conv[i - 1] = true;
  };

  const notify = (): void => options.onRuleChange?.(mask, curRule());

  function setMask(m: number): void {
    mask = Math.max(0, Math.min(255, m | 0));
    const ex = rules.get(mask);
    if (ex) { applyRule(ex); }
    else {
      conc = new Array(8).fill(false);
      conv = new Array(4).fill(false);
      for (const t of getShoreTiles(mask)) {
        if (t.type === 'concave' && t.index >= 1 && t.index <= 8) conc[t.index - 1] = true;
        if (t.type === 'convex' && t.index >= 1 && t.index <= 4) conv[t.index - 1] = true;
      }
    }
    render();
  }

  function render(): void {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cW, cH);
    // Mask label + box
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('遮罩:', 4, gsY);
    ctx.fillStyle = '#333';
    ctx.fillRect(56, gsY - 2, 60, 20);
    ctx.strokeStyle = BORDER; ctx.strokeRect(56, gsY - 2, 60, 20);
    ctx.fillStyle = TEXT; ctx.textAlign = 'center';
    ctx.fillText(String(mask), 86, gsY + 1);
    // Up/Down arrows
    ctx.fillStyle = BTN_BG;
    ctx.fillRect(118, gsY - 2, 16, 20);
    ctx.fillRect(118, gsY + 18, 16, 20);
    ctx.fillStyle = TEXT; ctx.font = '10px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('\u25B2', 126, gsY);
    ctx.fillText('\u25BC', 126, gsY + 18);
    // Binary
    ctx.fillStyle = TEXT; ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('二进制: ' + maskToBinary(mask), 140, gsY);
    // 3x3 neighbor grid
    const gY = gsY + mrH + 4;
    const nb = getNeighborsFromMask(mask);
    const gi = [[0,1,2],[3,-1,4],[5,6,7]];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const i = gi[r][c];
        const x = 4 + c * cs, y = gY + r * cs;
        ctx.fillStyle = i === -1 ? CENTER : nb[i] ? LAND : WATER;
        ctx.fillRect(x, y, cs, cs);
        ctx.strokeStyle = BORDER; ctx.lineWidth = 1;
        ctx.strokeRect(x + .5, y + .5, cs - 1, cs - 1);
        ctx.fillStyle = TEXT;
        ctx.font = 'bold ' + Math.max(9, cs / 5) + 'px monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(i === -1 ? 'C' : DIRECTION_NAMES[i], x + 3, y + 3);
        ctx.font = Math.max(8, cs / 5) + 'px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(i === -1 ? 'C' : (nb[i] ? '陆地' : '水域'), x + cs / 2, y + cs / 2 + 4);
      }
    }
    // Concave toggles (S1-S8)
    ctx.fillStyle = TEXT; ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('凹角:', 4, cY);
    for (let i = 0; i < 8; i++) {
      const bx = 64 + i * (cs - 2);
      ctx.fillStyle = conc[i] ? TOGL_C : TOGL_OFF;
      ctx.fillRect(bx, cY - 2, cs - 4, 20);
      ctx.strokeStyle = BORDER; ctx.strokeRect(bx, cY - 2, cs - 4, 20);
      ctx.fillStyle = TEXT; ctx.font = '10px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S' + (i + 1), bx + (cs - 4) / 2, cY + 8);
    }
    // Convex toggles (C1-C4)
    ctx.fillStyle = TEXT; ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('凸角:', 4, cvY);
    for (let i = 0; i < 4; i++) {
      const bx = 64 + i * (cs + 4);
      ctx.fillStyle = conv[i] ? TOGL_V : TOGL_OFF;
      ctx.fillRect(bx, cvY - 2, cs, 20);
      ctx.strokeStyle = BORDER; ctx.strokeRect(bx, cvY - 2, cs, 20);
      ctx.fillStyle = TEXT; ctx.font = '10px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('C' + (i + 1), bx + cs / 2, cvY + 8);
    }
    // Action buttons
    const bLabels = ['保存', '加载', '重置', '导出'];
    const bW = 64;
    for (let i = 0; i < bLabels.length; i++) {
      const bx = 4 + i * (bW + 8);
      ctx.fillStyle = BTN_BG; ctx.fillRect(bx, bY, bW, 24);
      ctx.strokeStyle = BORDER; ctx.strokeRect(bx, bY, bW, 24);
      ctx.fillStyle = TEXT; ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(bLabels[i], bx + bW / 2, bY + 12);
    }
  }

  function hitTest(e: MouseEvent): string | null {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const gY = gsY + mrH + 4;
    if (x >= 118 && x <= 134 && y >= gsY - 2 && y <= gsY + 18) return 'up';
    if (x >= 118 && x <= 134 && y >= gsY + 18 && y <= gsY + 38) return 'down';
    if (y >= gY && y < gY + 3 * cs && x >= 4 && x < 4 + 3 * cs) return null;
    if (y >= cY - 2 && y <= cY + 18) {
      for (let i = 0; i < 8; i++) {
        const bx = 64 + i * (cs - 2);
        if (x >= bx && x < bx + cs - 4) return 'concave-' + i;
      }
    }
    if (y >= cvY - 2 && y <= cvY + 18) {
      for (let i = 0; i < 4; i++) {
        const bx = 64 + i * (cs + 4);
        if (x >= bx && x < bx + cs) return 'convex-' + i;
      }
    }
    const bW = 64;
    if (y >= bY && y <= bY + 24) {
      for (const [lbl, idx] of [['save',0],['load',1],['reset',2],['export',3]] as const) {
        if (x >= 4 + idx * (bW + 8) && x < 4 + idx * (bW + 8) + bW) return lbl;
      }
    }
    return null;
  }

  function handleClick(e: MouseEvent): void {
    const h = hitTest(e);
    if (!h) return;
    if (h === 'up') { setMask(mask + 1); notify(); return; }
    if (h === 'down') { setMask(mask - 1); notify(); return; }
    if (h.startsWith('concave-')) {
      conc[+h.split('-')[1]] = !conc[+h.split('-')[1]];
      render(); notify(); return;
    }
    if (h.startsWith('convex-')) {
      conv[+h.split('-')[1]] = !conv[+h.split('-')[1]];
      render(); notify(); return;
    }
    if (h === 'save') { saveRules(); return; }
    if (h === 'load') { loadRules(); return; }
    if (h === 'reset') { resetRule(); notify(); return; }
    if (h === 'export') { copyExport(); return; }
  }

  const toObj = (): Record<number, ShoreRule> => {
    const o: Record<number, ShoreRule> = {};
    rules.forEach((v, k) => { o[k] = v; });
    return o;
  };

  function saveRules(): void { localStorage.setItem(KEY, JSON.stringify(toObj())); }
  function loadRules(): void {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    rules.clear();
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, ShoreRule>)) rules.set(+k, v);
    setMask(mask);
  }
  function resetRule(): void { rules.delete(mask); setMask(mask); }
  function exportRules(): string { return JSON.stringify(toObj(), null, 2); }
  function copyExport(): void { navigator.clipboard?.writeText(exportRules()); }
  function importRules(json: string): void {
    rules.clear();
    for (const [k, v] of Object.entries(JSON.parse(json) as Record<string, ShoreRule>)) rules.set(+k, v);
    setMask(mask);
  }
  function destroy(): void { canvas.removeEventListener('click', handleClick); canvas.remove(); }

  canvas.addEventListener('click', handleClick);
  render();

  return { canvas, setMask, getCurrentRule: curRule, resetRule, saveRules, loadRules, exportRules, importRules, destroy };
}
