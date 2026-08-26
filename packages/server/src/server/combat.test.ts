import { describe, it, expect, beforeEach } from "vitest";
import { Biome, WorldGenerator, CHUNK_SIZE } from "@mmo/shared";
import {
  CombatSystem,
  MobSpawner,
  MOB_TYPES,
  calculateDamage,
  calculateXpGain,
  rollLoot,
  getMobTypeForBiome,
  createDefaultPlayerStats,
  type MobInstance,
} from "./index.js";

/* ── Damage Calculation ── */

describe("calculateDamage", () => {
  it("applies level multiplier and subtracts defense", () => {
    // base_damage * (1 + level * 0.1) - defense
    // 10 * (1 + 1 * 0.1) - 5 = 10 * 1.1 - 5 = 11 - 5 = 6
    const damage = calculateDamage(10, 1, 5);
    expect(damage).toBe(6);
  });

  it("returns minimum 1 when defense exceeds damage", () => {
    // 5 * (1 + 1 * 0.1) - 20 = 5.5 - 20 = -14.5 → clamped to 1
    const damage = calculateDamage(5, 1, 20);
    expect(damage).toBe(1);
  });

  it("calculates correctly for level 0", () => {
    // 10 * (1 + 0 * 0.1) - 3 = 10 - 3 = 7
    const damage = calculateDamage(10, 0, 3);
    expect(damage).toBe(7);
  });

  it("scales with attacker level", () => {
    const dmgLv1 = calculateDamage(10, 1, 0);
    const dmgLv5 = calculateDamage(10, 5, 0);
    const dmgLv10 = calculateDamage(10, 10, 0);

    // 10 * 1.1 = 11, 10 * 1.5 = 15, 10 * 2.0 = 20
    expect(dmgLv1).toBe(11);
    expect(dmgLv5).toBe(15);
    expect(dmgLv10).toBe(20);
    expect(dmgLv10).toBeGreaterThan(dmgLv5);
    expect(dmgLv5).toBeGreaterThan(dmgLv1);
  });

  it("handles zero defense", () => {
    // 8 * (1 + 3 * 0.1) - 0 = 8 * 1.3 = 10.4 → rounded to 10
    const damage = calculateDamage(8, 3, 0);
    expect(damage).toBe(10);
  });

  it("rounds to nearest integer", () => {
    // 7 * (1 + 2 * 0.1) - 4 = 7 * 1.2 - 4 = 8.4 - 4 = 4.4 → rounded to 4
    const damage = calculateDamage(7, 2, 4);
    expect(damage).toBe(4);
  });
});

/* ── XP Gain ── */

describe("calculateXpGain", () => {
  it("returns mob_level * 10", () => {
    expect(calculateXpGain(1)).toBe(10);
    expect(calculateXpGain(2)).toBe(20);
    expect(calculateXpGain(5)).toBe(50);
    expect(calculateXpGain(10)).toBe(100);
  });

  it("returns 0 for level 0", () => {
    expect(calculateXpGain(0)).toBe(0);
  });
});

/* ── Loot Drops ── */

describe("rollLoot", () => {
  it("returns items when roll succeeds", () => {
    // Force all rolls to succeed (rng always returns 0)
    const loot = rollLoot([
      { itemId: "sword", name: "Sword", dropRate: 0.5 },
      { itemId: "shield", name: "Shield", dropRate: 0.5 },
    ], () => 0);

    // Items pass the drop rate check, but 30% gate may block
    // With rng returning 0, dropRate 0.5 > 0 → items pass
    // Then 30% gate: rng() < 0.3 → 0 < 0.3 → true, so loot is kept
    expect(loot.length).toBeGreaterThanOrEqual(0);
    // Since we force all rolls to 0, items pass drop rate AND 30% gate
    expect(loot).toContain("sword");
    expect(loot).toContain("shield");
  });

  it("returns empty when roll fails", () => {
    // Force all rolls to fail (rng always returns 1)
    const loot = rollLoot([
      { itemId: "sword", name: "Sword", dropRate: 0.5 },
    ], () => 1);

    expect(loot).toHaveLength(0);
  });

  it("respects individual drop rates", () => {
    // rng returns 0.1 → passes 0.5 drop rate, passes 0.3 gate
    const loot = rollLoot([
      { itemId: "common", name: "Common", dropRate: 0.5 },
      { itemId: "rare", name: "Rare", dropRate: 0.05 },
    ], () => 0.1);

    expect(loot).toContain("common");
    expect(loot).not.toContain("rare");
  });

  it("can return empty even with items passing drop rate", () => {
    // Items pass drop rate (0.1 < 0.5), but 30% gate blocks (0.8 >= 0.3)
    let callCount = 0;
    const rng = () => {
      callCount++;
      // First two calls: 0.1 (pass drop rate), third call: 0.8 (fail 30% gate)
      if (callCount <= 2) return 0.1;
      return 0.8;
    };

    const loot = rollLoot([
      { itemId: "a", name: "A", dropRate: 0.5 },
      { itemId: "b", name: "B", dropRate: 0.5 },
    ], rng);

    expect(loot).toHaveLength(0);
  });
});

/* ── Biome → Mob Type Mapping ── */

describe("getMobTypeForBiome", () => {
  it("returns Wolf for Forest", () => {
    const mob = getMobTypeForBiome(Biome.Forest);
    expect(mob).toBeDefined();
    expect(mob!.id).toBe("wolf");
  });

  it("returns Scorpion for Desert", () => {
    const mob = getMobTypeForBiome(Biome.Desert);
    expect(mob).toBeDefined();
    expect(mob!.id).toBe("scorpion");
  });

  it("returns Skeleton for Mountains", () => {
    const mob = getMobTypeForBiome(Biome.Mountains);
    expect(mob).toBeDefined();
    expect(mob!.id).toBe("skeleton");
  });

  it("returns Slime for Plains", () => {
    const mob = getMobTypeForBiome(Biome.Plains);
    expect(mob).toBeDefined();
    expect(mob!.id).toBe("slime");
  });

  it("returns undefined for Ocean", () => {
    const mob = getMobTypeForBiome(Biome.Ocean);
    expect(mob).toBeUndefined();
  });

  it("returns undefined for Beach", () => {
    const mob = getMobTypeForBiome(Biome.Beach);
    expect(mob).toBeUndefined();
  });
});

/* ── Mob Type Configs ── */

describe("MOB_TYPES", () => {
  it("has all required mob types", () => {
    expect(MOB_TYPES.wolf).toBeDefined();
    expect(MOB_TYPES.scorpion).toBeDefined();
    expect(MOB_TYPES.skeleton).toBeDefined();
    expect(MOB_TYPES.slime).toBeDefined();
  });

  it("wolf has correct stats", () => {
    const wolf = MOB_TYPES.wolf;
    expect(wolf.baseHp).toBe(80);
    expect(wolf.baseAttack).toBe(8);
    expect(wolf.baseDefense).toBe(3);
    expect(wolf.level).toBe(2);
    expect(wolf.xpReward).toBe(20);
    expect(wolf.lootTable.length).toBeGreaterThan(0);
  });

  it("scorpion has correct stats", () => {
    const scorpion = MOB_TYPES.scorpion;
    expect(scorpion.baseHp).toBe(60);
    expect(scorpion.baseAttack).toBe(12);
    expect(scorpion.baseDefense).toBe(2);
    expect(scorpion.level).toBe(3);
  });

  it("skeleton has correct stats", () => {
    const skeleton = MOB_TYPES.skeleton;
    expect(skeleton.baseHp).toBe(100);
    expect(skeleton.baseAttack).toBe(10);
    expect(skeleton.baseDefense).toBe(8);
    expect(skeleton.level).toBe(5);
  });

  it("slime has correct stats", () => {
    const slime = MOB_TYPES.slime;
    expect(slime.baseHp).toBe(50);
    expect(slime.baseAttack).toBe(5);
    expect(slime.baseDefense).toBe(1);
    expect(slime.level).toBe(1);
  });
});

/* ── Default Player Stats ── */

describe("createDefaultPlayerStats", () => {
  it("returns correct defaults", () => {
    const stats = createDefaultPlayerStats();
    expect(stats.attack).toBe(10);
    expect(stats.defense).toBe(5);
    expect(stats.xp).toBe(0);
    expect(stats.xpToNextLevel).toBe(100);
  });
});

/* ── CombatSystem Integration ── */

describe("CombatSystem", () => {
  let cs: CombatSystem;

  beforeEach(() => {
    cs = new CombatSystem();
  });

  describe("player stats management", () => {
    it("creates default stats for new player", () => {
      const stats = cs.getPlayerStats("p1");
      expect(stats.attack).toBe(10);
      expect(stats.defense).toBe(5);
    });

    it("returns same stats for same player", () => {
      const stats1 = cs.getPlayerStats("p1");
      const stats2 = cs.getPlayerStats("p1");
      expect(stats1).toBe(stats2);
    });

    it("removes player stats", () => {
      cs.getPlayerStats("p1");
      cs.removePlayerStats("p1");
      const stats = cs.getPlayerStats("p1");
      // Should create fresh stats
      expect(stats.attack).toBe(10);
    });
  });

  describe("processPlayerAttack", () => {
    it("deals damage to mob", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "wolf",
        config: MOB_TYPES.wolf,
        x: 10,
        y: 10,
        currentHp: 80,
        maxHp: 80,
        aggroTarget: null,
        aiState: "idle",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: 0,
        lastAttackTime: 0,
        synced: false,
      };

      const events = cs.processPlayerAttack("p1", mob, Date.now());
      expect(events).not.toBeNull();
      expect(events!.length).toBeGreaterThan(0);

      const dmgEvent = events!.find((e) => e.type === "damage_dealt");
      expect(dmgEvent).toBeDefined();
      expect(dmgEvent!.damage).toBeGreaterThan(0);
      expect(mob.currentHp).toBeLessThan(80);
    });

    it("respects attack cooldown", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "wolf",
        config: MOB_TYPES.wolf,
        x: 10,
        y: 10,
        currentHp: 80,
        maxHp: 80,
        aggroTarget: null,
        aiState: "idle",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: 0,
        lastAttackTime: 0,
        synced: false,
      };

      const now = Date.now();
      cs.processPlayerAttack("p1", mob, now);
      // Second attack immediately should fail
      const result = cs.processPlayerAttack("p1", mob, now + 100);
      expect(result).toBeNull();
    });

    it("kills mob at 0 HP and grants XP", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "slime",
        config: MOB_TYPES.slime,
        x: 10,
        y: 10,
        currentHp: 1, // Very low HP
        maxHp: 50,
        aggroTarget: null,
        aiState: "idle",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: 0,
        lastAttackTime: 0,
        synced: false,
      };

      const events = cs.processPlayerAttack("p1", mob, Date.now());
      expect(events).not.toBeNull();

      const killEvent = events!.find((e) => e.type === "mob_killed");
      expect(killEvent).toBeDefined();

      const xpEvent = events!.find((e) => e.type === "xp_gained");
      expect(xpEvent).toBeDefined();
      expect(xpEvent!.xp).toBe(10); // slime level 1 * 10

      expect(mob.aiState).toBe("dead");
    });

    it("rejects attack on dead mob", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "wolf",
        config: MOB_TYPES.wolf,
        x: 10,
        y: 10,
        currentHp: 0,
        maxHp: 80,
        aggroTarget: null,
        aiState: "dead",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: Date.now(),
        lastAttackTime: 0,
        synced: false,
      };

      const events = cs.processPlayerAttack("p1", mob, Date.now());
      expect(events).toBeNull();
    });
  });

  describe("processMobAttack", () => {
    it("deals damage to player", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "wolf",
        config: MOB_TYPES.wolf,
        x: 10,
        y: 10,
        currentHp: 80,
        maxHp: 80,
        aggroTarget: "p1",
        aiState: "chase",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: 0,
        lastAttackTime: 0,
        synced: false,
      };

      const events = cs.processMobAttack(mob, "p1", 100, Date.now());
      expect(events).not.toBeNull();

      const dmgEvent = events!.find((e) => e.type === "player_damaged");
      expect(dmgEvent).toBeDefined();
      expect(dmgEvent!.damage).toBeGreaterThan(0);
      expect(dmgEvent!.currentHp).toBeLessThan(100);
    });

    it("kills player at 0 HP", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "scorpion",
        config: MOB_TYPES.scorpion,
        x: 10,
        y: 10,
        currentHp: 60,
        maxHp: 60,
        aggroTarget: "p1",
        aiState: "chase",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: 0,
        lastAttackTime: 0,
        synced: false,
      };

      const events = cs.processMobAttack(mob, "p1", 1, Date.now());
      expect(events).not.toBeNull();

      const deathEvent = events!.find((e) => e.type === "player_died");
      expect(deathEvent).toBeDefined();
    });

    it("respects attack cooldown", () => {
      const mob: MobInstance = {
        id: "mob_1",
        typeId: "wolf",
        config: MOB_TYPES.wolf,
        x: 10,
        y: 10,
        currentHp: 80,
        maxHp: 80,
        aggroTarget: "p1",
        aiState: "chase",
        patrolTarget: null,
        spawnX: 10,
        spawnY: 10,
        chunkX: 0,
        chunkY: 0,
        deathTime: 0,
        lastAttackTime: 0,
        synced: false,
      };

      const now = Date.now();
      cs.processMobAttack(mob, "p1", 100, now);
      const result = cs.processMobAttack(mob, "p1", 100, now + 100);
      expect(result).toBeNull();
    });
  });
});

/* ── MobSpawner Integration ── */

describe("MobSpawner", () => {
  let worldGen: WorldGenerator;
  let cs: CombatSystem;
  let spawner: MobSpawner;

  beforeEach(() => {
    worldGen = new WorldGenerator(42);
    cs = new CombatSystem();
    spawner = new MobSpawner(worldGen, cs);
  });

  describe("spawnMobsForChunk", () => {
    it("spawns mobs in chunks with valid biomes", () => {
      // Try several chunks to find one with a spawnable biome
      let spawned = false;
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          const mobs = spawner.spawnMobsForChunk(cx, cy);
          if (mobs.length > 0) {
            spawned = true;
            expect(mobs.length).toBeGreaterThan(0);
            expect(mobs.length).toBeLessThanOrEqual(5);
            break;
          }
        }
        if (spawned) break;
      }
      // At least some chunks should have mobs
      expect(spawned).toBe(true);
    });

    it("does not exceed max mobs per chunk", () => {
      // Find a spawnable chunk
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          spawner.spawnMobsForChunk(cx, cy);
          const mobs = spawner.spawnMobsForChunk(cx, cy);
          if (mobs.length > 0) {
            // Should have spawned 0 on second call (already at max)
            const allMobs = spawner.getAllMobs();
            const chunkMobs = Array.from(allMobs.values()).filter(
              (m) => m.chunkX === cx && m.chunkY === cy,
            );
            expect(chunkMobs.length).toBeLessThanOrEqual(5);
            return;
          }
        }
      }
    });

    it("spawns mobs with correct type for biome", () => {
      // Find a spawnable chunk and check mob type
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          const mobs = spawner.spawnMobsForChunk(cx, cy);
          if (mobs.length > 0) {
            const mob = mobs[0];
            // Mob type should be one of the valid types
            expect(["wolf", "scorpion", "skeleton", "slime"]).toContain(mob.typeId);
            expect(mob.currentHp).toBe(mob.maxHp);
            expect(mob.maxHp).toBeGreaterThan(0);
            return;
          }
        }
      }
    });
  });

  describe("removeMobsForChunk", () => {
    it("removes all mobs in a chunk", () => {
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          spawner.spawnMobsForChunk(cx, cy);
          const allMobs = spawner.getAllMobs();
          const chunkMobs = Array.from(allMobs.values()).filter(
            (m) => m.chunkX === cx && m.chunkY === cy,
          );
          if (chunkMobs.length > 0) {
            spawner.removeMobsForChunk(cx, cy);
            const remaining = Array.from(spawner.getAllMobs().values()).filter(
              (m) => m.chunkX === cx && m.chunkY === cy,
            );
            expect(remaining).toHaveLength(0);
            return;
          }
        }
      }
    });
  });

  describe("tick AI", () => {
    it("moves idle mobs toward patrol target", () => {
      // Spawn a mob
      let mob: MobInstance | undefined;
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          spawner.spawnMobsForChunk(cx, cy);
          const allMobs = spawner.getAllMobs();
          for (const [, m] of allMobs) {
            if (m.chunkX === cx && m.chunkY === cy) {
              mob = m;
              break;
            }
          }
          if (mob) break;
        }
        if (mob) break;
      }

      if (!mob) return; // No spawnable chunk found

      const startX = mob.x;
      const startY = mob.y;

      // Run a few ticks
      const players = new Map<string, { x: number; y: number; health: number }>();
      for (let i = 0; i < 10; i++) {
        spawner.tick(0.05, players, Date.now());
      }

      // Mob should have moved (either to patrol or started patrol)
      const moved = mob.x !== startX || mob.y !== startY;
      expect(moved).toBe(true);
    });

    it("aggros when player is within range", () => {
      let mob: MobInstance | undefined;
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          spawner.spawnMobsForChunk(cx, cy);
          const allMobs = spawner.getAllMobs();
          for (const [, m] of allMobs) {
            if (m.chunkX === cx && m.chunkY === cy) {
              mob = m;
              break;
            }
          }
          if (mob) break;
        }
        if (mob) break;
      }

      if (!mob) return;

      // Place player within aggro range (3 tiles)
      const players = new Map<string, { x: number; y: number; health: number }>();
      players.set("p1", { x: mob.x + 2, y: mob.y, health: 100 });

      spawner.tick(0.05, players, Date.now());

      expect(mob.aggroTarget).toBe("p1");
      expect(mob.aiState).toBe("chase");
    });

    it("leashes when player moves too far", () => {
      let mob: MobInstance | undefined;
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          spawner.spawnMobsForChunk(cx, cy);
          const allMobs = spawner.getAllMobs();
          for (const [, m] of allMobs) {
            if (m.chunkX === cx && m.chunkY === cy) {
              mob = m;
              break;
            }
          }
          if (mob) break;
        }
        if (mob) break;
      }

      if (!mob) return;

      // Aggro the mob
      const players = new Map<string, { x: number; y: number; health: number }>();
      players.set("p1", { x: mob.x + 2, y: mob.y, health: 100 });
      spawner.tick(0.05, players, Date.now());
      expect(mob.aggroTarget).toBe("p1");

      // Move player out of leash range (LEASH_RANGE = 30 tiles)
      players.set("p1", { x: mob.x + 35, y: mob.y, health: 100 });
      spawner.tick(0.05, players, Date.now());

      // Mob should leash back to patrol
      expect(mob.aggroTarget).toBeNull();
    });
  });

  describe("getMob", () => {
    it("returns mob by ID", () => {
      for (let cx = -5; cx <= 5; cx++) {
        for (let cy = -5; cy <= 5; cy++) {
          spawner.spawnMobsForChunk(cx, cy);
          const allMobs = spawner.getAllMobs();
          for (const [id] of allMobs) {
            const mob = spawner.getMob(id);
            expect(mob).toBeDefined();
            expect(mob!.id).toBe(id);
            return;
          }
        }
      }
    });

    it("returns undefined for unknown ID", () => {
      expect(spawner.getMob("mob_999")).toBeUndefined();
    });
  });
});

/* ���� Combat Activation Slice ���� */

describe("processMobAttack - dead player guard", () => {
  it("returns null and skips cooldown when player is already dead", () => {
    const combat = new CombatSystem();
    // Build a minimal mob instance directly
    const wolf = MOB_TYPES["wolf"];
    const testMob: MobInstance = {
      id: "mob_test_1",
      typeId: "wolf",
      config: wolf,
      x: 0, y: 0,
      currentHp: wolf.baseHp,
      maxHp: wolf.baseHp,
      aggroTarget: "p1",
      aiState: "chase",
      patrolTarget: null,
      spawnX: 0, spawnY: 0,
      chunkX: 0, chunkY: 0,
      deathTime: 0,
      lastAttackTime: 0,
      lastCombatTime: 0,
      synced: false,
    };
    const now = Date.now();
    // Dead player (hp = 0): attack must be ignored entirely.
    expect(combat.processMobAttack(testMob, "p1", 0, now)).toBeNull();
    // Cooldown must NOT be consumed (mob can attack a living target right after).
    const events = combat.processMobAttack(testMob, "p1", 50, now);
    expect(events).not.toBeNull();
  });
});

describe("processPlayerAttack - player level scaling", () => {
  it("uses the passed player level instead of hardcoded 1", () => {
    const combat = new CombatSystem();
    const slime = MOB_TYPES["slime"];
    const testMob: MobInstance = {
      id: "mob_test_2",
      typeId: "slime",
      config: slime,
      x: 0, y: 0,
      currentHp: 9999,
      maxHp: 9999,
      aggroTarget: null,
      aiState: "idle",
      patrolTarget: null,
      spawnX: 0, spawnY: 0,
      chunkX: 0, chunkY: 0,
      deathTime: 0,
      lastAttackTime: 0,
      lastCombatTime: 0,
      synced: false,
    };
    const now = Date.now();
    // attack=10, defense=1: level 1 -> round(10*1.1)-1 = 10; level 10 -> round(10*2.0)-1 = 19
    const e1 = combat.processPlayerAttack("p1", testMob, now, 1)!;
    expect(e1[0].damage).toBe(calculateDamage(10, 1, slime.baseDefense));
    const e10 = combat.processPlayerAttack("p1", testMob, now + 2000, 10)!;
    expect(e10[0].damage).toBe(calculateDamage(10, 10, slime.baseDefense));
    expect(e10[0].damage!).toBeGreaterThan(e1[0].damage!);
  });
});
