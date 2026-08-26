/**
 * EncounterPanel — DOM overlay for turn-based combat encounters.
 *
 * Renders mob info (name, level, HP bar), round/turn indicators,
 * and three action buttons: attack / defend / flee.
 * Buttons are disabled when it is not the player's turn.
 */

/* ── Types ── */

export interface EncounterShowPayload {
  mobId: string;
  mobName: string;
  mobLevel: number;
  mobHp: number;
  mobMaxHp: number;
  turn: "player" | "mob";
  round: number;
}

export interface EncounterUpdatePayload {
  turn: "player" | "mob";
  round: number;
  mobHp: number;
  playerDefending?: boolean;
}

export type EncounterAction = "attack" | "defend" | "flee";
export type EncounterActionHandler = (action: EncounterAction) => void;

/* ── EncounterPanel Class ── */

export class EncounterPanel {
  private readonly container: HTMLElement;
  private readonly mobNameEl: HTMLElement;
  private readonly mobHpFill: HTMLElement;
  private readonly mobHpText: HTMLElement;
  private readonly roundEl: HTMLElement;
  private readonly turnEl: HTMLElement;
  private readonly buttons: Record<EncounterAction, HTMLButtonElement>;
  private actionHandler: EncounterActionHandler | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; inset: 0; z-index: 50; display: none;
      background: rgba(0,0,0,0.8); font-family: monospace; color: #fff;
      display: flex; align-items: center; justify-content: center;
    `;
    parent.appendChild(this.container);

    const panel = document.createElement("div");
    panel.style.cssText = `
      background: rgba(20,20,30,0.95); border: 1px solid #555; border-radius: 8px;
      padding: 24px 32px; min-width: 320px; text-align: center;
    `;

    // Mob info
    this.mobNameEl = document.createElement("div");
    this.mobNameEl.style.cssText = `
      font-size: 18px; font-weight: bold; color: #e74c3c; margin-bottom: 8px;
    `;
    panel.appendChild(this.mobNameEl);

    // HP bar
    const hpBar = document.createElement("div");
    hpBar.style.cssText = `
      width: 100%; height: 16px; background: #333; border: 1px solid #555;
      border-radius: 3px; overflow: hidden; margin-bottom: 4px;
    `;
    this.mobHpFill = document.createElement("div");
    this.mobHpFill.style.cssText = `
      width: 100%; height: 100%; background: #e74c3c; transition: width 0.3s;
    `;
    hpBar.appendChild(this.mobHpFill);
    panel.appendChild(hpBar);

    this.mobHpText = document.createElement("div");
    this.mobHpText.style.cssText = "font-size: 12px; color: #bbb; margin-bottom: 12px;";
    panel.appendChild(this.mobHpText);

    // Round
    this.roundEl = document.createElement("div");
    this.roundEl.style.cssText = "font-size: 13px; color: #aaa; margin-bottom: 4px;";
    panel.appendChild(this.roundEl);

    // Turn indicator
    this.turnEl = document.createElement("div");
    this.turnEl.style.cssText = `
      font-size: 16px; font-weight: bold; margin-bottom: 16px;
    `;
    panel.appendChild(this.turnEl);

    // Action buttons
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display: flex; gap: 12px; justify-content: center;";

    const actionDefs: [EncounterAction, string, string][] = [
      ["attack", "攻击", "#e74c3c"],
      ["defend", "防御", "#3498db"],
      ["flee", "逃跑", "#f39c12"],
    ];

    this.buttons = {} as Record<EncounterAction, HTMLButtonElement>;

    for (const [action, label, color] of actionDefs) {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = `
        padding: 8px 20px; font-size: 14px; font-family: monospace; font-weight: bold;
        color: #fff; background: ${color}; border: none; border-radius: 4px;
        cursor: pointer; transition: opacity 0.2s;
      `;
      btn.addEventListener("mouseenter", () => { btn.style.opacity = "0.8"; });
      btn.addEventListener("mouseleave", () => { btn.style.opacity = "1"; });
      btn.addEventListener("click", () => {
        if (!btn.disabled && this.actionHandler) {
          this.actionHandler(action);
        }
      });
      this.buttons[action] = btn;
      btnRow.appendChild(btn);
    }
    panel.appendChild(btnRow);

    this.container.appendChild(panel);
  }

  /* ── Public API ── */

  show(payload: EncounterShowPayload): void {
    this.container.style.display = "flex";
    this.updateMobInfo(payload.mobName, payload.mobLevel, payload.mobHp, payload.mobMaxHp);
    this.updateTurnState(payload.turn, payload.round);
  }

  update(payload: EncounterUpdatePayload): void {
    this.updateTurnState(payload.turn, payload.round);
    this.updateMobHp(payload.mobHp);
  }

  hide(): void {
    this.container.style.display = "none";
    this.setButtonsEnabled(false);
  }

  onAction(handler: EncounterActionHandler): void {
    this.actionHandler = handler;
  }

  /* ── Private helpers ── */

  private updateMobInfo(name: string, level: number, hp: number, maxHp: number): void {
    this.mobNameEl.textContent = `${name} (Lv.${level})`;
    this.updateMobHp(hp);
    this.mobHpText.textContent = `${hp} / ${maxHp}`;
    const pct = maxHp > 0 ? (hp / maxHp) * 100 : 0;
    this.mobHpFill.style.width = `${pct}%`;
  }

  private updateMobHp(hp: number): void {
    // Parent show stores maxHp implicitly via the fill width ratio.
    // We re-use the stored maxHp from the text to recalculate.
    const match = this.mobHpText.textContent?.match(/\/\s*(\d+)/);
    const maxHp = match ? parseInt(match[1], 10) : 100;
    const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
    this.mobHpFill.style.width = `${pct}%`;
    this.mobHpText.textContent = `${hp} / ${maxHp}`;
  }

  private updateTurnState(turn: "player" | "mob", round: number): void {
    this.roundEl.textContent = `回合 ${round}`;
    if (turn === "player") {
      this.turnEl.textContent = "你的回合";
      this.turnEl.style.color = "#2ecc71";
      this.setButtonsEnabled(true);
    } else {
      this.turnEl.textContent = "对方行动中...";
      this.turnEl.style.color = "#e74c3c";
      this.setButtonsEnabled(false);
    }
  }

  private setButtonsEnabled(enabled: boolean): void {
    for (const btn of Object.values(this.buttons)) {
      btn.disabled = !enabled;
      btn.style.opacity = enabled ? "1" : "0.4";
      btn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
  }
}
