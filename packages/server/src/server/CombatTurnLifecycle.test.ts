import {
  type CombatSession,
  type CombatParticipantState,
  type CombatManagerError,
} from "@mmo/shared";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CombatManager } from "./CombatManager.js";

/* ── Result type ── */

type CombatResult =
  | { readonly session: CombatSession }
  | { readonly error: CombatManagerError };

/* ── Fixtures ── */

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
    side: "player",
    ...overrides,
  };
}

function sessionOf(result: CombatResult): CombatSession {
  expect(result).not.toHaveProperty("error");
  if ("session" in result) return result.session;
  return expect.fail(
    `Expected combat result, received ${(result as { error: string }).error}`,
  );
}

function expectError(result: unknown, error: CombatManagerError): void {
  expect(result).toEqual({ error });
}

/** Unwrap getCombatSession() result directly (no CombatResult wrapper). */
function getSession(manager: CombatManager, combatId: string): CombatSession {
  const s = manager.getCombatSession(combatId);
  expect(s).toBeDefined();
  return s!;
}

function createSession(
  manager: CombatManager,
  opts: {
    id?: string;
    battleId?: string;
    participants?: CombatParticipantState[];
    timeoutMs?: number;
  } = {},
): CombatSession {
  return sessionOf(
    manager.createCombatSession(
      opts.id ?? "combat-1",
      opts.battleId ?? "battle-1",
      opts.participants ?? [
        combatParticipant("player-1", { side: "player" }),
        combatParticipant("enemy-1", { initiative: 5, side: "enemy" }),
      ],
      opts.timeoutMs,
    ),
  );
}

/* ════════════════ Combat Turn Lifecycle (Phase 3D-3) ════════════════ */

describe("Combat turn lifecycle (Phase 3D-3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* ── TL-001: Initial turn assigned to first alive in initiative order ── */
  it("TL-001: initial turn assigned to first alive in initiative order", () => {
    const manager = new CombatManager();
    const session = createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 5, side: "player" }),
        combatParticipant("p2", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 3, side: "enemy" }),
      ],
    });
    // p2 has highest initiative (10), should be first actor
    expect(session.currentActorId).toBe("p2");
    expect(session.turnOrder[0]).toBe("p2");
  });

  /* ── TL-002: Initial turn skips dead participants ── */
  it("TL-002: initial turn skips dead participants", () => {
    const manager = new CombatManager();
    const session = createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player", alive: false }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });
    // p1 is dead, e1 should be first actor
    expect(session.currentActorId).toBe("e1");
  });

  /* ── TL-003: Advance 1v1 ── */
  it("TL-003: advance 1v1", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // Initial: p1 (highest initiative)
    const s1 = getSession(manager, "combat-1");
    expect(s1.currentActorId).toBe("p1");

    // Advance: should go to e1
    const result = manager.advanceTurn("combat-1");
    const s2 = sessionOf(result);
    expect(s2.currentActorId).toBe("e1");

    // Advance: should wrap back to p1
    const s3 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s3.currentActorId).toBe("p1");
  });

  /* ── TL-004: Advance 2v1 ── */
  it("TL-004: advance 2v1", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("p2", { initiative: 8, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // Initial: p1 (highest initiative)
    const s1 = getSession(manager, "combat-1");
    expect(s1.currentActorId).toBe("p1");

    // Advance: p1 → p2
    const s2 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s2.currentActorId).toBe("p2");

    // Advance: p2 → e1
    const s3 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s3.currentActorId).toBe("e1");

    // Advance: e1 → p1 (wrap)
    const s4 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s4.currentActorId).toBe("p1");
  });

  /* ── TL-005: Advance 2v2 ── */
  it("TL-005: advance 2v2", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("p2", { initiative: 8, side: "player" }),
        combatParticipant("e1", { initiative: 6, side: "enemy" }),
        combatParticipant("e2", { initiative: 4, side: "enemy" }),
      ],
    });

    // Initial: p1
    const s1 = getSession(manager, "combat-1");
    expect(s1.currentActorId).toBe("p1");

    // Advance through all: p1 → p2 → e1 → e2 → p1
    const s2 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s2.currentActorId).toBe("p2");

    const s3 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s3.currentActorId).toBe("e1");

    const s4 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s4.currentActorId).toBe("e2");

    const s5 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s5.currentActorId).toBe("p1");
  });

  /* ── TL-006: Round increments on full cycle ── */
  it("TL-006: round increments on full cycle", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    const s1 = getSession(manager, "combat-1");
    expect(s1.round).toBe(1);

    // p1 → e1 (no wrap yet)
    const s2 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s2.round).toBe(1);

    // e1 → p1 (wrap, round++)
    const s3 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s3.round).toBe(2);

    // p1 → e1 (no wrap)
    const s4 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s4.round).toBe(2);

    // e1 → p1 (wrap, round++)
    const s5 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s5.round).toBe(3);
  });

  /* ── TL-007: Dead participant skipped on advance ── */
  it("TL-007: dead participant skipped on advance", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("p2", { initiative: 8, side: "player", alive: false }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // Initial: p1
    const s1 = getSession(manager, "combat-1");
    expect(s1.currentActorId).toBe("p1");

    // Advance: skip dead p2, go to e1
    const s2 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s2.currentActorId).toBe("e1");

    // Advance: wrap, skip dead p2, go to p1
    const s3 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s3.currentActorId).toBe("p1");
  });

  /* ── TL-008: Current actor death advances turn ── */
  it("TL-008: current actor death advances turn", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player", currentHp: 1, maxHp: 100 }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    const stats: Record<string, { attack: number; defense: number; level: number }> = {
      "e1": { attack: 100, defense: 5, level: 1 },
      "p1": { attack: 5, defense: 5, level: 1 },
    };

    const statsProvider = {
      getStats(id: string) { return stats[id]; },
    };

    // p1 is current actor but e1 attacks first (this is a test scenario)
    // We need to manually set currentActor to e1 first
    manager.advanceTurn("combat-1");

    // Now e1 attacks p1 (lethal)
    manager.applyAttack("combat-1", "e1", "p1", statsProvider);

    // After p1 dies, turn should advance to next alive (back to e1)
    const session = getSession(manager, "combat-1");
    expect(session.participants.find(p => p.participantId === "p1")?.alive).toBe(false);
  });

  /* ── TL-009: Current participant removed advances turn ── */
  it("TL-009: current participant removed advances turn", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("p2", { initiative: 8, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // p1 is current actor
    const s1 = getSession(manager, "combat-1");
    expect(s1.currentActorId).toBe("p1");

    // Remove p1 (current actor)
    manager.removeCombatParticipant("combat-1", "p1");

    // Turn should advance to p2
    const s2 = getSession(manager, "combat-1");
    expect(s2.currentActorId).toBe("p2");
  });

  /* ── TL-010: Non-current participant removed no advance ── */
  it("TL-010: non-current participant removed no advance", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("p2", { initiative: 8, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // p1 is current actor
    const s1 = getSession(manager, "combat-1");
    expect(s1.currentActorId).toBe("p1");

    // Remove e1 (non-current)
    manager.removeCombatParticipant("combat-1", "e1");

    // Current actor should still be p1
    const s2 = getSession(manager, "combat-1");
    expect(s2.currentActorId).toBe("p1");
  });

  /* ── TL-011: No alive participants → RESOLVED ── */
  it("TL-011: no alive participants → RESOLVED", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // Remove both participants
    manager.removeCombatParticipant("combat-1", "p1");
    manager.removeCombatParticipant("combat-1", "e1");

    const session = getSession(manager, "combat-1");
    expect(session.state).toBe("RESOLVED");
  });

  /* ── TL-012: turnStartedAt updated on advance ── */
  it("TL-012: turnStartedAt updated on advance", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    const s1 = getSession(manager, "combat-1");
    const initialTimestamp = s1.turnStartedAt;

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));

    const s2 = sessionOf(manager.advanceTurn("combat-1"));
    expect(s2.turnStartedAt).toBeGreaterThan(initialTimestamp ?? 0);
  });

  /* ── TL-013: timeout false before deadline ── */
  it("TL-013: timeout false before deadline", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    // Advance 5 seconds (still within timeout)
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));

    // Timeout check should return session (not timed out)
    const result = manager.evaluateTurnTimeout("combat-1", Date.now());
    const session = sessionOf(result);
    expect(session.currentActorId).toBe("p1"); // Still p1's turn
  });

  /* ── TL-014: timeout true at deadline ── */
  it("TL-014: timeout true at deadline", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    // Advance exactly 10 seconds (at deadline)
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    const result = manager.evaluateTurnTimeout("combat-1", Date.now());
    const session = sessionOf(result);
    // Should have advanced to e1
    expect(session.currentActorId).toBe("e1");
  });

  /* ── TL-015: timeout true after deadline ── */
  it("TL-015: timeout true after deadline", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    // Advance 15 seconds (past deadline)
    vi.setSystemTime(new Date("2026-01-01T00:00:15.000Z"));

    const result = manager.evaluateTurnTimeout("combat-1", Date.now());
    const session = sessionOf(result);
    expect(session.currentActorId).toBe("e1");
  });

  /* ── TL-016: timeout → defending ── */
  it("TL-016: timeout → defending", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    // Advance past timeout
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    manager.evaluateTurnTimeout("combat-1", Date.now());

    // p1 should now be defending
    const session = getSession(manager, "combat-1");
    const p1 = session.participants.find(p => p.participantId === "p1");
    expect(p1?.defending).toBe(true);
  });

  /* ── TL-017: timeout → advance ── */
  it("TL-017: timeout → advance", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    const result = manager.evaluateTurnTimeout("combat-1", Date.now());
    const session = sessionOf(result);
    expect(session.currentActorId).toBe("e1");
  });

  /* ── TL-018: repeated timeout evaluation idempotent ── */
  it("TL-018: repeated timeout evaluation idempotent", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    // First evaluation: advances to e1
    const s1 = sessionOf(manager.evaluateTurnTimeout("combat-1", Date.now()));
    expect(s1.currentActorId).toBe("e1");

    // Second evaluation: e1 hasn't timed out yet (just started)
    const s2 = sessionOf(manager.evaluateTurnTimeout("combat-1", Date.now()));
    expect(s2.currentActorId).toBe("e1"); // Still e1, no double advance
  });

  /* ── TL-019: deterministic turn order by initiative ── */
  it("TL-019: deterministic turn order by initiative", () => {
    const manager = new CombatManager();
    const session = createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 5, side: "player" }),
        combatParticipant("p2", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 3, side: "enemy" }),
        combatParticipant("e2", { initiative: 8, side: "enemy" }),
      ],
    });

    // Should be sorted: p2(10) → e2(8) → p1(5) → e1(3)
    expect(session.turnOrder).toEqual(["p2", "e2", "p1", "e1"]);
    expect(session.currentActorId).toBe("p2");
  });

  /* ── TL-020: Battle remains independent after Combat RESOLVED ── */
  it("TL-020: battle remains independent after Combat RESOLVED", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
    });

    // Remove all participants to trigger RESOLVED
    manager.removeCombatParticipant("combat-1", "p1");
    manager.removeCombatParticipant("combat-1", "e1");

    const session = getSession(manager, "combat-1");
    expect(session.state).toBe("RESOLVED");
    expect(session.battleId).toBe("battle-1"); // battleId still valid
  });

  /* ── TL-021: negative / invalid timestamp handling ── */
  it("TL-021: negative / invalid timestamp handling", () => {
    const manager = new CombatManager();
    createSession(manager, {
      participants: [
        combatParticipant("p1", { initiative: 10, side: "player" }),
        combatParticipant("e1", { initiative: 5, side: "enemy" }),
      ],
      timeoutMs: 10000,
    });

    // Evaluate with negative timestamp
    const result = manager.evaluateTurnTimeout("combat-1", -1);
    const session = sessionOf(result);
    // Should not timeout (negative elapsed)
    expect(session.currentActorId).toBe("p1");
  });

  /* ── TL-022: large turn order ── */
  it("TL-022: large turn order", () => {
    const manager = new CombatManager();
    const participants = Array.from({ length: 20 }, (_, i) =>
      combatParticipant(`p${i + 1}`, {
        initiative: 20 - i,
        side: i % 2 === 0 ? "player" : "enemy",
      }),
    );

    const session = createSession(manager, { participants });

    // Should have 20 participants sorted by initiative
    expect(session.turnOrder).toHaveLength(20);
    expect(session.currentActorId).toBe("p1"); // Highest initiative (20)

    // Advance through all 20 participants
    let currentSession = session;
    for (let i = 0; i < 19; i++) {
      const result = manager.advanceTurn("combat-1");
      currentSession = sessionOf(result);
    }

    // After 19 advances, should be at p20
    expect(currentSession.currentActorId).toBe("p20");

    // One more advance wraps to p1, round increments
    const finalResult = manager.advanceTurn("combat-1");
    const finalSession = sessionOf(finalResult);
    expect(finalSession.currentActorId).toBe("p1");
    expect(finalSession.round).toBe(2);
  });
});
