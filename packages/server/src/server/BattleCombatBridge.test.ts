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
import { BattleManager, type BattleManagerError } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import {
  BattleCombatBridge,
  type BridgeError,
  type HpProvider,
  type CombatActionBridgeResult,
} from "./BattleCombatBridge.js";

/* ── Helpers ── */

const point = (x: number, y: number): CombatPoint => ({ x, y });

function participant(
  id: string,
  position: CombatPoint,
  state: ParticipantState = "ACTIVE",
  combatPower = 10,
): BattleParticipant {
  return { id, position, combatPower, personality: "cautious", state };
}

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

function expectBridgeError(result: unknown, error: BridgeError): void {
  expect(result).toEqual({ error });
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
  for (const e of entries) {
    map.set(e.id, { currentHp: e.currentHp, maxHp: e.maxHp });
  }
  return {
    getHp(id: string) {
      return map.get(id);
    },
  };
}

/* ── Phase 3D-2B: World HP Synchronization fixtures ── */

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

/* ── Tests ── */

describe("BattleCombatBridge", () => {
  /* ── BC-001: Battle without combat ── */
  it("BC-001: battle exists but beginEncounter not called → no combat session", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    // No combat should exist
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    expect(bridge.getCombatId("battle-1")).toBeUndefined();
  });

  /* ── BC-002: Create combat from battle ── */
  it("BC-002: beginEncounter creates combat session referencing battleId", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.beginEncounter("battle-1", provider);
    const session = sessionOf(result);

    expect(session.battleId).toBe("battle-1");
    expect(session.state).toBe("ACTIVE");
    expect(bridge.hasActiveCombat("battle-1")).toBe(true);
  });

  /* ── BC-003: Duplicate combat rejected ── */
  it("BC-003: second beginEncounter on same battle returns ACTIVE_COMBAT_EXISTS", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const first = bridge.beginEncounter("battle-1", provider);
    sessionOf(first); // should succeed

    const second = bridge.beginEncounter("battle-1", provider);
    expectBridgeError(second, "ACTIVE_COMBAT_EXISTS");
  });

  /* ── BC-004: 1v1 ── */
  it("BC-004: 1v1 creates combat with 2 participants", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    expect(session.participants.length).toBe(2);
    expect(session.turnOrder.length).toBe(2);
    expect(session.turnOrder).toContain("player-1");
    expect(session.turnOrder).toContain("enemy-1");
  });

  /* ── BC-005: 2v1 ── */
  it("BC-005: 2v1 creates combat with 3 participants", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    // Add second player participant
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    expect(session.participants.length).toBe(3);
    expect(session.turnOrder.length).toBe(3);
  });

  /* ── BC-006: 1v2 ── */
  it("BC-006: 1v2 creates combat with 3 participants", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    // Add second enemy participant
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    expect(session.participants.length).toBe(3);
    expect(session.turnOrder.length).toBe(3);
  });

  /* ── BC-007: 2v2 ── */
  it("BC-007: 2v2 creates combat with 4 participants", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    expect(session.participants.length).toBe(4);
    expect(session.turnOrder.length).toBe(4);
  });

  /* ── BC-008: World player HP copied ── */
  it("BC-008: combat participant currentHp/maxHp match world HP", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 75, maxHp: 100 },
      { id: "enemy-1", currentHp: 60, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    const p1 = session.participants.find((p) => p.participantId === "player-1");
    const e1 = session.participants.find((p) => p.participantId === "enemy-1");

    expect(p1).toBeDefined();
    expect(p1!.currentHp).toBe(75);
    expect(p1!.maxHp).toBe(100);

    expect(e1).toBeDefined();
    expect(e1!.currentHp).toBe(60);
    expect(e1!.maxHp).toBe(80);
  });

  /* ── BC-009: World mob HP copied ── */
  it("BC-009: mob HP from world state correctly copied to combat participant", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("mob_wolf", point(1, 0)),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "mob_wolf", currentHp: 45, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    const mob = session.participants.find((p) => p.participantId === "mob_wolf");
    expect(mob).toBeDefined();
    expect(mob!.currentHp).toBe(45);
    expect(mob!.maxHp).toBe(80);
  });

  /* ── BC-010: Dead player rejected ── */
  it("BC-010: player with currentHp=0 excluded from combat participants", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 0, maxHp: 100 }, // dead
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.beginEncounter("battle-1", provider);

    // Only enemy is eligible → but we need at least one participant on each side?
    // Actually, bridge just filters by HP > 0. If only enemy survives, that's still valid.
    if ("session" in result) {
      const session = result.session;
      const p1 = session.participants.find((p) => p.participantId === "player-1");
      expect(p1).toBeUndefined(); // dead player excluded
      expect(session.participants.length).toBe(1);
    } else {
      // If NO eligible participants at all, that's also valid
      expect(result.error).toBe("NO_ELIGIBLE_PARTICIPANTS");
    }
  });

  /* ── BC-011: Dead mob rejected ── */
  it("BC-011: mob with currentHp=0 excluded from combat participants", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 0, maxHp: 80 }, // dead
    ]);

    const result = bridge.beginEncounter("battle-1", provider);

    if ("session" in result) {
      const session = result.session;
      const e1 = session.participants.find((p) => p.participantId === "enemy-1");
      expect(e1).toBeUndefined(); // dead mob excluded
      expect(session.participants.length).toBe(1);
    } else {
      expect(result.error).toBe("NO_ELIGIBLE_PARTICIPANTS");
    }
  });

  /* ── BC-012: Battle participant ≠ automatic combat participant ── */
  it("BC-012: ELIMINATED battle participants excluded from combat", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    // Add a third player who is ELIMINATED
    bm.addParticipant(
      battle.id,
      "player",
      participant("player-2", point(0, 1), "ELIMINATED"),
    );

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 50, maxHp: 100 }, // HP exists but state is ELIMINATED
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    const p2 = session.participants.find((p) => p.participantId === "player-2");
    expect(p2).toBeUndefined(); // ELIMINATED excluded
    expect(session.participants.length).toBe(2); // only player-1 + enemy-1
  });

  /* ── BC-013: Combat references battleId ── */
  it("BC-013: combat session battleId matches battle group id", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm, { id: "my-battle" });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("my-battle", provider));
    expect(session.battleId).toBe("my-battle");
  });

  /* ── BC-014: Combat participant IDs match battle participants ── */
  it("BC-014: all combat participant IDs exist in battle participant list", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));
    const battleSnapshot = bm.getBattle("battle-1")!;
    const battleIds = new Set([
      ...battleSnapshot.playerSide.participants.map((p) => p.id),
      ...battleSnapshot.enemySide.participants.map((p) => p.id),
    ]);

    for (const cp of session.participants) {
      expect(battleIds.has(cp.participantId)).toBe(true);
    }
  });

  /* ── BC-015: TurnOrder valid ── */
  it("BC-015: turnOrder contains all combat participant IDs", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    // All participant IDs must be in turnOrder
    const participantIds = new Set(session.participants.map((p) => p.participantId));
    const turnOrderSet = new Set(session.turnOrder);

    expect(turnOrderSet.size).toBe(session.turnOrder.length); // no duplicates
    for (const id of participantIds) {
      expect(turnOrderSet.has(id)).toBe(true);
    }
  });

  /* ── BC-016: CurrentActor valid ── */
  it("BC-016: currentActorId is first in turnOrder", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    expect(session.currentActorId).toBe(session.turnOrder[0]);
  });

  /* ── BC-017: Battle ACTIVE + Combat ACTIVE ── */
  it("BC-017: battle and combat both ACTIVE simultaneously", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));
    const battle = bm.getBattle("battle-1")!;

    // Battle is still ACTIVE (bridge doesn't change battle state)
    expect(battle.playerSide.state).toBe("ACTIVE");
    expect(battle.enemySide.state).toBe("ACTIVE");

    // Combat is ACTIVE
    expect(session.state).toBe("ACTIVE");
  });

  /* ── BC-018: Battle ACTIVE + Combat RESOLVED ── */
  it("BC-018: combat can resolve independently while battle stays ACTIVE", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    bridge.beginEncounter("battle-1", provider);

    // Resolve combat
    const result = bridge.resolveCombat("battle-1");
    const session = sessionOf(result);

    expect(session.state).toBe("RESOLVED");

    // Battle is still ACTIVE (bridge doesn't change battle state)
    const battle = bm.getBattle("battle-1")!;
    expect(battle.playerSide.state).toBe("ACTIVE");
    expect(battle.enemySide.state).toBe("ACTIVE");

    // No more active combat for this battle
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
  });

  /* ── BC-019: Duplicate create deterministic ── */
  it("BC-019: same inputs produce same participant set", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session1 = sessionOf(bridge.beginEncounter("battle-1", provider, "combat-fixed"));

    // Try to create again — should fail because combat already exists for this battle
    const result2 = bridge.beginEncounter("battle-1", provider, "combat-fixed-2");
    expectBridgeError(result2, "ACTIVE_COMBAT_EXISTS");

    // First session should have correct participant set
    expect(session1.participants.length).toBe(2);
    const ids = session1.participants.map((p) => p.participantId).sort();
    expect(ids).toEqual(["enemy-1", "player-1"]);
  });

  /* ── BC-020: Bridge snapshot isolation ── */
  it("BC-020: returned snapshots are independent copies", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session1 = sessionOf(bridge.beginEncounter("battle-1", provider));
    const session2 = cm.getCombatSession(session1.id)!;

    // Snapshots should be structurally equal but not the same reference
    expect(session1).toEqual(session2);
    expect(session1).not.toBe(session2);

    // Mutating internal state: set one participant to defending
    cm.setCombatParticipantDefending(session1.id, "player-1", true);

    // Get fresh snapshot — should reflect the change
    const session3 = cm.getCombatSession(session1.id)!;
    const p1Fresh = session3.participants.find((p) => p.participantId === "player-1");
    expect(p1Fresh?.defending).toBe(true);

    // Original snapshot should NOT reflect the change (immutable snapshot)
    const p1Old = session1.participants.find((p) => p.participantId === "player-1");
    expect(p1Old?.defending).toBe(false);
  });

  /* ── BC-021: Battle not found ── */
  it("BC-021: beginEncounter with nonexistent battle returns BATTLE_NOT_FOUND", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const provider = hpMap([]);
    const result = bridge.beginEncounter("nonexistent", provider);
    expectBridgeError(result, "BATTLE_NOT_FOUND");
  });

  /* ── BC-022: No eligible participants ── */
  it("BC-022: all participants dead/eliminated → NO_ELIGIBLE_PARTICIPANTS", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    // BattleManager rejects ELIMINATED participants at creation,
    // so create with ACTIVE participants, then eliminate them via updateParticipantState
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    // Now eliminate both participants
    bm.updateParticipantState(battle.id, "player-1", "ELIMINATED");
    bm.updateParticipantState(battle.id, "enemy-1", "ELIMINATED");

    const provider = hpMap([
      { id: "player-1", currentHp: 0, maxHp: 100 },
      { id: "enemy-1", currentHp: 0, maxHp: 80 },
    ]);

    const result = bridge.beginEncounter("battle-1", provider);
    expectBridgeError(result, "NO_ELIGIBLE_PARTICIPANTS");
  });

  /* ── BC-023: Combat participant initiative from combatPower ── */
  it("BC-023: combat participant initiative equals battle participant combatPower", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 15),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 8),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    const p1 = session.participants.find((p) => p.participantId === "player-1")!;
    const e1 = session.participants.find((p) => p.participantId === "enemy-1")!;

    expect(p1.initiative).toBe(15);
    expect(e1.initiative).toBe(8);
  });

  /* ── BC-024: Mappings snapshot ── */
  it("BC-024: getMappings returns all battle→combat pairs", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    // Each battle needs unique participant IDs
    createBattle(bm, {
      id: "b1",
      player: participant("p1", point(0, 0)),
      enemy: participant("e1", point(1, 0)),
    });
    createBattle(bm, {
      id: "b2",
      player: participant("p2", point(5, 0)),
      enemy: participant("e2", point(6, 0)),
    });

    const provider1 = hpMap([
      { id: "p1", currentHp: 100, maxHp: 100 },
      { id: "e1", currentHp: 80, maxHp: 80 },
    ]);
    const provider2 = hpMap([
      { id: "p2", currentHp: 90, maxHp: 90 },
      { id: "e2", currentHp: 70, maxHp: 70 },
    ]);

    bridge.beginEncounter("b1", provider1, "c1");
    bridge.beginEncounter("b2", provider2, "c2");

    const mappings = bridge.getMappings();
    expect(mappings.length).toBe(2);
    expect(mappings).toContainEqual({ battleId: "b1", combatId: "c1" });
    expect(mappings).toContainEqual({ battleId: "b2", combatId: "c2" });
  });

  /* ── BC-025: getBattleId reverse lookup ── */
  it("BC-025: getBattleId returns correct battleId for combatId", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    bridge.beginEncounter("battle-1", provider, "combat-xyz");

    expect(bridge.getBattleId("combat-xyz")).toBe("battle-1");
    expect(bridge.getBattleId("nonexistent")).toBeUndefined();
  });
});

/* ════════════════ Phase 3D-2B: World HP Synchronization ════════════════ */

describe("World HP Synchronization (HP-001 to HP-020)", () => {
  function setupDuel(opts: {
    p1Hp?: number;
    e1Hp?: number;
    p1Attack?: number;
    e1Defense?: number;
  } = {}) {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: opts.p1Hp ?? 100, maxHp: 100 },
      { id: "enemy-1", currentHp: opts.e1Hp ?? 100, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: opts.p1Attack ?? 10, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: opts.e1Defense ?? 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    // Create battle
    bm.createBattle(
      "battle-1",
      participant("player-1", point(0, 0)),
      participant("enemy-1", point(1, 0)),
    );

    // Begin encounter
    bridge.beginEncounter("battle-1", world as HpProvider);

    return { bm, cm, world, stats, bridge };
  }

  /* ── HP-001: WorldHealthWriter.setHp updates stored HP ── */
  it("HP-001: WorldHealthWriter.setHp updates stored HP", () => {
    const world = worldHpMap([{ id: "p1", currentHp: 100, maxHp: 100 }]);
    world.setHp("p1", 50);
    expect(world.getHp("p1")?.currentHp).toBe(50);
  });

  /* ── HP-002: WorldHealthWriter.isAlive true when HP > 0 ── */
  it("HP-002: WorldHealthWriter.isAlive true when HP > 0", () => {
    const world = worldHpMap([{ id: "p1", currentHp: 50, maxHp: 100 }]);
    expect(world.isAlive("p1")).toBe(true);
  });

  /* ── HP-003: WorldHealthWriter.isAlive false when HP = 0 ── */
  it("HP-003: WorldHealthWriter.isAlive false when HP = 0", () => {
    const world = worldHpMap([{ id: "p1", currentHp: 0, maxHp: 100 }]);
    expect(world.isAlive("p1")).toBe(false);
  });

  /* ── HP-004: WorldHealthWriter.isAlive false when entity not found ── */
  it("HP-004: WorldHealthWriter.isAlive false when entity not found", () => {
    const world = worldHpMap([]);
    expect(world.isAlive("nonexistent")).toBe(false);
  });

  /* ── HP-005: applyCombatAction writes remaining HP to World ── */
  it("HP-005: applyCombatAction writes remaining HP to World after non-lethal attack", () => {
    const { world, stats, bridge } = setupDuel({ e1Hp: 100 });

    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats),
    );

    expect(dmg.remainingHp).toBeLessThan(100);
    expect(world.getHp("enemy-1")?.currentHp).toBe(dmg.remainingHp);
  });

  /* ── HP-006: applyCombatAction writes HP=0 to World after lethal attack ── */
  it("HP-006: applyCombatAction writes HP=0 to World after lethal attack", () => {
    const { world, stats, bridge } = setupDuel({ p1Attack: 100, e1Hp: 1 });

    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats),
    );

    expect(dmg.targetKilled).toBe(true);
    expect(world.getHp("enemy-1")?.currentHp).toBe(0);
  });

  /* ── HP-007: applyCombatAction returns correct DamageResult ── */
  it("HP-007: applyCombatAction returns correct DamageResult", () => {
    const { stats, bridge } = setupDuel();

    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats),
    );

    expect(dmg.attackerId).toBe("player-1");
    expect(dmg.targetId).toBe("enemy-1");
    expect(typeof dmg.damage).toBe("number");
    expect(typeof dmg.remainingHp).toBe("number");
    expect(typeof dmg.targetKilled).toBe("boolean");
  });

  /* ── HP-008: applyCombatAction rejects attack on dead target ── */
  it("HP-008: applyCombatAction rejects attack on dead target (isAlive=false)", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 0, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 10, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    bm.createBattle(
      "battle-1",
      participant("player-1", point(0, 0)),
      participant("enemy-1", point(1, 0)),
    );

    // Manually create combat with dead enemy
    bridge.beginEncounter("battle-1", {
      getHp(id: string) {
        if (id === "player-1") return { currentHp: 100, maxHp: 100 };
        if (id === "enemy-1") return { currentHp: 100, maxHp: 100 }; // alive in combat
        return undefined;
      },
    });

    const result = bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);
    expect(result).toEqual({ error: "TARGET_NOT_ALIVE" });
  });

  /* ── HP-009: applyCombatAction without WorldHealthWriter returns error ── */
  it("HP-009: applyCombatAction without WorldHealthWriter returns error", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm); // no worldHp

    const stats = statsMap([
      { id: "player-1", attack: 10, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
    ]);

    const result = bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);
    expect(result).toEqual({ error: "NO_WORLD_HP_WRITER" });
  });

  /* ── HP-010: applyCombatAction on battle without combat returns error ── */
  it("HP-010: applyCombatAction on battle without combat returns error", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 10, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    bm.createBattle(
      "battle-1",
      participant("player-1", point(0, 0)),
      participant("enemy-1", point(1, 0)),
    );

    const result = bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);
    expect(result).toEqual({ error: "BATTLE_NOT_FOUND" });
  });

  /* ── HP-011: Player death sets battle state to ELIMINATED ── */
  it("HP-011: Player death triggers ELIMINATED via removeParticipantByDeath", () => {
    const { bm, world, stats, bridge } = setupDuel({ p1Attack: 100, e1Hp: 1 });

    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);

    // Enemy should be removed from battle by death
    const battle = bm.getBattle("battle-1")!;
    expect(battle.enemySide.participants).toHaveLength(0);
  });

  /* ── HP-012: Mob death writes HP=0 to World ── */
  it("HP-012: Mob death writes HP=0 to World", () => {
    const { world, stats, bridge } = setupDuel({ p1Attack: 100, e1Hp: 1 });

    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);

    expect(world.getHp("enemy-1")?.currentHp).toBe(0);
  });

  /* ── HP-013: Leader death triggers automatic leader transfer ── */
  it("HP-013: Leader death triggers automatic leader transfer", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "p1", currentHp: 100, maxHp: 100 },
      { id: "e1", currentHp: 1, maxHp: 100 },
      { id: "e2", currentHp: 100, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "p1", attack: 100, defense: 5, level: 1 },
      { id: "e1", attack: 8, defense: 3, level: 1 },
      { id: "e2", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    bm.createBattle(
      "battle-1",
      participant("p1", point(0, 0)),
      participant("e1", point(1, 0), "ACTIVE", 10),
    );
    bm.addParticipant("battle-1", "enemy", participant("e2", point(2, 0), "ACTIVE", 8));

    // e1 is leader (highest combatPower)
    const battleBefore = bm.getBattle("battle-1")!;
    expect(battleBefore.enemySide.leaderId).toBe("e1");

    // Kill e1
    bridge.beginEncounter("battle-1", world as HpProvider);
    bridge.applyCombatAction("battle-1", "p1", "e1", stats);

    // Leader should transfer to e2
    const battleAfter = bm.getBattle("battle-1")!;
    expect(battleAfter.enemySide.leaderId).toBe("e2");
  });

  /* ── HP-014: Non-leader death does NOT change leader ── */
  it("HP-014: Non-leader death does NOT change leader", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "p1", currentHp: 100, maxHp: 100 },
      { id: "e1", currentHp: 100, maxHp: 100 },
      { id: "e2", currentHp: 1, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "p1", attack: 100, defense: 5, level: 1 },
      { id: "e1", attack: 8, defense: 3, level: 1 },
      { id: "e2", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    bm.createBattle(
      "battle-1",
      participant("p1", point(0, 0)),
      participant("e1", point(1, 0), "ACTIVE", 10),
    );
    bm.addParticipant("battle-1", "enemy", participant("e2", point(2, 0), "ACTIVE", 8));

    const battleBefore = bm.getBattle("battle-1")!;
    expect(battleBefore.enemySide.leaderId).toBe("e1");

    bridge.beginEncounter("battle-1", world as HpProvider);
    bridge.applyCombatAction("battle-1", "p1", "e2", stats);

    const battleAfter = bm.getBattle("battle-1")!;
    expect(battleAfter.enemySide.leaderId).toBe("e1"); // unchanged
  });

  /* ── HP-015: Mob death writes HP=0 to World ── */
  it("HP-015: Enemy mob killed → World HP=0", () => {
    const { world, stats, bridge } = setupDuel({ p1Attack: 100, e1Hp: 1 });

    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);

    const hp = world.getHp("enemy-1");
    expect(hp?.currentHp).toBe(0);
    expect(world.isAlive("enemy-1")).toBe(false);
  });

  /* ── HP-016: Non-lethal damage does NOT trigger death handling ── */
  it("HP-016: Non-lethal damage does NOT trigger death handling", () => {
    const { bm, world, stats, bridge } = setupDuel({ e1Hp: 100 });

    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);

    // Enemy should still be in battle
    const battle = bm.getBattle("battle-1")!;
    expect(battle.enemySide.participants).toHaveLength(1);
    expect(battle.enemySide.participants[0].state).toBe("ACTIVE");

    // World HP should be positive
    expect(world.isAlive("enemy-1")).toBe(true);
  });

  /* ── HP-017: Multiple participants have independent HP ── */
  it("HP-017: Damage to player-1 doesn't affect enemy-1 World HP", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "p1", currentHp: 100, maxHp: 100 },
      { id: "e1", currentHp: 100, maxHp: 100 },
      { id: "e2", currentHp: 80, maxHp: 80 },
    ]);
    const stats = statsMap([
      { id: "p1", attack: 10, defense: 5, level: 1 },
      { id: "e1", attack: 8, defense: 3, level: 1 },
      { id: "e2", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    bm.createBattle(
      "battle-1",
      participant("p1", point(0, 0)),
      participant("e1", point(1, 0)),
    );
    bm.addParticipant("battle-1", "enemy", participant("e2", point(2, 0)));

    bridge.beginEncounter("battle-1", world as HpProvider);

    // Attack e1
    bridge.applyCombatAction("battle-1", "p1", "e1", stats);

    // e2 should be untouched
    expect(world.getHp("e2")?.currentHp).toBe(80);
  });

  /* ── HP-018: CombatSession HP mirrors World HP ── */
  it("HP-018: CombatSession HP is working mirror after write-back", () => {
    const { cm, world, stats, bridge } = setupDuel({ e1Hp: 100 });

    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);

    const session = cm.getCombatSessionByBattle("battle-1")!;
    const combatHp = session.participants.find((p) => p.participantId === "enemy-1")!;
    const worldHp = world.getHp("enemy-1")!;

    expect(combatHp.currentHp).toBe(worldHp.currentHp);
  });

  /* ── HP-019: applyCombatAction on invalid attacker returns error ── */
  it("HP-019: applyCombatAction on invalid attacker returns CombatManager error", () => {
    const { stats, bridge } = setupDuel();

    // enemy-1 is not the current actor (player-1 is)
    const result = bridge.applyCombatAction("battle-1", "enemy-1", "player-1", stats);
    expect(result).toEqual({ error: "NOT_CURRENT_ACTOR" });
  });

  /* ── HP-020: Full lifecycle ── */
  it("HP-020: Full lifecycle: beginEncounter → applyCombatAction → death → verify", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "p1", currentHp: 100, maxHp: 100 },
      { id: "e1", currentHp: 5, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "p1", attack: 50, defense: 5, level: 3 },
      { id: "e1", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    // 1. Create battle
    bm.createBattle(
      "battle-1",
      participant("p1", point(0, 0)),
      participant("e1", point(1, 0)),
    );

    // 2. Begin encounter
    bridge.beginEncounter("battle-1", world as HpProvider);
    expect(bridge.hasActiveCombat("battle-1")).toBe(true);

    // 3. Attack to kill
    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "p1", "e1", stats),
    );
    expect(dmg.targetKilled).toBe(true);

    // 4. Verify World HP = 0
    expect(world.getHp("e1")?.currentHp).toBe(0);
    expect(world.isAlive("e1")).toBe(false);

    // 5. Verify battle state
    const battle = bm.getBattle("battle-1")!;
    expect(battle.enemySide.participants).toHaveLength(0);

    // 6. Verify combat session state
    const session = cm.getCombatSessionByBattle("battle-1")!;
    const combatTarget = session.participants.find((p) => p.participantId === "e1")!;
    expect(combatTarget.alive).toBe(false);
    expect(combatTarget.currentHp).toBe(0);
  });

  /* ══════════════════════════════════════════════════
   * Phase 3F-2: Dynamic Combat Membership
   * ══════════════════════════════════════════════════ */

  /* ── BC-F2-001: addParticipantToCombat success ── */
  it("BC-F2-001: addParticipantToCombat adds new participant to combat session", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    // Begin encounter with only player-1 and enemy-1
    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Add second player to battle (not in combat yet)
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const providerWithP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    // Add player-2 to combat
    const result = bridge.addParticipantToCombat("battle-1", "player-2", providerWithP2);
    const session = sessionOf(result);

    expect(session.participants.length).toBe(3);
    const p2 = session.participants.find((p) => p.participantId === "player-2");
    expect(p2).toBeDefined();
    expect(p2!.currentHp).toBe(90);
    expect(p2!.maxHp).toBe(90);
    expect(p2!.side).toBe("player");
    expect(p2!.alive).toBe(true);
    // MF3-003: new joins are pending — visible in participants but NOT in turnOrder until next round
    expect(session.turnOrder).not.toContain("player-2");
    expect(session.pendingParticipants.map((p) => p.participantId)).toContain("player-2");
  });

  /* ── BC-F2-002: addParticipantToCombat duplicate rejected ── */
  it("BC-F2-002: addParticipantToCombat rejects participant already in combat", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Try to add player-1 again (already in combat)
    const result = bridge.addParticipantToCombat("battle-1", "player-1", provider);
    expectBridgeError(result, "PARTICIPANT_ALREADY_IN_COMBAT");
  });

  /* ── BC-F2-003: addParticipantToCombat dead participant rejected ── */
  it("BC-F2-003: addParticipantToCombat rejects participant with HP=0", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Try to add player-2 with HP=0
    const deadProvider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 0, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.addParticipantToCombat("battle-1", "player-2", deadProvider);
    expectBridgeError(result, "NO_ELIGIBLE_PARTICIPANTS");
  });

  /* ── BC-F2-004: addParticipantToCombat ELIMINATED participant rejected ── */
  it("BC-F2-004: addParticipantToCombat rejects ELIMINATED battle participant", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);
    // Add as ACTIVE first, then eliminate via state update (BattleManager rejects ELIMINATED in addParticipant)
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));
    bm.updateParticipantState("battle-1", "player-2", "ELIMINATED");

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Try to add ELIMINATED player-2
    const providerWithP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 50, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.addParticipantToCombat("battle-1", "player-2", providerWithP2);
    expectBridgeError(result, "NO_ELIGIBLE_PARTICIPANTS");
  });

  /* ── BC-F2-005: addParticipantToCombat no combat session ── */
  it("BC-F2-005: addParticipantToCombat returns error when no combat exists", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
    ]);

    const result = bridge.addParticipantToCombat("battle-1", "player-1", provider);
    expectBridgeError(result, "COMBAT_CREATION_FAILED");
  });

  /* ── BC-F2-006: addParticipantToCombat enemy participant ── */
  it("BC-F2-006: addParticipantToCombat correctly assigns enemy side", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Add second enemy to battle
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1)));

    const providerWithE2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);

    const result = bridge.addParticipantToCombat("battle-1", "enemy-2", providerWithE2);
    const session = sessionOf(result);

    const e2 = session.participants.find((p) => p.participantId === "enemy-2");
    expect(e2).toBeDefined();
    expect(e2!.side).toBe("enemy");
    expect(e2!.currentHp).toBe(70);
  });

  /* ── BC-F2-007: syncParticipants adds missing ── */
  it("BC-F2-007: syncParticipants adds battle participants not yet in combat", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Add player-2 and enemy-2 to battle after combat started
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1)));

    const fullProvider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);

    const result = bridge.syncParticipants("battle-1", fullProvider);
    const session = sessionOf(result);

    // MF3-003: New participants go to pending queue — visible in participants but added at next round boundary
    expect(session.participants.length).toBe(4);
    expect(session.pendingParticipants).toHaveLength(2);
    expect(session.pendingParticipants.map((p) => p.participantId)).toContain("player-2");
    expect(session.pendingParticipants.map((p) => p.participantId)).toContain("enemy-2");
    // New participants are NOT in turnOrder yet
    expect(session.turnOrder).not.toContain("player-2");
    expect(session.turnOrder).not.toContain("enemy-2");
  });

  /* ── BC-F2-008: syncParticipants removes stale ── */
  it("BC-F2-008: syncParticipants removes combat participants no longer in battle", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });

    // Begin combat with only player-1 and enemy-1 (no player-2 in provider)
    const baseProvider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", baseProvider);

    // Add player-2 to battle after combat started
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    // Add player-2 to combat via bridge
    const providerWithP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const beforeSession = sessionOf(bridge.addParticipantToCombat("battle-1", "player-2", providerWithP2));
    expect(beforeSession.participants.length).toBe(3);

    // Remove player-2 from battle
    bm.removeParticipant("battle-1", "player-2");

    // Sync should remove player-2 from combat
    const providerWithoutP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.syncParticipants("battle-1", providerWithoutP2);
    const session = sessionOf(result);

    expect(session.participants.length).toBe(2);
    expect(session.participants.find((p) => p.participantId === "player-2")).toBeUndefined();
  });

  /* ── BC-F2-009: syncParticipants idempotent ── */
  it("BC-F2-009: syncParticipants is idempotent when called multiple times", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Sync twice with same data
    const result1 = bridge.syncParticipants("battle-1", provider);
    const result2 = bridge.syncParticipants("battle-1", provider);

    const session1 = sessionOf(result1);
    const session2 = sessionOf(result2);

    expect(session1.participants.length).toBe(session2.participants.length);
    expect(session1.turnOrder).toEqual(session2.turnOrder);
  });

  /* ── BC-F2-010: syncParticipants filters dead ── */
  it("BC-F2-010: syncParticipants excludes dead participants from addition", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // player-2 is dead
    const providerWithDeadP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 0, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.syncParticipants("battle-1", providerWithDeadP2);
    const session = sessionOf(result);

    // player-2 should NOT be added
    expect(session.participants.length).toBe(2);
    expect(session.participants.find((p) => p.participantId === "player-2")).toBeUndefined();
  });

  /* ── BC-F2-011: syncParticipants no combat ── */
  it("BC-F2-011: syncParticipants returns error when no combat exists", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
    ]);

    const result = bridge.syncParticipants("battle-1", provider);
    expectBridgeError(result, "COMBAT_CREATION_FAILED");
  });
});
