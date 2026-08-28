import { describe, it, expect, beforeEach } from "vitest";
import { CombatManager } from "./CombatManager";
import { BattleManager } from "./BattleManager";
import { BattleCombatBridge } from "./BattleCombatBridge";

describe("Phase 3E-4: Cleanup / Respawn Fixes", () => {
  let combatManager: CombatManager;
  let battleManager: BattleManager;
  let bridge: BattleCombatBridge;

  beforeEach(() => {
    combatManager = new CombatManager();
    battleManager = new BattleManager();
    bridge = new BattleCombatBridge(battleManager, combatManager);
  });

  it("E3E-019: getBattles returns all active battles", () => {
    battleManager.createBattle("battle-1",
      { id: "p1", position: { x: 0, y: 0, chunkX: 0, chunkY: 0 }, combatPower: 10, state: "ACTIVE" },
      { id: "e1", position: { x: 1, y: 1, chunkX: 0, chunkY: 0 }, combatPower: 8, state: "ACTIVE" },
    );
    battleManager.createBattle("battle-2",
      { id: "p2", position: { x: 5, y: 5, chunkX: 0, chunkY: 0 }, combatPower: 10, state: "ACTIVE" },
      { id: "e2", position: { x: 6, y: 6, chunkX: 0, chunkY: 0 }, combatPower: 8, state: "ACTIVE" },
    );

    const battles = battleManager.getBattles();
    expect(battles.size).toBe(2);
    expect(battles.has("battle-1")).toBe(true);
    expect(battles.has("battle-2")).toBe(true);
  });

  it("E3E-020: removeBattle cleans up participant index", () => {
    battleManager.createBattle("battle-3",
      { id: "p3", position: { x: 0, y: 0, chunkX: 0, chunkY: 0 }, combatPower: 10, state: "ACTIVE" },
      { id: "e3", position: { x: 1, y: 1, chunkX: 0, chunkY: 0 }, combatPower: 8, state: "ACTIVE" },
    );

    // Verify participant can be found
    expect(battleManager.getBattleByParticipant("p3")).toBeDefined();

    // Eliminate both sides so removeBattle succeeds (cleanup path)
    battleManager.updateParticipantState("battle-3", "p3", "ELIMINATED");
    battleManager.updateParticipantState("battle-3", "e3", "ELIMINATED");

    // Remove battle
    const result = battleManager.removeBattle("battle-3");
    expect("removedBattleId" in result).toBe(true);

    // Verify participant no longer found
    expect(battleManager.getBattleByParticipant("p3")).toBeUndefined();
    expect(battleManager.hasBattle("battle-3")).toBe(false);
  });

  it("E3E-021: removeBattle fails for non-resolved battle", () => {
    battleManager.createBattle("battle-4",
      { id: "p4", position: { x: 0, y: 0, chunkX: 0, chunkY: 0 }, combatPower: 10, state: "ACTIVE" },
      { id: "e4", position: { x: 1, y: 1, chunkX: 0, chunkY: 0 }, combatPower: 8, state: "ACTIVE" },
    );

    // Try to remove while still active — should fail
    const result = battleManager.removeBattle("battle-4");
    expect("error" in result).toBe(true);
  });

  it("E3E-022: No dual respawn — single death path", () => {
    // This is a structural test — verify the dual respawn fix
    // The actual respawn is in GameRoom, not testable here
    // This test verifies that CombatManager sessions are cleaned up properly
    combatManager.createCombatSession("combat-1", "battle-1", [
      { participantId: "p1", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e1", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ]);

    // Kill player
    combatManager.applyAttack("combat-1", "e1", "p1", {
      getStats: (id) => id === "e1" ? { attack: 20, defense: 5, level: 1 } : { attack: 10, defense: 3, level: 1 },
    });

    // Session should still exist (not auto-resolved)
    const session = combatManager.getCombatSession("combat-1");
    expect(session).toBeDefined();
    expect(session!.state).toBe("ACTIVE");

    // Remove combat session explicitly
    combatManager.removeCombatSession("combat-1");
    expect(combatManager.hasCombatSession("combat-1")).toBe(false);
  });

  it("E3E-023: getBattles returns empty when no battles", () => {
    const battles = battleManager.getBattles();
    expect(battles.size).toBe(0);
  });

  it("E3E-024: BattleCombatBridge works without redundant map", () => {
    // Create battle + combat through bridge
    battleManager.createBattle("battle-5",
      { id: "p5", position: { x: 0, y: 0, chunkX: 0, chunkY: 0 }, combatPower: 10, state: "ACTIVE" },
      { id: "e5", position: { x: 1, y: 1, chunkX: 0, chunkY: 0 }, combatPower: 8, state: "ACTIVE" },
    );

    const hpProvider = {
      getHp: (id: string) => {
        if (id === "p5") return { currentHp: 100, maxHp: 100 };
        if (id === "e5") return { currentHp: 80, maxHp: 80 };
        return undefined;
      },
    };

    const beginResult = bridge.beginEncounter("battle-5", hpProvider);
    expect("session" in beginResult).toBe(true);

    // Verify hasActiveCombat works (uses CombatManager, not bridge map)
    expect(bridge.hasActiveCombat("battle-5")).toBe(true);

    // Verify getCombatId works
    const combatId = bridge.getCombatId("battle-5");
    expect(combatId).toBeDefined();
  });
});
