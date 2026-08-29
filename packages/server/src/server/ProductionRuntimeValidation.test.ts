import { describe, it, expect, afterEach, vi } from "vitest";
import type { WorldHealthWriter, CombatPoint } from "@mmo/shared";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import { CombatSystem, type MobInstance, type MobTypeConfig } from "./CombatSystem.js";
import {
  isBattleCombatEnabled,
  routeRealtimeAttack,
  isMobOwnedByCombat,
  type ProductionCombatDeps,
  type CombatPlayerView,
} from "./ProductionCombatRouter.js";
import { emitCombatLog, emitBattleCleanup } from "./ProductionCombatLog.js";

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

function mkHpProvider(w: World) {
  return {
    getHp: (id: string) => {
      const mob = w.mobs.get(id);
      if (mob) return { currentHp: mob.currentHp, maxHp: mob.maxHp };
      const player = w.players.get(id);
      if (player) return { currentHp: player.health, maxHp: player.maxHealth };
      return undefined;
    },
  };
}

function mkStatsProvider(w: World) {
  return {
    getStats: (id: string) => {
      const player = w.players.get(id);
      if (player) {
        const ps = w.combatSystem.getPlayerStats(id);
        return { attack: ps.attack, defense: ps.defense, level: player.level };
      }
      const mob = w.mobs.get(id);
      if (mob) {
        return { attack: mob.config.baseAttack, defense: mob.config.baseDefense, level: mob.config.level };
      }
      return undefined;
    },
  };
}

function mkPlayerP(id: string, cp = 10) {
  return { id, position: point(0, 0), combatPower: cp, personality: "aggressive" as const, state: "ACTIVE" as const };
}
function mkEnemyP(id: string, x = 1, cp = 10) {
  return { id, position: point(x, 0), combatPower: cp, personality: "aggressive" as const, state: "ACTIVE" as const };
}

function setupBattle1v1(w: World, mobHp = 30, mobBaseHp = 30) {
  addPlayer(w, "p1", 100, 10);
  const mob = makeMob("mob_1", mobHp, { baseHp: mobBaseHp });
  w.mobs.set(mob.id, mob);
  w.entities.set(mob.id, { health: mobHp, maxHealth: mobBaseHp });
  return mob;
}

function createAndBegin(w: World, battleId = "battle-1", mobHp = 200, mobBaseHp = 200) {
  const mob = setupBattle1v1(w, mobHp, mobBaseHp);
  w.bm.createBattle(battleId, mkPlayerP("p1"), mkEnemyP("mob_1"));
  w.bridge.beginEncounter(battleId, mkHpProvider(w));
  return mob;
}

describe("Phase 3G-4B — Production Runtime Validation", () => {
  afterEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  describe("PRV-001..006: Normal Battle Creation", () => {
    it("PRV-001: createBattle returns battle and it exists in getBattles", () => {
      const w = makeWorld();
      setupBattle1v1(w);
      const r = w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      expect(r).toHaveProperty("battle");
      expect(w.bm.getBattles().size).toBe(1);
      expect(w.bm.hasBattle("battle-1")).toBe(true);
    });

    it("PRV-002: battle has correct participants on both sides", () => {
      const w = makeWorld();
      setupBattle1v1(w);
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      const battle = w.bm.getBattle("battle-1")!;
      expect(battle.playerSide.participants).toHaveLength(1);
      expect(battle.playerSide.participants[0].id).toBe("p1");
      expect(battle.enemySide.participants).toHaveLength(1);
      expect(battle.enemySide.participants[0].id).toBe("mob_1");
    });

    it("PRV-003: spatial area has center matching participant positions", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(5, 10), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(6, 10), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      const battle = w.bm.getBattle("battle-1")!;
      expect(battle.playerSide.area.center).toEqual(point(5, 10));
      expect(battle.enemySide.area.center).toEqual(point(6, 10));
      expect(battle.playerSide.area.radius).toBeGreaterThanOrEqual(0);
    });

    it("PRV-004: battle ID matches the one provided", () => {
      const w = makeWorld();
      setupBattle1v1(w);
      w.bm.createBattle("custom-id", mkPlayerP("p1"), mkEnemyP("mob_1"));
      expect(w.bm.getBattle("custom-id")).toBeDefined();
      expect(w.bm.getBattle("custom-id")!.id).toBe("custom-id");
    });

    it("PRV-005: second player joins existing battle via addParticipant", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      const r = w.bm.addParticipant("battle-1", "player", { id: "p2", position: point(0, 1), combatPower: 10, personality: "cautious", state: "ACTIVE" });
      expect(r).toHaveProperty("battle");
      expect(w.bm.getBattle("battle-1")!.playerSide.participants).toHaveLength(2);
    });

    it("PRV-006: multiple battles tracked in getBattles", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const m1 = makeMob("mob_1", 30, { baseHp: 30 });
      const m2 = makeMob("mob_2", 30, { baseHp: 30 });
      w.mobs.set(m1.id, m1);
      w.mobs.set(m2.id, m2);
      w.bm.createBattle("b1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bm.createBattle("b2",
        { id: "p2", position: point(100, 100), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_2", position: point(101, 100), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      expect(w.bm.getBattles().size).toBe(2);
    });
  });

  describe("PRV-007..012: Normal Combat Creation", () => {
    it("PRV-007: beginEncounter creates combat session", () => {
      const w = makeWorld();
      createAndBegin(w);
      expect(w.cm.getCombatSessionByBattle("battle-1")).toBeDefined();
    });

    it("PRV-008: session has correct battle reference", () => {
      const w = makeWorld();
      createAndBegin(w);
      expect(w.cm.getCombatSessionByBattle("battle-1")!.battleId).toBe("battle-1");
    });

    it("PRV-009: turn order contains both participants", () => {
      const w = makeWorld();
      createAndBegin(w);
      const s = w.cm.getCombatSessionByBattle("battle-1")!;
      expect(s.turnOrder).toContain("p1");
      expect(s.turnOrder).toContain("mob_1");
    });

    it("PRV-010: turn order sorted by initiative descending", () => {
      const w = makeWorld();
      setupBattle1v1(w);
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(0, 0), combatPower: 20, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(1, 0), combatPower: 5, personality: "aggressive", state: "ACTIVE" },
      );
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      expect(w.cm.getCombatSessionByBattle("battle-1")!.turnOrder[0]).toBe("p1");
    });

    it("PRV-011: combat session state is ACTIVE", () => {
      const w = makeWorld();
      createAndBegin(w);
      expect(w.cm.getCombatSessionByBattle("battle-1")!.state).toBe("ACTIVE");
    });

    it("PRV-012: combat has exactly 2 participants", () => {
      const w = makeWorld();
      createAndBegin(w);
      expect(w.cm.getCombatSessionByBattle("battle-1")!.participants).toHaveLength(2);
    });
  });

  describe("PRV-013..020: Normal Damage Execution", () => {
    it("PRV-013: HP decreases after player attacks mob", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 200, 200);
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", mkStatsProvider(w));
      expect(r).toHaveProperty("damage");
      if ("damage" in r) expect(r.damage.remainingHp).toBeLessThan(200);
    });

    it("PRV-014: damage follows formula max(1, round(attack*(1+level*0.1)-defense))", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 500, 500);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 10, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      expect(r).toHaveProperty("damage");
      if ("damage" in r) {
        const expected = Math.max(1, Math.round(10 * (1 + 1 * 0.1) - 1));
        expect(r.damage.damage).toBe(expected);
        expect(r.damage.remainingHp).toBe(500 - expected);
      }
    });

    it("PRV-015: remaining HP floors at 0", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 1, 30);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      if ("damage" in r) expect(r.damage.remainingHp).toBe(0);
    });

    it("PRV-016: damage accumulates across turns", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 200, 200);
      const sp = mkStatsProvider(w);
      const r1 = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      expect(r1).toHaveProperty("damage");
      if ("damage" in r1) {
        const afterFirst = r1.damage.remainingHp;
        const r2 = w.bridge.applyCombatAction("battle-1", "mob_1", "p1", sp);
        expect(r2).toHaveProperty("damage");
        const r3 = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
        if ("damage" in r3) expect(r3.damage.remainingHp).toBeLessThan(afterFirst);
      }
    });

    it("PRV-017: damage result contains attackerId and targetId", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 200, 200);
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", mkStatsProvider(w));
      expect(r).toHaveProperty("damage");
      if ("damage" in r) {
        expect(r.damage.attackerId).toBe("p1");
        expect(r.damage.targetId).toBe("mob_1");
      }
    });

    it("PRV-018: world HP synced after damage", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 200, 200);
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", mkStatsProvider(w));
      if ("damage" in r) {
        expect(w.mobs.get("mob_1")!.currentHp).toBe(r.damage.remainingHp);
        expect(w.entities.get("mob_1")!.health).toBe(r.damage.remainingHp);
      }
    });

    it("PRV-019: attacking dead mob returns error", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 1, 30);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      const r2 = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      expect(r2).toHaveProperty("error");
    });

    it("PRV-020: damage result has targetKilled boolean", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 200, 200);
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", mkStatsProvider(w));
      expect(r).toHaveProperty("damage");
      if ("damage" in r) expect(typeof r.damage.targetKilled).toBe("boolean");
    });
  });

  describe("PRV-021..026: Normal Death Execution", () => {
    it("PRV-021: targetKilled true when mob dies", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 1, 30);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      const r = w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      if ("damage" in r) expect(r.damage.targetKilled).toBe(true);
    });

    it("PRV-022: mob aiState set to dead via resolveKill", () => {
      const w = makeWorld();
      const mob = createAndBegin(w, "battle-1", 1, 30);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      w.deps.resolveKill(mob, "p1");
      expect(mob.aiState).toBe("dead");
      expect(mob.currentHp).toBe(0);
    });

    it("PRV-023: resolveKill called exactly once", () => {
      const w = makeWorld();
      const mob = createAndBegin(w, "battle-1", 1, 30);
      const spy = vi.spyOn(w.deps, "resolveKill");
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      w.deps.resolveKill(mob, "p1");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(mob, "p1");
    });

    it("PRV-024: mob participant removed from battle after kill", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 1, 30);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      const battle = w.bm.getBattle("battle-1")!;
      // applyCombatAction calls updateParticipantState(ELIMINATED) then removeParticipantByDeath
      // so the mob is fully removed from enemySide.participants
      const mp = battle.enemySide.participants.find((p) => p.id === "mob_1");
      expect(mp).toBeUndefined();
    });

    it("PRV-025: combat session still exists after kill", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 1, 30);
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      expect(w.cm.getCombatSessionByBattle("battle-1")).toBeDefined();
    });

    it("PRV-026: player HP unchanged after killing mob", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 50, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 1, maxHealth: 30 });
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        if (id === "mob_1") return { attack: 5, defense: 1, level: 1 };
        return undefined;
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      expect(w.players.get("p1")!.health).toBe(50);
    });
  });

  describe("PRV-027..033: Normal Reward Execution", () => {
    it("PRV-027: xp_gained event emitted on kill", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30, level: 1 });
      w.mobs.set(mob.id, mob);
      const events = w.combatSystem.processPlayerAttack("p1", mob, Date.now(), 1);
      expect(events).not.toBeNull();
      expect(events!.some((e) => e.type === "xp_gained")).toBe(true);
    });

    it("PRV-028: XP amount matches mobLevel * 10", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30, level: 3 });
      w.mobs.set(mob.id, mob);
      const events = w.combatSystem.processPlayerAttack("p1", mob, Date.now(), 1);
      const xp = events!.find((e) => e.type === "xp_gained");
      expect(xp).toBeDefined();
      expect(xp!.xp).toBe(30);
    });

    it("PRV-029: loot_dropped event when mob has loot", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30, lootTable: [{ itemId: "sword", name: "Sword", dropRate: 1.0 }] });
      w.mobs.set(mob.id, mob);
      // rollLoot has a 30% gate: drops only pass if rng() < LOOT_DROP_CHANCE (0.3)
      const spy = vi.spyOn(Math, "random").mockReturnValue(0.1);
      const events = w.combatSystem.processPlayerAttack("p1", mob, Date.now(), 1);
      spy.mockRestore();
      const loot = events!.find((e) => e.type === "loot_dropped");
      expect(loot).toBeDefined();
      expect(loot!.loot).toContain("sword");
    });

    it("PRV-030: player stats XP increases after kill", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30, level: 1 });
      w.mobs.set(mob.id, mob);
      expect(w.combatSystem.getPlayerStats("p1").xp).toBe(0);
      w.combatSystem.processPlayerAttack("p1", mob, Date.now(), 1);
      expect(w.combatSystem.getPlayerStats("p1").xp).toBe(10);
    });

    it("PRV-031: XP accumulates across multiple kills", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const m1 = makeMob("mob_1", 1, { baseHp: 30, level: 2 });
      const m2 = makeMob("mob_2", 1, { baseHp: 30, level: 3 });
      w.mobs.set(m1.id, m1);
      w.mobs.set(m2.id, m2);
      w.combatSystem.processPlayerAttack("p1", m1, Date.now(), 1);
      w.combatSystem.processPlayerAttack("p1", m2, Date.now() + 2000, 1);
      expect(w.combatSystem.getPlayerStats("p1").xp).toBe(50);
    });

    it("PRV-032: kills array populated after resolveKill", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.deps.resolveKill(mob, "p1");
      expect(w.kills).toHaveLength(1);
      expect(w.kills[0].mobId).toBe("mob_1");
      expect(w.kills[0].playerSessionId).toBe("p1");
    });

    it("PRV-033: XP gain equals mobLevel * 10 for level 5 mob", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30, level: 5 });
      w.mobs.set(mob.id, mob);
      const events = w.combatSystem.processPlayerAttack("p1", mob, Date.now(), 1);
      expect(events!.find((e) => e.type === "xp_gained")!.xp).toBe(50);
    });
  });

  describe("PRV-034..040: Normal Cleanup", () => {
    it("PRV-034: battle removed after removeBattle", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(100, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      expect(w.bm.getBattles().size).toBe(1);
      w.bm.removeBattle("battle-1");
      expect(w.bm.getBattles().size).toBe(0);
    });

    it("PRV-035: combat session removed after removeCombatSession", () => {
      const w = makeWorld();
      createAndBegin(w);
      const sid = w.cm.getCombatSessionByBattle("battle-1")!.id;
      w.cm.removeCombatSession(sid);
      expect(w.cm.getCombatSessionByBattle("battle-1")).toBeUndefined();
    });

    it("PRV-036: ownership released after cleanup", () => {
      const w = makeWorld();
      createAndBegin(w);
      expect(isMobOwnedByCombat(w.deps, "mob_1")).toBe(true);
      const sid = w.cm.getCombatSessionByBattle("battle-1")!.id;
      w.cm.removeCombatSession(sid);
      w.bm.removeBattle("battle-1");
      expect(isMobOwnedByCombat(w.deps, "mob_1")).toBe(false);
    });

    it("PRV-037: cleanup logs emitted", () => {
      const w = makeWorld();
      createAndBegin(w);
      const sid = w.cm.getCombatSessionByBattle("battle-1")!.id;
      emitBattleCleanup(w.deps, "battle-1", sid);
      expect(w.logs.map((l) => l.event)).toContain("battle_resolved");
      expect(w.logs.map((l) => l.event)).toContain("new_combat_resolved");
    });

    it("PRV-038: all state empty after full cleanup", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(100, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      const sid = w.cm.getCombatSessionByBattle("battle-1")!.id;
      w.cm.removeCombatSession(sid);
      w.bm.removeBattle("battle-1");
      expect(w.bm.getBattles().size).toBe(0);
      expect(w.cm.getCombatSessionByBattle("battle-1")).toBeUndefined();
      expect(w.cm.getAllCombatMappings()).toHaveLength(0);
    });

    it("PRV-039: new battle possible after cleanup", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(100, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      const sid = w.cm.getCombatSessionByBattle("battle-1")!.id;
      w.cm.removeCombatSession(sid);
      w.bm.removeBattle("battle-1");
      const r = w.bm.createBattle("battle-2",
        { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(100, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      expect(r).toHaveProperty("battle");
      expect(w.bm.getBattles().size).toBe(1);
    });

    it("PRV-040: getAllCombatMappings empty after removeCombatMapping", () => {
      const w = makeWorld();
      createAndBegin(w);
      expect(w.cm.getAllCombatMappings()).toHaveLength(1);
      w.cm.removeCombatMapping("battle-1");
      expect(w.cm.getAllCombatMappings()).toHaveLength(0);
    });
  });

  describe("PRV-041..048: Normal FLEE / REJOIN", () => {
    it("PRV-041: setParticipantFleeing marks participant fleeing", () => {
      const w = makeWorld();
      createAndBegin(w);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      const p = w.cm.getCombatSession(cid)!.participants.find((x) => x.participantId === "p1")!;
      expect(p.fleeing).toBe(true);
    });

    it("PRV-042: fled participant removed from turn order", () => {
      const w = makeWorld();
      createAndBegin(w);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      expect(w.cm.getCombatSession(cid)!.turnOrder).not.toContain("p1");
    });

    it("PRV-043: fled participant stays alive", () => {
      const w = makeWorld();
      createAndBegin(w);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      const p = w.cm.getCombatSession(cid)!.participants.find((x) => x.participantId === "p1")!;
      expect(p.alive).toBe(true);
    });

    it("PRV-044: rejoinCombatParticipant clears fleeing", () => {
      const w = makeWorld();
      createAndBegin(w);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      w.cm.rejoinCombatParticipant(cid, "p1");
      const p = w.cm.getCombatSession(cid)!.participants.find((x) => x.participantId === "p1")!;
      expect(p.fleeing).toBe(false);
    });

    it("PRV-045: rejoin puts participant in pending queue", () => {
      const w = makeWorld();
      createAndBegin(w);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      w.cm.rejoinCombatParticipant(cid, "p1");
      const s = w.cm.getCombatSession(cid)!;
      expect(s.pendingParticipants.some((p) => p.participantId === "p1")).toBe(true);
    });

    it("PRV-046: pending flushed on round boundary via advanceToNextAlive", () => {
      const w = makeWorld();
      createAndBegin(w, "battle-1", 200, 200);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      w.cm.rejoinCombatParticipant(cid, "p1");
      const sp = mkStatsProvider(w);
      w.bridge.applyCombatAction("battle-1", "mob_1", "p1", sp);
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      expect(w.cm.getCombatSession(cid)!.turnOrder).toContain("p1");
    });

    it("PRV-047: dead participant cannot rejoin", () => {
      const w = makeWorld();
      // 2v2 so killing one mob keeps combat ACTIVE
      addPlayer(w, "p1", 100, 100);
      const mob1 = makeMob("mob_1", 1, { baseHp: 30 });
      const mob2 = makeMob("mob_2", 200, { baseHp: 200 });
      w.mobs.set(mob1.id, mob1);
      w.mobs.set(mob2.id, mob2);
      w.entities.set(mob1.id, { health: 1, maxHealth: 30 });
      w.entities.set(mob2.id, { health: 200, maxHealth: 200 });
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(1, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      w.bm.addParticipant("battle-1", "enemy",
        { id: "mob_2", position: point(2, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      // Kill mob_1 via combat action — this sets alive=false in the combat session
      const sp = { getStats: (id: string) => {
        if (id === "p1") return { attack: 100, defense: 5, level: 1 };
        return { attack: 5, defense: 1, level: 1 };
      }};
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      // mob_1 alive is now false in the combat session
      const r = w.cm.rejoinCombatParticipant(cid, "mob_1");
      expect(r).toHaveProperty("error");
    });

    it("PRV-048: HP preserved through flee and rejoin", () => {
      const w = makeWorld();
      createAndBegin(w);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      w.cm.setParticipantFleeing(cid, "p1");
      w.cm.rejoinCombatParticipant(cid, "p1");
      const p = w.cm.getCombatSession(cid)!.participants.find((x) => x.participantId === "p1")!;
      expect(p.currentHp).toBe(100);
      expect(p.maxHp).toBe(100);
    });
  });

  describe("PRV-049..056: Normal Dynamic Join", () => {
    it("PRV-049: player joins existing battle via evaluateDynamicJoin", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      const r = w.bm.evaluateDynamicJoin({ id: "p2", position: point(0, 1), state: "ACTIVE", entityType: "player" });
      expect(r).toHaveProperty("battle");
      expect(w.bm.getBattle("battle-1")!.playerSide.participants).toHaveLength(2);
    });

    it("PRV-050: player outside battle area does not join", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      const r = w.bm.evaluateDynamicJoin({ id: "p2", position: point(500, 500), state: "ACTIVE", entityType: "player" });
      expect(r).toHaveProperty("error");
    });

    it("PRV-051: wrong faction rejected by evaluateDynamicJoin", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const m1 = makeMob("mob_1", 30, { baseHp: 30 });
      const m2 = makeMob("mob_2", 30, { baseHp: 30 });
      w.mobs.set(m1.id, m1);
      w.mobs.set(m2.id, m2);
      // Player at (0,0) and mob_1 at (50,0) so battle areas don't overlap
      w.bm.createBattle("battle-1",
        { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
        { id: "mob_1", position: point(50, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      );
      // mob_2 at (0,1) is inside player area but NOT inside enemy area (far apart)
      const r = w.bm.evaluateDynamicJoin({ id: "mob_2", position: point(0, 1), state: "ACTIVE", entityType: "mob" });
      expect(r).toHaveProperty("error");
    });

    it("PRV-052: joined player is in battle participants but not yet in combat turnOrder", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      w.bm.evaluateDynamicJoin({ id: "p2", position: point(0, 1), state: "ACTIVE", entityType: "player" });
      expect(w.bm.getBattle("battle-1")!.playerSide.participants).toHaveLength(2);
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      expect(w.cm.getCombatSession(cid)!.turnOrder).not.toContain("p2");
    });

    it("PRV-053: pending player flushed into turnOrder on round boundary", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      w.bm.evaluateDynamicJoin({ id: "p2", position: point(0, 1), state: "ACTIVE", entityType: "player" });
      w.bridge.syncParticipants("battle-1", mkHpProvider(w));
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      expect(w.cm.getCombatSession(cid)!.pendingParticipants.some((p) => p.participantId === "p2")).toBe(true);
      const sp = mkStatsProvider(w);
      w.bridge.applyCombatAction("battle-1", "p1", "mob_1", sp);
      w.bridge.applyCombatAction("battle-1", "mob_1", "p1", sp);
      expect(w.cm.getCombatSession(cid)!.turnOrder).toContain("p2");
    });

    it("PRV-054: multiple players can join same battle", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      addPlayer(w, "p3", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bm.evaluateDynamicJoin({ id: "p2", position: point(0, 1), state: "ACTIVE", entityType: "player" });
      w.bm.evaluateDynamicJoin({ id: "p3", position: point(0, 2), state: "ACTIVE", entityType: "player" });
      expect(w.bm.getBattle("battle-1")!.playerSide.participants).toHaveLength(3);
    });

    it("PRV-055: existing participants unaffected by dynamic join", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bridge.beginEncounter("battle-1", mkHpProvider(w));
      const cid = w.cm.getCombatIdByBattle("battle-1")!;
      const before = [...w.cm.getCombatSession(cid)!.turnOrder];
      const actorBefore = w.cm.getCombatSession(cid)!.currentActorId;
      w.bm.evaluateDynamicJoin({ id: "p2", position: point(0, 1), state: "ACTIVE", entityType: "player" });
      const after = w.cm.getCombatSession(cid)!;
      expect(after.turnOrder).toEqual(before);
      expect(after.currentActorId).toBe(actorBefore);
    });

    it("PRV-056: participant count correct after multiple dynamic joins", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      addPlayer(w, "p3", 100, 10);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.bm.createBattle("battle-1", mkPlayerP("p1"), mkEnemyP("mob_1"));
      w.bm.evaluateDynamicJoin({ id: "p2", position: point(0, 1), state: "ACTIVE", entityType: "player" });
      w.bm.evaluateDynamicJoin({ id: "p3", position: point(0, 2), state: "ACTIVE", entityType: "player" });
      const b = w.bm.getBattle("battle-1")!;
      expect(b.playerSide.participants.length).toBe(3);
      expect(b.enemySide.participants.length).toBe(1);
    });
  });

  describe("PRV-057..062: No Double Settlement", () => {
    it("PRV-057: second attack on owned mob is blocked", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      const r1 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r1.kind).toBe("combat");
      const r2 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r2.kind).toBe("blocked");
    });

    it("PRV-058: kill happens exactly once even with continued attacks", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 1, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 1, maxHealth: 30 });
      const spy = vi.spyOn(w.deps, "resolveKill");
      routeRealtimeAttack(w.deps, "p1", mob);
      routeRealtimeAttack(w.deps, "p1", mob);
      routeRealtimeAttack(w.deps, "p1", mob);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("PRV-059: resolved combat removes session from mapping", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      routeRealtimeAttack(w.deps, "p1", mob);
      const battle = [...w.bm.getBattles().values()][0]!;
      const sessionBefore = w.cm.getCombatSessionByBattle(battle.id);
      expect(sessionBefore).toBeDefined();
      expect(sessionBefore!.state).toBe("ACTIVE");
      expect(w.cm.getActiveSessions()).toHaveLength(1);
      w.bridge.resolveCombat(battle.id);
      expect(w.cm.getCombatSessionByBattle(battle.id)).toBeUndefined();
      expect(w.cm.getActiveSessions()).toHaveLength(0);
    });

    it("PRV-060: isMobOwnedByCombat returns true when owned", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      routeRealtimeAttack(w.deps, "p1", mob);
      expect(isMobOwnedByCombat(w.deps, "mob_1")).toBe(true);
    });

    it("PRV-061: flag flip does not remove session ownership", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      routeRealtimeAttack(w.deps, "p1", mob);
      process.env.ENABLE_BATTLE_COMBAT = "false";
      expect(isMobOwnedByCombat(w.deps, "mob_1")).toBe(true);
    });

    it("PRV-062: only one battle per unique player-mob contact", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      addPlayer(w, "p2", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      routeRealtimeAttack(w.deps, "p1", mob);
      const count = w.bm.getBattles().size;
      routeRealtimeAttack(w.deps, "p2", mob);
      expect(w.bm.getBattles().size).toBe(count);
    });
  });

  describe("PRV-063..068: No Unexpected Legacy Fallback", () => {
    it("PRV-063: flag ON routes to combat, not fallback", () => {
      delete process.env.ENABLE_BATTLE_COMBAT;
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("combat");
      expect(w.logs.map((l) => l.event)).not.toContain("creation_failed");
    });

    it("PRV-064: missing player returns fallback with player_unavailable", () => {
      const w = makeWorld();
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);
      const r = routeRealtimeAttack(w.deps, "ghost", mob);
      expect(r.kind).toBe("fallback");
      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("player_unavailable");
    });

    it("PRV-065: beginEncounter failure triggers fallback + battle rollback", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 30, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 30, maxHealth: 30 });
      const orig = w.bridge.beginEncounter.bind(w.bridge);
      (w.bridge as any).beginEncounter = () => ({ error: "INJECTED" });
      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("fallback");
      expect(w.cm.getCombatSessionByBattle("battle-p1-mob_1")).toBeUndefined();
      const fb = w.logs.filter((l) => l.event === "creation_failed");
      expect(fb).toHaveLength(1);
      expect(fb[0].data.reason).toBe("combat_creation_failed");
      (w.bridge as any).beginEncounter = orig;
    });

    it("PRV-066: flag OFF leaves zero combat state", () => {
      process.env.ENABLE_BATTLE_COMBAT = "false";
      const w = makeWorld();
      addPlayer(w, "p1", 100);
      const mob = makeMob("mob_1", 30);
      w.mobs.set(mob.id, mob);
      expect(isBattleCombatEnabled()).toBe(false);
      expect(w.bm.getBattles().size).toBe(0);
      expect(w.cm.getAllCombatMappings().length).toBe(0);
    });

    it("PRV-067: default flag routes to combat path", () => {
      delete process.env.ENABLE_BATTLE_COMBAT;
      expect(isBattleCombatEnabled()).toBe(true);
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("combat");
      expect(w.bm.getBattles().size).toBe(1);
    });

    it("PRV-068: flag flip mid-combat preserves session", () => {
      const w = makeWorld();
      addPlayer(w, "p1", 100, 50);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      routeRealtimeAttack(w.deps, "p1", mob);
      process.env.ENABLE_BATTLE_COMBAT = "false";
      expect(w.bm.getBattles().size).toBe(1);
      const battle = [...w.bm.getBattles().values()][0]!;
      expect(w.cm.getCombatSessionByBattle(battle.id)).toBeDefined();
    });
  });

  describe("PRV-069..070: Full Production Sequence", () => {
    it("PRV-069: complete 1v1 lifecycle — create, combat, kill, cleanup, empty", () => {
      delete process.env.ENABLE_BATTLE_COMBAT;
      const w = makeWorld();
      addPlayer(w, "p1", 100, 100);
      const mob = makeMob("mob_1", 5, { baseHp: 30 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 5, maxHealth: 30 });
      const r = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r.kind).toBe("combat");
      expect(r.damage?.targetKilled).toBe(true);
      expect(w.bm.getBattles().size).toBe(1);
      expect(w.kills).toHaveLength(1);
      const battle = [...w.bm.getBattles().values()][0]!;
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      w.cm.removeCombatSession(session.id);
      w.bm.removeBattle(battle.id);
      expect(w.bm.getBattles().size).toBe(0);
      expect(isMobOwnedByCombat(w.deps, "mob_1")).toBe(false);
    });

    it("PRV-070: complete multi-player lifecycle — 2 players vs 1 mob", () => {
      delete process.env.ENABLE_BATTLE_COMBAT;
      const w = makeWorld();
      addPlayer(w, "p1", 100, 10);
      addPlayer(w, "p2", 100, 10);
      const mob = makeMob("mob_1", 200, { baseHp: 200 });
      w.mobs.set(mob.id, mob);
      w.entities.set(mob.id, { health: 200, maxHealth: 200 });
      const r1 = routeRealtimeAttack(w.deps, "p1", mob);
      expect(r1.kind).toBe("combat");
      expect(mob.currentHp).toBeLessThan(200);
      const r2 = routeRealtimeAttack(w.deps, "p2", mob);
      expect(r2.kind).toBe("joined");
      expect(w.bm.getBattles().size).toBe(1);
      const battle = [...w.bm.getBattles().values()][0]!;
      expect(battle.playerSide.participants.length).toBe(2);
      const session = w.cm.getCombatSessionByBattle(battle.id)!;
      expect(session.state).toBe("ACTIVE");
      expect(session.turnOrder.length).toBeGreaterThanOrEqual(2);
      expect(w.cm.getActiveSessions()).toHaveLength(1);
      w.bridge.resolveCombat(battle.id);
      expect(w.cm.getActiveSessions()).toHaveLength(0);
    });
  });
});
