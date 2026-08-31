import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  BattleGroup,
  CombatPoint,
  WorldHealthWriter,
} from "@mmo/shared";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import { CombatSystem, type MobInstance, type MobTypeConfig } from "./CombatSystem.js";
import { BATTLE_MOB_TURN_DELAY_MS } from "@mmo/shared";
import {
  isBattleCombatEnabled,
  isMobOwnedByCombat,
  getCombatSessionForMob,
  getBattleForMob,
  ensurePlayerCombat,
  routeRealtimeAttack,
  routeEncounterAction,
  tickCombatEnemyTurns,
  releaseMobCombatState,
  type ProductionCombatDeps,
  type CombatPlayerView,
} from "./ProductionCombatRouter.js";

/* ═══════════════════════════════════════════════════════
 * Phase 3G-2 — Production 1v1 Battle Activation (PBA-001..024)
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
  /** EntityState mirror for mobs (PBA-014). */
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
  };

  return { deps, bm, cm, bridge, combatSystem, mobs, players, entities, events, respawns, kills };
}

function addPlayer(w: World, id: string, health = 100, attack = 10): void {
  w.players.set(id, { x: 0, y: 0, health, maxHealth: 100, level: 1 });
  const ps = w.combatSystem.getPlayerStats(id);
  ps.attack = attack;
  ps.defense = 5;
}

describe("Phase 3G-2 — Production 1v1 Battle Activation", () => {
  afterEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  describe("Feature flag", () => {
    it("PBA-001: flag unset → New (default ON)", () => {
      delete process.env.ENABLE_BATTLE_COMBAT;
      expect(isBattleCombatEnabled()).toBe(true);
    });

    it("PBA-001: flag \"false\" → Legacy emergency rollback", () => {
      process.env.ENABLE_BATTLE_COMBAT = "false";
      expect(isBattleCombatEnabled()).toBe(false);
    });

    it("PBA-001: flag \"true\" → New (explicit ON)", () => {
      process.env.ENABLE_BATTLE_COMBAT = "true";
      expect(isBattleCombatEnabled()).toBe(true);
    });
  });

  describe("PBA-002: flag ON → New path creates battle + combat", () => {
    it("realtime attack routes through the New Combat stack", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 100); // high attack → kills in one hit
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const r = routeRealtimeAttack(w.deps, "player-1", mob);
      expect(r.kind).toBe("combat");
      expect(r.damage?.targetKilled).toBe(true);
      // PBA-003: battle created (kill removes the mob from the battle — the
      // player side still owns the battle, session lookup goes via the player)
      expect(w.bm.getBattles().size).toBe(1);
      const playerBattle = w.bm.getBattleByParticipant("player-1")!.battle;
      expect(playerBattle).toBeDefined();
      // PBA-004: combat created
      const session = w.cm.getCombatSessionByBattle(playerBattle.id)!;
      expect(session).toBeDefined();
      // PBA-016: compat encounter_started sent with legacy fields
      const started = w.events.find((e) => e.type === "encounter_started");
      expect(started).toBeDefined();
      expect(started!.mobId).toBe("mob-1");
      expect(started!.mobHp).toBe(30);
      expect(started!.playerHp).toBe(100);
      expect(started!.currentActorId).toBeDefined();
    });
  });

  describe("Battle/Combat single instance", () => {
    it("PBA-005: same mob cannot create a second Battle", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob);
      // second ensurePlayerCombat reuses the existing battle
      const again = ensurePlayerCombat(w.deps, "player-1", mob);
      expect(again).not.toBeNull();
      expect(w.bm.getBattles().size).toBe(1);
      expect(w.bm.getBattleByParticipant(mob.id)!.battle.id).toBe(
        w.bm.getBattleByParticipant("player-1")!.battle.id,
      );
    });

    it("PBA-006: same Battle cannot create a second Combat", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob);
      const mappings = w.cm.getAllCombatMappings();
      expect(mappings.length).toBe(1);
      // ensurePlayerCombat again reuses the same session
      const again = ensurePlayerCombat(w.deps, "player-1", mob);
      expect(again!.id).toBe(mappings[0].combatId);
    });
  });

  describe("Ownership guard", () => {
    it("PBA-007: active Combat blocks legacy realtime attack", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob);
      expect(isMobOwnedByCombat(w.deps, mob.id)).toBe(true);

      // Second realtime attack on the combat-owned mob → blocked (no damage)
      const before = mob.currentHp;
      const r2 = routeRealtimeAttack(w.deps, "player-1", mob);
      expect(r2.kind).toBe("blocked");
      expect(mob.currentHp).toBe(before);
    });

    it("PBA-024: resolved combat still blocks until battle cleanup", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10); // low attack — mob survives
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob);
      const battle = getBattleForMob(w.deps, mob.id)!;
      const session = getCombatSessionForMob(w.deps, mob.id)!;
      expect(session.state).toBe("ACTIVE");

      // Simulate combat resolution while the mob is still alive and mapped
      w.cm.setCombatState(session.id, "RESOLVED");

      // Still mapped → still owned (blocks legacy re-attack until cleanup)
      expect(isMobOwnedByCombat(w.deps, mob.id)).toBe(true);
      expect(routeRealtimeAttack(w.deps, "player-1", mob).kind).toBe("blocked");

      // Cleanup (production does this in GameLoop.evaluateBattleDisengagement)
      releaseMobCombatState(w.deps, battle);
      w.bm.removeBattle(battle.id);
      w.cm.removeCombatMapping(battle.id);
      expect(isMobOwnedByCombat(w.deps, mob.id)).toBe(false);
    });
  });

  describe("Damage/death/reward single-processing", () => {
    it("PBA-008/010/013: new attack applies damage exactly once to MobInstance", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const r = routeRealtimeAttack(w.deps, "player-1", mob);
      // calculateDamage(10, 1, 1) = 10*1.1 - 1 = 10 → 30 - 10 = 20 (exactly once, not twice)
      expect(r.kind).toBe("combat");
      expect(r.damage?.damage).toBe(10);
      expect(mob.currentHp).toBe(20); // PBA-013: MobInstance.currentHp is the authority
    });

    it("PBA-009: legacy attack applies damage exactly once", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      // Legacy realtime path (flag OFF) — single processPlayerAttack call
      const events = w.combatSystem.processPlayerAttack("player-1", mob, Date.now(), 1);
      expect(events).not.toBeNull();
      expect(mob.currentHp).toBe(20); // exactly one damage application
    });

    it("PBA-011/012: no double death, no double reward", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 100);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const r = routeRealtimeAttack(w.deps, "player-1", mob);
      expect(r.damage?.targetKilled).toBe(true);
      expect(w.kills.length).toBe(1); // resolveKill (reward authority) called once
      expect(mob.aiState).toBe("dead");
      // No second kill from any continuation
      routeEncounterAction(w.deps, "player-1");
      expect(w.kills.length).toBe(1);
    });

    it("PBA-015: player HP remains correct after mob counterattack", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob); // player hits first, turn → mob
      tickCombatEnemyTurns(w.deps, Date.now() + BATTLE_MOB_TURN_DELAY_MS);
      // mob attack 5, player defense 5, level 1 → calculateDamage(5,1,5)=0.5→1
      expect(w.players.get("player-1")!.health).toBe(99);
      expect(w.events.some((e) => e.type === "player_damaged")).toBe(true);
    });
  });

  describe("Fallback safety", () => {
    it("PBA-020/021: new-path failure falls back without side effects", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      // Player not found → ensurePlayerCombat must return null with ZERO side effects
      const r = routeRealtimeAttack(w.deps, "ghost-player", mob);
      expect(r.kind).toBe("fallback");
      expect(w.bm.getBattles().size).toBe(0);
      expect(w.cm.getAllCombatMappings().length).toBe(0);
      expect(w.events.length).toBe(0);
      expect(mob.currentHp).toBe(30);
      expect(mob.aiState).toBe("idle");
    });

    it("ensurePlayerCombat null → caller may safely run Legacy", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const session = ensurePlayerCombat(w.deps, "ghost-player", mob);
      expect(session).toBeNull();
      expect(w.bm.getBattles().size).toBe(0);
    });
  });

  describe("Cross chunk / negative coordinates", () => {
    it("PBA-022: cross chunk attack works", () => {
      const w = makeWorld();
      w.players.set("player-1", { x: 100, y: 100, health: 100, maxHealth: 100, level: 1 });
      const ps = w.combatSystem.getPlayerStats("player-1");
      ps.attack = 100;
      const mob = makeMob("mob-1", 30);
      mob.x = 132; // across chunk boundary (CHUNK_SIZE 32)
      mob.y = 132;
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const r = routeRealtimeAttack(w.deps, "player-1", mob);
      expect(r.kind).toBe("combat");
      const playerBattle = w.bm.getBattleByParticipant("player-1")!.battle;
      expect(playerBattle).toBeDefined();
      expect(w.cm.getCombatSessionByBattle(playerBattle.id)).toBeDefined();
    });

    it("PBA-023: negative coordinates work", () => {
      const w = makeWorld();
      w.players.set("player-1", { x: -100, y: -200, health: 100, maxHealth: 100, level: 1 });
      const ps = w.combatSystem.getPlayerStats("player-1");
      ps.attack = 100;
      const mob = makeMob("mob-1", 30);
      mob.x = -150;
      mob.y = -250;
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      const r = routeRealtimeAttack(w.deps, "player-1", mob);
      expect(r.kind).toBe("combat");
      const battle = w.bm.getBattleByParticipant("player-1")!.battle;
      expect(battle.playerSide.area.center.x).toBe(-100);
    });
  });

  describe("Enemy turn engine (PBA-017)", () => {
    it("mob counterattacks only when the turn is due", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 10);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob);
      const before = w.players.get("player-1")!.health;

      // Not yet due → no-op
      tickCombatEnemyTurns(w.deps, Date.now());
      expect(w.players.get("player-1")!.health).toBe(before);

      // Due → mob attacks once, turn hands back to the player
      tickCombatEnemyTurns(w.deps, Date.now() + BATTLE_MOB_TURN_DELAY_MS);
      expect(w.players.get("player-1")!.health).toBeLessThan(before);
      const session = getCombatSessionForMob(w.deps, mob.id)!;
      expect(session.currentActorId).toBe("player-1");

      // Subsequent ticks while it is the player's turn → no mob action
      tickCombatEnemyTurns(w.deps, Date.now() + BATTLE_MOB_TURN_DELAY_MS * 2);
      expect(w.players.get("player-1")!.health).toBeLessThan(before);
    });
  });

  describe("Cleanup (PBA-018/019)", () => {
    it("battle removal frees the participant reverse index", () => {
      const w = makeWorld();
      addPlayer(w, "player-1", 100, 100);
      const mob = makeMob("mob-1", 30);
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });

      routeRealtimeAttack(w.deps, "player-1", mob);
      const playerBattle = w.bm.getBattleByParticipant("player-1")!.battle;
      const battle = playerBattle;
      expect(w.bm.getBattleByParticipant("player-1")).toBeDefined();
      // The killed mob is removed from the battle by the kill path — verify its
      // reverse index is already cleared, then clean up the battle itself.
      expect(w.bm.getBattleByParticipant(mob.id)).toBeUndefined();

      releaseMobCombatState(w.deps, battle);
      w.bm.removeBattle(battle.id);
      w.cm.removeCombatMapping(battle.id);

      expect(w.bm.getBattles().size).toBe(0); // PBA-018
      expect(w.bm.getBattleByParticipant("player-1")).toBeUndefined(); // PBA-019
      expect(w.bm.getBattleByParticipant(mob.id)).toBeUndefined();
    });
  });

  /* ── Full 1v1 end-to-end flow (PBA §20) ── */
  it("E2E: full 1v1 flow — battle→combat→turn→attack→HP→death→reward→cleanup", () => {
    const w = makeWorld();
    addPlayer(w, "player-1", 100, 10);
    const mob = makeMob("mob-1", 30);
    w.mobs.set(mob.id, mob);
    w.entities.set(mob.id, { health: 30, maxHealth: 30 });

    // 1. Player attack → battle + combat + encounter_started
    const r1 = routeRealtimeAttack(w.deps, "player-1", mob);
    expect(r1.kind).toBe("combat");
    expect(w.bm.getBattles().size).toBe(1); // PBA-003
    const battleId = w.bm.getBattleByParticipant("player-1")!.battle.id;
    let session = w.cm.getCombatSessionByBattle(battleId)!;
    expect(session.state).toBe("ACTIVE"); // PBA-004
    expect(w.events.some((e) => e.type === "encounter_started")).toBe(true); // PBA-016
    expect(mob.currentHp).toBe(20); // damage applied once

    // 2. Mob turn → player damaged
    tickCombatEnemyTurns(w.deps, Date.now() + BATTLE_MOB_TURN_DELAY_MS);
    expect(w.players.get("player-1")!.health).toBe(99);
    expect(w.events.some((e) => e.type === "player_damaged")).toBe(true);

    // 3. Player action (turn-based) → mob damaged
    const r2 = routeEncounterAction(w.deps, "player-1");
    expect(r2.kind).toBe("combat");
    expect(mob.currentHp).toBe(10);

    // 4. Mob turn again → player damaged
    tickCombatEnemyTurns(w.deps, Date.now() + BATTLE_MOB_TURN_DELAY_MS * 2);
    expect(w.players.get("player-1")!.health).toBe(98);

    // 5. Player killing blow → reward + combat resolved
    const r3 = routeEncounterAction(w.deps, "player-1");
    expect(r3.damage?.targetKilled).toBe(true);
    expect(w.kills.length).toBe(1); // PBA-012 single reward
    expect(mob.aiState).toBe("dead"); // PBA-011 single death
    session = w.cm.getCombatSessionByBattle(battleId)!;
    expect(session.state).toBe("RESOLVED");

    // 6. Cleanup (GameLoop.evaluateBattleDisengagement equivalent)
    const battle = w.bm.getBattleByParticipant("player-1")!.battle;
    releaseMobCombatState(w.deps, battle);
    w.bm.removeBattle(battle.id);
    w.cm.removeCombatMapping(battle.id);
    expect(w.bm.getBattles().size).toBe(0); // PBA-018
    expect(isMobOwnedByCombat(w.deps, mob.id)).toBe(false); // ownership released
  });
});
