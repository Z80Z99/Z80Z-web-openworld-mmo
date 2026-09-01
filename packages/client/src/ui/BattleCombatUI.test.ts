// @vitest-environment jsdom
/**
 * Phase 3H.4: Battle/Combat UI Tests (UI-001..UI-025)
 *
 * TDD RED phase — tests define the expected API contract for BattlePanel
 * and CombatPanel. These will FAIL to compile until the components exist.
 *
 * Validates:
 * - BattlePanel rendering for 1v1, 2v1, 1v2, 2v2 configurations
 * - CombatPanel state display, turn order, HP bars, participant states
 * - Target selection and action button enable/disable logic
 * - Combat log entries and round changes
 * - Lifecycle: combat resolved, battle remains visible
 * - Server authority: no client-side damage or turn calculation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BattlePanel } from "./BattlePanel.js";
import { CombatPanel } from "./CombatPanel.js";

import type {
  BattlePanelShowPayload,
  BattlePanelParticipant,
} from "./BattlePanel.js";
import type {
  CombatPanelShowPayload,
  CombatPanelParticipant,
  CombatPanelActionPayload,
} from "./CombatPanel.js";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

function makeBattleParticipant(
  overrides: Partial<BattlePanelParticipant>,
): BattlePanelParticipant {
  return {
    id: "player-1",
    name: "Warrior",
    currentHp: 100,
    maxHp: 100,
    alive: true,
    fleeing: false,
    isLeader: false,
    ...overrides,
  };
}

function makeCombatParticipant(
  overrides: Partial<CombatPanelParticipant>,
): CombatPanelParticipant {
  return {
    participantId: "player-1",
    name: "Warrior",
    side: "player",
    currentHp: 100,
    maxHp: 100,
    alive: true,
    defending: false,
    fleeing: false,
    ...overrides,
  };
}

function makeBattlePayload(
  overrides?: Partial<BattlePanelShowPayload>,
): BattlePanelShowPayload {
  return {
    battleState: "ACTIVE",
    playerParticipants: [
      makeBattleParticipant({ id: "player-1", name: "Warrior" }),
    ],
    enemyParticipants: [
      makeBattleParticipant({ id: "mob-1", name: "Goblin" }),
    ],
    ...overrides,
  };
}

function makeCombatPayload(
  overrides?: Partial<CombatPanelShowPayload>,
): CombatPanelShowPayload {
  return {
    combatState: "ACTIVE",
    round: 1,
    currentActorId: "player-1",
    turnOrder: ["player-1", "mob-1"],
    participants: [
      makeCombatParticipant({ participantId: "player-1", name: "Warrior", side: "player" }),
      makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
    ],
    localPlayerId: "player-1",
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Battle/Combat UI (UI-001..UI-025)", () => {
  let parent: HTMLElement;
  let panel: BattlePanel | CombatPanel;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  afterEach(() => {
    panel?.destroy();
    parent.remove();
  });

  /* ── BattlePanel Rendering (UI-001..UI-005) ── */

  it("UI-001: 1v1 render — shows 1 player + 1 enemy participant", () => {
    const battlePanel = new BattlePanel(parent);
    panel = battlePanel;

    battlePanel.show(makeBattlePayload({
      playerParticipants: [
        makeBattleParticipant({ id: "player-1", name: "Warrior" }),
      ],
      enemyParticipants: [
        makeBattleParticipant({ id: "mob-1", name: "Goblin" }),
      ],
    }));

    const participants = parent.querySelectorAll("[data-participant]");
    expect(participants.length).toBe(2);

    const playerEls = parent.querySelectorAll("[data-side='player'] [data-participant]");
    const enemyEls = parent.querySelectorAll("[data-side='enemy'] [data-participant]");
    expect(playerEls.length).toBe(1);
    expect(enemyEls.length).toBe(1);
  });

  it("UI-002: 2v1 render — shows 2 players + 1 enemy", () => {
    const battlePanel = new BattlePanel(parent);
    panel = battlePanel;

    battlePanel.show(makeBattlePayload({
      playerParticipants: [
        makeBattleParticipant({ id: "player-1", name: "Warrior" }),
        makeBattleParticipant({ id: "player-2", name: "Mage" }),
      ],
      enemyParticipants: [
        makeBattleParticipant({ id: "mob-1", name: "Goblin" }),
      ],
    }));

    const participants = parent.querySelectorAll("[data-participant]");
    expect(participants.length).toBe(3);

    const playerEls = parent.querySelectorAll("[data-side='player'] [data-participant]");
    const enemyEls = parent.querySelectorAll("[data-side='enemy'] [data-participant]");
    expect(playerEls.length).toBe(2);
    expect(enemyEls.length).toBe(1);
  });

  it("UI-003: 1v2 render — shows 1 player + 2 enemies", () => {
    const battlePanel = new BattlePanel(parent);
    panel = battlePanel;

    battlePanel.show(makeBattlePayload({
      playerParticipants: [
        makeBattleParticipant({ id: "player-1", name: "Warrior" }),
      ],
      enemyParticipants: [
        makeBattleParticipant({ id: "mob-1", name: "Goblin" }),
        makeBattleParticipant({ id: "mob-2", name: "Orc" }),
      ],
    }));

    const participants = parent.querySelectorAll("[data-participant]");
    expect(participants.length).toBe(3);

    const playerEls = parent.querySelectorAll("[data-side='player'] [data-participant]");
    const enemyEls = parent.querySelectorAll("[data-side='enemy'] [data-participant]");
    expect(playerEls.length).toBe(1);
    expect(enemyEls.length).toBe(2);
  });

  it("UI-004: 2v2 render — shows 2 players + 2 enemies", () => {
    const battlePanel = new BattlePanel(parent);
    panel = battlePanel;

    battlePanel.show(makeBattlePayload({
      playerParticipants: [
        makeBattleParticipant({ id: "player-1", name: "Warrior" }),
        makeBattleParticipant({ id: "player-2", name: "Mage" }),
      ],
      enemyParticipants: [
        makeBattleParticipant({ id: "mob-1", name: "Goblin" }),
        makeBattleParticipant({ id: "mob-2", name: "Orc" }),
      ],
    }));

    const participants = parent.querySelectorAll("[data-participant]");
    expect(participants.length).toBe(4);

    const playerEls = parent.querySelectorAll("[data-side='player'] [data-participant]");
    const enemyEls = parent.querySelectorAll("[data-side='enemy'] [data-participant]");
    expect(playerEls.length).toBe(2);
    expect(enemyEls.length).toBe(2);
  });

  it("UI-005: battle state rendering — ACTIVE/FLEEING/RESOLVED displayed with visual indicator", () => {
    const battlePanel = new BattlePanel(parent);
    panel = battlePanel;

    // ACTIVE state
    battlePanel.show(makeBattlePayload({ battleState: "ACTIVE" }));
    const activeIndicator = parent.querySelector("[data-battle-state]");
    expect(activeIndicator).not.toBeNull();
    expect(activeIndicator?.textContent).toContain("ACTIVE");

    // FLEEING state
    battlePanel.update({ battleState: "FLEEING" });
    expect(parent.querySelector("[data-battle-state]")?.textContent).toContain("FLEEING");

    // RESOLVED state
    battlePanel.update({ battleState: "RESOLVED" });
    expect(parent.querySelector("[data-battle-state]")?.textContent).toContain("RESOLVED");
  });

  /* ── CombatPanel Rendering (UI-006..UI-013) ── */

  it("UI-006: combat state rendering — FORMING/ACTIVE/RESOLVED + round number displayed", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    // FORMING state
    combatPanel.show(makeCombatPayload({ combatState: "FORMING", round: 1 }));
    const stateEl = parent.querySelector("[data-combat-state]");
    expect(stateEl).not.toBeNull();
    expect(stateEl?.textContent).toContain("FORMING");

    const roundEl = parent.querySelector("[data-round]");
    expect(roundEl).not.toBeNull();
    expect(roundEl?.textContent).toContain("1");

    // ACTIVE state
    combatPanel.update({ combatState: "ACTIVE", round: 3 });
    expect(parent.querySelector("[data-combat-state]")?.textContent).toContain("ACTIVE");
    expect(parent.querySelector("[data-round]")?.textContent).toContain("3");

    // RESOLVED state
    combatPanel.update({ combatState: "RESOLVED", round: 3 });
    expect(parent.querySelector("[data-combat-state]")?.textContent).toContain("RESOLVED");
  });

  it("UI-007: current actor highlight — currentActorId participant has visual highlight", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", name: "Warrior", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
      ],
    }));

    const currentActorEl = parent.querySelector("[data-participant='player-0']");
    expect(currentActorEl).not.toBeNull();
    expect(currentActorEl?.getAttribute("data-current")).toBe("true");

    // Non-current actor should not have highlight
    const otherEl = parent.querySelector("[data-participant='enemy-0']");
    expect(otherEl?.getAttribute("data-current")).not.toBe("true");
  });

  it("UI-008: turn order display — turnOrder shown as sequential indicator", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      turnOrder: ["player-1", "mob-1", "player-2", "mob-2"],
      participants: [
        makeCombatParticipant({ participantId: "player-1", name: "Warrior", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
        makeCombatParticipant({ participantId: "player-2", name: "Mage", side: "player" }),
        makeCombatParticipant({ participantId: "mob-2", name: "Orc", side: "enemy" }),
      ],
    }));

    const turnOrderEl = parent.querySelector("[data-turn-order]");
    expect(turnOrderEl).not.toBeNull();
    // Turn order should display participant names or IDs in sequence
    const turnOrderText = turnOrderEl?.textContent ?? "";
    expect(turnOrderText).toContain("Warrior");
    expect(turnOrderText).toContain("Goblin");
  });

  it("UI-009: HP display — HP bars reflect currentHp/maxHp correctly", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          currentHp: 75,
          maxHp: 100,
        }),
        makeCombatParticipant({
          participantId: "mob-1",
          name: "Goblin",
          side: "enemy",
          currentHp: 50,
          maxHp: 100,
        }),
      ],
    }));

    const playerHpBar = parent.querySelector(
      "[data-participant='player-0'] [data-hp-bar]",
    ) as HTMLElement;
    expect(playerHpBar).not.toBeNull();
    expect(playerHpBar.style.width).toContain("75");

    const mobHpBar = parent.querySelector(
      "[data-participant='enemy-0'] [data-hp-bar]",
    ) as HTMLElement;
    expect(mobHpBar).not.toBeNull();
    expect(mobHpBar.style.width).toContain("50");
  });

  it("UI-010: dead participant — dead participant shows dead state (opacity < 1 or strikethrough)", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          currentHp: 0,
          alive: false,
        }),
        makeCombatParticipant({
          participantId: "mob-1",
          name: "Goblin",
          side: "enemy",
          currentHp: 100,
          alive: true,
        }),
      ],
    }));

    const deadEl = parent.querySelector(
      "[data-participant='player-0']",
    ) as HTMLElement;
    expect(deadEl).not.toBeNull();
    expect(deadEl.getAttribute("data-alive")).toBe("false");
    // Dead participant should have reduced opacity or strikethrough styling
    const computedOpacity = parseFloat(
      getComputedStyle(deadEl).opacity,
    );
    expect(computedOpacity).toBeLessThan(1);
  });

  it("UI-011: defending state — defending participant shows shield/defending indicator", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          defending: true,
        }),
        makeCombatParticipant({
          participantId: "mob-1",
          name: "Goblin",
          side: "enemy",
          defending: false,
        }),
      ],
    }));

    const defendingEl = parent.querySelector(
      "[data-participant='player-0'][data-defending='true']",
    );
    expect(defendingEl).not.toBeNull();
    expect(defendingEl?.getAttribute("data-defending")).toBe("true");

    // Non-defending participant should not have the indicator
    const nonDefendingEl = parent.querySelector(
      "[data-participant='enemy-0'][data-defending='true']",
    );
    expect(nonDefendingEl).toBeNull();
  });

  it("UI-012: fleeing state — fleeing participant shows fleeing indicator", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          fleeing: true,
        }),
        makeCombatParticipant({
          participantId: "mob-1",
          name: "Goblin",
          side: "enemy",
          fleeing: false,
        }),
      ],
    }));

    const fleeingEl = parent.querySelector(
      "[data-participant='player-0'][data-fleeing='true']",
    );
    expect(fleeingEl).not.toBeNull();
    expect(fleeingEl?.getAttribute("data-fleeing")).toBe("true");

    // Non-fleeing participant should not have the indicator
    const nonFleeingEl = parent.querySelector(
      "[data-participant='enemy-0'][data-fleeing='true']",
    );
    expect(nonFleeingEl).toBeNull();
  });

  it("UI-013: rejoin — participant returning from fleeing shows active state (fleeing indicator removed)", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    // Start with fleeing
    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          fleeing: true,
        }),
      ],
    }));

    const fleeingEl = parent.querySelector(
      "[data-participant='player-0'][data-fleeing='true']",
    );
    expect(fleeingEl).not.toBeNull();

    // Rejoin: update with fleeing=false
    combatPanel.update({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          fleeing: false,
        }),
      ],
    });

    const rejoinedEl = parent.querySelector(
      "[data-participant='player-0'][data-fleeing='true']",
    );
    expect(rejoinedEl).toBeNull();
  });

  /* ── Target Selection & Actions (UI-014..UI-019) ── */

  it("UI-014: target selection — clicking enemy participant selects it as attack target", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", name: "Warrior", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
      ],
    }));

    const mobEl = parent.querySelector(
      "[data-participant='enemy-0']",
    ) as HTMLElement;
    expect(mobEl).not.toBeNull();

    // Enter target mode by clicking attack button first
    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();

    // After entering target mode, the enemy should be auto-selected (re-query after render replaces DOM)
    const selectedMobEl = parent.querySelector(
      "[data-participant='enemy-0']",
    ) as HTMLElement;
    expect(selectedMobEl.getAttribute("data-selected")).toBe("true");
  });

  it("UI-015: multiple targets — clicking new enemy deselects previous", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", name: "Warrior", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
        makeCombatParticipant({ participantId: "mob-2", name: "Orc", side: "enemy" }),
      ],
    }));

    // Enter target mode by clicking attack button first
    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();

    // After entering target mode, first enemy (enemy-0) is auto-selected
    let mob1El = parent.querySelector(
      "[data-participant='enemy-0']",
    ) as HTMLElement;
    expect(mob1El.getAttribute("data-selected")).toBe("true");

    // Click second enemy (different from auto-selected) — should select it and deselect first
    let mob2El = parent.querySelector(
      "[data-participant='enemy-1']",
    ) as HTMLElement;
    mob2El.click();

    // Re-query after render replaces DOM
    mob2El = parent.querySelector(
      "[data-participant='enemy-1']",
    ) as HTMLElement;
    mob1El = parent.querySelector(
      "[data-participant='enemy-0']",
    ) as HTMLElement;
    expect(mob2El.getAttribute("data-selected")).toBe("true");
    expect(mob1El.getAttribute("data-selected")).not.toBe("true");
  });

  it("UI-016: attack enabled for current actor — attack button enabled when currentActorId === localPlayerId && player alive", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      currentActorId: "player-1",
      localPlayerId: "player-1",
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          alive: true,
        }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
      ],
    }));

    const attackBtn = parent.querySelector(
      "[data-action='attack']",
    ) as HTMLButtonElement;
    expect(attackBtn).not.toBeNull();
    expect(attackBtn.disabled).toBe(false);
  });

  it("UI-017: attack disabled for non-current actor — attack button disabled when not player's turn", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({
      currentActorId: "mob-1",
      localPlayerId: "player-1",
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          alive: true,
        }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
      ],
    }));

    const attackBtn = parent.querySelector(
      "[data-action='attack']",
    ) as HTMLButtonElement;
    expect(attackBtn).not.toBeNull();
    expect(attackBtn.disabled).toBe(true);
  });

  it("UI-018: defend enabled correctly — defend enabled on player's turn, disabled otherwise", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    // Player's turn — defend enabled
    combatPanel.show(makeCombatPayload({
      currentActorId: "player-1",
      localPlayerId: "player-1",
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          alive: true,
        }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
      ],
    }));

    const defendBtn = parent.querySelector(
      "[data-action='defend']",
    ) as HTMLButtonElement;
    expect(defendBtn).not.toBeNull();
    expect(defendBtn.disabled).toBe(false);

    // Enemy's turn — defend disabled
    combatPanel.update({
      currentActorId: "mob-1",
    });

    expect(defendBtn.disabled).toBe(true);
  });

  it("UI-019: flee action — flee button fires onAction with { action: 'flee' }", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    const onAction = vi.fn();
    combatPanel.onAction(onAction);

    combatPanel.show(makeCombatPayload({
      currentActorId: "player-1",
      localPlayerId: "player-1",
    }));

    const fleeBtn = parent.querySelector(
      "[data-action='flee']",
    ) as HTMLButtonElement;
    expect(fleeBtn).not.toBeNull();
    fleeBtn.click();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "flee" }),
    );
  });

  /* ── Combat Log & Lifecycle (UI-020..UI-023) ── */

  it("UI-020: combat log — addLogEntry() displays entry in log container", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload());

    combatPanel.addLogEntry({ text: "Warrior attacks Goblin for 25 damage!", timestamp: Date.now() });

    const logContainer = parent.querySelector("[data-combat-log]");
    expect(logContainer).not.toBeNull();
    expect(logContainer?.textContent).toContain(
      "Warrior attacks Goblin for 25 damage!",
    );
  });

  it("UI-021: round change — round increment updates displayed round number", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({ round: 1 }));

    const roundEl = parent.querySelector("[data-round]");
    expect(roundEl?.textContent).toContain("1");

    // Increment round
    combatPanel.update({ round: 2 });
    expect(parent.querySelector("[data-round]")?.textContent).toContain("2");

    // Increment again
    combatPanel.update({ round: 5 });
    expect(parent.querySelector("[data-round]")?.textContent).toContain("5");
  });

  it("UI-022: combat resolved — hides action buttons, shows resolved message", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    combatPanel.show(makeCombatPayload({ combatState: "ACTIVE", currentActorId: "mob-1" }));

    // Action buttons should be visible when ACTIVE
    const attackBtn = parent.querySelector("[data-action='attack']");
    const defendBtn = parent.querySelector("[data-action='defend']");
    const fleeBtn = parent.querySelector("[data-action='flee']");
    expect(attackBtn).not.toBeNull();
    expect(defendBtn).not.toBeNull();
    expect(fleeBtn).not.toBeNull();

    // Resolve combat
    combatPanel.update({ combatState: "RESOLVED" });

    // Action buttons should be hidden or disabled
    const resolvedAttackBtn = parent.querySelector(
      "[data-action='attack']",
    ) as HTMLButtonElement | null;
    const resolvedDefendBtn = parent.querySelector(
      "[data-action='defend']",
    ) as HTMLButtonElement | null;
    const resolvedFleeBtn = parent.querySelector(
      "[data-action='flee']",
    ) as HTMLButtonElement | null;

    if (resolvedAttackBtn) expect(resolvedAttackBtn.disabled).toBe(true);
    if (resolvedDefendBtn) expect(resolvedDefendBtn.disabled).toBe(true);
    if (resolvedFleeBtn) expect(resolvedFleeBtn.disabled).toBe(true);

    // Resolved message should be displayed
    const resolvedMsg = parent.querySelector("[data-combat-resolved]");
    expect(resolvedMsg).not.toBeNull();
  });

  it("UI-023: battle remains after combat resolved — BattlePanel stays visible when combat resolves", () => {
    const battlePanel = new BattlePanel(parent);
    panel = battlePanel;

    battlePanel.show(makeBattlePayload({ battleState: "ACTIVE" }));

    // BattlePanel should be visible (container is in the DOM and display is set)
    const container = parent.querySelector("div") as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.style.display).not.toBe("none");

    // Simulate combat resolving — battle may still be ACTIVE
    battlePanel.update({ battleState: "ACTIVE" });

    // BattlePanel should remain visible (battle not resolved, only combat)
    expect(container.style.display).not.toBe("none");

    // Even if battle state changes to RESOLVED, panel should remain until explicitly hidden
    battlePanel.update({ battleState: "RESOLVED" });
    expect(container.style.display).not.toBe("none");
  });

  /* ── Constraints (UI-024..UI-025) ── */

  it("UI-024: no client damage calculation — participant HP only changes via show/update", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    const initialPayload = makeCombatPayload({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          currentHp: 100,
          maxHp: 100,
        }),
        makeCombatParticipant({
          participantId: "mob-1",
          name: "Goblin",
          side: "enemy",
          currentHp: 100,
          maxHp: 100,
        }),
      ],
    });

    combatPanel.show(initialPayload);

    // Capture initial HP display
    const mobHpBarBefore = parent.querySelector(
      "[data-participant='enemy-0'] [data-hp-bar]",
    ) as HTMLElement;
    expect(mobHpBarBefore.style.width).toContain("100");

    // Simulate attack action — combatPanel should NOT compute damage
    // Only server update via update() should change HP
    combatPanel.update({
      participants: [
        makeCombatParticipant({
          participantId: "player-1",
          name: "Warrior",
          side: "player",
          currentHp: 100,
          maxHp: 100,
        }),
        makeCombatParticipant({
          participantId: "mob-1",
          name: "Goblin",
          side: "enemy",
          currentHp: 75, // Server-computed damage result
          maxHp: 100,
        }),
      ],
    });

    // HP should reflect the server-provided value, not any client calculation
    const mobHpBarAfter = parent.querySelector(
      "[data-participant='enemy-0'] [data-hp-bar]",
    ) as HTMLElement;
    expect(mobHpBarAfter.style.width).toContain("75");

    // Verify no internal damage computation method exists on the panel
    expect(typeof (combatPanel as any).calculateDamage).toBe("undefined");
  });

  it("UI-025: no client turn calculation — turnOrder only changes via show/update payload", () => {
    const combatPanel = new CombatPanel(parent);
    panel = combatPanel;

    const initialPayload = makeCombatPayload({
      turnOrder: ["player-1", "mob-1"],
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", name: "Warrior", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", name: "Goblin", side: "enemy" }),
      ],
    });

    combatPanel.show(initialPayload);

    // Verify initial turn order is displayed correctly
    const turnOrderEl = parent.querySelector("[data-turn-order]");
    expect(turnOrderEl).not.toBeNull();
    expect(turnOrderEl?.textContent).toContain("Warrior");

    // Update turn order via payload (server-authoritative)
    combatPanel.update({
      turnOrder: ["mob-1", "player-1"],
      currentActorId: "mob-1",
    });

    // Turn order should reflect the new server-provided order
    const updatedTurnOrderEl = parent.querySelector("[data-turn-order]");
    expect(updatedTurnOrderEl?.textContent).toContain("Goblin");
    expect(updatedTurnOrderEl?.textContent).toContain("Warrior");
    // Goblin should appear before Warrior in the display
    const text = updatedTurnOrderEl?.textContent ?? "";
    expect(text.indexOf("Goblin")).toBeLessThan(text.indexOf("Warrior"));

    // Verify no internal turn computation method exists on the panel
    expect(typeof (combatPanel as any).computeTurnOrder).toBe("undefined");
    expect(typeof (combatPanel as any).nextTurn).toBe("undefined");
  });
});

/* ═══════════════════════════════════════════════════════
 * Core Combat CG-001..CG-027
 * ═══════════════════════════════════════════════════════ */

describe("Core Combat CG-001..CG-027", () => {
  let parent: HTMLElement;
  let panel: CombatPanel;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  afterEach(() => {
    panel?.destroy();
    parent.remove();
  });

  /* ── Attack Targeting (CG-001..CG-006) ── */

  it("CG-001: 1v1 attack → handler receives correct targetId", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player", name: "Warrior" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy", name: "Goblin" }),
      ],
    }));

    // Click Attack → enters target mode, auto-selects first alive enemy
    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();

    // Click the same enemy card to confirm (since it's already selected)
    const enemyCard = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    enemyCard.click();

    expect(receivedAction).toEqual({ action: "attack", targetId: "mob-1" });
  });

  it("CG-002: 2v1 attack targeting mob-1 → correct targetId", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "player-2", side: "player", name: "Mage" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    const enemyCard = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    enemyCard.click();

    expect(receivedAction).toEqual({ action: "attack", targetId: "mob-1" });
  });

  it("CG-003: 1v2 attack targeting mob-X → correct targetId", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
        makeCombatParticipant({ participantId: "mob-2", side: "enemy", name: "Orc" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    const enemyX = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    enemyX.click();

    expect(receivedAction).toEqual({ action: "attack", targetId: "mob-1" });
  });

  it("CG-004: 1v2 attack targeting mob-Y → correct targetId", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
        makeCombatParticipant({ participantId: "mob-2", side: "enemy", name: "Orc" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    // Select the second enemy (mob-2 = enemy-1)
    const enemyY = parent.querySelector("[data-participant='enemy-1']") as HTMLElement;
    enemyY.click();
    // Confirm attack with mob-2
    attackBtn.click();

    expect(receivedAction).toEqual({ action: "attack", targetId: "mob-2" });
  });

  it("CG-005: 2v2 attack targeting mob-X → correct targetId", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "player-2", side: "player", name: "Mage" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
        makeCombatParticipant({ participantId: "mob-2", side: "enemy", name: "Orc" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    const enemyX = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    enemyX.click();

    expect(receivedAction).toEqual({ action: "attack", targetId: "mob-1" });
  });

  it("CG-006: 2v2 attack targeting mob-Y → correct targetId", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "player-2", side: "player", name: "Mage" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
        makeCombatParticipant({ participantId: "mob-2", side: "enemy", name: "Orc" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    const enemyY = parent.querySelector("[data-participant='enemy-1']") as HTMLElement;
    enemyY.click();
    attackBtn.click();

    expect(receivedAction).toEqual({ action: "attack", targetId: "mob-2" });
  });

  /* ── Action Enable/Disable (CG-007..CG-010) ── */

  it("CG-007: current actor can attack (buttons enabled)", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    const defendBtn = parent.querySelector("[data-action='defend']") as HTMLButtonElement;
    const fleeBtn = parent.querySelector("[data-action='flee']") as HTMLButtonElement;
    expect(attackBtn.disabled).toBe(false);
    expect(defendBtn.disabled).toBe(false);
    expect(fleeBtn.disabled).toBe(false);
  });

  it("CG-008: non-current actor cannot attack (buttons disabled)", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "mob-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    const defendBtn = parent.querySelector("[data-action='defend']") as HTMLButtonElement;
    const fleeBtn = parent.querySelector("[data-action='flee']") as HTMLButtonElement;
    expect(attackBtn.disabled).toBe(true);
    expect(defendBtn.disabled).toBe(true);
    expect(fleeBtn.disabled).toBe(true);
  });

  it("CG-009: current actor can defend (defend button enabled)", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const defendBtn = parent.querySelector("[data-action='defend']") as HTMLButtonElement;
    expect(defendBtn.disabled).toBe(false);
  });

  it("CG-010: non-current actor cannot defend (defend button disabled)", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "mob-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const defendBtn = parent.querySelector("[data-action='defend']") as HTMLButtonElement;
    expect(defendBtn.disabled).toBe(true);
  });

  /* ── Flee (CG-011..CG-012) ── */

  it("CG-011: explicit flee → handler receives {action:'flee'}", () => {
    panel = new CombatPanel(parent);
    let receivedAction: { action: string; targetId?: string } | undefined;
    panel.onAction((p) => { receivedAction = p; });

    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const fleeBtn = parent.querySelector("[data-action='flee']") as HTMLButtonElement;
    fleeBtn.click();

    expect(receivedAction).toEqual({ action: "flee" });
  });

  it("CG-012: flee result (combat=null) → panel.hide() called", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload());

    // Simulate flee by calling hide() directly (which main.ts does on encounter_fled)
    panel.hide();

    // Container should be hidden — CombatPanel container is the first child
    const container = parent.querySelector("[data-combat-state]") as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.style.display).toBe("none");
  });

  /* ── Target Selection Edge Cases (CG-013..CG-014) ── */

  it("CG-013: dead target cannot be selected (data-selected not set)", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy", alive: false, currentHp: 0 }),
      ],
    }));

    // Enter target mode — no alive enemy, so selectedTargetId stays null
    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();

    // Dead enemy card should not have a click listener, so clicking does nothing
    const deadEnemy = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    expect(deadEnemy).not.toBeNull();
    // data-selected should not be "true" (it's either "false" or absent)
    expect(deadEnemy.getAttribute("data-selected")).not.toBe("true");
  });

  it("CG-014: dead actor cannot act (buttons disabled when alive=false)", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player", alive: false, currentHp: 0 }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    const defendBtn = parent.querySelector("[data-action='defend']") as HTMLButtonElement;
    const fleeBtn = parent.querySelector("[data-action='flee']") as HTMLButtonElement;
    expect(attackBtn.disabled).toBe(true);
    expect(defendBtn.disabled).toBe(true);
    expect(fleeBtn.disabled).toBe(true);
  });

  /* ── Visual Feedback (CG-015..CG-017) ── */

  it("CG-015: current actor has data-current='true' highlight", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    // CombatPanel uses data-participant="side-index" not data-participant-id
    const playerCard = parent.querySelector("[data-participant='player-0']") as HTMLElement;
    const mobCard = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    expect(playerCard).not.toBeNull();
    expect(mobCard).not.toBeNull();
    expect(playerCard.getAttribute("data-current")).toBe("true");
    expect(mobCard.getAttribute("data-current")).toBe("false");
  });

  it("CG-016: turn order display contains participant names in order", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      turnOrder: ["mob-1", "player-1"],
      currentActorId: "mob-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player", name: "Warrior" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy", name: "Goblin" }),
      ],
    }));

    const turnOrderEl = parent.querySelector("[data-turn-order]");
    const text = turnOrderEl?.textContent ?? "";
    expect(text).toContain("Goblin");
    expect(text).toContain("Warrior");
    expect(text.indexOf("Goblin")).toBeLessThan(text.indexOf("Warrior"));
  });

  it("CG-017: round display shows correct round number", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({ round: 3 }));

    const roundEl = parent.querySelector("[data-round]");
    expect(roundEl?.textContent).toContain("3");
  });

  /* ── Combat Log (CG-018..CG-022) ── */

  it("CG-018: damage log entry appears after damage_dealt event", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player", name: "Warrior" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy", name: "Goblin" }),
      ],
    }));

    // Simulate damage event via update — main.ts adds log entry
    // Since we can't call main.ts logic, add the log entry directly
    panel.addLogEntry({ text: "Warrior dealt 10 to Goblin", timestamp: Date.now() });

    const logEl = parent.querySelector("[data-combat-log]");
    expect(logEl?.textContent).toContain("Warrior dealt 10 to Goblin");
  });

  it("CG-019: death log entry appears after mob_killed event", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    panel.addLogEntry({ text: "Goblin was slain!", timestamp: Date.now() });

    const logEl = parent.querySelector("[data-combat-log]");
    expect(logEl?.textContent).toContain("Goblin was slain!");
  });

  it("CG-020: defend log entry appears after defend action", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      currentActorId: "player-1",
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player", name: "Warrior" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    panel.addLogEntry({ text: "You defend", timestamp: Date.now() });

    const logEl = parent.querySelector("[data-combat-log]");
    expect(logEl?.textContent).toContain("You defend");
  });

  it("CG-021: flee log entry appears after encounter_fled", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player", name: "Warrior" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));

    panel.addLogEntry({ text: "Warrior fled!", timestamp: Date.now() });

    const logEl = parent.querySelector("[data-combat-log]");
    expect(logEl?.textContent).toContain("Warrior fled!");
  });

  it("CG-022: combat resolved log entry appears", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload());

    panel.addLogEntry({ text: "Combat resolved!", timestamp: Date.now() });

    const logEl = parent.querySelector("[data-combat-log]");
    expect(logEl?.textContent).toContain("Combat resolved!");
  });

  /* ── Combat Resolution (CG-023..CG-024) ── */

  it("CG-023: combat resolved — BattlePanel stays visible", () => {
    const battlePanel = new BattlePanel(parent);
    battlePanel.show(makeBattlePayload());

    // BattlePanel container should still be in DOM after show()
    const container = parent.firstElementChild as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.style.display).not.toBe("none");
    battlePanel.destroy();
  });

  it("CG-024: combat resolved — CombatPanel shows resolved banner", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({ combatState: "RESOLVED" }));

    // Resolved banner should be visible
    const resolvedEl = parent.querySelector("[data-combat-resolved]") as HTMLElement;
    expect(resolvedEl).not.toBeNull();
    expect(resolvedEl.style.display).not.toBe("none");
    expect(resolvedEl.textContent).toContain("Combat Resolved");
  });

  /* ── Target Transmission (CG-025) ── */

  it("CG-025: targetId transmitted exactly (attack handler receives correct ID)", () => {
    panel = new CombatPanel(parent);
    const received: Array<{ action: string; targetId?: string }> = [];
    panel.onAction((p) => received.push(p));

    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-99", side: "enemy", name: "Dragon" }),
      ],
    }));

    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    // CombatPanel uses data-participant="side-index", not data-participant-id
    const dragonCard = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    dragonCard.click();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ action: "attack", targetId: "mob-99" });
  });

  /* ── Server Authority (CG-026..CG-027) ── */

  it("CG-026: no client-side damage calculation method exists", () => {
    panel = new CombatPanel(parent);
    expect(typeof (panel as any).calculateDamage).toBe("undefined");
    expect(typeof (panel as any).applyDamage).toBe("undefined");
    expect(typeof (panel as any).rollDamage).toBe("undefined");
  });

  it("CG-027: no client-side turn calculation method exists", () => {
    panel = new CombatPanel(parent);
    expect(typeof (panel as any).computeTurnOrder).toBe("undefined");
    expect(typeof (panel as any).nextTurn).toBe("undefined");
    expect(typeof (panel as any).advanceTurn).toBe("undefined");
  });

  /* ── CSS Fix: Initial Visibility (CSS-FIX-001..006) ── */

  it("CSS-FIX-001: CombatPanel container is hidden before show()", () => {
    panel = new CombatPanel(parent);
    const container = (panel as any).container as HTMLElement;
    expect(container.style.display).toBe("none");
  });

  it("CSS-FIX-002: show() makes the container visible", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload());
    const container = (panel as any).container as HTMLElement;
    expect(container.style.display).toBe("flex");
  });

  it("CSS-FIX-003: hide() makes the container hidden again", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload());
    panel.hide();
    const container = (panel as any).container as HTMLElement;
    expect(container.style.display).toBe("none");
  });

  it("CSS-FIX-004: update() does not change container visibility", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload());
    const container = (panel as any).container as HTMLElement;
    expect(container.style.display).toBe("flex");
    panel.update({ round: 2 });
    expect(container.style.display).toBe("flex");
  });

  it("CSS-FIX-005: target selection state is preserved across show/update/hide", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload({
      participants: [
        makeCombatParticipant({ participantId: "player-1", side: "player" }),
        makeCombatParticipant({ participantId: "mob-1", side: "enemy" }),
      ],
    }));
    // Enter target mode — auto-selects enemy-0
    const attackBtn = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    attackBtn.click();
    const enemyCard = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    expect(enemyCard.getAttribute("data-selected")).toBe("true");
    // update() should preserve selection while in target mode
    panel.update({ round: 2 });
    const enemyCardAfter = parent.querySelector("[data-participant='enemy-0']") as HTMLElement;
    expect(enemyCardAfter.getAttribute("data-selected")).toBe("true");
  });

  it("CSS-FIX-006: Attack/Defend/Flee buttons exist and are interactive", () => {
    panel = new CombatPanel(parent);
    panel.show(makeCombatPayload());
    const attack = parent.querySelector("[data-action='attack']") as HTMLButtonElement;
    const defend = parent.querySelector("[data-action='defend']") as HTMLButtonElement;
    const flee = parent.querySelector("[data-action='flee']") as HTMLButtonElement;
    expect(attack).toBeDefined();
    expect(defend).toBeDefined();
    expect(flee).toBeDefined();
    expect(attack.textContent).toBe("Attack");
    expect(defend.textContent).toBe("Defend");
    expect(flee.textContent).toBe("Flee");
  });
});
