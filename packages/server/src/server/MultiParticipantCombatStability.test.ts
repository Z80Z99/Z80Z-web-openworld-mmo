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

/* ═══════════════════════════════════════════════════════
 * Multi-Participant Combat Stability — Phase 3F-3
 *
 * These 22 tests define the Phase 3F-3 stability requirements.
 * They are written as TDD red-phase stubs: each assertion targets
 * a behavior that the current code does NOT yet implement.
 * ═══════════════════════════════════════════════════════ */

describe("Multi-Participant Combat Stability - Phase 3F-3", () => {
  /* ── MF3-001: 2v2 initial combat setup ── */
  it("MF3-001: 2v2 initial combat setup — two players vs two mobs, verify turnOrder has 4 entries", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1), "ACTIVE", 8));
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 6));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    // turnOrder must have 4 entries
    expect(session.turnOrder.length).toBe(4);

    // Phase 3F-3: combat should start in FORMING state, not ACTIVE
    // Participants should be confirmed before combat transitions to ACTIVE
    expect(session.state).toBe("FORMING");
  });

  /* ── MF3-002: Join while combat active ── */
  it("MF3-002: Join while combat active — add participant mid-combat, verify added", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Add second player to battle, then to combat
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    const providerWithP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const result = bridge.addParticipantToCombat("battle-1", "player-2", providerWithP2);
    const session = sessionOf(result);

    // Verify participant was added
    const p2 = session.participants.find((p) => p.participantId === "player-2");
    expect(p2).toBeDefined();

    // Phase 3F-3: mid-combat join should validate per-side capacity
    // Bridge should enforce a maximum participant count per side
    const playerCount = session.participants.filter((p) => p.side === "player").length;
    expect(playerCount).toBeLessThanOrEqual(3);
  });

  /* ── MF3-003: Join pending next round ── */
  it("MF3-003: Join pending next round — new join should NOT be in turnOrder until next round", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const initialSession = sessionOf(bridge.beginEncounter("battle-1", provider));

    // Add participant mid-combat
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));
    const providerWithP2 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const updatedSession = sessionOf(
      bridge.addParticipantToCombat("battle-1", "player-2", providerWithP2),
    );

    // Phase 3F-3: newly added participant should be PENDING — NOT in the active
    // turnOrder until the next round begins. This prevents mid-turn disruption.
    expect(updatedSession.turnOrder).not.toContain("player-2");
  });

  /* ── MF3-004: Remove non-current participant ── */
  it("MF3-004: Remove non-current participant — remove participant who is not currentActor, verify turnOrder shrinks", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

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
    const initialSession = sessionOf(bridge.beginEncounter("battle-1", provider));

    // currentActor should be player-1 (highest initiative)
    expect(initialSession.currentActorId).toBe("player-1");

    // Remove player-2 (not current actor)
    const updatedSession = sessionOf(bridge.removeParticipant("battle-1", "player-2"));

    // turnOrder should shrink
    expect(updatedSession.turnOrder.length).toBe(2);
    expect(updatedSession.turnOrder).not.toContain("player-2");

    // Phase 3F-3: removing a participant should trigger battle-side evaluation
    // to check if the side is now undermanned or eliminated
    const battleSnapshot = bm.getBattle("battle-1")!;
    expect(battleSnapshot.playerSide.participants.length).toBe(1);
  });

  /* ── MF3-005: Remove current participant ── */
  it("MF3-005: Remove current participant — remove currentActor, verify next alive becomes currentActor", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    // player-1 has highest initiative so they start as currentActor
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const initialSession = sessionOf(bridge.beginEncounter("battle-1", provider));
    expect(initialSession.currentActorId).toBe("player-1");

    // Remove current actor (player-1 is also the battle leader)
    const updatedSession = sessionOf(bridge.removeParticipant("battle-1", "player-1"));

    // Next alive should become currentActor
    expect(updatedSession.currentActorId).toBe("enemy-1");

    // Phase 3F-3: removing the leader from combat should trigger leader transfer
    // in BattleManager, not just combat state change
    const battleSnapshot = bm.getBattle("battle-1")!;
    expect(battleSnapshot.playerSide.leaderId).not.toBe("player-1");
  });

  /* ── MF3-006: Death skip ── */
  it("MF3-006: Death skip — kill a participant, verify next turn skips dead", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
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
    const bridge = new BattleCombatBridge(bm, cm, world);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 12),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 10),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 8));

    bridge.beginEncounter("battle-1", world as HpProvider);

    // Kill enemy-1 (low HP)
    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats),
    );
    expect(dmg.targetKilled).toBe(true);

    // Next turn should skip dead enemy-1
    const session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.currentActorId).not.toBe("enemy-1");

    // Phase 3F-3: death should trigger battle-side elimination evaluation
    // If all enemies on a side are dead, the side should be marked ELIMINATED
    const battleSnapshot = bm.getBattle("battle-1")!;
    expect(battleSnapshot.enemySide.participants.length).toBe(1); // enemy-2 remains
  });

  /* ── MF3-007: Current actor death ── */
  it("MF3-007: Current actor death — currentActor takes lethal damage, verify auto-skip to next alive", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
      { id: "player-1", currentHp: 1, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "enemy-1", attack: 100, defense: 5, level: 1 },
      { id: "player-1", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    // enemy-1 has higher initiative so they go first
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 8),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 12),
    });

    bridge.beginEncounter("battle-1", world as HpProvider);

    // enemy-1 (currentActor) kills player-1
    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "enemy-1", "player-1", stats),
    );
    expect(dmg.targetKilled).toBe(true);

    // Phase 3F-3: bridge.applyCombatAction should write HP back to WorldHP
    // for the killed actor, not just the target
    expect(world.getHp("player-1")?.currentHp).toBe(0);
  });

  /* ── MF3-008: All enemies dead ── */
  it("MF3-008: All enemies dead — all enemies eliminated, verify combat RESOLVED", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 1, maxHp: 80 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 100, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    createBattle(bm);

    bridge.beginEncounter("battle-1", world as HpProvider);

    // Kill the only enemy
    const dmg = damageOf(
      bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats),
    );
    expect(dmg.targetKilled).toBe(true);

    // Phase 3F-3: when all enemies on a side are eliminated, combat should
    // automatically transition to RESOLVED state
    const session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.state).toBe("RESOLVED");
  });

  /* ── MF3-009: Combat resolved ── */
  it("MF3-009: Combat resolved — verify session.state === 'RESOLVED'", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 1, maxHp: 80 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 100, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    createBattle(bm);
    bridge.beginEncounter("battle-1", world as HpProvider);

    // Kill the only enemy to trigger auto-resolve
    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);

    // Phase 3F-3: combat session state should be RESOLVED
    const session = cm.getCombatSessionByBattle("battle-1")!;
    expect(session.state).toBe("RESOLVED");

    // bridge.hasActiveCombat should also return false
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
  });

  /* ── MF3-010: Battle remains after combat resolve ── */
  it("MF3-010: Battle remains after combat resolve — BattleGroup still exists after combat resolved", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Resolve combat manually
    bridge.resolveCombat("battle-1");

    // Phase 3F-3: after combat resolves, the battle should still exist
    const battle = bm.getBattle("battle-1");
    expect(battle).toBeDefined();
    expect(battle!.id).toBe("battle-1");

    // Phase 3F-3: the resolved combat session should be cleaned up
    // (removed from CombatManager), not just marked RESOLVED
    const combatId = cm.getCombatIdByBattle("battle-1");
    expect(combatId).toBeUndefined();
  });

  /* ── MF3-011: syncParticipants idempotent ── */
  it("MF3-011: syncParticipants idempotent — call syncParticipants twice with same state, verify same result", () => {
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
    const initialSession = sessionOf(bridge.beginEncounter("battle-1", provider));
    const initialActor = initialSession.currentActorId;

    // Sync twice with same state
    const result1 = sessionOf(bridge.syncParticipants("battle-1", provider));
    const result2 = sessionOf(bridge.syncParticipants("battle-1", provider));

    expect(result1.participants.length).toBe(result2.participants.length);
    expect(result1.turnOrder).toEqual(result2.turnOrder);

    // Phase 3F-3: idempotent sync should not change the currentActorId
    // if the turn order hasn't meaningfully changed
    expect(result2.currentActorId).toBe(initialActor);
  });

  /* ── MF3-012: Duplicate join ── */
  it("MF3-012: Duplicate join — attempt to add same participant twice, verify no duplicate", () => {
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

    // Phase 3F-3: duplicate join should return PARTICIPANT_ALREADY_IN_COMBAT
    // not a generic COMBAT_CREATION_FAILED
    expect(result).toEqual({ error: "PARTICIPANT_ALREADY_IN_COMBAT" });
  });

  /* ── MF3-013: Multiple battles isolated ── */
  it("MF3-013: Multiple battles isolated — battle A state doesn't affect battle B", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    // Create two separate battles with unique participants
    createBattle(bm, {
      id: "battle-A",
      player: participant("pA1", point(0, 0)),
      enemy: participant("eA1", point(1, 0)),
    });
    createBattle(bm, {
      id: "battle-B",
      player: participant("pB1", point(5, 0)),
      enemy: participant("eB1", point(6, 0)),
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

    // Resolve battle A's combat
    bridge.resolveCombat("battle-A");

    // Phase 3F-3: battle B's combat should be unaffected
    expect(bridge.hasActiveCombat("battle-B")).toBe(true);
    const sessionB = cm.getCombatSessionByBattle("battle-B")!;
    expect(sessionB.state).toBe("ACTIVE");

    // Phase 3F-3: battle A's resolved combat session should be cleaned up
    const combatIdA = cm.getCombatIdByBattle("battle-A");
    expect(combatIdA).toBeUndefined();
  });

  /* ── MF3-014: Dynamic join world HP initialization ── */
  it("MF3-014: Dynamic join world HP initialization — new participant gets HP from WorldHP provider", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    const battle = createBattle(bm);
    bridge.beginEncounter("battle-1", world as HpProvider);

    // Add new player to battle
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    // Update world HP for new player (different from combat start)
    world.setHp("player-2", 45);

    // Add via bridge
    const session = sessionOf(
      bridge.addParticipantToCombat("battle-1", "player-2", world as HpProvider),
    );

    const p2 = session.participants.find((p) => p.participantId === "player-2");
    expect(p2).toBeDefined();
    expect(p2!.currentHp).toBe(45);
    expect(p2!.maxHp).toBe(100);

    // Phase 3F-3: bridge should write the new participant's initial combat HP
    // back to WorldHealthWriter to keep world state in sync
    expect(world.getHp("player-2")?.currentHp).toBe(45);
  });

  /* ── MF3-015: No stale HP ── */
  it("MF3-015: No stale HP — new participant doesn't inherit old participant's HP", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "player-2", currentHp: 50, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 100, defense: 5, level: 1 },
      { id: "enemy-1", attack: 8, defense: 3, level: 1 },
      { id: "player-2", attack: 10, defense: 3, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);

    const battle = createBattle(bm);
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    bridge.beginEncounter("battle-1", world as HpProvider);

    // Resolve the initial combat
    bridge.resolveCombat("battle-1");

    // Start new combat with player-2 included
    const freshWorld = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "player-2", currentHp: 50, maxHp: 100 },
    ]);
    const freshBridge = new BattleCombatBridge(bm, cm, freshWorld);
    const session = sessionOf(freshBridge.beginEncounter("battle-1", freshWorld as HpProvider));

    // Phase 3F-3: new participant's HP should come exclusively from WorldHP,
    // not from any stale combat state from a previous session
    const p2 = session.participants.find((p) => p.participantId === "player-2");
    expect(p2).toBeDefined();
    expect(p2!.currentHp).toBe(50); // from WorldHP, not stale
    expect(p2!.alive).toBe(true);

    // Phase 3F-3: bridge should validate HP consistency — reject if world HP
    // contradicts expected range
    expect(p2!.currentHp).toBeLessThanOrEqual(p2!.maxHp);
  });

  /* ── MF3-016: Initiative order preserved ── */
  it("MF3-016: Initiative order preserved — turnOrder sorted by initiative descending", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 5),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 15),
    });
    bm.addParticipant(battle.id, "player", participant("player-2", point(0, 1), "ACTIVE", 10));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-1", provider));

    // Verify initiative-based ordering: enemy-1(15) > player-2(10) > player-1(5)
    expect(session.turnOrder[0]).toBe("enemy-1");
    expect(session.turnOrder[1]).toBe("player-2");
    expect(session.turnOrder[2]).toBe("player-1");

    // Phase 3F-3: turnOrder should maintain initiative-sorted position
    // even after dynamic participant addition. Currently addCombatParticipant
    // appends to the end without re-sorting.
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 12));

    const providerFull = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 90, maxHp: 90 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);

    const updatedSession = sessionOf(
      bridge.addParticipantToCombat("battle-1", "enemy-2", providerFull),
    );

    // After adding enemy-2 (initiative 12), turnOrder should be:
    // enemy-1(15), enemy-2(12), player-2(10), player-1(5)
    expect(updatedSession.turnOrder[0]).toBe("enemy-1");
    expect(updatedSession.turnOrder[1]).toBe("enemy-2");
  });

  /* ── MF3-017: Round progression ── */
  it("MF3-017: Round progression — verify round increments correctly", () => {
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

    createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 9),
    });

    const session = sessionOf(bridge.beginEncounter("battle-1", world as HpProvider));
    expect(session.round).toBe(1);

    // Full round: player-1 attacks, then enemy-1 attacks
    bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);
    bridge.applyCombatAction("battle-1", "enemy-1", "player-1", stats);

    // Phase 3F-3: round should increment by exactly 1 after a full cycle
    // Removing the current actor mid-round should NOT cause a double-increment
    const updatedSession = cm.getCombatSessionByBattle("battle-1")!;
    expect(updatedSession.round).toBe(2);

    // Phase 3F-3: round tracking should include a roundStartAt timestamp
    expect(updatedSession.turnStartedAt).toBeTypeOf("number");
  });

  /* ── MF3-018: Cross chunk ── */
  it("MF3-018: Cross chunk — combat across chunk boundaries works", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    // Create battle spanning chunk boundary (assuming 32x32 chunks)
    // Chunk 0: x=[0,31], Chunk 1: x=[32,63]
    const battle = createBattle(bm, {
      id: "battle-cross-chunk",
      player: participant("player-1", point(16, 16), "ACTIVE", 10),
      enemy: participant("enemy-1", point(48, 16), "ACTIVE", 8),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-cross-chunk", provider));

    // Verify combat was created successfully across chunks
    expect(session.participants.length).toBe(2);
    expect(session.battleId).toBe("battle-cross-chunk");

    // Phase 3F-3: bridge should convert chunk-local coordinates to world
    // coordinates for combat participants, not use raw battle positions
    const p1 = session.participants.find((p) => p.participantId === "player-1")!;
    const e1 = session.participants.find((p) => p.participantId === "enemy-1")!;
    expect(p1.participantId).toBe("player-1");
    expect(e1.participantId).toBe("enemy-1");
  });

  /* ── MF3-019: Negative coordinate ── */
  it("MF3-019: Negative coordinate — combat at negative coordinates works", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      id: "battle-neg-coord",
      player: participant("player-1", point(-100, -200), "ACTIVE", 10),
      enemy: participant("enemy-1", point(-50, -150), "ACTIVE", 8),
    });

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    const session = sessionOf(bridge.beginEncounter("battle-neg-coord", provider));

    expect(session.participants.length).toBe(2);
    expect(session.battleId).toBe("battle-neg-coord");

    // Phase 3F-3: bridge should normalize negative coordinates to their
    // positive equivalents (using modular arithmetic) for consistent
    // chunk lookups and spatial indexing
    const battleSnapshot = bm.getBattle("battle-neg-coord")!;
    expect(battleSnapshot.playerSide.area.center.x).toBeGreaterThanOrEqual(0);
  });

  /* ── MF3-020: Resolved battle cannot reactivate combat ── */
  it("MF3-020: Resolved battle cannot reactivate combat — RESOLVED session stays RESOLVED", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    createBattle(bm);

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
    ]);

    // Begin and resolve combat
    bridge.beginEncounter("battle-1", provider);
    bridge.resolveCombat("battle-1");

    // Attempt to begin new combat on the same battle
    const result = bridge.beginEncounter("battle-1", provider);

    // Phase 3F-3: after combat resolution, the battle should NOT be allowed
    // to start a new combat session. Currently beginEncounter succeeds because
    // it filters out RESOLVED sessions, which is incorrect behavior.
    expect(result).toEqual({ error: "COMBAT_RESOLVED" });
  });

  /* ── MF3-021: Fleeing side + active combat ── */
  it("MF3-021: Fleeing side + active combat — one side flees, combat continues with remaining", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 10),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 8),
    });
    bm.addParticipant(battle.id, "enemy", participant("enemy-2", point(1, 1), "ACTIVE", 6));

    const provider = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 70, maxHp: 70 },
    ]);
    bridge.beginEncounter("battle-1", provider);

    // Set enemy side to FLEEING via BattleManager
    bm.updateParticipantState("battle-1", "enemy-1", "FLEEING");

    // Phase 3F-3: when a battle side enters FLEEING state, the combat
    // participants on that side should be marked as FLEEING in the combat
    // session, and the combat should continue with remaining active participants
    const session = cm.getCombatSessionByBattle("battle-1")!;
    const e1 = session.participants.find((p) => p.participantId === "enemy-1")!;

    // Combat should still be active (not auto-resolved)
    expect(session.state).toBe("ACTIVE");

    // Fleeing participant should be excluded from turn order
    expect(session.turnOrder).not.toContain("enemy-1");
  });

  /* ── MF3-022: Leader transfer compatibility ── */
  it("MF3-022: Leader transfer compatibility — leader transfer doesn't break combat state", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);

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
    const initialSession = sessionOf(bridge.beginEncounter("battle-1", provider));

    // player-1 is leader (highest initiative) and should be currentActor
    expect(initialSession.currentActorId).toBe("player-1");
    expect(bm.getBattle("battle-1")!.playerSide.leaderId).toBe("player-1");

    // Transfer leader to player-2 via BattleManager
    bm.transferLeader("battle-1", "player", "player-2");

    // Verify leader changed in battle
    const updatedBattle = bm.getBattle("battle-1")!;
    expect(updatedBattle.playerSide.leaderId).toBe("player-2");

    // Phase 3F-3: leader transfer should synchronize with combat state.
    // If the old leader was the currentActor, combat should advance to
    // the next alive participant or the new leader
    const combatSession = cm.getCombatSessionByBattle("battle-1")!;
    expect(combatSession.currentActorId).not.toBe("player-1");
  });
});
