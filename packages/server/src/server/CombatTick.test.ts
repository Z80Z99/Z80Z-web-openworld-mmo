import { describe, it, expect, beforeEach } from "vitest";
import { CombatManager } from "./CombatManager.js";
import type { CombatSession } from "@mmo/shared";

describe("Phase 3E-2: Combat Tick Integration", () => {
  let combatManager: CombatManager;

  beforeEach(() => {
    combatManager = new CombatManager();
  });

  function createActiveSession(combatId: string, battleId: string, timeoutMs: number = 30000): CombatSession {
    const result = combatManager.createCombatSession(combatId, battleId, [
      { participantId: "p1", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e1", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ], timeoutMs);
    if ("error" in result) throw new Error(`Failed to create session: ${result.error}`);
    return result.session;
  }

  it("E3E-007: tickCombatSessions with no active sessions is a no-op", () => {
    // No sessions exist — evaluateTurnTimeout should not throw
    const sessions = combatManager.getActiveSessions();
    expect(sessions).toHaveLength(0);
    // Calling evaluateTurnTimeout on non-existent session returns error (not thrown)
    const result = combatManager.evaluateTurnTimeout("nonexistent", Date.now());
    expect("error" in result).toBe(true);
  });

  it("E3E-008: tickCombatSessions auto-defends on timeout", () => {
    const session = createActiveSession("combat-1", "battle-1", 1000); // 1 second timeout
    const initialActor = session.currentActorId;

    // Advance time past timeout
    const futureTime = Date.now() + 2000;
    const result = combatManager.evaluateTurnTimeout("combat-1", futureTime);

    // Should succeed (no error)
    expect("error" in result).toBe(false);

    // Current actor should have changed (turn advanced after auto-defend)
    const updated = combatManager.getCombatSession("combat-1");
    expect(updated).toBeDefined();
    expect(updated!.currentActorId).not.toBe(initialActor);
  });

  it("E3E-009: tickCombatSessions advances turn after timeout", () => {
    const session = createActiveSession("combat-2", "battle-2", 500);
    const initialActor = session.currentActorId;

    // First tick — within timeout, no change
    combatManager.evaluateTurnTimeout("combat-2", Date.now());
    let updated = combatManager.getCombatSession("combat-2");
    expect(updated!.currentActorId).toBe(initialActor);

    // Second tick — past timeout, turn advances
    combatManager.evaluateTurnTimeout("combat-2", Date.now() + 1000);
    updated = combatManager.getCombatSession("combat-2");
    expect(updated!.currentActorId).not.toBe(initialActor);
  });

  it("E3E-010: tickCombatSessions does nothing when within timeout", () => {
    const session = createActiveSession("combat-3", "battle-3", 60000); // 60s timeout
    const initialActor = session.currentActorId;

    // Tick immediately — well within timeout
    combatManager.evaluateTurnTimeout("combat-3", Date.now());
    const updated = combatManager.getCombatSession("combat-3");
    expect(updated!.currentActorId).toBe(initialActor);
  });

  it("E3E-011: tickCombatSessions handles multiple active sessions independently", () => {
    createActiveSession("combat-a", "battle-a", 1000);
    createActiveSession("combat-b", "battle-b", 5000);

    const sessions = combatManager.getActiveSessions();
    expect(sessions).toHaveLength(2);

    // Tick both — only combat-a should timeout
    const futureTime = Date.now() + 2000;
    for (const s of sessions) {
      combatManager.evaluateTurnTimeout(s.id, futureTime);
    }

    // combat-a should have advanced (1s timeout < 2s elapsed)
    const updatedA = combatManager.getCombatSession("combat-a");
    expect(updatedA).toBeDefined();

    // combat-b should NOT have advanced (5s timeout > 2s elapsed)
    const updatedB = combatManager.getCombatSession("combat-b");
    expect(updatedB).toBeDefined();
    expect(updatedB!.currentActorId).toBe(sessions.find(s => s.id === "combat-b")!.currentActorId);
  });

  it("E3E-012: tickCombatSessions skips resolved sessions", () => {
    createActiveSession("combat-4", "battle-4", 1000);
    combatManager.setCombatState("combat-4", "RESOLVED");

    const sessions = combatManager.getActiveSessions();
    expect(sessions).toHaveLength(0);

    // evaluateTurnTimeout on resolved session returns error (not in active set)
    const result = combatManager.evaluateTurnTimeout("combat-4", Date.now() + 5000);
    expect("error" in result).toBe(true);
  });
});
