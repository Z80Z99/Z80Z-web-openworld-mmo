import { describe, it, expect, vi } from "vitest";
import { PlayerState, EntityState } from "@mmo/shared";
import { applyLevelUps, resolveMobKill } from "./CombatEffects.js";
import {
  MOB_TYPES,
  calculateXpGain,
  createDefaultPlayerStats,
  type MobInstance,
} from "./CombatSystem.js";

/* ── Test doubles (minimal structural fakes �?no mocking library) ── */

interface WireEvent {
  type: string;
  [key: string]: unknown;
}

function makeWolfMob(overrides: Partial<MobInstance> = {}): MobInstance {
  const wolf = MOB_TYPES["wolf"];
  return {
    id: "mob_1",
    typeId: "wolf",
    config: wolf,
    x: 10,
    y: 10,
    currentHp: wolf.baseHp,
    maxHp: wolf.baseHp,
    aggroTarget: null,
    aiState: "idle",
    patrolTarget: null,
    spawnX: 10,
    spawnY: 10,
    chunkX: 0,
    chunkY: 0,
    deathTime: 0,
    lastAttackTime: 0,
    lastCombatTime: 0,
    synced: false,
    ...overrides,
  };
}

interface FakeRoom {
  state: {
    entities: Map<string, EntityState>;
    players: Map<string, PlayerState>;
  };
  clients: {
    getById: (id: string) => { send: (channel: string, payload: WireEvent) => void } | undefined;
  };
}

function makeFakeRoom(): { room: FakeRoom; sent: Array<{ channel: string; payload: WireEvent }> } {
  const sent: Array<{ channel: string; payload: WireEvent }> = [];
  const room: FakeRoom = {
    state: {
      entities: new Map<string, EntityState>(),
      players: new Map<string, PlayerState>(),
    },
    clients: {
      getById: () => ({
        send: (channel: string, payload: WireEvent) => {
          sent.push({ channel, payload });
        },
      }),
    },
  };
  return { room, sent };
}

/* ── resolveMobKill ── */

describe("resolveMobKill", () => {
  it("marks the mob dead and emits exactly one authoritative mob_killed + xp + loot", () => {
    const { room, sent } = makeFakeRoom();
    const mob = makeWolfMob({ aggroTarget: "s1" });
    const entity = new EntityState();
    entity.id = mob.id;
    entity.type = mob.typeId;
    entity.health = mob.currentHp;
    room.state.entities.set(mob.id, entity);

    const player = new PlayerState();
    const playerStats = createDefaultPlayerStats();
    const inventory = new Map<string, number>();
    const saved: Array<Map<string, number>> = [];
    const ctx = {
      room: room as unknown as Parameters<typeof resolveMobKill>[0]["room"],
      mob,
      player,
      playerStats,
      sessionId: "s1",
      getPlayerInventory: () => inventory,
      savePlayerInventory: (_pid: string, inv: Map<string, number>) => {
        saved.push(inv);
      },
      getAuthData: () => ({ playerId: "acc-1" }),
    };

    // Force every loot roll to succeed (drop rates + 30% gate all pass).
    const rng = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      resolveMobKill(ctx);
    } finally {
      rng.mockRestore();
    }

    // Mob is dead.
    expect(mob.aiState).toBe("dead");
    expect(mob.currentHp).toBe(0);
    expect(mob.deathTime).toBeGreaterThan(0);
    expect(mob.aggroTarget).toBeNull();
    // Schema entity health is zeroed via the shared event application path.
    expect(entity.health).toBe(0);

    // Exactly one mob_killed is sent to the client.
    const kills = sent.filter((m) => m.channel === "combat_event" && m.payload.type === "mob_killed");
    expect(kills).toHaveLength(1);

    // XP awarded from the single authoritative formula.
    const xpEvent = sent.find((m) => m.payload.type === "xp_gained");
    expect(xpEvent).toBeDefined();
    expect(xpEvent!.payload.xp).toBe(calculateXpGain(mob.config.level));
    expect(playerStats.xp).toBe(calculateXpGain(mob.config.level));

    // Loot persisted through the inventory callbacks.
    const lootEvent = sent.find((m) => m.payload.type === "loot_dropped");
    expect(lootEvent).toBeDefined();
    expect(saved.length).toBe(1);
    for (const entry of mob.config.lootTable) {
      expect(inventory.get(entry.itemId)).toBe(1);
    }

    // No level-up yet (slime-level XP far below the 100 threshold).
    expect(sent.filter((m) => m.payload.type === "level_up")).toHaveLength(0);
  });

  it("does not award or persist loot when the global gate blocks all drops", () => {
    const { room, sent } = makeFakeRoom();
    const mob = makeWolfMob();
    const entity = new EntityState();
    entity.id = mob.id;
    entity.health = mob.currentHp;
    room.state.entities.set(mob.id, entity);

    const player = new PlayerState();
    const playerStats = createDefaultPlayerStats();
    const inventory = new Map<string, number>();
    const saved: Array<Map<string, number>> = [];
    const ctx = {
      room: room as unknown as Parameters<typeof resolveMobKill>[0]["room"],
      mob,
      player,
      playerStats,
      sessionId: "s1",
      getPlayerInventory: () => inventory,
      savePlayerInventory: (_pid: string, inv: Map<string, number>) => {
        saved.push(inv);
      },
      getAuthData: () => ({ playerId: "acc-1" }),
    };

    // Every roll fails: no item passes its drop rate, so nothing persists.
    const rng = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      resolveMobKill(ctx);
    } finally {
      rng.mockRestore();
    }

    expect(sent.some((m) => m.payload.type === "loot_dropped")).toBe(false);
    expect(saved).toHaveLength(0);
    expect(sent.filter((m) => m.payload.type === "mob_killed")).toHaveLength(1);
  });
});

/* ── applyLevelUps ── */

describe("applyLevelUps", () => {
  it("applies the existing level-up progression and emits level_up with exact fields", () => {
    const { room, sent } = makeFakeRoom();
    const player = new PlayerState();
    player.health = 50;
    player.maxHealth = 100;
    player.level = 1;
    const playerStats = createDefaultPlayerStats();
    playerStats.xp = 150; // crosses the 100 threshold once

    const ctx = {
      room: room as unknown as Parameters<typeof applyLevelUps>[0]["room"],
      player,
      playerStats,
      sessionId: "s1",
    };

    applyLevelUps(ctx);

    // Stats progression matches the inline loops in both reward paths.
    expect(playerStats.xp).toBe(50);
    expect(player.level).toBe(2);
    expect(playerStats.attack).toBe(12);
    expect(playerStats.defense).toBe(6);
    expect(playerStats.xpToNextLevel).toBe(200);
    expect(player.maxHealth).toBe(120);
    expect(player.health).toBe(120);

    // Schema player state synchronized.
    expect(player.xp).toBe(50);
    expect(player.xpToNextLevel).toBe(200);

    // Exactly one level_up with the exact payload fields.
    const ups = sent.filter((m) => m.payload.type === "level_up");
    expect(ups).toHaveLength(1);
    expect(ups[0].payload.level).toBe(2);
    expect(ups[0].payload.attack).toBe(12);
    expect(ups[0].payload.defense).toBe(6);
    expect(ups[0].payload.currentHp).toBe(120);
    expect(ups[0].payload.maxHp).toBe(120);
  });

  it("chains multiple level-ups when XP crosses several thresholds", () => {
    const { room, sent } = makeFakeRoom();
    const player = new PlayerState();
    player.level = 1;
    const playerStats = createDefaultPlayerStats();
    playerStats.xp = 100 * 1 + 100 * 2 + 37; // crosses thresholds for levels 2 and 3

    const ctx = {
      room: room as unknown as Parameters<typeof applyLevelUps>[0]["room"],
      player,
      playerStats,
      sessionId: "s1",
    };

    applyLevelUps(ctx);

    expect(player.level).toBe(3);
    expect(playerStats.xp).toBe(37);
    expect(playerStats.xpToNextLevel).toBe(300);
    expect(sent.filter((m) => m.payload.type === "level_up")).toHaveLength(2);
  });
});
