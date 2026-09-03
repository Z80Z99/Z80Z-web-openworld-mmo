// @vitest-environment jsdom
/**
 * Phase 4A.9-R1: Combat UI Initialization / Visibility Regression Tests
 *
 * Verifies that BattlePanel and CombatPanel are hidden when no
 * battle/combat is active, and correctly show/hide through the
 * full lifecycle.
 *
 * Test IDs: UII-001..UII-010
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BattlePanel } from "./BattlePanel.js";
import { CombatPanel } from "./CombatPanel.js";

/* ===== Helpers ===== */

function createParent(): HTMLElement {
  const div = document.createElement("div");
  div.style.position = "relative";
  div.style.width = "800px";
  div.style.height = "600px";
  document.body.appendChild(div);
  return div;
}

function battlePayload(overrides?: Partial<Parameters<BattlePanel["show"]>[0]>) {
  return {
    battleState: "ACTIVE" as const,
    playerParticipants: [
      { id: "p1", name: "You", currentHp: 100, maxHp: 100, alive: true, fleeing: false, isLeader: true },
    ],
    enemyParticipants: [
      { id: "mob1", name: "Goblin", currentHp: 50, maxHp: 80, alive: true, fleeing: false, isLeader: true },
    ],
    ...overrides,
  };
}

function combatPayload(overrides?: Partial<Parameters<CombatPanel["show"]>[0]>) {
  return {
    combatState: "ACTIVE" as const,
    round: 1,
    currentActorId: "p1",
    turnOrder: ["p1", "mob1"],
    participants: [
      { participantId: "p1", name: "You", currentHp: 100, maxHp: 100, alive: true, defending: false, fleeing: false, side: "player" as const },
      { participantId: "mob1", name: "Goblin", currentHp: 50, maxHp: 80, alive: true, defending: false, fleeing: false, side: "enemy" as const },
    ],
    localPlayerId: "p1",
    ...overrides,
  };
}

/* ===== Tests ===== */

describe("Phase 4A.9-R1 — Combat UI Initialization / Visibility (UII-001..UII-010)", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = createParent();
  });

  /* ── Initial state ── */

  it("UII-001: BattlePanel hidden on initial construction (no battle active)", () => {
    const panel = new BattlePanel(parent);
    const container = (panel as any).container as HTMLElement;
    expect(container.style.display).toBe("none");
    expect(container.getAttribute("data-battle-state")).toBeNull();
    panel.destroy();
  });

  it("UII-002: CombatPanel hidden on initial construction (no combat active)", () => {
    const panel = new CombatPanel(parent);
    const container = (panel as any).container as HTMLElement;
    expect(container.style.display).toBe("none");
    panel.destroy();
  });

  it("UII-003: BattlePanel does not intercept pointer events when hidden", () => {
    const panel = new BattlePanel(parent);
    const container = (panel as any).container as HTMLElement;
    // display:none elements should not receive pointer events
    const computed = window.getComputedStyle(container);
    expect(computed.display).toBe("none");
    panel.destroy();
  });

  it("UII-004: CombatPanel does not intercept pointer events when hidden", () => {
    const panel = new CombatPanel(parent);
    const container = (panel as any).container as HTMLElement;
    const computed = window.getComputedStyle(container);
    expect(computed.display).toBe("none");
    panel.destroy();
  });

  /* ── show / hide lifecycle ── */

  it("UII-005: BattlePanel shows Allies/Enemies only after show() called", () => {
    const panel = new BattlePanel(parent);
    const container = (panel as any).container as HTMLElement;

    // Before show: hidden
    expect(container.style.display).toBe("none");

    // After show: visible with correct content
    panel.show(battlePayload());
    expect(container.style.display).toBe("flex");
    expect(container.textContent).toContain("Allies");
    expect(container.textContent).toContain("Enemies");
    expect(container.getAttribute("data-battle-state")).toBe("ACTIVE");

    panel.destroy();
  });

  it("UII-006: CombatPanel shows participants only after show() called", () => {
    const panel = new CombatPanel(parent);
    const container = (panel as any).container as HTMLElement;

    // Before show: hidden
    expect(container.style.display).toBe("none");

    // After show: visible with participants
    panel.show(combatPayload());
    expect(container.style.display).toBe("flex");

    panel.destroy();
  });

  it("UII-007: BattlePanel hides correctly after show → hide cycle", () => {
    const panel = new BattlePanel(parent);
    const container = (panel as any).container as HTMLElement;

    panel.show(battlePayload());
    expect(container.style.display).toBe("flex");

    panel.hide();
    expect(container.style.display).toBe("none");

    panel.destroy();
  });

  it("UII-008: CombatPanel hides correctly after show → hide cycle", () => {
    const panel = new CombatPanel(parent);
    const container = (panel as any).container as HTMLElement;

    panel.show(combatPayload());
    expect(container.style.display).toBe("flex");

    panel.hide();
    expect(container.style.display).toBe("none");

    panel.destroy();
  });

  /* ── Lifecycle: battle resolve → hide → next battle → show ── */

  it("UII-009: BattlePanel re-shows correctly for second battle after hide", () => {
    const panel = new BattlePanel(parent);
    const container = (panel as any).container as HTMLElement;

    // First battle
    panel.show(battlePayload());
    expect(container.style.display).toBe("flex");
    expect(container.getAttribute("data-battle-state")).toBe("ACTIVE");

    // Battle resolved → hide
    panel.hide();
    expect(container.style.display).toBe("none");

    // Second battle → show again
    panel.show(battlePayload({ battleState: "RESOLVED" }));
    expect(container.style.display).toBe("flex");
    expect(container.getAttribute("data-battle-state")).toBe("RESOLVED");

    panel.destroy();
  });

  it("UII-010: CombatPanel re-shows correctly for second combat after hide", () => {
    const panel = new CombatPanel(parent);
    const container = (panel as any).container as HTMLElement;

    // First combat
    panel.show(combatPayload());
    expect(container.style.display).toBe("flex");

    // Combat resolved → hide
    panel.hide();
    expect(container.style.display).toBe("none");

    // Second combat → show again
    panel.show(combatPayload({ combatState: "RESOLVED" }));
    expect(container.style.display).toBe("flex");

    panel.destroy();
  });
});
