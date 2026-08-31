import { describe, it, expect } from "vitest";
import type {
  BattleGroup,
  CombatPoint,
  WorldHealthWriter,
} from "@mmo/shared";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import { CombatSystem, type MobInstance, type MobTypeConfig } from "./CombatSystem.js";
import { BATTLE_MOB_TURN_DELAY_MS, BATTLE_TURN_TIMEOUT_MS } from "@mmo/shared";
import {
  isMobOwnedByCombat,
  routeRealtimeAttack,
  routeEncounterAction,
  routeEncounterDefend,
  tickCombatEnemyTurns,
  releaseMobCombatState,
  type ProductionCombatDeps,
  type CombatPlayerView,
} from "./ProductionCombatRouter.js";
import {
  notifyCombatJoinedPlayers,
  markCombatNotified,
  resolveEncounterTarget,
} from "./ProductionMultiParticipantCombat.js";

/* ══════════════════════════════════════════════════════�? * Phase 3G-3 �?Multi-Participant Production Combat (MP-001..030)
 *
 * Every test drives the REAL production functions GameRoom/GameLoop call:
 * routeRealtimeAttack / routeEncounterAction / routeEncounterDefend /
 * tickCombatEnemyTurns / evaluateTurnTimeout / bridge.syncParticipants /
 * battleManager.updateParticipantState + syncFleeingState/syncRejoinState /
 * notifyCombatJoinedPlayers + the cleanup trio.
 *
 * Deterministic stats: player attack 10 / defense 5 / level 1; mob baseHp 30,
 * baseAttack 5, baseDefense 1, level 1.  player→mob damage = round(10·1.1�?)=10;
 * mob→player damage = max(1, round(5·1.1�?))=1.
 * ══════════════════════════════════════════════════════�?*/

const point = (x: number, y: number): CombatPoint => ({ x, y });

function makeMob(id: string, hp: number, overrides: Partial<MobTypeConfig> = {}): MobInstance {
  const config: MobTypeConfig = {
    id,
    name: id,
    biomes: [],
    baseHp: 30,
    baseAttack: 5,
    baseDefense: 1,
    level: 1,
    xpReward: 10,
    lootTable: [],
    color: 0x000000,
    ...overrides,
  };
  return {
    id,
    typeId: id,
    config,
    x: 1,
    y: 0,
    currentHp: hp,
    maxHp: config.baseHp,
    aggroTarget: null,
    aiState: "idle",
    patrolTarget: null,
    spawnX: 1,
    spawnY: 0,
    chunkX: 0,
    chunkY: 0,
    deathTime: 0,
    lastAttackTime: 0,
    lastCombatTime: 0,
    synced: false,
  };
}

interface World {
  deps: ProductionCombatDeps;
  bm: BattleManager;
  cm: CombatManager;
  bridge: BattleCombatBridge;
  combatSystem: CombatSystem;
  mobs: Map<string, MobInstance>;
  players: Map<string, CombatPlayerView>;
  entities: Map<string, { health: number; maxHealth: number }>;
  events: Array<{ type: string; [key: string]: unknown }>;
  respawns: string[];
  kills: Array<{ mobId: string; playerSessionId: string }>;
}

function makeWorld(): World {
  const bm = new BattleManager();
  const cm = new CombatManager();
  const combatSystem = new CombatSystem();
  const mobs = new Map<string, MobInstance>();
  const players = new Map<string, CombatPlayerView>();
  const entities = new Map<string, { health: number; maxHealth: number }>();
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  const respawns: string[] = [];
  const kills: Array<{ mobId: string; playerSessionId: string }> = [];

  const worldHp: WorldHealthWriter = {
    getHp: (id: string) => {
      const p = players.get(id);
      if (p) return { currentHp: p.health, maxHp: p.maxHealth };
      const mob = mobs.get(id);
      if (mob) return { currentHp: mob.currentHp, maxHp: mob.maxHp };
      const e = entities.get(id);
      if (e) return { currentHp: e.health, maxHp: e.maxHealth };
      return undefined;
    },
    setHp: (id: string, hp: number) => {
      const p = players.get(id);
      if (p) {
        p.health = Math.max(0, Math.min(hp, p.maxHealth));
        return;
      }
      const mob = mobs.get(id);
      if (mob) {
        mob.currentHp = Math.max(0, Math.min(hp, mob.maxHp));
        const e = entities.get(id);
        if (e) e.health = mob.currentHp;
        return;
      }
      const e = entities.get(id);
      if (e) e.health = Math.max(0, Math.min(hp, e.maxHealth));
    },
    isAlive: (id: string) => {
      const hp = worldHp.getHp(id);
      return hp !== undefined && hp.currentHp > 0;
    },
  };

  const bridge = new BattleCombatBridge(bm, cm, worldHp);
  const deps: ProductionCombatDeps = {
    battleManager: bm,
    combatManager: cm,
    bridge,
    combatSystem,
    getMob: (id) => mobs.get(id),
    getPlayer: (id) => players.get(id),
    getHp: (id) => worldHp.getHp(id),
    sendCombatEvent: (sid, evt) => events.push(evt),
    respawnPlayer: (sid) => respawns.push(sid),
    resolveKill: (mob, sid) => {
      mob.aiState = "dead";
      mob.currentHp = 0;
      kills.push({ mobId: mob.id, playerSessionId: sid });
    },
    combatNotifiedPlayers: new Map<string, Set<string>>(),
  };

  return { deps, bm, cm, bridge, combatSystem, mobs, players, entities, events, respawns, kills };
}

function addPlayer(w: World, id: string, health = 100, attack = 10): void {
  w.players.set(id, { x: 0, y: 0, health, maxHealth: 100, level: 1 });
  const ps = w.combatSystem.getPlayerStats(id);
  ps.attack = attack;
  ps.defense = 5;
}

function addMob(w: World, id: string, hp = 30, x = 1, y = 0): MobInstance {
  // Keep maxHp in sync with the supplied HP so setHp clamping never bites
  const mob = makeMob(id, hp, hp !== 30 ? { baseHp: hp } : {});
  mob.x = x;
  mob.y = y;
  w.mobs.set(id, mob);
  w.entities.set(id, { health: hp, maxHealth: mob.maxHp });
  return mob;
}

/** Drive a round boundary flush: enemy turn wraps to index 0 �?pending flush. */
function driveRoundBoundary(w: World, now = Date.now()): void {
  tickCombatEnemyTurns(w.deps, now + BATTLE_MOB_TURN_DELAY_MS);
}

/** Mirror of GameLoop's auto-join: battle membership + combat sync (pending). */
function autoJoin(
  w: World,
  battleId: string,
  participant: Parameters<BattleManager["addParticipant"]>[2],
  side: "player" | "enemy",
): void {
  w.bm.addParticipant(battleId, side, participant);
  w.bridge.syncParticipants(battleId, { getHp: w.deps.getHp });
}

describe("Phase 3G-3 �?Multi-Participant Production Combat", () => {
  describe("2v1 production (MP-001..009)", () => {
    it("MP-001: 2v1 �?second player joins an ACTIVE combat as pending (not blocked)", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");

      const r1 = routeRealtimeAttack(w.deps, "player-A", x);
      expect(r1.kind).toBe("combat");

      const r2 = routeRealtimeAttack(w.deps, "player-B", x);
      expect(r2.kind).toBe("joined");
      // B is now a battle participant, in the combat's pending queue
      expect(w.bm.getBattleByParticipant("player-B")).toBeDefined();
      const session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-B")!.battle.id,
      )!;
      expect(session.pendingParticipants.some((p) => p.participantId === "player-B")).toBe(true);

      // Repeated join attempt �?blocked (no double-pending)
      const r3 = routeRealtimeAttack(w.deps, "player-B", x);
      expect(r3.kind).toBe("blocked");
      expect(session.pendingParticipants.filter((p) => p.participantId === "player-B").length).toBe(1);
    });

    it("MP-002: 1v2 �?a mob joins via battle membership sync and becomes pending", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      addMob(w, "mob-Y", 30, 1, 1);

      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;

      // Mob Y auto-joins the battle (GameLoop evaluateDynamicJoin �?addParticipant)
      autoJoin(w, battle.id, {
        id: "mob-Y",
        position: point(1, 1),
        combatPower: 5,
        personality: "aggressive",
        state: "ACTIVE",
      }, "enemy");

      let session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.pendingParticipants.some((p) => p.participantId === "mob-Y")).toBe(true);

      // Next round boundary �?Y flushed into turnOrder
      driveRoundBoundary(w);
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnOrder).toContain("mob-Y");
    });

    it("MP-003: joining deals NO damage this round", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");

      routeRealtimeAttack(w.deps, "player-A", x); // X: 30 �?20
      const before = x.currentHp;
      const r = routeRealtimeAttack(w.deps, "player-B", x);
      expect(r.kind).toBe("joined");
      expect(x.currentHp).toBe(before); // no damage on join
    });

    it("MP-004: engine rejects a non-existent explicit target", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      const session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      const result = w.cm.applyAttack(
        session.id,
        { actorId: "player-A", targetId: "ghost", actionType: "ATTACK" },
        { getStats: () => ({ attack: 10, defense: 1, level: 1 }) },
      );
      expect("error" in result && result.error === "TARGET_NOT_FOUND").toBe(true);
    });

    it("MP-005: friendly fire is rejected", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      // B joins as pending
      routeRealtimeAttack(w.deps, "player-B", x);
      // Drive so A is the current actor (X attacks, turn wraps back to A)
      driveRoundBoundary(w);
      const session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      expect(session.currentActorId).toBe("player-A");
      const result = w.cm.applyAttack(
        session.id,
        { actorId: "player-A", targetId: "player-B", actionType: "ATTACK" },
        { getStats: () => ({ attack: 10, defense: 1, level: 1 }) },
      );
      expect("error" in result && result.error === "FRIENDLY_FIRE_REJECTED").toBe(true);
    });

    it("MP-006: non-current actor cannot attack", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x); // A is currentActor initially
      routeRealtimeAttack(w.deps, "player-B", x); // B pending
      const session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      // A is currentActor after its opening hit? No �?the turn advanced to X.
      // Force a known actor: B (pending) is NOT currentActor �?NOT_CURRENT_ACTOR.
      const result = w.cm.applyAttack(
        session.id,
        { actorId: "player-B", targetId: "mob-X", actionType: "ATTACK" },
        { getStats: () => ({ attack: 10, defense: 1, level: 1 }) },
      );
      expect("error" in result && result.error === "NOT_CURRENT_ACTOR").toBe(true);
    });

    it("MP-007: joined participant is pending �?not in turnOrder", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      routeRealtimeAttack(w.deps, "player-B", x);
      const session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      expect(session.turnOrder).not.toContain("player-B");
      expect(session.pendingParticipants.some((p) => p.participantId === "player-B")).toBe(true);
    });

    it("MP-008: pending participant flushes into turnOrder at the next round boundary", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      routeRealtimeAttack(w.deps, "player-B", x);
      let session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      expect(session.turnOrder).not.toContain("player-B");

      driveRoundBoundary(w);
      session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      expect(session.turnOrder).toContain("player-B");
      expect(session.pendingParticipants.some((p) => p.participantId === "player-B")).toBe(false);
    });

    it("MP-009: a fleeing pending participant is never flushed", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      routeRealtimeAttack(w.deps, "player-B", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;

      // B flees while pending
      w.bm.updateParticipantState(battle.id, "player-B", "FLEEING");
      w.bridge.syncFleeingState(battle.id);

      driveRoundBoundary(w);
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnOrder).not.toContain("player-B");
      const b = session.participants.find((p) => p.participantId === "player-B")!;
      expect(b.fleeing).toBe(true);
    });
  });

  describe("Target derivation / aggro (MP-010..018)", () => {
    it("MP-010: turn-based action targets the enemy leader (explicit at engine)", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      routeRealtimeAttack(w.deps, "player-B", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      driveRoundBoundary(w); // flush B

      // A's turn �?routeEncounterAction targets enemy leader X
      const r = routeEncounterAction(w.deps, "player-A");
      expect(r.kind).toBe("combat");
      expect(r.damage?.targetId).toBe("mob-X");
      expect(r.damage?.damage).toBe(10);
    });

    it("MP-011: after the leader dies, the next enemy becomes the target", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      addMob(w, "mob-X", 30);
      addMob(w, "mob-Y", 30, 1, 1);
      const x = w.mobs.get("mob-X")!;
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle.id, { id: "mob-Y", position: point(1, 1), combatPower: 5, personality: "aggressive", state: "ACTIVE" }, "enemy");
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      driveRoundBoundary(w);

      // Kill X (leader): A attacks X, then B attacks X (X dies)
      let r = routeEncounterAction(w.deps, "player-A");
      expect(r.damage?.targetId).toBe("mob-X");
      r = routeEncounterAction(w.deps, "player-B");
      expect(r.damage?.targetId).toBe("mob-X");
      expect(r.damage?.targetKilled).toBe(true);
      expect(w.kills.filter((k) => k.mobId === "mob-X").length).toBe(1);

      // Y (current actor) counter-attacks �?wraps back to A
      driveRoundBoundary(w);
      // Next player action targets the new leader (Y)
      r = routeEncounterAction(w.deps, "player-A");
      expect(r.damage?.targetId).toBe("mob-Y");
    });

    it("MP-012: a dead participant is skipped in the turn rotation", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      addMob(w, "mob-Y", 30, 1, 1);
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle.id, { id: "mob-Y", position: point(1, 1), combatPower: 5, personality: "aggressive", state: "ACTIVE" }, "enemy");
      driveRoundBoundary(w);

      // Kill X quickly (A attacks it on the next two turns with tick in between)
      let guard = 0;
      while (w.mobs.get("mob-X")!.aiState !== "dead" && guard < 8) {
        const now = Date.now();
        driveRoundBoundary(w, now);
        const r = routeEncounterAction(w.deps, "player-A");
        if (r.kind !== "combat") break;
        guard++;
      }
      expect(w.mobs.get("mob-X")!.aiState).toBe("dead");
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      // Full rotation must never land on the dead X
      for (let i = 0; i < 10; i++) {
        driveRoundBoundary(w, Date.now());
        const s = w.cm.getCombatSessionByBattle(battle.id)!;
        expect(s.currentActorId).not.toBe("mob-X");
        routeEncounterAction(w.deps, "player-A");
      }
      expect(session.state).toBe("ACTIVE"); // Y still alive
    });

    it("MP-013: a single hit applies damage exactly once", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      const r = routeRealtimeAttack(w.deps, "player-A", x);
      expect(r.kind).toBe("combat");
      expect(x.currentHp).toBe(20); // exactly one application of 10 damage
      expect(w.entities.get("mob-X")!.health).toBe(20); // world-HP mirror consistent
    });

    it("MP-014: an enemy turn damages exactly one player by the exact amount", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x); // turn �?X
      driveRoundBoundary(w); // X attacks A
      expect(w.players.get("player-A")!.health).toBe(99); // exactly 1 damage
      const damaged = w.events.filter((e) => e.type === "player_damaged");
      expect(damaged.length).toBe(1);
    });

    it("MP-015: aggro follows the last attacker and drives the enemy turn target", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      expect(x.aggroTarget).toBe("player-A");
      routeRealtimeAttack(w.deps, "player-B", x); // join �?aggro to B
      expect(x.aggroTarget).toBe("player-B");

      driveRoundBoundary(w); // X's turn (aggro B) �?damages B
      expect(w.players.get("player-B")!.health).toBe(99);
      expect(w.players.get("player-A")!.health).toBe(100);
    });

    it("MP-016: removing the current actor does not increment round or flush pending", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x); // turn �?X
      routeRealtimeAttack(w.deps, "player-B", x); // B pending
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      const roundBefore = session.round;

      // X (current actor) flees
      w.bm.updateParticipantState(battle.id, "mob-X", "FLEEING");
      w.bridge.syncFleeingState(battle.id);

      const after = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(after.round).toBe(roundBefore); // no premature round++
      expect(after.turnOrder).not.toContain("mob-X");
      // Pending B not flushed prematurely
      expect(after.turnOrder).not.toContain("player-B");
    });

    it("MP-017: side elimination resolves the combat when all enemies die", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x); // X 30�?0, turn �?X
      driveRoundBoundary(w); // X hits A �?turn �?A
      let r = routeEncounterAction(w.deps, "player-A"); // X 20�?0, turn �?X
      expect(r.damage?.targetId).toBe("mob-X");
      driveRoundBoundary(w); // X hits A �?turn �?A
      r = routeEncounterAction(w.deps, "player-A"); // X 10�? killed
      expect(r.damage?.targetKilled).toBe(true);
      const session = w.cm.getCombatSessionByBattle(
        w.bm.getBattleByParticipant("player-A")!.battle.id,
      )!;
      expect(session.state).toBe("RESOLVED");
    });

    it("MP-018: exactly one reward per mob kill �?no double reward", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      addMob(w, "mob-Y", 30, 1, 1);
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle.id, { id: "mob-Y", position: point(1, 1), combatPower: 5, personality: "aggressive", state: "ACTIVE" }, "enemy");
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      driveRoundBoundary(w);

      // Kill both mobs through the turn cycle
      let guard = 0;
      while (w.kills.length < 2 && guard < 20) {
        const now = Date.now();
        driveRoundBoundary(w, now);
        routeEncounterAction(w.deps, "player-A");
        routeEncounterAction(w.deps, "player-B");
        guard++;
      }
      expect(w.kills.length).toBe(2); // exactly one per mob
      const xKills = w.kills.filter((k) => k.mobId === "mob-X").length;
      const yKills = w.kills.filter((k) => k.mobId === "mob-Y").length;
      expect(xKills).toBe(1);
      expect(yKills).toBe(1);
    });
  });

  describe("Flee / Rejoin (MP-019..020)", () => {
    it("MP-019: a fleeing participant leaves turnOrder and combat continues", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      routeRealtimeAttack(w.deps, "player-B", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;

      w.bm.updateParticipantState(battle.id, "player-B", "FLEEING");
      w.bridge.syncFleeingState(battle.id);

      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnOrder).not.toContain("player-B");
      expect(session.state).toBe("ACTIVE"); // combat continues with A
    });

    it("MP-020: a fleeing participant rejoins as pending and regains eligibility", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      routeRealtimeAttack(w.deps, "player-B", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;

      w.bm.updateParticipantState(battle.id, "player-B", "FLEEING");
      w.bridge.syncFleeingState(battle.id);
      w.bm.updateParticipantState(battle.id, "player-B", "ACTIVE");
      w.bridge.syncRejoinState(battle.id);

      let session = w.cm.getCombatSessionByBattle(battle.id)!;
      const b = session.participants.find((p) => p.participantId === "player-B")!;
      expect(b.fleeing).toBe(false);
      expect(session.pendingParticipants.some((p) => p.participantId === "player-B")).toBe(true);
      expect(session.turnOrder).not.toContain("player-B");

      // Next round boundary �?B re-enters turnOrder; HP preserved (mirrors world, not reset)
      driveRoundBoundary(w);
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnOrder).toContain("player-B");
      const rejoined = session.participants.find((p) => p.participantId === "player-B")!;
      expect(rejoined.currentHp).toBe(w.players.get("player-B")!.health); // preserved, never reset
    });
  });

  describe("Defend / Timeout (MP-021..024)", () => {
    it("MP-021: defend sets defending=true and advances the turn", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x); // A's hit, turn �?X
      // A's turn: X attacked �?turn back to A
      driveRoundBoundary(w);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      let session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.currentActorId).toBe("player-A");

      const r = routeEncounterDefend({ battleManager: w.bm, combatManager: w.cm }, "player-A");
      expect(r.kind).toBe("combat");
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.participants.find((p) => p.participantId === "player-A")!.defending).toBe(true);
      expect(session.currentActorId).toBe("mob-X"); // advanced

      // Defend when it is not your turn �?no-op
      const before = session.round;
      const r2 = routeEncounterDefend({ battleManager: w.bm, combatManager: w.cm }, "player-A");
      expect(r2.kind).toBe("combat");
      const after = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(after.currentActorId).toBe("mob-X");
      expect(after.round).toBe(before);
    });

    it("MP-022: production session carries BATTLE_TURN_TIMEOUT_MS and timeout auto-defends + advances", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnTimeoutMs).toBe(BATTLE_TURN_TIMEOUT_MS); // threaded through beginEncounter

      const currentActor = session.currentActorId;
      w.cm.evaluateTurnTimeout(session.id, Date.now() + BATTLE_TURN_TIMEOUT_MS + 1);
      const after = w.cm.getCombatSessionByBattle(battle.id)!;
      const actor = after.participants.find((p) => p.participantId === currentActor)!;
      expect(actor.defending).toBe(true); // auto-defend
      expect(after.currentActorId).not.toBe(currentActor); // advanced
    });

    it("MP-023: timeout does not fire before the deadline", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      const beforeActor = session.currentActorId;

      w.cm.evaluateTurnTimeout(session.id, Date.now());
      const after = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(after.currentActorId).toBe(beforeActor);
      expect(after.participants.find((p) => p.participantId === beforeActor)!.defending).toBe(false);
    });

    it("MP-024: a session created without timeoutMs has no timeout", () => {
      const w = makeWorld();
      const battle = w.bm.createBattle(
        "battle-plain",
        { id: "player-A", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob-X", position: point(1, 0), combatPower: 5, personality: "aggressive", state: "ACTIVE" },
      );
      if ("error" in battle) throw new Error("battle create failed");
      const begin = w.bridge.beginEncounter("battle-plain", {
        getHp: (id) => (id === "player-A" ? { currentHp: 100, maxHp: 100 } : { currentHp: 30, maxHp: 30 }),
      });
      if ("error" in begin) throw new Error("begin failed");
      expect(begin.session.turnTimeoutMs).toBeNull();

      const before = begin.session.currentActorId;
      w.cm.evaluateTurnTimeout(begin.session.id, Date.now() + BATTLE_TURN_TIMEOUT_MS + 1);
      const after = w.cm.getCombatSession(begin.session.id)!;
      expect(after.currentActorId).toBe(before); // no timeout �?no-op
    });
  });

  describe("2v2 + isolation + notification (MP-025..030)", () => {
    it("MP-025: 2v2 dynamic join �?both new participants flush into turnOrder", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      addMob(w, "mob-Y", 30, 1, 1);
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      autoJoin(w, battle.id, { id: "mob-Y", position: point(1, 1), combatPower: 5, personality: "aggressive", state: "ACTIVE" }, "enemy");

      let session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.participants.length).toBe(4);
      driveRoundBoundary(w);
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnOrder).toContain("player-B");
      expect(session.turnOrder).toContain("mob-Y");
      expect(session.turnOrder.length).toBe(4);
    });

    it("MP-026: two battles run in isolation", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      addPlayer(w, "player-C");
      const x = addMob(w, "mob-X");
      const y = addMob(w, "mob-Y", 30, 1, 1);

      routeRealtimeAttack(w.deps, "player-A", x); // battle 1: A vs X
      const battle1 = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle1.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      // Separate contact: C vs Y �?battle 2
      const r = routeRealtimeAttack(w.deps, "player-C", y);
      expect(r.kind).toBe("combat");
      const battle2 = w.bm.getBattleByParticipant("player-C")!.battle;
      expect(battle1.id).not.toBe(battle2.id);
      expect(w.cm.getAllCombatMappings().length).toBe(2);

      // Damage battle 1's mob �?battle 2 untouched
      driveRoundBoundary(w);
      const s1 = w.cm.getCombatSessionByBattle(battle1.id)!;
      const s2 = w.cm.getCombatSessionByBattle(battle2.id)!;
      const yHp = y.currentHp;
      routeEncounterAction(w.deps, "player-A");
      expect(y.currentHp).toBe(yHp); // battle 2's mob unaffected
      expect(s1.participants.map((p) => p.participantId).sort()).not.toEqual(
        s2.participants.map((p) => p.participantId).sort(),
      );
    });

    it("MP-027: joined players receive encounter_started exactly once (notify)", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      const session = w.cm.getCombatSessionByBattle(battle.id)!;

      // B auto-joins via battle sync (no realtime attack) �?not yet notified
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      const before = w.events.filter((e) => e.type === "encounter_started" && e.mobId === "mob-X").length;

      notifyCombatJoinedPlayers(w.deps, w.cm.getCombatSessionByBattle(battle.id)!);
      const after = w.events.filter((e) => e.type === "encounter_started" && e.mobId === "mob-X").length;
      expect(after).toBe(before + 1); // exactly one new notification (for B)
      expect(w.deps.combatNotifiedPlayers!.get(session.id)!.has("player-B")).toBe(true);
    });

    it("MP-028: repeated notification is idempotent (dedup)", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      routeRealtimeAttack(w.deps, "player-A", x);
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");

      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      notifyCombatJoinedPlayers(w.deps, session);
      const afterFirst = w.events.filter((e) => e.type === "encounter_started").length;
      notifyCombatJoinedPlayers(w.deps, w.cm.getCombatSessionByBattle(battle.id)!);
      const afterSecond = w.events.filter((e) => e.type === "encounter_started").length;
      expect(afterSecond).toBe(afterFirst); // no duplicate
    });

    it("MP-029: no double damage across a 2v2 cycle", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X", 60); // high HP so the cycle doesn't kill it
      addMob(w, "mob-Y", 30, 1, 1);
      routeRealtimeAttack(w.deps, "player-A", x); // X 60�?0
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      autoJoin(w, battle.id, { id: "mob-Y", position: point(1, 1), combatPower: 5, personality: "aggressive", state: "ACTIVE" }, "enemy");
      driveRoundBoundary(w); // X attacks A (aggro), flush pending, turn �?A
      expect(x.currentHp).toBe(50);

      const aHpBefore = w.players.get("player-A")!.health; // 99
      const bHpBefore = w.players.get("player-B")!.health; // 100
      const r = routeEncounterAction(w.deps, "player-A");
      expect(r.damage?.targetId).toBe("mob-X");
      expect(x.currentHp).toBe(40); // exactly one application of 10
      const r2 = routeEncounterAction(w.deps, "player-B");
      expect(r2.damage?.targetId).toBe("mob-X");
      expect(x.currentHp).toBe(30); // exactly one application of 10

      // X's turn (aggro follows last attacker B) �?exactly one player hit by 1
      driveRoundBoundary(w);
      const damageA = aHpBefore - w.players.get("player-A")!.health;
      const damageB = bHpBefore - w.players.get("player-B")!.health;
      expect(damageA + damageB).toBe(1);
      expect(w.players.get("player-B")!.health).toBe(99); // aggro B
    });

    it("MP-030: 2v2 E2E �?full production flow (Scenario A)", () => {
      const w = makeWorld();
      addPlayer(w, "player-A");
      addPlayer(w, "player-B");
      const x = addMob(w, "mob-X");
      const y = addMob(w, "mob-Y", 30, 1, 1);

      // 1. A attacks X �?battle + combat created, X damaged once, aggro A
      const r1 = routeRealtimeAttack(w.deps, "player-A", x);
      expect(r1.kind).toBe("combat");
      expect(x.currentHp).toBe(20);
      expect(x.aggroTarget).toBe("player-A");
      const battle = w.bm.getBattleByParticipant("player-A")!.battle;
      let session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.state).toBe("ACTIVE");

      // 2. Y and B auto-join (battle + pending) �?the GameLoop production path
      autoJoin(w, battle.id, { id: "mob-Y", position: point(1, 1), combatPower: 5, personality: "aggressive", state: "ACTIVE" }, "enemy");
      autoJoin(w, battle.id, { id: "player-B", position: point(0, 1), combatPower: 10, personality: "aggressive", state: "ACTIVE" }, "player");
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.participants.length).toBe(4);
      expect(session.pendingParticipants.length).toBe(2);

      // 3. Round boundary �?pending flush (B, Y in turnOrder)
      driveRoundBoundary(w);
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.turnOrder.length).toBe(4);
      expect(session.turnOrder).toContain("player-B");
      expect(session.turnOrder).toContain("mob-Y");

      // 4. currentActor=A (wrap after X's counter) �?A targets enemy leader X
      const rA = routeEncounterAction(w.deps, "player-A");
      expect(rA.damage?.targetId).toBe("mob-X");
      expect(x.currentHp).toBe(10);

      // 5. B's turn �?X dies (single reward)
      const rB = routeEncounterAction(w.deps, "player-B");
      expect(rB.damage?.targetId).toBe("mob-X");
      expect(rB.damage?.targetKilled).toBe(true);
      expect(w.kills.filter((k) => k.mobId === "mob-X").length).toBe(1);

      // 6. Y's counter-turn �?exactly one player damaged by 1 more
      // (total player HP drops to 198 �?single enemy turn, single application)
      driveRoundBoundary(w, Date.now());
      const totalPlayerHp = (w.players.get("player-A")?.health ?? 0) + (w.players.get("player-B")?.health ?? 0);
      expect(totalPlayerHp).toBe(198);

      // 7. Kill both mobs through the turn cycle �?combat RESOLVED, reward once each
      let guard = 0;
      while (w.kills.length < 2 && guard < 24) {
        driveRoundBoundary(w, Date.now());
        routeEncounterAction(w.deps, "player-A");
        routeEncounterAction(w.deps, "player-B");
        guard++;
      }
      expect(w.kills.length).toBe(2); // single reward per mob (MP-018/027)
      expect(w.kills.filter((k) => k.mobId === "mob-X").length).toBe(1);
      expect(w.kills.filter((k) => k.mobId === "mob-Y").length).toBe(1);
      session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.state).toBe("RESOLVED"); // side elimination

      // 8. Cleanup (GameLoop.evaluateBattleDisengagement equivalent)
      releaseMobCombatState(w.deps, battle);
      w.deps.combatNotifiedPlayers!.delete(session.id); // GameLoop does this
      w.cm.removeCombatSession(session.id);
      w.bm.removeBattle(battle.id);
      expect(w.bm.getBattles().size).toBe(0);
      expect(isMobOwnedByCombat(w.deps, "mob-X")).toBe(false);
      expect(isMobOwnedByCombat(w.deps, "mob-Y")).toBe(false);
      expect(w.deps.combatNotifiedPlayers!.has(session.id)).toBe(false);
    });
  });
});
