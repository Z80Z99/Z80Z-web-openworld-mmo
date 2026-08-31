import { Biome } from "@mmo/shared";

/* ── Mob Type Definitions ── */

export interface MobTypeConfig {
  id: string;
  name: string;
  biomes: Biome[];
  baseHp: number;
  baseAttack: number;
  baseDefense: number;
  level: number;
  xpReward: number;
  lootTable: LootEntry[];
  color: number; // hex color for client rendering
}

export interface LootEntry {
  itemId: string;
  name: string;
  dropRate: number; // 0-1
}

/** All mob types available in the game. */
export const MOB_TYPES: Record<string, MobTypeConfig> = {
  wolf: {
    id: "wolf",
    name: "Wolf",
    biomes: [Biome.Forest],
    baseHp: 80,
    baseAttack: 8,
    baseDefense: 3,
    level: 2,
    xpReward: 20, // level * 10
    lootTable: [
      { itemId: "wolf_pelt", name: "Wolf Pelt", dropRate: 0.3 },
      { itemId: "wolf_fang", name: "Wolf Fang", dropRate: 0.15 },
      { itemId: "raw_meat", name: "Raw Meat", dropRate: 0.5 },
    ],
    color: 0x8b6914,
  },
  scorpion: {
    id: "scorpion",
    name: "Scorpion",
    biomes: [Biome.Desert],
    baseHp: 60,
    baseAttack: 12,
    baseDefense: 2,
    level: 3,
    xpReward: 30,
    lootTable: [
      { itemId: "scorpion_stinger", name: "Scorpion Stinger", dropRate: 0.25 },
      { itemId: "chitin_plate", name: "Chitin Plate", dropRate: 0.2 },
      { itemId: "venom_sac", name: "Venom Sac", dropRate: 0.35 },
    ],
    color: 0xcc7722,
  },
  skeleton: {
    id: "skeleton",
    name: "Skeleton",
    biomes: [Biome.Mountains],
    baseHp: 100,
    baseAttack: 10,
    baseDefense: 8,
    level: 5,
    xpReward: 50,
    lootTable: [
      { itemId: "bone_fragment", name: "Bone Fragment", dropRate: 0.4 },
      { itemId: "rusty_sword", name: "Rusty Sword", dropRate: 0.1 },
      { itemId: "soul_shard", name: "Soul Shard", dropRate: 0.05 },
    ],
    color: 0xdddddd,
  },
  slime: {
    id: "slime",
    name: "Slime",
    biomes: [Biome.Plains],
    baseHp: 50,
    baseAttack: 5,
    baseDefense: 1,
    level: 1,
    xpReward: 10,
    lootTable: [
      { itemId: "slime_gel", name: "Slime Gel", dropRate: 0.5 },
      { itemId: "slime_core", name: "Slime Core", dropRate: 0.1 },
    ],
    color: 0x44cc44,
  },
};

/** Build biome → mob type lookup. */
const BIOME_MOB_MAP: Map<Biome, MobTypeConfig> = new Map();
for (const mob of Object.values(MOB_TYPES)) {
  for (const biome of mob.biomes) {
    if (!BIOME_MOB_MAP.has(biome)) {
      BIOME_MOB_MAP.set(biome, mob);
    }
  }
}

export function getMobTypeForBiome(biome: Biome): MobTypeConfig | undefined {
  return BIOME_MOB_MAP.get(biome);
}

/* ── Player Combat Stats (server-side only) ── */

export interface PlayerCombatStats {
  attack: number;
  defense: number;
  xp: number;
  xpToNextLevel: number;
}

export function createDefaultPlayerStats(): PlayerCombatStats {
  return {
    attack: 10,
    defense: 5,
    xp: 0,
    xpToNextLevel: 100,
  };
}

/* ── Damage Calculation ── */

/**
 * Calculate damage dealt by attacker to target.
 * Formula: base_damage * (1 + attacker_level * 0.1) - target_defense
 * Minimum damage is 1 (never deal 0 or negative).
 */
export function calculateDamage(baseDamage: number, attackerLevel: number, targetDefense: number): number {
  const raw = baseDamage * (1 + attackerLevel * 0.1) - targetDefense;
  return Math.max(1, Math.round(raw));
}

/* ── XP System ── */

/**
 * Calculate XP gained from killing a mob.
 * XP = mob_level * 10
 */
export function calculateXpGain(mobLevel: number): number {
  return mobLevel * 10;
}

/**
 * Check if player has enough XP to level up (title only, no stat bonus).
 * Returns true if xp >= xpToNextLevel.
 */
export function hasLeveledUp(xp: number, xpToNextLevel: number): boolean {
  return xp >= xpToNextLevel;
}

/* ── Loot System ── */

const LOOT_DROP_CHANCE = 0.3; // 30%

/**
 * Roll for loot drops from a mob's loot table.
 * Returns array of dropped items (can be empty if no roll succeeds).
 * Each item in the loot table is rolled independently.
 */
export function rollLoot(lootTable: LootEntry[], rng: () => number = Math.random): string[] {
  const drops: string[] = [];

  for (const entry of lootTable) {
    if (rng() < entry.dropRate) {
      drops.push(entry.itemId);
    }
  }

  // 30% chance that ANY loot drops at all
  if (drops.length > 0 && rng() >= LOOT_DROP_CHANCE) {
    return [];
  }

  return drops;
}

/* ── Combat Events ── */

export type CombatEventType =
  | "damage_dealt"
  | "mob_killed"
  | "player_damaged"
  | "player_died"
  | "xp_gained"
  | "loot_dropped"
  | "mob_respawn";

export interface CombatEvent {
  type: CombatEventType;
  sourceId: string;
  targetId: string;
  damage?: number;
  xp?: number;
  loot?: string[];
  currentHp?: number;
  maxHp?: number;
}

/* ── Mob Instance Data (server-side) ── */

export interface MobInstance {
  id: string;
  typeId: string;
  config: MobTypeConfig;
  x: number;
  y: number;
  currentHp: number;
  maxHp: number;
  /** Aggro target session ID, or null if idle. */
  aggroTarget: string | null;
  /** Current AI state. */
  aiState: "idle" | "patrol" | "chase" | "dead";
  /** Patrol target position. */
  patrolTarget: { x: number; y: number } | null;
  /** Spawn position (for leash range). */
  spawnX: number;
  spawnY: number;
  /** Chunk coordinates. */
  chunkX: number;
  chunkY: number;
  /** Timestamp when mob died (for respawn timer). */
  deathTime: number;
  /** Timestamp of last attack. */
  lastAttackTime: number;
  /** Timestamp of last successful attack on aggro target (for combat leash). */
  lastCombatTime: number;
  /** Whether entity is synced to clients. */
  synced: boolean;
}

/* ── CombatSystem Class ── */

/**
 * Server-side combat system.
 * Manages player combat stats, mob HP, attack processing, XP, and loot.
 * Does NOT handle AI — that's MobSpawner's job.
 */
export class CombatSystem {
  /** Per-player combat stats keyed by Colyseus sessionId. */
  private readonly playerStats = new Map<string, PlayerCombatStats>();

  /** Track player attack cooldowns (last attack timestamp). */
  private readonly playerAttackCooldowns = new Map<string, number>();

  /** Attack cooldown in ms (1 attack per second). */
  private static readonly ATTACK_COOLDOWN_MS = 1000;

  /* ── Player Stats ── */

  getPlayerStats(sessionId: string): PlayerCombatStats {
    let stats = this.playerStats.get(sessionId);
    if (!stats) {
      stats = createDefaultPlayerStats();
      this.playerStats.set(sessionId, stats);
    }
    return stats;
  }

  removePlayerStats(sessionId: string): void {
    this.playerStats.delete(sessionId);
    this.playerAttackCooldowns.delete(sessionId);
  }

  /* ── Attack Processing ── */

  /**
   * Process a player attacking a mob.
   * Returns combat events or null if the attack is invalid/on cooldown.
   */
  processPlayerAttack(
    sessionId: string,
    mob: MobInstance,
    now: number,
    playerLevel: number = 1,
  ): CombatEvent[] | null {
    // Check cooldown
    const lastAttack = this.playerAttackCooldowns.get(sessionId) ?? 0;
    if (now - lastAttack < CombatSystem.ATTACK_COOLDOWN_MS) {
      return null;
    }

    // Check mob is alive
    if (mob.aiState === "dead") {
      return null;
    }

    // Check player is alive (has HP > 0)
    const playerStats = this.getPlayerStats(sessionId);

    this.playerAttackCooldowns.set(sessionId, now);

    const events: CombatEvent[] = [];

    // Calculate damage (real player level drives the multiplier)
    const damage = calculateDamage(playerStats.attack, playerLevel, mob.config.baseDefense);

    // Apply damage to mob
    mob.currentHp = Math.max(0, mob.currentHp - damage);

    events.push({
      type: "damage_dealt",
      sourceId: sessionId,
      targetId: mob.id,
      damage,
      currentHp: mob.currentHp,
      maxHp: mob.maxHp,
    });

    // Check mob death
    if (mob.currentHp <= 0) {
      mob.aiState = "dead";
      mob.deathTime = now;
      mob.aggroTarget = null;

      events.push({
        type: "mob_killed",
        sourceId: sessionId,
        targetId: mob.id,
      });

      // XP gain
      const xpGain = calculateXpGain(mob.config.level);
      playerStats.xp += xpGain;

      events.push({
        type: "xp_gained",
        sourceId: sessionId,
        targetId: mob.id,
        xp: xpGain,
      });

      // Loot roll
      const loot = rollLoot(mob.config.lootTable);
      if (loot.length > 0) {
        events.push({
          type: "loot_dropped",
          sourceId: sessionId,
          targetId: mob.id,
          loot,
        });
      }
    }

    return events;
  }
}
