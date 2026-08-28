import { describe, it, expect, beforeEach } from "vitest";
import { CombatManager } from "./CombatManager";
import { BattleCombatBridge } from "./BattleCombatBridge";
import { BattleManager } from "./BattleManager";

describe("Phase 3E-1: Production Instantiation", () => {
  let combatManager: CombatManager;
  let battleManager: BattleManager;

  beforeEach(() => {
    combatManager = new CombatManager();
    battleManager = new BattleManager();
  });

  it("E3E-001: getActiveSessions returns empty when no sessions", () => {
    expect(combatManager.getActiveSessions()).toEqual([]);
  });

  it("E3E-002: getActiveSessions returns only ACTIVE sessions", () => {
    combatManager.createCombatSession("combat-1", "battle-1", [
      { participantId: "p1", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e1", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ]);
    combatManager.createCombatSession("combat-2", "battle-2", [
      { participantId: "p2", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e2", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ]);
    combatManager.setCombatState("combat-2", "RESOLVED");

    const active = combatManager.getActiveSessions();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe("combat-1");
  });

  it("E3E-003: getActiveSessions returns deep-cloned snapshots", () => {
    combatManager.createCombatSession("combat-1", "battle-1", [
      { participantId: "p1", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e1", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ]);
    const sessions = combatManager.getActiveSessions();
    // Mutating the returned snapshot should not affect internal state
    (sessions[0] as any).id = "mutated";
    const sessions2 = combatManager.getActiveSessions();
    expect(sessions2[0].id).toBe("combat-1");
  });

  it("E3E-004: BattleCombatBridge construction with valid managers", () => {
    const bridge = new BattleCombatBridge(battleManager, combatManager);
    expect(bridge).toBeDefined();
  });

  it("E3E-005: getCombatIdByBattle returns undefined for unknown battle", () => {
    expect(combatManager.getCombatIdByBattle("nonexistent")).toBeUndefined();
  });

  it("E3E-006: getCombatIdByBattle returns combatId after creation", () => {
    combatManager.createCombatSession("combat-1", "battle-1", [
      { participantId: "p1", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e1", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ]);
    expect(combatManager.getCombatIdByBattle("battle-1")).toBe("combat-1");
  });
});
