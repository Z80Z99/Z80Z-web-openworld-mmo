/**
 * CombatPanel — DOM overlay for turn-based combat with multiple participants.
 *
 * Renders combat lifecycle (FORMING/ACTIVE/RESOLVED), round number, current actor,
 * turn order, all participants with HP/status, action buttons with target selection,
 * and a combat log. Read-only from payload — does not calculate damage, turns, or HP.
 */

/* ── Types ── */

export interface CombatPanelParticipant {
  participantId: string;
  name: string;
  currentHp: number;
  maxHp: number;
  alive: boolean;
  defending: boolean;
  fleeing: boolean;
  side: "player" | "enemy";
}

export type CombatPanelAction = "attack" | "defend" | "flee";

export interface CombatPanelActionPayload {
  action: CombatPanelAction;
  targetId?: string;
}

export type CombatPanelActionHandler = (payload: CombatPanelActionPayload) => void;

export interface CombatPanelShowPayload {
  combatState: "FORMING" | "ACTIVE" | "RESOLVED";
  round: number;
  currentActorId: string;
  turnOrder: string[];
  participants: CombatPanelParticipant[];
  localPlayerId: string;
}

export interface CombatPanelLogEntry {
  text: string;
  timestamp: number;
}

/* ── Helpers ── */

const S = {
  overlay: `position:absolute;inset:0;z-index:50;display:none;background:rgba(0,0,0,0.8);font-family:monospace;color:#fff;display:flex;align-items:center;justify-content:center;`,
  card: `background:rgba(20,20,30,0.95);border:1px solid #555;border-radius:8px;padding:16px;max-width:500px;width:90%;`,
  header: `display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;`,
  badge: `font-size:11px;font-weight:bold;text-transform:uppercase;padding:2px 8px;border-radius:3px;color:#fff;`,
  round: `font-size:13px;color:#f1c40f;font-weight:bold;`,
  turnOrder: `font-size:12px;color:#bbb;margin-bottom:12px;text-align:center;padding:6px;background:rgba(255,255,255,0.05);border-radius:4px;`,
  participantGroup: `margin-bottom:8px;`,
  btn: `padding:8px 16px;font-size:13px;font-family:monospace;font-weight:bold;color:#fff;background:#333;border:1px solid #555;border-radius:4px;cursor:pointer;transition:opacity 0.2s,background 0.2s;`,
  log: `max-height:120px;overflow-y:auto;font-size:12px;color:#aaa;border-top:1px solid #333;padding-top:8px;`,
  hpBar: `width:100%;height:8px;background:#333;border:1px solid #555;border-radius:2px;overflow:hidden;margin-top:4px;`,
  hpFill: (pct: number) => `width:${pct}%;height:100%;background:${pct > 60 ? "#2ecc71" : pct > 30 ? "#f1c40f" : "#e74c3c"};transition:width 0.3s;`,
};

const BADGE_COLORS: Record<string, string> = {
  ACTIVE: "#2ecc71",
  FORMING: "#95a5a6",
  RESOLVED: "#7f8c8d",
};

function el(tag: string, css?: string, attrs?: Record<string, string>): HTMLElement {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/* ── CombatPanel Class ── */

export class CombatPanel {
  private readonly container: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly stateLabel: HTMLElement;
  private readonly roundEl: HTMLElement;
  private readonly turnOrderEl: HTMLElement;
  private readonly participantsEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly resolvedBanner: HTMLElement;
  private readonly buttons: Record<CombatPanelAction, HTMLButtonElement>;
  private actionHandler: CombatPanelActionHandler | null = null;
  private selectedTargetId: string | null = null;
  private payload: CombatPanelShowPayload | null = null;
  private targetMode = false;

  constructor(parent: HTMLElement) {
    this.container = el("div", S.overlay);
    parent.appendChild(this.container);

    this.panel = el("div", S.card);
    this.container.appendChild(this.panel);

    // Header
    const header = el("div", S.header);
    this.stateLabel = el("span", S.badge, { "data-combat-state-label": "" });
    this.roundEl = el("span", S.round, { "data-round": "" });
    header.append(this.stateLabel, this.roundEl);
    this.panel.appendChild(header);

    // Turn order
    this.turnOrderEl = el("div", S.turnOrder, { "data-turn-order": "" });
    this.panel.appendChild(this.turnOrderEl);

    // Participants
    this.participantsEl = el("div", "margin-bottom:12px;");
    this.panel.appendChild(this.participantsEl);

    // Resolved banner
    this.resolvedBanner = el("div", `display:none;text-align:center;font-size:18px;font-weight:bold;color:#f1c40f;padding:16px;margin-bottom:12px;`, { "data-combat-resolved": "" });
    this.resolvedBanner.textContent = "Combat Resolved";
    this.panel.appendChild(this.resolvedBanner);

    // Action buttons
    this.actionsEl = el("div", "display:flex;gap:8px;justify-content:center;margin-bottom:12px;");
    this.buttons = {} as Record<CombatPanelAction, HTMLButtonElement>;
    for (const [action, label] of [["attack", "Attack"], ["defend", "Defend"], ["flee", "Flee"]] as const) {
      const btn = el("button", S.btn, { "data-action": action }) as HTMLButtonElement;
      btn.textContent = label;
      btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.opacity = "0.8"; });
      btn.addEventListener("mouseleave", () => { if (!btn.disabled) btn.style.opacity = "1"; });
      btn.addEventListener("click", () => this.onButtonClick(action));
      this.buttons[action] = btn;
      this.actionsEl.appendChild(btn);
    }
    this.panel.appendChild(this.actionsEl);

    // Log
    this.logEl = el("div", S.log, { "data-combat-log": "" });
    this.panel.appendChild(this.logEl);
  }

  /* ── Public API ── */

  show(payload: CombatPanelShowPayload): void {
    this.container.style.display = "flex";
    this.payload = payload;
    this.targetMode = false;
    this.selectedTargetId = null;
    this.render(payload);
  }

  update(patch: Partial<CombatPanelShowPayload>): void {
    if (!this.payload) return;
    this.payload = { ...this.payload, ...patch };
    this.render(this.payload);
  }

  addLogEntry(entry: CombatPanelLogEntry): void {
    const row = el("div", "padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);");
    row.textContent = entry.text;
    this.logEl.appendChild(row);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  hide(): void {
    this.container.style.display = "none";
    this.targetMode = false;
    this.selectedTargetId = null;
    this.payload = null;
    this.enableButtons(false);
  }

  destroy(): void { this.container.remove(); }

  onAction(handler: CombatPanelActionHandler): void { this.actionHandler = handler; }

  /* ── Render ── */

  private render(p: CombatPanelShowPayload): void {
    // State badge
    this.container.setAttribute("data-combat-state", p.combatState);
    this.stateLabel.textContent = p.combatState;
    this.stateLabel.style.background = BADGE_COLORS[p.combatState] ?? "#555";

    // Round
    this.roundEl.textContent = `Round ${p.round}`;

    // Turn order
    this.turnOrderEl.innerHTML = "";
    const nameOf = new Map(p.participants.map((x) => [x.participantId, x.name]));
    for (let i = 0; i < p.turnOrder.length; i++) {
      const id = p.turnOrder[i];
      const cur = id === p.currentActorId;
      const span = el("span", cur ? "background:rgba(52,152,219,0.3);border-radius:4px;padding:1px 4px;font-weight:bold;" : "", cur ? { "data-current-actor": id } : {});
      span.textContent = nameOf.get(id) ?? id;
      this.turnOrderEl.appendChild(span);
      if (i < p.turnOrder.length - 1) {
        const arrow = el("span", "color:#666;");
        arrow.textContent = " → ";
        this.turnOrderEl.appendChild(arrow);
      }
    }

    // Participants
    this.participantsEl.innerHTML = "";
    for (const side of ["player", "enemy"] as const) {
      const group = el("div", S.participantGroup, { "data-side": side });
      group.className = `participant-group ${side}-group`;
      const list = p.participants.filter((x) => x.side === side);
      for (let i = 0; i < list.length; i++) {
        group.appendChild(this.renderCard(list[i], i, side, p));
      }
      this.participantsEl.appendChild(group);
    }

    // Actions
    const isMyTurn = p.currentActorId === p.localPlayerId
      && p.participants.some((x) => x.participantId === p.localPlayerId && x.alive);
    this.actionsEl.style.display = p.combatState === "RESOLVED" ? "none" : "flex";
    this.enableButtons(isMyTurn);
    this.buttons.attack.style.background = this.targetMode ? "#e74c3c" : "#333";
    this.buttons.attack.textContent = this.targetMode ? "Confirm" : "Attack";

    // Resolved banner
    this.resolvedBanner.style.display = p.combatState === "RESOLVED" ? "block" : "none";
  }

  private renderCard(
    p: CombatPanelParticipant, idx: number, side: "player" | "enemy",
    ctx: CombatPanelShowPayload,
  ): HTMLElement {
    const isCur = p.participantId === ctx.currentActorId;
    const isSel = side === "enemy" && this.selectedTargetId === p.participantId;
    const borderCol = side === "player" ? "#3498db" : "#e74c3c";
    const pct = p.maxHp > 0 ? Math.max(0, Math.min(100, (p.currentHp / p.maxHp) * 100)) : 0;

    const card = el("div", `border-left:3px solid ${borderCol};padding:8px 12px;margin-bottom:4px;border-radius:4px;background:rgba(255,255,255,0.03);${!p.alive ? "opacity:0.4;" : ""}${p.fleeing ? "opacity:0.6;" : ""}${isCur ? "background:rgba(52,152,219,0.15);" : ""}${isSel ? "background:rgba(231,76,60,0.3);border:1px solid #e74c3c;" : ""}`, {
      "data-participant": `${side}-${idx}`,
      "data-alive": String(p.alive),
      "data-defending": String(p.defending),
      "data-fleeing": String(p.fleeing),
      "data-current": String(isCur),
      ...(side === "enemy" ? { "data-selected": String(isSel) } : {}),
    });

    const name = el("span", `font-weight:bold;font-size:13px;${!p.alive ? "text-decoration:line-through;" : ""}`, { "data-name": "" });
    name.textContent = p.name;
    card.appendChild(name);

    const status = el("span", "font-size:11px;margin-left:8px;", { "data-status": "" });
    if (p.defending) { status.textContent = "🛡️ DEFENDING"; status.style.color = "#3498db"; }
    else if (p.fleeing) { status.textContent = "FLEEING"; status.style.color = "#f39c12"; }
    else if (!p.alive) { status.textContent = "DEAD"; status.style.color = "#e74c3c"; }
    card.appendChild(status);

    const barWrap = el("div", S.hpBar, { "data-hp-bar-container": "" });
    barWrap.appendChild(el("div", S.hpFill(pct), { "data-hp-bar": "" }));
    card.appendChild(barWrap);

    const hpTxt = el("span", "font-size:11px;color:#bbb;", { "data-hp-text": "" });
    hpTxt.textContent = `${p.currentHp}/${p.maxHp}`;
    card.appendChild(hpTxt);

    if (side === "enemy" && p.alive) {
      card.style.cursor = this.targetMode ? "pointer" : "default";
      card.addEventListener("click", () => { if (this.targetMode) this.onTargetClick(p.participantId); });
    }
    return card;
  }

  /* ── Target selection / actions ── */

  private enableButtons(on: boolean): void {
    for (const b of Object.values(this.buttons)) {
      b.disabled = !on;
      b.style.opacity = on ? "1" : "0.4";
      b.style.cursor = on ? "pointer" : "not-allowed";
    }
  }

  private onButtonClick(action: CombatPanelAction): void {
    if (!this.payload) return;
    if (action === "attack" && !this.targetMode) { this.enterTargetMode(); return; }
    if (action === "attack" && this.targetMode) { this.confirmAttack(); return; }
    this.targetMode = false;
    this.selectedTargetId = null;
    this.actionHandler?.({ action });
  }

  private enterTargetMode(): void {
    if (!this.payload) return;
    this.targetMode = true;
    this.selectedTargetId = this.payload.participants.find((p) => p.side === "enemy" && p.alive)?.participantId ?? null;
    this.render(this.payload);
  }

  private onTargetClick(targetId: string): void {
    if (!this.payload) return;
    if (this.selectedTargetId === targetId) { this.confirmAttack(); }
    else { this.selectedTargetId = targetId; this.render(this.payload); }
  }

  private confirmAttack(): void {
    if (!this.payload || !this.selectedTargetId) return;
    const tid = this.selectedTargetId;
    this.targetMode = false;
    this.selectedTargetId = null;
    this.actionHandler?.({ action: "attack", targetId: tid });
    this.render(this.payload);
  }
}
