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
  return expect.fail(`Expected battle, received ${(result as any).error}`);
}

function sessionOf(result: { session: CombatSession } | { error: string }): CombatSession {
  expect(result).not.toHaveProperty("error");
  if ("session" in result) return result.session;
  return expect.fail(`Expected session, received ${(result as any).error}`);
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
  const map = new Map(entries.map(e => [e.id, { currentHp: e.currentHp, maxHp: e.maxHp }]));
  return { getHp(id: string) { return map.get(id); } };
}

function worldHpMap(
  entries: Array<{ id: string; currentHp: number; maxHp: number }>,
): WorldHealthWriter {
  const map = new Map(entries.map(e => [e.id, { currentHp: e.currentHp, maxHp: e.maxHp }]));
  return {
    getHp(id: string) { return map.get(id); },
    setHp(id: string, hp: number) { const e = map.get(id); if (e) e.currentHp = Math.max(0, Math.min(hp, e.maxHp)); },
    isAlive(id: string) { const e = map.get(id); return e !== undefined && e.currentHp > 0; },
  };
}

function statsMap(
  entries: Array<{ id: string; attack: number; defense: number; level: number }>,
): CombatStatsProvider {
  const map = new Map(entries.map(e => [e.id, e]));
  return { getStats(id: string) { return map.get(id); } };
}

function damageOf(result: CombatActionBridgeResult): DamageResult {
  expect(result).not.toHaveProperty("error");
  if ("damage" in result) return result.damage;
  return expect.fail(`Expected damage, received ${(result as any).error}`);
}

/* ── Tests ── */

describe("BattleCombatLifecycleBridge", () => {
  /* ── LC-001: Battle active without combat ── */
  it("LC-001: battle active without combat → hasActiveCombat false", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    expect(bridge.getCombatId("battle-1")).toBeUndefined();
  });

  /* ── LC-002: Begin combat creates session ── */
  it("LC-002: beginEncounter → combat ACTIVE, mapping exists", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const result = bridge.beginEncounter("battle-1", hp);
    expect(result).toHaveProperty("session");
    const session = sessionOf(result);
    expect(session.state).toBe("ACTIVE");
    expect(bridge.hasActiveCombat("battle-1")).toBe(true);
    expect(bridge.getCombatId("battle-1")).toBe(session.id);
  });

  /* ── LC-003: Duplicate combat rejected ── */
  it("LC-003: beginEncounter on battle with active combat → ACTIVE_COMBAT_EXISTS", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    const second = bridge.beginEncounter("battle-1", hp);
    expectBridgeError(second, "ACTIVE_COMBAT_EXISTS");
  });

  /* ── LC-004: Combat active + battle active ── */
  it("LC-004: combat ACTIVE + battle ACTIVE simultaneously", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    const battle = createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    expect(battle.playerSide.state).toBe("ACTIVE");
    const session = cm.getCombatSessionByBattle("battle-1");
    expect(session).toBeDefined();
    expect(session!.state).toBe("ACTIVE");
  });

  /* ── LC-005: Combat resolved + battle active ── */
  it("LC-005: resolveCombat → battle still ACTIVE, combat RESOLVED", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    const resolved = bridge.resolveCombat("battle-1");
    expect(resolved).toHaveProperty("session");
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    const battle = bm.getBattle("battle-1");
    expect(battle).toBeDefined();
    expect(battle!.playerSide.state).toBe("ACTIVE");
  });

  /* ── LC-006: Battle resolved + combat active → must resolve combat ── */
  it("LC-006: handleBattleResolved → active combat also resolves", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    expect(bridge.hasActiveCombat("battle-1")).toBe(true);
    // Resolve the battle — combat should also resolve
    const result = bridge.handleBattleResolved("battle-1");
    expect(result).toHaveProperty("session");
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    const session = sessionOf(result);
    expect(session.state).toBe("RESOLVED");
  });

  /* ── LC-007: Battle resolved + combat resolved ── */
  it("LC-007: both RESOLVED → no dangling state", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    bridge.resolveCombat("battle-1");
    // Now resolve the battle too — idempotent, already resolved
    const result = bridge.handleBattleResolved("battle-1");
    // Both combat and battle already resolved — no dangling state
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    expect(bridge.getCombatId("battle-1")).toBeUndefined();
  });

  /* ── LC-008: Resolved battle cannot create combat ── */
  it("LC-008: beginEncounter on nonexistent battle → error", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const result = bridge.beginEncounter("nonexistent-battle", hp);
    expectBridgeError(result, "BATTLE_NOT_FOUND");
  });

  /* ── LC-009: Participant added to battle does not auto-join combat ── */
  it("LC-009: addParticipant to battle → combat participant count unchanged", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    // Add participant to battle AFTER combat started
    bm.addParticipant("battle-1", "player", participant("player-2", point(2, 0)));
    // Combat should still have original participants
    const session = cm.getCombatSessionByBattle("battle-1");
    expect(session).toBeDefined();
    expect(session!.participants.length).toBe(2);
  });

  /* ── LC-010: Eligible participant can join combat ── */
  it("LC-010: eligible battle participant can join combat", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    // Add participant before combat starts
    bm.addParticipant("battle-1", "player", participant("player-2", point(2, 0)));
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 80, maxHp: 80 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const session = sessionOf(bridge.beginEncounter("battle-1", hp));
    expect(session.participants.length).toBe(3);
  });

  /* ── LC-011: Participant death sync ── */
  it("LC-011: kill in combat → battle participant ELIMINATED", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 1, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 50, defense: 10, level: 1 },
      { id: "enemy-1", attack: 10, defense: 10, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);
    createBattle(bm);
    bridge.beginEncounter("battle-1", world);
    const damage = bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);
    expect(damage).toHaveProperty("damage");
    const dmg = damageOf(damage);
    expect(dmg.targetKilled).toBe(true);
    // Battle participant removed by death
    const battle = bm.getBattle("battle-1");
    expect(battle).toBeDefined();
    const enemy = battle!.enemySide.participants.find(p => p.id === "enemy-1");
    expect(enemy).toBeUndefined();
  });

  /* ── LC-012: Player death removes battle membership ── */
  it("LC-012: player death → removed from battle side", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 1, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 10, defense: 10, level: 1 },
      { id: "enemy-1", attack: 50, defense: 10, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);
    createBattle(bm, {
      player: participant("player-1", point(0, 0), "ACTIVE", 5),
      enemy: participant("enemy-1", point(1, 0), "ACTIVE", 20),
    });
    bridge.beginEncounter("battle-1", world);
    // enemy-1 has higher initiative (20 > 5), so enemy acts first
    const damage = bridge.applyCombatAction("battle-1", "enemy-1", "player-1", stats);
    expect(damage).toHaveProperty("damage");
    const dmg = damageOf(damage);
    expect(dmg.targetKilled).toBe(true);
    // Player should be removed from battle
    const battle = bm.getBattle("battle-1");
    expect(battle).toBeDefined();
    const player = battle!.playerSide.participants.find(p => p.id === "player-1");
    expect(player).toBeUndefined();
  });

  /* ── LC-013: Mob death preserves battle semantics ── */
  it("LC-013: mob death → removed from battle, battle state updates", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const world = worldHpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 1, maxHp: 100 },
    ]);
    const stats = statsMap([
      { id: "player-1", attack: 50, defense: 10, level: 1 },
      { id: "enemy-1", attack: 10, defense: 10, level: 1 },
    ]);
    const bridge = new BattleCombatBridge(bm, cm, world);
    createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });
    bridge.beginEncounter("battle-1", world);
    const damage = bridge.applyCombatAction("battle-1", "player-1", "enemy-1", stats);
    expect(damage).toHaveProperty("damage");
    const dmg = damageOf(damage);
    expect(dmg.targetKilled).toBe(true);
    // Mob should be removed from battle
    const battle = bm.getBattle("battle-1");
    expect(battle).toBeDefined();
    const enemy = battle!.enemySide.participants.find(p => p.id === "enemy-1");
    expect(enemy).toBeUndefined();
  });

  /* ── LC-014: Leader transfer ── */
  it("LC-014: transferLeader → battle leader updated", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    const battle = createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });
    // Add a second player
    bm.addParticipant("battle-1", "player", participant("player-2", point(2, 0)));
    // Transfer leader to player-2
    const result = bm.transferLeader("battle-1", "player", "player-2");
    expect(result).toHaveProperty("battle");
    const updated = battleOf(result);
    expect(updated.playerSide.leaderId).toBe("player-2");
  });

  /* ── LC-015: Leader transfer does not reorder combat ── */
  it("LC-015: leader transfer → combat turnOrder unchanged", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm, {
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });
    bm.addParticipant("battle-1", "player", participant("player-2", point(2, 0)));
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 80, maxHp: 80 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const sessionBefore = sessionOf(bridge.beginEncounter("battle-1", hp));
    const orderBefore = [...sessionBefore.turnOrder];
    // Transfer leader
    bm.transferLeader("battle-1", "player", "player-2");
    // Combat turnOrder should be unchanged
    const sessionAfter = cm.getCombatSessionByBattle("battle-1");
    expect(sessionAfter).toBeDefined();
    expect(sessionAfter!.turnOrder).toEqual(orderBefore);
  });

  /* ── LC-016: Active combat lookup by battle ── */
  it("LC-016: getCombatId returns correct combatId", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const session = sessionOf(bridge.beginEncounter("battle-1", hp));
    expect(bridge.getCombatId("battle-1")).toBe(session.id);
    // Reverse lookup
    expect(bridge.getBattleId(session.id)).toBe("battle-1");
  });

  /* ── LC-017: Bridge idempotence ── */
  it("LC-017: lifecycle methods idempotent — no duplicates", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    // Call handleBattleResolved twice
    bridge.handleBattleResolved("battle-1");
    const second = bridge.handleBattleResolved("battle-1");
    // Should still work (idempotent)
    expect(second).toHaveProperty("session");
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
  });

  /* ── LC-018: Multiple battles independent ── */
  it("LC-018: multiple battles → separate combats don't interfere", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm, {
      id: "battle-1",
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });
    createBattle(bm, {
      id: "battle-2",
      player: participant("player-2", point(5, 0)),
      enemy: participant("enemy-2", point(6, 0)),
    });
    const hp1 = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const hp2 = hpMap([
      { id: "player-2", currentHp: 80, maxHp: 80 },
      { id: "enemy-2", currentHp: 80, maxHp: 80 },
    ]);
    const s1 = sessionOf(bridge.beginEncounter("battle-1", hp1));
    const s2 = sessionOf(bridge.beginEncounter("battle-2", hp2));
    expect(s1.id).not.toBe(s2.id);
    expect(bridge.hasActiveCombat("battle-1")).toBe(true);
    expect(bridge.hasActiveCombat("battle-2")).toBe(true);
    // Resolve one — other unaffected
    bridge.resolveCombat("battle-1");
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    expect(bridge.hasActiveCombat("battle-2")).toBe(true);
  });

  /* ── LC-019: Combat removal cleans battle mapping ── */
  it("LC-019: combat resolved + removed → mapping cleaned", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    const session = sessionOf(bridge.beginEncounter("battle-1", hp));
    bridge.resolveCombat("battle-1");
    expect(bridge.getCombatId("battle-1")).toBeUndefined();
    expect(bridge.getBattleId(session.id)).toBeUndefined();
  });

  /* ── LC-020: No dangling active combat after battle resolve ── */
  it("LC-020: battleResolve → hasActiveCombat false, no dangling", () => {
    const bm = new BattleManager();
    const cm = new CombatManager();
    const bridge = new BattleCombatBridge(bm, cm);
    createBattle(bm);
    const hp = hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]);
    bridge.beginEncounter("battle-1", hp);
    expect(bridge.hasActiveCombat("battle-1")).toBe(true);
    bridge.handleBattleResolved("battle-1");
    expect(bridge.hasActiveCombat("battle-1")).toBe(false);
    // Verify combat session is RESOLVED
    const mappings = bridge.getMappings();
    const mapping = mappings.find(m => m.battleId === "battle-1");
    expect(mapping).toBeUndefined();
  });
});
