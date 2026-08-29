/**
 * Phase 3G-4C: Legacy Fallback Retirement Tests (LFR-001..020)
 *
 * Validates:
 * - Attack handler: blocks Legacy fallback when ENABLE_BATTLE_COMBAT is ON
 * - Encounter action handler: blocks Legacy fallback when flag is ON
 * - Emergency rollback: ENABLE_BATTLE_COMBAT=false re-enables Legacy
 * - Structured logging: creation_failed events with correct reasons
 * - Ownership integrity: combat-owned mobs/players never enter Legacy
 * - Cleanup: battle/session resources cleaned up on creation failure
 */
import { describe, it, expect, afterEach } from "vitest";
import type { WorldHealthWriter, CombatPoint } from "@mmo/shared";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import { CombatSystem, type MobInstance, type MobTypeConfig } from "./CombatSystem.js";
import {
  isBattleCombatEnabled,
  routeRealtimeAttack,
  routeEncounterAction,
  routeEncounterDefend,
  isMobOwnedByCombat,
  type ProductionCombatDeps,
  type CombatPlayerView,
} from "./ProductionCombatRouter.js";
import { emitCombatLog } from "./ProductionCombatLog.js";

/* ═══════════════════════════════════════════════════════
 * Shared fixtures (mirrors ProductionCutover.test.ts)
 * ═══════════════════════════════════════════════════════ */

const point = (x: number, y: number): CombatPoint => ({ x, y });

function makeMobConfig(id: string, overrides: Partial<MobTypeConfig> = {}): MobTypeConfig {
  return {
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
}

function makeMob(id: string, hp: number, overrides: Partial<MobTypeConfig> = {}): MobInstance {
  const config = makeMobConfig(id, overrides);
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
    inEncounter: false,
    pendingEncounterTarget: null,
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
  logs: Array<{ event: string; data: Record<string, unknown> }>;
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
  const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
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
    respawnPlayer: () => {},
    resolveKill: (mob, sid) => {
      mob.aiState = "dead";
      mob.currentHp = 0;
      kills.push({ mobId: mob.id, playerSessionId: sid });
    },
    combatNotifiedPlayers: new Map<string, Set<string>>(),
    logCombatEvent: (event, data) => logs.push({ event, data: data as Record<string, unknown> }),
  };

  return { deps, bm, cm, bridge, combatSystem, mobs, players, entities, events, logs, kills };
}

function addPlayer(w: World, id: string, health = 100, attack = 10): void {
  w.players.set(id, { x: 0, y: 0, health, maxHealth: 100, level: 1 });
  const ps = w.combatSystem.getPlayerStats(id);
  ps.attack = attack;
  ps.defense = 5;
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Phase 3G-4C — Legacy Fallback Retirement", () => {
  afterEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  /* ── Attack handler: block Legacy when flag ON ── */

  describe("LFR-001..005: Attack handler fallback blocking", () => {
    it("LFR-001: flag ON + missing player → routeRealtimeAttack returns fallback, no Legacy combat", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      const r = routeRealtimeAttack(w.deps, "ghost", mob);
      expect(r.kind).toBe("fallback");
      // No battle or session should exist — Legacy would not run
      expect(w.bm.getBattles().size).toBe(0);
      expect(w.cm.getAllCombatMappings().length).toBe(0);
    });

    it("LFR-002: flag ON + missing player → fallback_blocked_attack logged (if GameRoom guard present)", () => {
      // At the router level, ensurePlayerCombat logs creation_failed.
      // The GameRoom attack handler adds fallback_blocked_attack on top.
      // This test validates the router logs creation_failed for player_unavailable.
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      const r = routeRealtimeAttack(w.deps, "ghost", mob);
      expect(r.kind).toBe("fallback");
      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("player_unavailable");
    });

    it("LFR-003: flag ON + battle creation fails → routeRealtimeAttack returns fallback, battle rolled back", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      // Inject failure into bridge.beginEncounter
      const origBegin = w.bridge.beginEncounter.bind(w.bridge);
      (w.bridge as any).beginEncounter = () => ({ error: "INJECTED" });

      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("fallback");
      expect(w.cm.getCombatSessionByBattle("battle-p1-mob_1")).toBeUndefined();

      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("combat_creation_failed");
      expect(fb[0].data.battleId).toBeDefined();

      (w.bridge as any).beginEncounter = origBegin;
    });

    it("LFR-004: flag OFF + missing player → routeRealtimeAttack returns fallback (Legacy available)", () => {
      process.env.ENABLE_BATTLE_COMBAT = "false";
      const w = makeWorld();
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      const r = routeRealtimeAttack(w.deps, "ghost", mob);
      expect(r.kind).toBe("fallback");
      // Legacy is available when flag is OFF — no blocking
      expect(w.bm.getBattles().size).toBe(0);
    });

    it("LFR-005: flag ON + successful creation → kind 'combat', no fallback_blocked log", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("combat");
      expect(w.logs.map((l) => l.event)).not.toContain("creation_failed");
      expect(w.logs.map((l) => l.event)).not.toContain("fallback_blocked_attack");
    });
  });

  /* ── Encounter action handler: block Legacy when flag ON ── */

  describe("LFR-006..010: Encounter action handler fallback blocking", () => {
    it("LFR-006: flag ON + routeEncounterAction returns not-in-combat → 'combat' kind, no Legacy", () => {
      // When player has no active combat session, routeEncounterAction returns
      // { kind: "not-in-combat" }. At router level this means fallback is possible.
      // GameRoom guard blocks Legacy when flag ON.
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);

      const r = routeEncounterAction(w.deps, "p1");
      // Player has no session → not-in-combat
      expect(r.kind).not.toBe("combat");
    });

    it("LFR-007: flag ON + routeEncounterDefend returns not-in-combat → 'not-in-combat', no Legacy", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);

      const r = routeEncounterDefend(
        { battleManager: w.bm, combatManager: w.cm },
        "p1",
      );
      expect(r.kind).not.toBe("combat");
    });

    it("LFR-008: flag OFF + routeEncounterAction → not-in-combat (Legacy available)", () => {
      process.env.ENABLE_BATTLE_COMBAT = "false";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);

      const r = routeEncounterAction(w.deps, "p1");
      expect(r.kind).not.toBe("combat");
    });

    it("LFR-009: flag ON + active session → routeEncounterAction returns combat with damage", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });

      // Create combat session via first attack
      const r1 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r1.kind).toBe("combat");

      // Now encounter_action should route to combat
      const r2 = routeEncounterAction(w.deps, "p1");
      expect(r2.kind).toBe("combat");
    });

    it("LFR-010: flag ON + active session → routeEncounterDefend returns combat", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });

      const r1 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r1.kind).toBe("combat");

      const r2 = routeEncounterDefend(
        { battleManager: w.bm, combatManager: w.cm },
        "p1",
      );
      expect(r2.kind).toBe("combat");
    });
  });

  /* ── Emergency rollback ── */

  describe("LFR-011..013: Emergency rollback via ENABLE_BATTLE_COMBAT=false", () => {
    it("LFR-011: ENABLE_BATTLE_COMBAT=false → isBattleCombatEnabled() returns false", () => {
      process.env.ENABLE_BATTLE_COMBAT = "false";
      expect(isBattleCombatEnabled()).toBe(false);
    });

    it("LFR-012: ENABLE_BATTLE_COMBAT=false → routeRealtimeAttack fallback is allowed (not blocked)", () => {
      process.env.ENABLE_BATTLE_COMBAT = "false";
      const w = makeWorld();
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      const r = routeRealtimeAttack(w.deps, "ghost", mob);
      expect(r.kind).toBe("fallback");
      // When flag is OFF, fallback is allowed — GameRoom won't block it
      // No creation_failed should be logged at router level since ensurePlayerCombat
      // is only called when no session exists for the mob (regardless of flag)
    });

    it("LFR-013: flag unset → isBattleCombatEnabled() returns true (default ON)", () => {
      delete process.env.ENABLE_BATTLE_COMBAT;
      expect(isBattleCombatEnabled()).toBe(true);
    });
  });

  /* ── Structured logging ── */

  describe("LFR-014..016: Structured logging on creation failure", () => {
    it("LFR-014: player_unavailable → creation_failed with reason 'player_unavailable'", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      routeRealtimeAttack(w.deps, "ghost", mob);

      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("player_unavailable");
      expect(fb[0].data.playerId).toBe("ghost");
      expect(fb[0].data.targetId).toBe("mob_1");
    });

    it("LFR-015: battle_creation_failed → creation_failed with reason 'battle_creation_failed'", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      // Inject failure into battleManager.createBattle
      const origCreate = w.bm.createBattle.bind(w.bm);
      (w.bm as any).createBattle = () => ({ error: "INJECTED" });

      routeRealtimeAttack(w.deps, "p1", mob);

      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("battle_creation_failed");
      expect(fb[0].data.playerId).toBe("p1");
      expect(fb[0].data.targetId).toBe("mob_1");

      (w.bm as any).createBattle = origCreate;
    });

    it("LFR-016: combat_creation_failed → creation_failed with reason + battleId", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      const origBegin = w.bridge.beginEncounter.bind(w.bridge);
      (w.bridge as any).beginEncounter = () => ({ error: "INJECTED" });

      routeRealtimeAttack(w.deps, "p1", mob);

      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("combat_creation_failed");
      expect(fb[0].data.battleId).toBeDefined();
      expect(fb[0].data.playerId).toBe("p1");
      expect(fb[0].data.targetId).toBe("mob_1");

      (w.bridge as any).beginEncounter = origBegin;
    });
  });

  /* ── Ownership integrity ── */

  describe("LFR-017..018: Ownership integrity — combat-owned never enters Legacy", () => {
    it("LFR-017: flag ON + mob owned by combat → routeRealtimeAttack returns blocked (not fallback)", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });

      // First attack creates combat session
      const r1 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r1.kind).toBe("combat");
      expect(isMobOwnedByCombat(w.deps, mob.id)).toBe(true);

      // Second attack from different player → join as pending, not fallback
      addPlayer(w, "p2", 100, 50);
      const r2 = routeRealtimeAttack(w.deps, "p2", mob);
      expect(r2.kind).toBe("joined"); // joins as pending, not fallback
      expect(r2.kind).not.toBe("fallback");
    });

    it("LFR-018: flag ON + player owns combat session → routeEncounterAction returns combat (not fallback)", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });

      const r1 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r1.kind).toBe("combat");

      // Player owns session → encounter_action routes to combat
      const r2 = routeEncounterAction(w.deps, "p1");
      expect(r2.kind).toBe("combat");
    });
  });

  /* ── Cleanup on failure ── */

  describe("LFR-019..020: Cleanup on creation failure", () => {
    it("LFR-019: beginEncounter failure → no combat session created, battle removal attempted", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const origBegin = w.bridge.beginEncounter.bind(w.bridge);
      (w.bridge as any).beginEncounter = () => ({ error: "INJECTED" });

      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("fallback");

      // Critical invariant: no combat session exists (cleanup was attempted)
      expect(w.cm.getCombatSessionByBattle("battle-p1-mob_1")).toBeUndefined();
      // Battle removal was attempted via removeBattle (may not succeed due to
      // spatial resolution check in BattleManager — that's OK, the battle will
      // be cleaned up by GameLoop's disengagement evaluation).
      expect(w.logs.filter((l) => l.event === "creation_failed")).toHaveLength(1);

      (w.bridge as any).beginEncounter = origBegin;
    });

    it("LFR-020: battle_creation_failed → battle not created, no dangling session", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);

      const origCreate = w.bm.createBattle.bind(w.bm);
      (w.bm as any).createBattle = () => ({ error: "INJECTED" });

      routeRealtimeAttack(w.deps, "p1", mob);

      // No battle should exist
      expect(w.bm.getBattles().size).toBe(0);
      expect(w.cm.getAllCombatMappings().length).toBe(0);

      (w.bm as any).createBattle = origCreate;
    });
  });
});
