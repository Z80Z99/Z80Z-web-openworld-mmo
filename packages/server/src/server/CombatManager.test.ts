import {
  type CombatSession,
  type CombatParticipantState,
  type CombatManagerError,
} from "@mmo/shared";
import { describe, expect, it } from "vitest";
import { CombatManager } from "./CombatManager.js";

/* ── Result type (mirrors BattleManager.test.ts pattern) ── */

type CombatResult =
  | { readonly session: CombatSession }
  | { readonly error: CombatManagerError };

/* ── Fixtures ── */

type CombatFixture = {
  readonly id?: string;
  readonly battleId?: string;
  readonly participants?: CombatParticipantState[];
};

function combatParticipant(
  id: string,
  overrides?: Partial<CombatParticipantState>,
): CombatParticipantState {
  return {
    participantId: id,
    currentHp: 100,
    maxHp: 100,
    initiative: 10,
    alive: true,
    defending: false,
    ...overrides,
  };
}

function sessionOf(result: CombatResult): CombatSession {
  expect(result).not.toHaveProperty("error");
  if ("session" in result) return result.session;
  return expect.fail(`Expected combat result, received ${(result as { error: string }).error}`);
}

function expectError(result: unknown, error: CombatManagerError): void {
  expect(result).toEqual({ error });
}

function createSession(
  manager: CombatManager,
  fixture: CombatFixture = {},
): CombatSession {
  return sessionOf(
    manager.createCombatSession(
      fixture.id ?? "combat-1",
      fixture.battleId ?? "battle-1",
      fixture.participants ?? [
        combatParticipant("player-1"),
        combatParticipant("enemy-1", { initiative: 5 }),
      ],
    ),
  );
}

/* ════════════════ CombatManager Runtime ════════════════ */

describe("CombatManager runtime", () => {
  /* ── Session creation ── */

  it("CM-001 can create a 1v1 combat session", () => {
    const manager = new CombatManager();
    const session = createSession(manager);
    expect(session.id).toBe("combat-1");
    expect(session.battleId).toBe("battle-1");
    expect(session.state).toBe("ACTIVE");
    expect(session.round).toBe(1);
    expect(session.turnOrder).toHaveLength(2);
    expect(session.participants).toHaveLength(2);
  });

  it("CM-002 can create a 2v1 combat session", () => {
    const manager = new CombatManager();
    const session = createSession(manager, {
      participants: [
        combatParticipant("player-1"),
        combatParticipant("player-2"),
        combatParticipant("enemy-1", { initiative: 5 }),
      ],
    });
    expect(session.turnOrder).toHaveLength(3);
    expect(session.participants).toHaveLength(3);
  });

  it("CM-003 can create a 2v2 combat session", () => {
    const manager = new CombatManager();
    const session = createSession(manager, {
      participants: [
        combatParticipant("player-1"),
        combatParticipant("player-2"),
        combatParticipant("enemy-1", { initiative: 5 }),
        combatParticipant("enemy-2", { initiative: 3 }),
      ],
    });
    expect(session.turnOrder).toHaveLength(4);
    expect(session.participants).toHaveLength(4);
  });

  /* ── Duplicate / invalid guards ── */

  it("CM-004 duplicate active combat for same battle rejected", () => {
    const manager = new CombatManager();
    createSession(manager, { battleId: "b1" });
    const result = manager.createCombatSession("combat-2", "b1", [
      combatParticipant("p1"),
    ]);
    expectError(result, "ACTIVE_COMBAT_EXISTS_FOR_BATTLE");
  });

  it("CM-005 invalid battle rejected", () => {
    const manager = new CombatManager();
    expectError(
      manager.createCombatSession("c1", "", [combatParticipant("p1")]),
      "INVALID_BATTLE_ID",
    );
    expectError(
      manager.createCombatSession("c1", "   ", [combatParticipant("p1")]),
      "INVALID_BATTLE_ID",
    );
  });

  /* ── Lookup ── */

  it("CM-006 get by combat ID", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1" });
    const found = manager.getCombatSession("c1");
    expect(found).toBeDefined();
    expect(found!.id).toBe("c1");
  });

  it("CM-007 get by battle ID", () => {
    const manager = new CombatManager();
    createSession(manager, { battleId: "b1" });
    const found = manager.getCombatSessionByBattle("b1");
    expect(found).toBeDefined();
    expect(found!.battleId).toBe("b1");
  });

  /* ── Participant management ── */

  it("CM-008 add combat participant", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1" });
    const result = manager.addCombatParticipant("c1", combatParticipant("p3"));
    const session = sessionOf(result);
    expect(session.participants).toHaveLength(3);
    expect(session.turnOrder).toContain("p3");
  });

  it("CM-009 duplicate participant rejected", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1" });
    const result = manager.addCombatParticipant(
      "c1",
      combatParticipant("player-1"),
    );
    expectError(result, "PARTICIPANT_ALREADY_IN_COMBAT");
  });

  /* ── Participant state ── */

  it("CM-010 participant state update (defending toggle)", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1" });
    const result = manager.setCombatParticipantDefending("c1", "player-1", true);
    const session = sessionOf(result);
    const p = session.participants.find((x) => x.participantId === "player-1");
    expect(p).toBeDefined();
    expect(p!.defending).toBe(true);
  });

  /* ── Turn advancement ── */

  it("CM-011 advance turn basic", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "c1",
      participants: [
        combatParticipant("p1", { initiative: 10 }),
        combatParticipant("p2", { initiative: 5 }),
      ],
    });
    const before = manager.getCombatSession("c1")!;
    expect(before.currentActorId).toBe("p1");
    const result = manager.advanceTurn("c1");
    const after = sessionOf(result);
    expect(after.currentActorId).toBe("p2");
  });

  it("CM-012 dead participant skipped", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "c1",
      participants: [
        combatParticipant("p1", { initiative: 10 }),
        combatParticipant("p2", { initiative: 7, alive: false }),
        combatParticipant("p3", { initiative: 5 }),
      ],
    });
    // currentActorId = p1, advance → skip p2 (dead) → p3
    const result = manager.advanceTurn("c1");
    const after = sessionOf(result);
    expect(after.currentActorId).toBe("p3");
  });

  it("CM-013 round increments after full cycle", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "c1",
      participants: [
        combatParticipant("p1", { initiative: 10 }),
        combatParticipant("p2", { initiative: 5 }),
      ],
    });
    // p1 → p2 (advance 1)
    manager.advanceTurn("c1");
    // p2 → p1 (advance 2, wraps around → round++)
    const result = manager.advanceTurn("c1");
    const after = sessionOf(result);
    expect(after.round).toBe(2);
    expect(after.currentActorId).toBe("p1");
  });

  it("CM-014 current actor removed → auto-advance", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "c1",
      participants: [
        combatParticipant("p1", { initiative: 10 }),
        combatParticipant("p2", { initiative: 5 }),
      ],
    });
    // currentActorId = p1, remove p1 → should advance to p2
    const result = manager.removeCombatParticipant("c1", "p1");
    const after = sessionOf(result);
    expect(after.currentActorId).toBe("p2");
    expect(after.participants).toHaveLength(1);
  });

  it("CM-015 no alive participant → RESOLVED", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "c1",
      participants: [combatParticipant("p1")],
    });
    const result = manager.removeCombatParticipant("c1", "p1");
    const after = sessionOf(result);
    expect(after.state).toBe("RESOLVED");
  });

  /* ── Session removal ── */

  it("CM-016 remove combat session", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1", battleId: "b1" });
    const removeResult = manager.removeCombatSession("c1");
    expect(removeResult).toEqual({ removedCombatId: "c1" });
    expect(manager.getCombatSession("c1")).toBeUndefined();
    expect(manager.getCombatSessionByBattle("b1")).toBeUndefined();
  });
});

/* ════════════════ CombatManager Ownership and Lifecycle ════════════════ */

describe("CombatManager ownership and lifecycle", () => {
  it("CM-017 snapshot isolation (mutation doesn't affect internal)", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1" });
    const snapshot1 = manager.getCombatSession("c1")!;
    // Attempt to mutate snapshot (readonly prevents at TS level, but runtime object is mutable)
    (snapshot1 as any).round = 999;
    (snapshot1 as any).state = "RESOLVED";
    const snapshot2 = manager.getCombatSession("c1")!;
    expect(snapshot2.round).toBe(1);
    expect(snapshot2.state).toBe("ACTIVE");
  });

  it("CM-018 Battle ACTIVE + Combat RESOLVED (lifecycle independence)", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1", battleId: "b1" });
    // Set combat to RESOLVED — battle state is independent
    const result = manager.setCombatState("c1", "RESOLVED");
    const session = sessionOf(result);
    expect(session.state).toBe("RESOLVED");
    // Battle is still "ACTIVE" in BattleManager — no coupling
  });

  it("CM-019 Battle ACTIVE + Combat ACTIVE", () => {
    const manager = new CombatManager();
    const session = createSession(manager, { id: "c1", battleId: "b1" });
    expect(session.state).toBe("ACTIVE");
    // Default state after creation
  });

  it("CM-020 two different battles → independent combats", () => {
    const manager = new CombatManager();
    createSession(manager, { id: "c1", battleId: "b1" });
    createSession(manager, { id: "c2", battleId: "b2" });
    manager.setCombatState("c1", "RESOLVED");
    const s1 = manager.getCombatSession("c1")!;
    const s2 = manager.getCombatSession("c2")!;
    expect(s1.state).toBe("RESOLVED");
    expect(s2.state).toBe("ACTIVE");
  });
});
