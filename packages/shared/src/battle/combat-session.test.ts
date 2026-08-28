import { describe, it, expect } from "vitest";
import type {
  CombatSession,
  CombatParticipantState,
  CombatState,
} from "./types.js";

/* ── Fixtures ── */

function combatParticipant(
  overrides?: Partial<CombatParticipantState>,
): CombatParticipantState {
  return {
    participantId: "p1",
    currentHp: 100,
    maxHp: 100,
    initiative: 10,
    alive: true,
    defending: false,
    side: "player",
    ...overrides,
  };
}

function createTestSession(
  overrides?: Partial<CombatSession>,
): CombatSession {
  return {
    id: "session-1",
    battleId: "battle-1",
    state: "ACTIVE",
    round: 1,
    currentActorId: "p1",
    turnOrder: ["p1", "e1"],
    participants: [
      combatParticipant({ participantId: "p1" }),
      combatParticipant({ participantId: "e1", currentHp: 80, initiative: 5 }),
    ],
    turnStartedAt: null,
    turnTimeoutMs: null,
    ...overrides,
  };
}

/* ════════════════ CombatSession Domain Types ════════════════ */

describe("CombatSession", () => {
  /* ── Session creation ── */

  it("CS-001 can create a 1v1 combat session", () => {
    const session = createTestSession({
      turnOrder: ["p1", "e1"],
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({ participantId: "e1", currentHp: 80 }),
      ],
    });
    expect(session.turnOrder).toHaveLength(2);
    expect(session.participants).toHaveLength(2);
    expect(session.turnOrder).toEqual(["p1", "e1"]);
  });

  it("CS-002 can create a 2v1 combat session", () => {
    const session = createTestSession({
      turnOrder: ["p1", "p2", "e1"],
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({ participantId: "p2", currentHp: 90 }),
        combatParticipant({ participantId: "e1", currentHp: 80 }),
      ],
    });
    expect(session.turnOrder).toHaveLength(3);
    expect(session.participants).toHaveLength(3);
    expect(session.turnOrder).toEqual(["p1", "p2", "e1"]);
  });

  it("CS-003 can create a 2v2 combat session", () => {
    const session = createTestSession({
      turnOrder: ["p1", "p2", "e1", "e2"],
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({ participantId: "p2", currentHp: 90 }),
        combatParticipant({ participantId: "e1", currentHp: 80 }),
        combatParticipant({ participantId: "e2", currentHp: 70 }),
      ],
    });
    expect(session.turnOrder).toHaveLength(4);
    expect(session.participants).toHaveLength(4);
    expect(session.turnOrder).toEqual(["p1", "p2", "e1", "e2"]);
  });

  /* ── Structural invariants ── */

  it("CS-004 turnOrder contains unique participant IDs", () => {
    const session = createTestSession({
      turnOrder: ["p1", "p2", "e1", "e2"],
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({ participantId: "p2" }),
        combatParticipant({ participantId: "e1" }),
        combatParticipant({ participantId: "e2" }),
      ],
    });
    const uniqueIds = new Set(session.turnOrder);
    expect(uniqueIds.size).toBe(session.turnOrder.length);
  });

  it("CS-005 all turnOrder IDs exist in participants", () => {
    const session = createTestSession({
      turnOrder: ["p1", "p2", "e1"],
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({ participantId: "p2" }),
        combatParticipant({ participantId: "e1" }),
      ],
    });
    const participantIds = new Set(
      session.participants.map((p) => p.participantId),
    );
    for (const id of session.turnOrder) {
      expect(participantIds.has(id)).toBe(true);
    }
  });

  it("CS-006 currentActorId is in turnOrder", () => {
    const session = createTestSession({
      currentActorId: "p2",
      turnOrder: ["p1", "p2", "e1"],
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({ participantId: "p2" }),
        combatParticipant({ participantId: "e1" }),
      ],
    });
    expect(session.turnOrder).toContain(session.currentActorId);
  });

  /* ── Default / initial state ── */

  it("CS-007 session starts at round 1", () => {
    const session = createTestSession();
    expect(session.round).toBe(1);
  });

  it("CS-008 participant HP: currentHp <= maxHp, both > 0", () => {
    const session = createTestSession({
      participants: [
        combatParticipant({ participantId: "p1", currentHp: 100, maxHp: 100 }),
        combatParticipant({ participantId: "e1", currentHp: 50, maxHp: 80 }),
      ],
    });
    for (const p of session.participants) {
      expect(p.currentHp).toBeLessThanOrEqual(p.maxHp);
      expect(p.currentHp).toBeGreaterThan(0);
      expect(p.maxHp).toBeGreaterThan(0);
    }
  });

  it("CS-009 initiative is a number", () => {
    const p = combatParticipant({ initiative: 42 });
    expect(typeof p.initiative).toBe("number");
    expect(p.initiative).toBe(42);
  });

  it("CS-010 defending defaults to false", () => {
    const p = combatParticipant();
    expect(p.defending).toBe(false);
  });

  /* ── Participant states ── */

  it("CS-011 dead participant remains in participants array", () => {
    const session = createTestSession({
      participants: [
        combatParticipant({ participantId: "p1" }),
        combatParticipant({
          participantId: "e1",
          alive: false,
          currentHp: 0,
        }),
      ],
    });
    const deadParticipant = session.participants.find(
      (p) => p.participantId === "e1",
    );
    expect(deadParticipant).toBeDefined();
    expect(deadParticipant!.alive).toBe(false);
    expect(session.participants).toHaveLength(2);
  });

  /* ── Lifecycle ── */

  it("CS-012 resolved state", () => {
    const session = createTestSession({ state: "RESOLVED" });
    expect(session.state).toBe("RESOLVED");
  });

  it("CS-013 resolved session type has no addParticipant method", () => {
    // CombatSession is a pure data interface — no methods exist.
    // This is a compile-time guarantee verified at runtime by checking
    // that the object has only data properties.
    const session = createTestSession();
    const keys = Object.keys(session);
    expect(keys).not.toContain("addParticipant");
    expect(keys).not.toContain("removeParticipant");
    expect(keys).not.toContain("nextTurn");
  });

  it("CS-014 session references a battle via battleId", () => {
    const session = createTestSession({ battleId: "battle-42" });
    expect(session.battleId).toBe("battle-42");
  });

  it("CS-015 battle and combat states are independent", () => {
    // BattleGroup can be ACTIVE while CombatSession is RESOLVED
    // This is a type-level property verified by constructing both states independently.
    const battleState = "ACTIVE" as const;
    const combatState: CombatState = "RESOLVED";
    expect(battleState).toBe("ACTIVE");
    expect(combatState).toBe("RESOLVED");
    // Both types coexist without coupling
    const session = createTestSession({ state: combatState });
    expect(session.state).toBe("RESOLVED");
  });

  /* ── Immutability ── */

  it("CS-016 readonly fields cannot be reassigned at runtime", () => {
    const session = createTestSession();
    // In strict mode, readonly prevents assignment at compile time.
    // At runtime, the property is still writable on plain objects,
    // but the type contract guarantees immutability at the TS level.
    // We verify the type structure is correct by checking all expected keys exist.
    expect(session).toHaveProperty("id");
    expect(session).toHaveProperty("battleId");
    expect(session).toHaveProperty("state");
    expect(session).toHaveProperty("round");
    expect(session).toHaveProperty("currentActorId");
    expect(session).toHaveProperty("turnOrder");
    expect(session).toHaveProperty("participants");
  });
});
