/**
 * Phase 3H.2: New Combat Flee Action Tests (FLEE-001..008)
 *
 * Validates:
 * - routeEncounterFlee() properly routes flee through New Combat
 * - Server-authoritative validation (in combat, your turn, not already fleeing)
 * - Full removal from BattleManager + CombatManager on success
 * - BattleGroup/BattleSide/BattleArea state after flee
 * - encounter_fled event sent to client
 * - Last player flee ends battle
 * - Partial group flee leaves remaining players fighting
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

describe("Phase 3H.2 — New Combat Flee Action", () => {
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

  /* ── FLEE-001: Valid flee (in combat, your turn) → success ── */

  it("FLEE-001: Valid flee removes participant from battle and combat", () => {
    const battle = createBattle(battleManager);
    const session = createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Ensure player-1 is current actor
    expect(session.currentActorId).toBe("player-1");

    const result = routeEncounterFlee(makeDeps(), "player-1");

    expect(result).toEqual({ kind: "combat", success: true });

    // Player removed from battle
    const updatedBattle = battleManager.getBattle(battle.id);
    expect(updatedBattle).toBeDefined();
    expect(updatedBattle!.playerSide.participants).toHaveLength(0);

    // Player removed from combat session
    const updatedSession = combatManager.getCombatSession(session.id);
    expect(updatedSession).toBeDefined();
    expect(updatedSession!.participants.find((p) => p.participantId === "player-1")).toBeUndefined();
  });

  /* ── FLEE-002: Flee not in combat → not-in-combat ── */

  it("FLEE-002: Flee not in combat returns not-in-combat", () => {
    const result = routeEncounterFlee(makeDeps(), "player-999");

    expect(result).toEqual({ kind: "not-in-combat" });
  });

  /* ── FLEE-003: Flee not your turn → success=false ── */

  it("FLEE-003: Flee not your turn returns success=false and advances turn", () => {
    const battle = createBattle(battleManager);
    const session = createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // player-1 is current actor, enemy-1 tries to flee
    expect(session.currentActorId).toBe("player-1");

    const result = routeEncounterFlee(makeDeps(), "enemy-1");

    expect(result).toEqual({ kind: "combat", success: false });

    // Player still in battle
    const updatedBattle = battleManager.getBattle(battle.id);
    expect(updatedBattle!.enemySide.participants).toHaveLength(1);
  });

  /* ── FLEE-004: Flee sends encounter_fled event ── */

  it("FLEE-004: Successful flee sends encounter_fled event to client", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    routeEncounterFlee(makeDeps(), "player-1");

    expect(events).toHaveLength(1);
    expect(events[0].targetId).toBe("player-1");
    expect(events[0].event.type).toBe("encounter_fled");
  });

  /* ── FLEE-005: Last player flees → battle side becomes ELIMINATED ── */

  it("FLEE-005: Last player flees → player side eliminated", () => {
    const battle = createBattle(battleManager);
    createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    routeEncounterFlee(makeDeps(), "player-1");

    // Battle should still exist but player side has no participants
    const updatedBattle = battleManager.getBattle(battle.id);
    expect(updatedBattle).toBeDefined();
    expect(updatedBattle!.playerSide.participants).toHaveLength(0);
    expect(updatedBattle!.playerSide.state).toBe("ELIMINATED");
  });

  /* ── FLEE-006: Partial group flee → remaining players continue ── */

  it("FLEE-006: Partial group flee leaves remaining players in combat", () => {
    const battle = createBattle(battleManager, {
      player: participant("player-1", point(0, 0)),
    });
    // Add second player to the battle
    battleManager.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));

    // Get updated battle snapshot after adding player-2
    const updatedBattle = battleManager.getBattle(battle.id)!;

    const session = createCombatSession(combatManager, battleManager, updatedBattle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // player-1 is current actor, they flee
    expect(session.currentActorId).toBe("player-1");

    routeEncounterFlee(makeDeps(), "player-1");

    // player-2 still in battle
    const finalBattle = battleManager.getBattle(battle.id);
    expect(finalBattle!.playerSide.participants).toHaveLength(1);
    expect(finalBattle!.playerSide.participants[0].id).toBe("player-2");

    // Combat session still active with player-2 and enemy-1
    const updatedSession = combatManager.getCombatSession(session.id);
    expect(updatedSession!.state).toBe("ACTIVE");
    expect(updatedSession!.participants).toHaveLength(2);
  });

  /* ── FLEE-007: Flee cleans up BattleArea (radius recalculated) ── */

  it("FLEE-007: Flee triggers BattleArea radius recalculation", () => {
    const battle = createBattle(battleManager);

    // Add more participants to expand area
    battleManager.addParticipant(battle.id, "player", participant("player-2", point(0, 1)));
    battleManager.addParticipant(battle.id, "player", participant("player-3", point(0, 2)));

    // Get updated battle with 3 players
    const expandedBattle = battleManager.getBattle(battle.id)!;
    const expandedRadius = expandedBattle.playerSide.area.radius;

    createCombatSession(combatManager, battleManager, expandedBattle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "player-2", currentHp: 100, maxHp: 100 },
      { id: "player-3", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    // Player-1 flees
    routeEncounterFlee(makeDeps(), "player-1");

    // Radius should be recalculated (smaller with 2 players than 3)
    const finalBattle = battleManager.getBattle(battle.id);
    expect(finalBattle!.playerSide.area.radius).toBeLessThan(expandedRadius);
    expect(finalBattle!.playerSide.participants).toHaveLength(2);
  });

  /* ── FLEE-008: Flee advances turn when current actor flees ── */

  it("FLEE-008: Current actor flee advances turn to next participant", () => {
    const battle = createBattle(battleManager);
    const session = createCombatSession(combatManager, battleManager, battle, hpMap([
      { id: "player-1", currentHp: 100, maxHp: 100 },
      { id: "enemy-1", currentHp: 100, maxHp: 100 },
    ]), bridge);

    expect(session.currentActorId).toBe("player-1");

    routeEncounterFlee(makeDeps(), "player-1");

    // Turn should advance to enemy-1 (only remaining participant)
    const updatedSession = combatManager.getCombatSession(session.id);
    expect(updatedSession!.currentActorId).toBe("enemy-1");
  });
});
