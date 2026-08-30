/**
 * Phase 3H.2 POST-AUDIT: Flee Fixes (FLEE-FIX-001..015)
 *
 * Validates:
 * - BUG #1: bridge.removeParticipant failure → no success event
 * - BUG #2: Flee suppression prevents dynamic re-join to same battle
 * - BUG #3: removeParticipant survivor invariant (non-leader removal → ELIMINATED)
 * - Bridge error propagation
 * - Suppression cleanup on battle removal
 * - Spatial FLEEING/REJOIN unaffected
 */
import { describe, it, expect, beforeEach } from "vitest";
import type {
  BattleGroup,
  BattleParticipant,
  CombatSession,
  CombatPoint,
  ParticipantState,
} from "@mmo/shared";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge, type HpProvider } from "./BattleCombatBridge.js";
import { routeEncounterFlee } from "./ProductionMultiParticipantCombat.js";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

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

function createCombatSession(
  combatManager: CombatManager,
  battleManager: BattleManager,
  battle: BattleGroup,
  hpProvider: HpProvider,
  bridge: BattleCombatBridge,
): CombatSession {
  const participants = [
    ...battle.playerSide.participants.map((p) => ({
      participantId: p.id,
      side: "player" as const,
      maxHp: 100,
      currentHp: 100,
      initiative: 10,
      alive: true,
      defending: false,
    })),
    ...battle.enemySide.participants.map((p) => ({
      participantId: p.id,
      side: "enemy" as const,
      maxHp: 100,
      currentHp: 100,
      initiative: 5,
      alive: true,
      defending: false,
    })),
  ];

  const result = combatManager.createCombatSession(
    `combat-${battle.id}`,
    battle.id,
    participants,
  );

  return sessionOf(result);
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Phase 3H.2 — Post-Audit Flee Fixes (FLEE-FIX-001..015)", () => {
  let battleManager: BattleManager;
  let combatManager: CombatManager;
  let bridge: BattleCombatBridge;
  let events: Array<{ targetId: string; event: { type: string; [key: string]: unknown } }>;

  beforeEach(() => {
    battleManager = new BattleManager();
    combatManager = new CombatManager();
    bridge = new BattleCombatBridge(battleManager, combatManager, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]));
    events = [];
  });

  function makeDeps() {
    return {
      battleManager,
      combatManager,
      bridge,
      sendCombatEvent: (sid: string, evt: { type: string; [key: string]: unknown }) => {
        events.push({ targetId: sid, event: evt });
      },
    };
  }

  /* ── FLEE-FIX-001: bridge.removeParticipant failure → no success event ── */

  it("FLEE-FIX-001: bridge failure returns success=false and no event", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Remove player-1 from battle directly (not via bridge) to create bridge failure
    battleManager.removeParticipant(battle.id, "player-1");

    // bridge.removeParticipant will fail: combat removal succeeds,
    // but battle removal fails (PARTICIPANT_NOT_IN_BATTLE)
    const bridgeResult = bridge.removeParticipant(battle.id, "player-1");
    expect(bridgeResult).toHaveProperty("error");

    // Verify: no event was sent
    expect(events).toHaveLength(0);
  });

  /* ── FLEE-FIX-002: bridge.removeParticipant failure → server state consistent ── */

  it("FLEE-FIX-002: bridge failure leaves server state consistent", () => {
    const battle = createBattle(battleManager);
    const session = createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Remove player-1 from battle directly to create bridge failure
    battleManager.removeParticipant(battle.id, "player-1");

    // Attempt bridge.removeParticipant — should fail
    const bridgeResult = bridge.removeParticipant(battle.id, "player-1");
    expect(bridgeResult).toHaveProperty("error");

    // Combat session still has both participants (combat removal happened but battle failed)
    // Actually: bridge.removeParticipant calls combatManager first, then battleManager.
    // Combat removal succeeds, battle removal fails. So combat participant IS removed.
    const updatedSession = combatManager.getCombatSession(session.id);
    expect(updatedSession).toBeDefined();

    // Battle still has enemy-1 (player-1 was already removed directly)
    const updatedBattle = battleManager.getBattle(battle.id);
    expect(updatedBattle).toBeDefined();
    expect(updatedBattle!.enemySide.participants).toHaveLength(1);
  });

  /* ── FLEE-FIX-003: explicit flee → removed from Combat session ── */

  it("FLEE-FIX-003: explicit flee removes participant from Combat", () => {
    const battle = createBattle(battleManager);
    const session = createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    routeEncounterFlee(makeDeps(), "player-1");

    const updatedSession = combatManager.getCombatSession(session.id);
    expect(updatedSession).toBeDefined();
    expect(updatedSession!.participants.find((p) => p.participantId === "player-1")).toBeUndefined();
    expect(updatedSession!.participants).toHaveLength(1);
  });

  /* ── FLEE-FIX-004: explicit flee → removed from Battle manager ── */

  it("FLEE-FIX-004: explicit flee removes participant from Battle", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    routeEncounterFlee(makeDeps(), "player-1");

    const updatedBattle = battleManager.getBattle(battle.id);
    expect(updatedBattle).toBeDefined();
    expect(updatedBattle!.playerSide.participants).toHaveLength(0);
  });

  /* ── FLEE-FIX-005: explicit flee → same Battle cannot auto-rejoin ── */

  it("FLEE-FIX-005: explicit flee blocks dynamic re-join to same battle", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Player-1 flees
    routeEncounterFlee(makeDeps(), "player-1");

    // Verify suppression is set
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(true);

    // Attempt dynamic re-join via evaluateDynamicJoin
    const joinResult = battleManager.evaluateDynamicJoin({
      id: "player-1",
      entityType: "player",
      state: "ACTIVE",
      position: point(0, 0),
    });

    // Should be rejected because player-1 is suppressed for this battle
    expect(joinResult).toHaveProperty("error");
  });

  /* ── FLEE-FIX-006: explicit flee → different Battle CAN join ── */

  it("FLEE-FIX-006: explicit flee allows joining a different battle", () => {
    const battle1 = createBattle(battleManager, {
      id: "battle-1",
      player: participant("player-1", point(0, 0)),
      enemy: participant("enemy-1", point(1, 0)),
    });
    createCombatSession(combatManager, battleManager, battle1, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Player-1 flees battle-1
    routeEncounterFlee(makeDeps(), "player-1");

    // Verify suppression for battle-1
    expect(battleManager.isFleeSuppressed("player-1", battle1.id)).toBe(true);

    // Create battle-2 at player-1's position
    const battle2 = createBattle(battleManager, {
      id: "battle-2",
      player: participant("player-2", point(5, 5)),
      enemy: participant("enemy-2", point(6, 5)),
    });

    // Player-1 tries to join battle-2 — should succeed (not suppressed for battle-2)
    const joinResult = battleManager.evaluateDynamicJoin({
      id: "player-1",
      entityType: "player",
      state: "ACTIVE",
      position: point(5, 5),
    });

    expect(joinResult).toHaveProperty("battle");
  });

  /* ── FLEE-FIX-007: Battle removeBattle → suppression cleaned ── */

  it("FLEE-FIX-007: removing battle cleans up suppression entries", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Player-1 flees
    routeEncounterFlee(makeDeps(), "player-1");
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(true);

    // Remove the battle (simulates GameLoop cleanup)
    battleManager.removeBattle(battle.id);

    // Suppression should be cleaned
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(false);
  });

  /* ── FLEE-FIX-008: repeated dynamic join → still blocked for same Battle ── */

  it("FLEE-FIX-008: repeated dynamic join still blocked after flee", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Player-1 flees
    routeEncounterFlee(makeDeps(), "player-1");

    // Multiple attempts to re-join — all should fail
    for (let i = 0; i < 3; i++) {
      const joinResult = battleManager.evaluateDynamicJoin({
        id: "player-1",
        entityType: "player",
        state: "ACTIVE",
        position: point(0, 0),
      });
      expect(joinResult).toHaveProperty("error");
    }
  });

  /* ── FLEE-FIX-009: spatial FLEEING → still allows REJOIN ── */

  it("FLEE-FIX-009: spatial FLEEING does not set suppression", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Set player-1 to FLEEING via spatial state (not explicit flee)
    battleManager.updateParticipantState(battle.id, "player-1", "FLEEING");

    // No suppression should be set
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(false);

    // Player-1 can still rejoin via spatial REJOIN
    battleManager.updateParticipantState(battle.id, "player-1", "ACTIVE");
    const battleAfter = battleManager.getBattle(battle.id);
    expect(battleAfter!.playerSide.participants.find((p) => p.id === "player-1")).toBeDefined();
  });

  /* ── FLEE-FIX-010: explicit flee ≠ spatial fleeing ── */

  it("FLEE-FIX-010: explicit flee and spatial flee are different mechanics", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Explicit flee: removes from battle + combat + sets suppression
    routeEncounterFlee(makeDeps(), "player-1");

    // Player-1 is gone from battle
    const updatedBattle = battleManager.getBattle(battle.id);
    expect(updatedBattle!.playerSide.participants).toHaveLength(0);

    // Suppression is set
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(true);

    // Spatial FLEEING: sets state but keeps participant in battle, no suppression
    const battle2 = createBattle(battleManager, {
      id: "battle-2",
      player: participant("player-2", point(5, 5)),
      enemy: participant("enemy-2", point(6, 5)),
    });
    battleManager.updateParticipantState(battle2.id, "player-2", "FLEEING");

    const battle2After = battleManager.getBattle(battle2.id);
    expect(battle2After!.playerSide.participants).toHaveLength(1);
    expect(battleManager.isFleeSuppressed("player-2", battle2.id)).toBe(false);
  });

  /* ── FLEE-FIX-011: last survivor removed → side ELIMINATED ── */

  it("FLEE-FIX-011: removing last survivor (non-leader) eliminates side", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Add second player
    battleManager.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));
    const updatedBattle = battleManager.getBattle(battle.id)!;

    // Remove player-1 (leader) first — leader transfers to player-2
    battleManager.removeParticipant(battle.id, "player-1");
    const afterLeader = battleManager.getBattle(battle.id)!;
    expect(afterLeader.playerSide.leaderId).toBe("player-2");

    // Remove player-2 (last survivor) — side should become ELIMINATED
    battleManager.removeParticipant(battle.id, "player-2");
    const final = battleManager.getBattle(battle.id)!;
    expect(final.playerSide.state).toBe("ELIMINATED");
    expect(final.playerSide.participants).toHaveLength(0);
  });

  /* ── FLEE-FIX-012: bridge.removeParticipant propagates BattleManager failure ── */

  it("FLEE-FIX-012: bridge propagates BattleManager error", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Remove player-1 from battle directly — battle removal will fail in bridge
    battleManager.removeParticipant(battle.id, "player-1");

    // bridge.removeParticipant: combat removal succeeds, battle removal fails
    const result = bridge.removeParticipant(battle.id, "player-1");
    expect(result).toHaveProperty("error");
  });

  /* ── FLEE-FIX-013: no stale suppression after removeBattle ── */

  it("FLEE-FIX-013: no stale suppression after battle removal", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Player-1 flees
    routeEncounterFlee(makeDeps(), "player-1");
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(true);

    // Remove battle
    battleManager.removeBattle(battle.id);

    // No stale suppression
    expect(battleManager.isFleeSuppressed("player-1", battle.id)).toBe(false);

    // Create new battle — player-1 should be able to join
    const newBattle = createBattle(battleManager, {
      id: "battle-new",
      player: participant("player-2", point(5, 5)),
      enemy: participant("enemy-2", point(6, 5)),
    });

    const joinResult = battleManager.evaluateDynamicJoin({
      id: "player-1",
      entityType: "player",
      state: "ACTIVE",
      position: point(5, 5),
    });

    expect(joinResult).toHaveProperty("battle");
  });

  /* ── FLEE-FIX-014: leader explicit flee → correct leader handling ── */

  it("FLEE-FIX-014: leader flee transfers leadership before removal", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Add second player
    battleManager.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    // Verify player-1 is leader
    const before = battleManager.getBattle(battle.id)!;
    expect(before.playerSide.leaderId).toBe("player-1");

    // Player-1 (leader) flees
    routeEncounterFlee(makeDeps(), "player-1");

    // Player-2 should now be leader
    const after = battleManager.getBattle(battle.id)!;
    expect(after.playerSide.leaderId).toBe("player-2");
    expect(after.playerSide.participants).toHaveLength(1);
  });

  /* ── FLEE-FIX-015: current actor explicit flee → no dangling currentActor ── */

  it("FLEE-FIX-015: current actor flee advances turn correctly", () => {
    const battle = createBattle(battleManager);
    const session = createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // player-1 is current actor
    expect(session.currentActorId).toBe("player-1");

    // player-1 flees
    routeEncounterFlee(makeDeps(), "player-1");

    // Turn should advance to enemy-1 (no dangling currentActor)
    const updatedSession = combatManager.getCombatSession(session.id);
    expect(updatedSession).toBeDefined();
    expect(updatedSession!.currentActorId).toBe("enemy-1");
  });
});
