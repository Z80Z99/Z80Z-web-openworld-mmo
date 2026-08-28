import {
  type BattleGroup,
  type BattleParticipant,
  type CombatParticipantState,
  type CombatSession,
  type CombatPoint,
  type ParticipantState,
  type WorldHealthWriter,
  type CombatStatsProvider,
  type DamageResult,
} from "@mmo/shared";
import { describe, expect, it } from "vitest";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import {
  BattleCombatBridge,
  type HpProvider,
  type CombatActionBridgeResult,
} from "./BattleCombatBridge.js";

/* ═══════════════════════════════════════════════════════
 * Post-Audit FLEE / REJOIN / PENDING stability — Phase 3F-3
 *
 * FR-001 ~ FR-022 fix the three confirmed audit bugs:
 *   Bug #1  FLEEING → REJOIN cannot restore Combat TurnOrder
 *   Bug #2  Current actor FLEE causes wrong round++ / flush pending
 *   Bug #3  Pending FLEE gets wrongly flushed into turnOrder
 * ═══════════════════════════════════════════════════════ */

/* ── Helpers (mirror MultiParticipantCombatStability.test.ts) ── */

const point = (x: number, y: number): CombatPoint => ({ x, y });

function participant(
  id: string,
  position: CombatPoint,
  state: ParticipantState = "ACTIVE",
  combatPower = 10,
): BattleParticipant {
  return { id, position, combatPower, personality: "cautious", state };
}

function battleOf(result: { battle: BattleGroup } | { error: string }): BattleGroup {
  expect(result).not.toHaveProperty("error");
  if ("battle" in result) return result.battle;
  return expect.fail(`Expected battle result, received ${(result as { error: string }).error}`);
}

function sessionOf(result: { session: CombatSession } | { error: string }): CombatSession {
  expect(result).not.toHaveProperty("error");
  if ("session" in result) return result.session;
  return expect.fail(`Expected combat result, received ${(result as { error: string }).error}`);
}

function createBattle(
  manager: BattleManager,
  opts: {
    id?: string;
    player?: BattleParticipant;
    enemy?: BattleParticipant;
  } = {},
): BattleGroup {
  return battleOf(
    manager.createBattle(
      opts.id ?? "battle-1",
      opts.player ?? participant("player-1", point(0, 0)),
      opts.enemy ?? participant("enemy-1", point(1, 0)),
    ),
  );
}

function hpMap(
  entries: Array<{ id: string; currentHp: number; maxHp: number }>,
): HpProvider {
  const map = new Map<string, { currentHp: number; maxHp: number }>();
  for (const e of entries) map.set(e.id, { currentHp: e.currentHp, maxHp: e.maxHp });
  return {
    getHp(id: string) {
      return map.get(id);
    },
  };
}

function worldHpMap(
  entries: Array<{ id: string; currentHp: number; maxHp: number }>,
): WorldHealthWriter {
  const map = new Map<string, { currentHp: number; maxHp: number }>();
  for (const e of entries) map.set(e.id, { currentHp: e.currentHp, maxHp: e.maxHp });
  return {
    getHp(id: string) {
      return map.get(id);
    },
    setHp(id: string, hp: number) {
      const entry = map.get(id);
      if (entry) entry.currentHp = Math.max(0, Math.min(hp, entry.maxHp));
      else map.set(id, { currentHp: Math.max(0, hp), maxHp: 100 });
    },
    isAlive(id: string) {
      const entry = map.get(id);
      return entry !== undefined && entry.currentHp > 0;
    },
  };
}

function statsMap(
  entries: Array<{ id: string; attack: number; defense: number; level: number }>,
): CombatStatsProvider {
  const map = new Map(entries.map((e) => [e.id, e]));
  return {
    getStats(id: string) {
      return map.get(id);
    },
  };
}

function damageOf(result: CombatActionBridgeResult): DamageResult {
  expect(result).not.toHaveProperty("error");
  if ("damage" in result) return result.damage;
  return expect.fail(`Expected damage result, received ${(result as { error: string }).error}`);
}

/** Fixture: fresh managers + bridge (optionally wired with a WorldHealthWriter). */
function makeBridge(world?: WorldHealthWriter): {
  bm: BattleManager;
  cm: CombatManager;
  bridge: BattleCombatBridge;
} {
  const bm = new BattleManager();
  const cm = new CombatManager();
  const bridge = new BattleCombatBridge(bm, cm, world);
  return { bm, cm, bridge };
}

/** Advance turns until the pending queue is flushed (round boundary). */
function flushAtRoundBoundary(cm: CombatManager, battleId: string): void {
  const combatId = cm.getCombatIdByBattle(battleId)!;
  // With two active turnOrder members a full cycle takes 2 advances; loop a
  // few extra times to be robust against re-sorted turn orders.
  for (let i = 0; i < 8; i++) cm.advanceTurn(combatId);
}

/* ── FR-001: FLEE → REJOIN restores turn eligibility ── */
describe("Post-Audit FLEE/REJOIN — Phase 3F-3", () => {
  it("FR-001: FLEE → REJOIN restores turn eligibility", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // enemy-2 flees → excluded from turnOrder
    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).not.toContain("enemy-2");

    // enemy-2 rejoins the battle → pending, not yet in turnOrder
    bm.updateParticipantState("battle-1", "enemy-2", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2.fleeing).toBe(false);
    expect(session.pendingParticipants.some((p) => p.participantId === "enemy-2")).toBe(true);
    expect(session.turnOrder).not.toContain("enemy-2");

    // Next round boundary → enemy-2 re-enters turnOrder
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).toContain("enemy-2");
  });

  it("FR-002: Rejoined participant HP preserved", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-2", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    flushAtRoundBoundary(cm, "battle-1");

    const session = cm.getCombatSessionByBattle("battle-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2.currentHp).toBe(70); // world HP preserved — never reset
  });

  it("FR-003: Rejoined initiative preserved", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-2", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    flushAtRoundBoundary(cm, "battle-1");

    const session = cm.getCombatSessionByBattle("battle-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2.initiative).toBe(8); // combatPower preserved
  });

  it("FR-004: Rejoined participant not current actor immediately", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-2", "ACTIVE");
    bridge.syncRejoinState("battle-1");

    // Immediately after rejoin enemy-2 must NOT be the current actor
    const session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.currentActorId).not.toBe("enemy-2");
    expect(session.pendingParticipants.some((p) => p.participantId === "enemy-2")).toBe(true);
  });

  /* ── FR-005 / FR-006: Bug #2 — current actor flee ── */
  it("FR-005: current actor flee does not increment round prematurely", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const initial = sessionOf(bridge.beginEncounter("battle-1", provider));
    expect(initial.round).toBe(1);
    expect(initial.currentActorId).toBe("player-1");

    // Current actor player-1 flees → advance must NOT increment round
    bm.updateParticipantState("battle-1", "player-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    const session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.round).toBe(1);
    expect(session.currentActorId).toBe("enemy-1");
    expect(session.state).toBe("ACTIVE");
  });

  it("FR-006: current actor flee does not flush pending", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);
    // player-2 joins the battle mid-combat, then the combat → pending
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1), "ACTIVE", 7));
    sessionOf(bridge.addParticipantToCombat("battle-1", "player-2", provider));
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.pendingParticipants.some((p) => p.participantId === "player-2")).toBe(true);

    // Current actor player-1 flees → pending player-2 must NOT be flushed
    bm.updateParticipantState("battle-1", "player-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.round).toBe(1);
    expect(session.turnOrder).not.toContain("player-2");
    expect(session.pendingParticipants.some((p) => p.participantId === "player-2")).toBe(true);
  });

  /* ── FR-007 / FR-008: Bug #3 — pending FLEE ── */
  it("FR-007: pending FLEE never flushes into turnOrder", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);
    // enemy-2 joins the battle mid-combat, then the combat → pending
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    sessionOf(bridge.addParticipantToCombat("battle-1", "enemy-2", provider));

    // enemy-2 flees while pending
    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.pendingParticipants.some((p) => p.participantId === "enemy-2")).toBe(true);

    // Full cycle → flush must skip the fleeing pending participant
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).not.toContain("enemy-2");
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2.fleeing).toBe(true);
    expect(session.pendingParticipants.some((p) => p.participantId === "enemy-2")).toBe(true);
  });

  it("FR-008: pending FLEE can rejoin and regain turn eligibility", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);
    // enemy-2 joins the battle mid-combat, then the combat → pending
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    sessionOf(bridge.addParticipantToCombat("battle-1", "enemy-2", provider));

    // enemy-2 flees while pending, then rejoins
    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-2", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    let session = cm.getCombatSessionByBattle("battle-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2.fleeing).toBe(false);

    // Next round boundary → enemy-2 enters turnOrder
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).toContain("enemy-2");
  });

  /* ── FR-009 / FR-010: FLEEING vs DEAD ── */
  it("FR-009: FLEEING != DEAD", () => {
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 1, maxHp: 70 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 100, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
      { id: "enemy-2", attack: 8, defense: 3, level: 1 },
    ]);
    const { bm, cm, bridge } = makeBridge(world);
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    bridge.beginEncounter("battle-1", world as HpProvider);

    // enemy-2 flees → FLEEING keeps alive=true
    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    // player-1 (current actor) kills enemy-1 → DEAD alive=false
    damageOf(bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats));

    const session = cm.getCombatSessionByBattle("battle-1")!;
    const e1 = session.participants.find((p) => p.participantId === "enemy-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    // DEAD: alive=false (and not fleeing)
    expect(e1.alive).toBe(false);
    expect(e1.fleeing).toBe(false);
    // FLEEING: alive=true + fleeing=true — strictly distinct from DEAD
    expect(e2.alive).toBe(true);
    expect(e2.fleeing).toBe(true);

    // Kill the FLEEING participant → DEAD strictly clears FLEEING
    // (alive=false AND fleeing=false — never alive=false + fleeing=true)
    damageOf(bridge.applyCombatAction("battle-1", "player-1", "enemy-2", stats));
    const sessionAfter = cm.getCombatSessionByBattle("battle-1")!;
    const e2Dead = sessionAfter.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2Dead.alive).toBe(false);
    expect(e2Dead.fleeing).toBe(false);
  });

  it("FR-010: dead participant cannot rejoin", () => {
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 1, maxHp: 80 },
      { id: "enemy-2", currentHp: 80, maxHp: 80 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 100, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
      { id: "enemy-2", attack: 8, defense: 3, level: 1 },
    ]);
    const { bm, cm, bridge } = makeBridge(world);
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    // Keep enemy-2 alive so killing enemy-1 does NOT auto-resolve combat
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    bridge.beginEncounter("battle-1", world as HpProvider);

    // Kill enemy-1 (combat stays ACTIVE — enemy-2 survives)
    damageOf(bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats));
    expect(cm.getCombatSessionByBattle("battle-1")!.state).toBe("ACTIVE");

    const combatId = cm.getCombatIdByBattle("battle-1")!;
    const result = cm.rejoinCombatParticipant(combatId, "enemy-1");
    expect(result).toEqual({ error: "PARTICIPANT_NOT_ALIVE" });
  });

  /* ── FR-011 / FR-012: idempotency ── */
  it("FR-011: repeated FLEE evaluation idempotent", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-1", "FLEEING");
    const r1 = sessionOf(bridge.syncFleeingState("battle-1"));
    const r2 = sessionOf(bridge.syncFleeingState("battle-1"));
    expect(r1.turnOrder).toEqual(r2.turnOrder);
    expect(r2.turnOrder).not.toContain("enemy-1");
    const e1 = r2.participants.find((p) => p.participantId === "enemy-1")!;
    expect(e1.fleeing).toBe(true);
    expect(cm.getCombatSessionByBattle("battle-1")!.state).toBe("ACTIVE");
  });

  it("FR-012: repeated REJOIN evaluation idempotent", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-1", "ACTIVE");
    const r1 = sessionOf(bridge.syncRejoinState("battle-1"));
    const r2 = sessionOf(bridge.syncRejoinState("battle-1"));
    const e1 = r2.participants.find((p) => p.participantId === "enemy-1")!;
    expect(e1.fleeing).toBe(false);
    expect(r2.pendingParticipants.some((p) => p.participantId === "enemy-1")).toBe(true);
    expect(r1.turnOrder).toEqual(r2.turnOrder);
  });

  /* ── FR-013 / FR-014: invariants ── */
  it("FR-013: turnOrder contains no FLEEING participant", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Flee both enemies
    bm.updateParticipantState("battle-1", "enemy-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");

    const session = cm.getCombatSessionByBattle("battle-1")!;
    const fleeingIds = session.participants
      .filter((p) => p.fleeing)
      .map((p) => p.participantId);
    expect(fleeingIds.sort()).toEqual(["enemy-1", "enemy-2"]);
    for (const id of fleeingIds) {
      expect(session.turnOrder).not.toContain(id);
    }
    expect(session.turnOrder).toContain("player-1");
  });

  it("FR-014: currentActor never dangling", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    const assertCurrentActorValid = (battleId: string): void => {
      const session = cm.getCombatSessionByBattle(battleId)!;
      const ca = session.participants.find((p) => p.participantId === session.currentActorId)!;
      expect(ca).toBeDefined();
      expect(ca.alive).toBe(true);
      expect(ca.fleeing).toBe(false);
      expect(session.turnOrder).toContain(session.currentActorId);
    };

    // Current actor player-1 flees → next actor valid
    bm.updateParticipantState("battle-1", "player-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    assertCurrentActorValid("battle-1");

    // Remove the current actor → next actor valid
    bridge.removeParticipant("battle-1", cm.getCombatSessionByBattle("battle-1")!.currentActorId);
    assertCurrentActorValid("battle-1");
  });

  /* ── FR-015: round behavior ── */
  it("FR-015: round increments only on true cycle completion", () => {
    const { bm, cm, bridge } = makeBridge();
    createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const s1 = sessionOf(bridge.beginEncounter("battle-1", provider));
    expect(s1.round).toBe(1);
    const combatId = cm.getCombatIdByBattle("battle-1")!;

    // Partial cycle: no round++
    cm.advanceTurn(combatId);
    expect(cm.getCombatSession(combatId)!.round).toBe(1);

    // Full cycle: exactly +1
    cm.advanceTurn(combatId);
    expect(cm.getCombatSession(combatId)!.round).toBe(2);

    // Another full cycle: exactly +1
    cm.advanceTurn(combatId);
    cm.advanceTurn(combatId);
    expect(cm.getCombatSession(combatId)!.round).toBe(3);
  });

  /* ── FR-016: multiple fleeing ── */
  it("FR-016: multiple fleeing participants handled", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");

    const session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).toEqual(["player-1"]);
    expect(session.state).toBe("ACTIVE");
    const e1 = session.participants.find((p) => p.participantId === "enemy-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e1.fleeing).toBe(true);
    expect(e2.fleeing).toBe(true);
    expect(e1.alive).toBe(true);
    expect(e2.alive).toBe(true);
  });

  /* ── FR-017 / FR-018: leader / member ── */
  it("FR-017: leader flee / rejoin keeps battle leader and restores turns", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const initial = sessionOf(bridge.beginEncounter("battle-1", provider));
    expect(initial.currentActorId).toBe("player-1");

    // Leader (current actor) flees
    bm.updateParticipantState("battle-1", "player-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    let battleSnapshot = bm.getBattle("battle-1")!;
    // Battle-side leader is retained (FLEEING ≠ ELIMINATED)
    expect(battleSnapshot.playerSide.leaderId).toBe("player-1");
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).not.toContain("player-1");
    expect(session.currentActorId).toBe("enemy-1"); // advanced past leader
    expect(session.round).toBe(1); // no premature round++

    // Leader rejoins → pending → next round enters turnOrder
    bm.updateParticipantState("battle-1", "player-1", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.pendingParticipants.some((p) => p.participantId === "player-1")).toBe(true);
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).toContain("player-1");
  });

  it("FR-018: member flee / rejoin restores turns", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);
    // enemy-2 is a member (not the leader)
    expect(bm.getBattle("battle-1")!.enemySide.leaderId).toBe("enemy-1");

    bm.updateParticipantState("battle-1", "enemy-2", "FLEEING");
    bridge.syncFleeingState("battle-1");
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).not.toContain("enemy-2");

    bm.updateParticipantState("battle-1", "enemy-2", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).toContain("enemy-2");
  });

  /* ── FR-019: cross chunk ── */
  it("FR-019: cross chunk flee / rejoin works", () => {
    const { bm, cm, bridge } = makeBridge();
    createBattle(bm, {
      player: participant("player-1", point(100, 100), "ACTIVE", 10),
      enemy: participant("enemy-1", point(-100, -100), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    bm.updateParticipantState("battle-1", "enemy-1", "FLEEING");
    bridge.syncFleeingState("battle-1");
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).not.toContain("enemy-1");

    bm.updateParticipantState("battle-1", "enemy-1", "ACTIVE");
    bridge.syncRejoinState("battle-1");
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).toContain("enemy-1");
  });

  /* ── FR-020: battle isolation ── */
  it("FR-020: multiple battles remain isolated during flee/rejoin", () => {
    const { bm, cm, bridge } = makeBridge();
    createBattle(bm, {
      id: "battle-A",
      player: participant("pA1", point(0, 0), "ACTIVE", 10),
      enemy: participant("eA1", point(1, 0), "ACTIVE", 9),
    });
    createBattle(bm, {
      id: "battle-B",
      player: participant("pB1", point(5, 0), "ACTIVE", 10),
      enemy: participant("eB1", point(6, 0), "ACTIVE", 9),
    });
    const providerA = hpMap([
      { id: "pA1", currentHp: 100, maxHp: 100 },
      { id: "eA1", currentHp: 80, maxHp: 80 },
    ]);
    const providerB = hpMap([
      { id: "pB1", currentHp: 90, maxHp: 90 },
      { id: "eB1", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-A", providerA, "combat-A");
    bridge.beginEncounter("battle-B", providerB, "combat-B");

    // Flee in battle-A only
    bm.updateParticipantState("battle-A", "eA1", "FLEEING");
    bridge.syncFleeingState("battle-A");

    const sA = cm.getCombatSessionByBattle("battle-A")!;
    const sB = cm.getCombatSessionByBattle("battle-B")!;
    expect(sA.turnOrder).not.toContain("eA1");
    // battle-B completely unaffected
    expect(sB.turnOrder).toContain("eB1");
    expect(sB.state).toBe("ACTIVE");
    const eB1 = sB.participants.find((p) => p.participantId === "eB1")!;
    expect(eB1.fleeing).toBe(false);
  });

  /* ── FR-021: pending + death ── */
  it("FR-021: pending + death — dead pending never flushes", () => {
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 1, maxHp: 70 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 100, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
      { id: "enemy-2", attack: 8, defense: 3, level: 1 },
    ]);
    const { bm, cm, bridge } = makeBridge(world);
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    bridge.beginEncounter("battle-1", world as HpProvider);
    // enemy-2 joins the battle mid-combat, then the combat → pending
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    sessionOf(bridge.addParticipantToCombat("battle-1", "enemy-2", world as HpProvider));
    let session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.pendingParticipants.some((p) => p.participantId === "enemy-2")).toBe(true);

    // Kill the pending enemy-2
    damageOf(bridge.applyCombatAction("battle-1", "player-1", "enemy-2", stats));
    session = cm.getCombatSessionByBattle("battle-1")!;
    const e2 = session.participants.find((p) => p.participantId === "enemy-2")!;
    expect(e2.alive).toBe(false);

    // Round boundary → dead pending must never enter turnOrder
    flushAtRoundBoundary(cm, "battle-1");
    session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.turnOrder).not.toContain("enemy-2");
    expect(session.state).toBe("ACTIVE"); // enemy-1 still alive
  });

  /* ── FR-022: pending + battle resolve ── */
  it("FR-022: pending + battle resolve cleans up cleanly", () => {
    const { bm, cm, bridge } = makeBridge();
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);
    // enemy-2 joins the battle mid-combat, then the combat → pending
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));
    sessionOf(bridge.addParticipantToCombat("battle-1", "enemy-2", provider));
    expect(cm.getCombatSessionByBattle("battle-1")!.pendingParticipants.length).toBe(1);

    // Resolve combat → session + pending fully cleaned up
    bridge.resolveCombat("battle-1");
    expect(cm.getCombatSessionByBattle("battle-1")).toBeUndefined();
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    expect(bridge.getCombatId("battle-1")).toBeUndefined();
  });
});
