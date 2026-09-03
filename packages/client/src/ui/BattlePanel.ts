/**
 * BattlePanel — DOM overlay for spatial battle state.
 *
 * Renders battle lifecycle (ACTIVE/FLEEING/RESOLVED/ELIMINATED),
 * player and enemy participants with HP bars, alive/dead/fleeing states,
 * and leader indicator.
 */

/* ── Types ── */

export interface BattlePanelParticipant {
  readonly id: string;
  readonly name: string;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly fleeing: boolean;
  readonly isLeader: boolean;
}

export interface BattlePanelShowPayload {
  readonly battleState: "ACTIVE" | "FLEEING" | "RESOLVED" | "ELIMINATED";
  readonly playerParticipants: readonly BattlePanelParticipant[];
  readonly enemyParticipants: readonly BattlePanelParticipant[];
}

/* ── Constants ── */

const STATE_COLORS: Record<string, string> = {
  ACTIVE: "#2ecc71",
  FLEEING: "#f1c40f",
  RESOLVED: "#666",
  ELIMINATED: "#666",
};

/* ── BattlePanel Class ── */

export class BattlePanel {
  private readonly container: HTMLElement;
  private readonly panelCard: HTMLElement;
  private readonly stateLabel: HTMLElement;
  private readonly playerParticipants: HTMLElement;
  private readonly enemyParticipants: HTMLElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; inset: 0; z-index: 50; display: none;
      background: rgba(0,0,0,0.8); font-family: monospace; color: #fff;
    `;
    parent.appendChild(this.container);

    // Panel card
    this.panelCard = document.createElement("div");
    this.panelCard.style.cssText = `
      background: rgba(20,20,30,0.95); border: 1px solid #555; border-radius: 8px;
      padding: 16px; max-width: 500px; width: 90%;
    `;

    // Battle header
    const header = document.createElement("div");
    header.style.cssText = `
      text-align: center; margin-bottom: 16px; padding-bottom: 8px;
      border-bottom: 1px solid #333;
    `;

    this.stateLabel = document.createElement("span");
    this.stateLabel.style.cssText = `
      font-size: 14px; font-weight: bold; padding: 4px 12px;
      border-radius: 4px; text-transform: uppercase;
    `;
    this.stateLabel.setAttribute("data-battle-state-label", "");
    header.appendChild(this.stateLabel);

    this.panelCard.appendChild(header);

    // Battle sides container
    const sides = document.createElement("div");
    sides.style.cssText = `
      display: flex; gap: 16px;
    `;

    // Player side
    const playerSide = document.createElement("div");
    playerSide.style.cssText = `
      flex: 1; min-width: 0;
    `;
    playerSide.setAttribute("data-side", "player");

    const playerHeader = document.createElement("div");
    playerHeader.style.cssText = `
      font-size: 12px; font-weight: bold; color: #3498db;
      margin-bottom: 8px; text-transform: uppercase;
    `;
    playerHeader.textContent = "Allies";
    playerSide.appendChild(playerHeader);

    this.playerParticipants = document.createElement("div");
    this.playerParticipants.style.cssText = `
      display: flex; flex-direction: column; gap: 8px;
    `;
    this.playerParticipants.setAttribute("data-side", "player");
    playerSide.appendChild(this.playerParticipants);

    sides.appendChild(playerSide);

    // Enemy side
    const enemySide = document.createElement("div");
    enemySide.style.cssText = `
      flex: 1; min-width: 0;
    `;
    enemySide.setAttribute("data-side", "enemy");

    const enemyHeader = document.createElement("div");
    enemyHeader.style.cssText = `
      font-size: 12px; font-weight: bold; color: #e74c3c;
      margin-bottom: 8px; text-transform: uppercase;
    `;
    enemyHeader.textContent = "Enemies";
    enemySide.appendChild(enemyHeader);

    this.enemyParticipants = document.createElement("div");
    this.enemyParticipants.style.cssText = `
      display: flex; flex-direction: column; gap: 8px;
    `;
    this.enemyParticipants.setAttribute("data-side", "enemy");
    enemySide.appendChild(this.enemyParticipants);

    sides.appendChild(enemySide);

    this.panelCard.appendChild(sides);
    this.container.appendChild(this.panelCard);
  }

  /* ── Public API ── */

  show(payload: BattlePanelShowPayload): void {
    this.container.style.display = "flex";
    this.container.style.alignItems = "center";
    this.container.style.justifyContent = "center";
    this.render(payload);
  }

  update(payload: Partial<BattlePanelShowPayload>): void {
    this.render(payload as BattlePanelShowPayload);
  }

  hide(): void {
    this.container.style.display = "none";
  }

  destroy(): void {
    this.container.remove();
  }

  /* ── Private helpers ── */

  private render(payload: Partial<BattlePanelShowPayload>): void {
    if (payload.battleState) {
      this.container.setAttribute("data-battle-state", payload.battleState);
      this.panelCard.setAttribute("data-battle-state", payload.battleState);
      this.stateLabel.textContent = payload.battleState;
      this.stateLabel.style.background = STATE_COLORS[payload.battleState] ?? "#666";
    }
    if (payload.playerParticipants) {
      this.renderParticipants(this.playerParticipants, payload.playerParticipants, "player");
    }
    if (payload.enemyParticipants) {
      this.renderParticipants(this.enemyParticipants, payload.enemyParticipants, "enemy");
    }
  }

  private renderParticipants(
    container: HTMLElement,
    participants: readonly BattlePanelParticipant[],
    side: "player" | "enemy",
  ): void {
    container.innerHTML = "";

    participants.forEach((p, index) => {
      const card = this.createParticipantCard(p, side, index);
      container.appendChild(card);
    });
  }

  private createParticipantCard(
    participant: BattlePanelParticipant,
    side: "player" | "enemy",
    index: number,
  ): HTMLElement {
    const card = document.createElement("div");
    card.setAttribute("data-participant", `${side}-${index}`);
    card.setAttribute("data-alive", String(participant.alive));
    card.setAttribute("data-fleeing", String(participant.fleeing));

    // Base card style
    let cardStyle = `
      padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;
      border: 1px solid #333;
    `;

    // Dead state
    if (!participant.alive) {
      cardStyle += " opacity: 0.4; text-decoration: line-through;";
    }
    // Fleeing state
    else if (participant.fleeing) {
      cardStyle += " opacity: 0.6;";
    }

    card.style.cssText = cardStyle;

    // Name row with leader indicator
    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display: flex; align-items: center; gap: 4px; margin-bottom: 4px;";

    const nameSpan = document.createElement("span");
    nameSpan.setAttribute("data-name", "");
    nameSpan.style.cssText = `
      font-size: 12px; font-weight: bold;
      color: ${side === "player" ? "#3498db" : "#e74c3c"};
    `;
    nameSpan.textContent = participant.name;
    nameRow.appendChild(nameSpan);

    // Leader indicator
    if (participant.isLeader) {
      const leaderIcon = document.createElement("span");
      leaderIcon.setAttribute("data-leader", "");
      leaderIcon.style.cssText = "color: #f1c40f; font-size: 12px;";
      leaderIcon.textContent = "★";
      nameRow.appendChild(leaderIcon);
    }

    // Fleeing label
    if (participant.fleeing && participant.alive) {
      const fleeLabel = document.createElement("span");
      fleeLabel.style.cssText = "color: #f1c40f; font-size: 10px; margin-left: auto;";
      fleeLabel.textContent = "FLEEING";
      nameRow.appendChild(fleeLabel);
    }

    card.appendChild(nameRow);

    // HP bar container
    const hpContainer = document.createElement("div");
    hpContainer.setAttribute("data-hp-bar-container", "");
    hpContainer.style.cssText = `
      width: 100%; height: 8px; background: #333; border-radius: 4px;
      overflow: hidden; margin-bottom: 2px;
    `;

    const hpFill = document.createElement("div");
    const hpPct = participant.maxHp > 0
      ? Math.max(0, Math.min(100, (participant.currentHp / participant.maxHp) * 100))
      : 0;

    hpFill.setAttribute("data-hp-bar", "");
    hpFill.style.cssText = `
      width: ${hpPct}%; height: 100%; transition: width 0.3s;
      background: ${this.getHpColor(hpPct)};
    `;
    hpContainer.appendChild(hpFill);
    card.appendChild(hpContainer);

    // HP text
    const hpText = document.createElement("span");
    hpText.setAttribute("data-hp-text", "");
    hpText.style.cssText = "font-size: 10px; color: #bbb;";
    hpText.textContent = `${participant.currentHp}/${participant.maxHp}`;
    card.appendChild(hpText);

    return card;
  }

  private getHpColor(pct: number): string {
    if (pct > 50) return "#2ecc71";
    if (pct > 25) return "#f1c40f";
    return "#e74c3c";
  }
}
