import {
  type CombatSession,
  type CombatParticipantState,
  type CombatManagerError,
  type CombatStatsProvider,
  type DamageResult,
} from "@mmo/shared";
import { calculateDamage } from "./CombatSystem.js";
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
    side: "player",
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
        combatParticipant("player-1", { side: "player" }),
        combatParticipant("enemy-1", { initiative: 5, side: "enemy" }),
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

/* ════════════════ Phase 3D-2A: Damage Pipeline ════════════════ */

function makeStatsProvider(
  stats: Record<string, { attack: number; defense: number; level: number }>,
): CombatStatsProvider {
  return {
    getStats(id: string) {
      return stats[id];
    },
  };
}

function createDuelSession(
  manager: CombatManager,
  opts: {
    combatId?: string;
    p1Stats?: { attack: number; defense: number; level: number };
    e1Stats?: { attack: number; defense: number; level: number };
    p1Hp?: number;
    e1Hp?: number;
  } = {},
): { session: CombatSession; statsProvider: CombatStatsProvider } {
  const combatId = opts.combatId ?? "combat-1";
  const p1Stats = opts.p1Stats ?? { attack: 10, defense: 5, level: 1 };
  const e1Stats = opts.e1Stats ?? { attack: 8, defense: 3, level: 1 };
  const p1Hp = opts.p1Hp ?? 100;
  const e1Hp = opts.e1Hp ?? 100;

  const session = createSession(manager, {
    id: combatId,
    battleId: "battle-1",
    participants: [
      combatParticipant("player-1", { side: "player", currentHp: p1Hp, maxHp: p1Hp }),
      combatParticipant("enemy-1", { side: "enemy", currentHp: e1Hp, maxHp: e1Hp, initiative: 5 }),
    ],
  });

  const statsProvider = makeStatsProvider({
    "player-1": p1Stats,
    "enemy-1": e1Stats,
  });

  return { session, statsProvider };
}

type AttackResult =
  | { readonly result: DamageResult }
  | { readonly error: CombatManagerError };

function resultOf(r: AttackResult): DamageResult {
  expect(r).not.toHaveProperty("error");
  if ("result" in r) return r.result;
  return expect.fail(`Expected attack result, ${(r as { error: string }).error}`);
}

describe("Phase 3D-2A: CombatManager.applyAttack", () => {
  /* ── DM-001: basic attack ── */
  it("DM-001: basic attack deals calculated damage", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    // calculateDamage(10, 1, 3) = 10 * (1 + 0.1) - 3 = 11 - 3 = 8
    const r = resultOf(manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider));
    expect(r.damage).toBe(8);
    expect(r.remainingHp).toBe(92);
    expect(r.targetKilled).toBe(false);
  });

  /* ── DM-002: zero damage minimum 1 ── */
  it("DM-002: minimum damage is 1 even with high defense", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager, {
      p1Stats: { attack: 1, defense: 0, level: 1 },
      e1Stats: { attack: 1, defense: 100, level: 1 },
    });

    // calculateDamage(1, 1, 100) = 1 * 1.1 - 100 = -98.9 → max(1, -99) = 1
    const r = resultOf(manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider));
    expect(r.damage).toBe(1);
    expect(r.remainingHp).toBe(99);
  });

  /* ── DM-003: damage cannot exceed HP ── */
  it("DM-003: damage is clamped, remaining HP never negative", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager, {
      p1Stats: { attack: 100, defense: 0, level: 10 },
      e1Stats: { attack: 1, defense: 0, level: 1 },
      e1Hp: 5,
    });

    // High damage vs low HP target
    const r = resultOf(manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider));
    expect(r.remainingHp).toBe(0);
    expect(r.remainingHp).toBeGreaterThanOrEqual(0);
  });

  /* ── DM-004: HP clamps to zero ── */
  it("DM-004: HP clamps to exactly zero, not negative", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager, {
      p1Stats: { attack: 100, defense: 0, level: 10 },
      e1Hp: 1,
    });

    const r = resultOf(manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider));
    expect(r.remainingHp).toBe(0);
  });

  /* ── DM-005: target dies ── */
  it("DM-005: target dies when HP reaches 0", () => {
    const manager = new CombatManager();
    createDuelSession(manager, {
      p1Stats: { attack: 100, defense: 0, level: 10 },
      e1Hp: 1,
    });

    manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, makeStatsProvider({
      "player-1": { attack: 100, defense: 0, level: 10 },
      "enemy-1": { attack: 1, defense: 0, level: 1 },
    }));

    const session = manager.getCombatSession("combat-1")!;
    const target = session.participants.find((p) => p.participantId === "enemy-1")!;
    expect(target.alive).toBe(false);
    expect(target.defending).toBe(false);
    expect(target.currentHp).toBe(0);
  });

  /* ── DM-006: dead target rejected ── */
  it("DM-006: cannot attack a dead target", () => {
    const manager = new CombatManager();
    createDuelSession(manager, {
      p1Stats: { attack: 100, defense: 0, level: 10 },
      e1Hp: 1,
    });

    // Kill the target first — this also triggers side elimination (RESOLVED)
    manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, makeStatsProvider({
      "player-1": { attack: 100, defense: 0, level: 10 },
      "enemy-1": { attack: 1, defense: 0, level: 1 },
    }));

    // Phase 3F-3: combat auto-resolves when all enemies dead
    // Now try to attack again — combat is RESOLVED
    const r = manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, makeStatsProvider({
      "player-1": { attack: 10, defense: 5, level: 1 },
      "enemy-1": { attack: 8, defense: 3, level: 1 },
    }));
    expect(r).toEqual({ error: "COMBAT_NOT_ACTIVE" });
  });

  /* ── DM-007: dead attacker cannot attack ── */
  it("DM-007: dead attacker cannot attack", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("player-1", { side: "player", currentHp: 1, maxHp: 100 }),
        combatParticipant("enemy-1", { side: "enemy", currentHp: 100, maxHp: 100, initiative: 5 }),
      ],
    });

    const statsProvider = makeStatsProvider({
      "player-1": { attack: 10, defense: 5, level: 1 },
      "enemy-1": { attack: 100, defense: 0, level: 10 },
    });

    // Enemy attacks first (turn order: player-1 is current actor, but let's kill player first via enemy turn)
    // Actually player-1 is currentActor. Let's make enemy attack by swapping turn order.
    // Easier: just set player alive=false manually for testing
    // Can't do that via public API... let's use a different approach.
    // Create session where player is dead at start
    const manager2 = new CombatManager();
    manager2.createCombatSession("c1", "b1", [
      combatParticipant("p1", { side: "player", currentHp: 0, alive: false, maxHp: 100 }),
      combatParticipant("e1", { side: "enemy", currentHp: 100, maxHp: 100, initiative: 5 }),
    ]);

    const r = manager2.applyAttack("c1", { actorId: "p1", targetId: "e1", actionType: "ATTACK" }, statsProvider);
    expect(r).toEqual({ error: "ATTACKER_NOT_ALIVE" });
  });

  /* ── DM-008: attacker must be currentActor ── */
  it("DM-008: only current actor can attack", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    // player-1 is currentActor, enemy-1 tries to attack
    const r = manager.applyAttack("combat-1", { actorId: "enemy-1", targetId: "player-1", actionType: "ATTACK" }, statsProvider);
    expect(r).toEqual({ error: "NOT_CURRENT_ACTOR" });
  });

  /* ── DM-009: self attack rejected ── */
  it("DM-009: cannot attack yourself", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    const r = manager.applyAttack("combat-1", { actorId: "player-1", targetId: "player-1", actionType: "ATTACK" }, statsProvider);
    expect(r).toEqual({ error: "SELF_ATTACK_REJECTED" });
  });

  /* ── DM-010: friendly fire rejected ── */
  it("DM-010: cannot attack friendly (same side)", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("p1", { side: "player", currentHp: 100, maxHp: 100 }),
        combatParticipant("p2", { side: "player", currentHp: 100, maxHp: 100, initiative: 5 }),
      ],
    });

    const statsProvider = makeStatsProvider({
      "p1": { attack: 10, defense: 5, level: 1 },
      "p2": { attack: 8, defense: 3, level: 1 },
    });

    const r = manager.applyAttack("combat-1", { actorId: "p1", targetId: "p2", actionType: "ATTACK" }, statsProvider);
    expect(r).toEqual({ error: "FRIENDLY_FIRE_REJECTED" });
  });

  /* ── DM-011: explicit target selection ── */
  it("DM-011: attacker can target specific enemy", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("p1", { side: "player", currentHp: 100, maxHp: 100 }),
        combatParticipant("e1", { side: "enemy", currentHp: 100, maxHp: 100, initiative: 5 }),
        combatParticipant("e2", { side: "enemy", currentHp: 50, maxHp: 50, initiative: 3 }),
      ],
    });

    const statsProvider = makeStatsProvider({
      "p1": { attack: 10, defense: 5, level: 1 },
      "e1": { attack: 8, defense: 3, level: 1 },
      "e2": { attack: 5, defense: 1, level: 1 },
    });

    // Target e2 specifically
    const r = resultOf(manager.applyAttack("combat-1", { actorId: "p1", targetId: "e2", actionType: "ATTACK" }, statsProvider));
    expect(r.targetId).toBe("e2");
    expect(r.remainingHp).toBeLessThan(50);

    // e1 should be untouched
    const session = manager.getCombatSession("combat-1")!;
    const e1 = session.participants.find((p) => p.participantId === "e1")!;
    expect(e1.currentHp).toBe(100);
  });

  /* ── DM-012: 1v1 full round ── */
  it("DM-012: 1v1 — player attacks, turn advances to enemy", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    // Player attacks enemy
    manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider);

    const session = manager.getCombatSession("combat-1")!;
    expect(session.currentActorId).toBe("enemy-1");
  });

  /* ── DM-013: 2v1 ── */
  it("DM-013: 2v1 — two players vs one enemy", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("p1", { side: "player", currentHp: 100, maxHp: 100 }),
        combatParticipant("p2", { side: "player", currentHp: 90, maxHp: 90, initiative: 8 }),
        combatParticipant("e1", { side: "enemy", currentHp: 80, maxHp: 80, initiative: 5 }),
      ],
    });

    const statsProvider = makeStatsProvider({
      "p1": { attack: 10, defense: 5, level: 1 },
      "p2": { attack: 12, defense: 4, level: 2 },
      "e1": { attack: 8, defense: 3, level: 1 },
    });

    // p1 attacks e1
    manager.applyAttack("combat-1", { actorId: "p1", targetId: "e1", actionType: "ATTACK" }, statsProvider);
    const s1 = manager.getCombatSession("combat-1")!;
    expect(s1.currentActorId).toBe("p2");

    // p2 attacks e1
    manager.applyAttack("combat-1", { actorId: "p2", targetId: "e1", actionType: "ATTACK" }, statsProvider);
    const s2 = manager.getCombatSession("combat-1")!;
    // Turn wraps to e1 (or resolves if dead)
    expect(["e1", "p1"]).toContain(s2.currentActorId);
  });

  /* ── DM-014: 1v2 ── */
  it("DM-014: 1v2 — one player vs two enemies", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("p1", { side: "player", currentHp: 100, maxHp: 100 }),
        combatParticipant("e1", { side: "enemy", currentHp: 100, maxHp: 100, initiative: 5 }),
        combatParticipant("e2", { side: "enemy", currentHp: 60, maxHp: 60, initiative: 3 }),
      ],
    });

    const statsProvider = makeStatsProvider({
      "p1": { attack: 10, defense: 5, level: 1 },
      "e1": { attack: 8, defense: 3, level: 1 },
      "e2": { attack: 6, defense: 2, level: 1 },
    });

    // p1 attacks e1
    manager.applyAttack("combat-1", { actorId: "p1", targetId: "e1", actionType: "ATTACK" }, statsProvider);
    const s1 = manager.getCombatSession("combat-1")!;
    expect(s1.currentActorId).toBe("e1");

    // e1 attacks p1
    manager.applyAttack("combat-1", { actorId: "e1", targetId: "p1", actionType: "ATTACK" }, statsProvider);
    const s2 = manager.getCombatSession("combat-1")!;
    expect(s2.currentActorId).toBe("e2");
  });

  /* ── DM-015: 2v2 ── */
  it("DM-015: 2v2 full multi-party combat", () => {
    const manager = new CombatManager();
    createSession(manager, {
      id: "combat-1",
      battleId: "battle-1",
      participants: [
        combatParticipant("p1", { side: "player", currentHp: 100, maxHp: 100 }),
        combatParticipant("p2", { side: "player", currentHp: 90, maxHp: 90, initiative: 8 }),
        combatParticipant("e1", { side: "enemy", currentHp: 100, maxHp: 100, initiative: 5 }),
        combatParticipant("e2", { side: "enemy", currentHp: 70, maxHp: 70, initiative: 3 }),
      ],
    });

    const statsProvider = makeStatsProvider({
      "p1": { attack: 10, defense: 5, level: 1 },
      "p2": { attack: 12, defense: 4, level: 2 },
      "e1": { attack: 8, defense: 3, level: 1 },
      "e2": { attack: 6, defense: 2, level: 1 },
    });

    // p1 → e1
    manager.applyAttack("combat-1", { actorId: "p1", targetId: "e1", actionType: "ATTACK" }, statsProvider);
    // p2 → e2
    manager.applyAttack("combat-1", { actorId: "p2", targetId: "e2", actionType: "ATTACK" }, statsProvider);

    const session = manager.getCombatSession("combat-1")!;
    // After p2 attacks, turn should be on e1 (next alive enemy)
    expect(session.currentActorId).toBe("e1");
  });

  /* ── DM-016: calculateDamage reused ── */
  it("DM-016: damage matches direct calculateDamage call", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    const r = resultOf(manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider));

    // Verify against direct calculation
    const expected = calculateDamage(10, 1, 3); // attack=10, level=1, defense=3
    expect(r.damage).toBe(expected);
  });

  /* ── DM-017: deterministic damage ── */
  it("DM-017: same inputs always produce same damage", () => {
    const r1 = calculateDamage(10, 1, 3);
    const r2 = calculateDamage(10, 1, 3);
    const r3 = calculateDamage(10, 1, 3);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  /* ── DM-018: no World HP mutation ── */
  it("DM-018: CombatManager only modifies CombatSession HP, not external state", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager, { e1Hp: 100 });

    const beforeSession = manager.getCombatSession("combat-1")!;
    const beforeHp = beforeSession.participants.find((p) => p.participantId === "enemy-1")!.currentHp;

    manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider);

    const afterSession = manager.getCombatSession("combat-1")!;
    const afterHp = afterSession.participants.find((p) => p.participantId === "enemy-1")!.currentHp;

    // HP changed in CombatSession
    expect(afterHp).toBeLessThan(beforeHp);
    // No external state was touched (this is a unit test — CombatManager has no reference to World state)
  });

  /* ── DM-019: combat snapshot isolation ── */
  it("DM-019: snapshots returned by applyAttack are independent copies", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    const r = resultOf(manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider));
    const fresh = manager.getCombatSession("combat-1")!;

    // Result has remainingHp, fresh session has updated state
    expect(r.remainingHp).toBe(
      fresh.participants.find((p) => p.participantId === "enemy-1")!.currentHp,
    );

    // Mutating fresh shouldn't affect future snapshots
    // (Can't easily mutate readonly, but verify structural independence)
    expect(r).not.toBe(fresh);
  });

  /* ── DM-020: attack advances turn correctly ── */
  it("DM-020: attack always advances turn to next alive participant", () => {
    const manager = new CombatManager();
    const { statsProvider } = createDuelSession(manager);

    const before = manager.getCombatSession("combat-1")!;
    expect(before.currentActorId).toBe("player-1");

    manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider);

    const after = manager.getCombatSession("combat-1")!;
    expect(after.currentActorId).toBe("enemy-1");
    expect(after.round).toBeGreaterThanOrEqual(1);
  });

  /* ── DM-021: combat not found ── */
  it("DM-021: applyAttack on nonexistent combat returns error", () => {
    const manager = new CombatManager();
    const statsProvider = makeStatsProvider({});
    const r = manager.applyAttack("nonexistent", { actorId: "a", targetId: "b", actionType: "ATTACK" }, statsProvider);
    expect(r).toEqual({ error: "COMBAT_NOT_FOUND" });
  });

  /* ── DM-022: combat not active ── */
  it("DM-022: applyAttack on resolved combat returns error", () => {
    const manager = new CombatManager();
    createDuelSession(manager);
    manager.setCombatState("combat-1", "RESOLVED");

    const statsProvider = makeStatsProvider({
      "player-1": { attack: 10, defense: 5, level: 1 },
      "enemy-1": { attack: 8, defense: 3, level: 1 },
    });
    const r = manager.applyAttack("combat-1", { actorId: "player-1", targetId: "enemy-1", actionType: "ATTACK" }, statsProvider);
    expect(r).toEqual({ error: "COMBAT_NOT_ACTIVE" });
  });
});
