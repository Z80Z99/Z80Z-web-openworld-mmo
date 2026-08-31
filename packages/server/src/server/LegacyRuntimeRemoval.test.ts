import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BattleGroup, CombatPoint, WorldHealthWriter, WorldGenerator } from "@mmo/shared";
import { BATTLE_MOB_TURN_DELAY_MS, CHUNK_SIZE, TileType } from "@mmo/shared";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import {
  CombatSystem,
  calculateDamage,
  type MobInstance,
  type MobTypeConfig,
} from "./CombatSystem.js";
import { MobSpawner } from "./MobSpawner.js";
import { GameLoop } from "./GameLoop.js";
import {
  routeRealtimeAttack,
  routeEncounterDefend,
  tickCombatEnemyTurns,
  releaseMobCombatState,
  type ProductionCombatDeps,
  type CombatPlayerView,
} from "./ProductionCombatRouter.js";

/**
 * Phase 3I-3B: Legacy Runtime Removal (LR-001..018).
 *
 * Proves the Legacy EncounterSystem / ENABLE_BATTLE_COMBAT removal is complete
 * and the New Battle/Combat stack is the sole combat path:
 *
 *  - LR-001..009  STATIC SCANS over packages/server/src/server non-test .ts
 *                 files (comment text is stripped so the removal-documentation
 *                 comments in ProductionCombatRouter.ts /
 *                 ProductionMultiParticipantCombat.ts / BattleCombatBridge.ts do
 *                 not trip the "no token" proof — only live code is scanned).
 *  - LR-010..016  RUNTIME: GameLoop.tick drives CombatSessions unconditionally,
 *                 routeRealtimeAttack never falls back for a valid player,
 *                 MobSpawner stops at attack range without encounter state,
 *                 releaseMobCombatState resets only aggro+aiState, and neither
 *                 GameLoop nor MobInstance carry legacy fields.
 *  - LR-017..018  MIGRATED defend behavior: defend sets defending=true and
 *                 advances the turn; the mob's next hit deals FULL
 *                 calculateDamage damage (New Combat has no damage-halving).
 */

/* ═══════════════════════════════════════════════════════
 * Static-scan infrastructure (comment-stripped code only)
 * ═══════════════════════════════════════════════════════ */

/** Absolute path to this test's directory (packages/server/src/server). */
const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Remove /* * / and // comments so the scan proves "no live code reference". */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*$/gm, "$1");
}

/** All non-test .ts file paths directly under src/server. */
function serverSourceFiles(): string[] {
  return readdirSync(SERVER_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(SERVER_DIR, f));
}

/** Comment-stripped concatenation of every non-test server .ts file. */
function allServerSource(): string {
  return serverSourceFiles()
    .map((f) => stripComments(readFileSync(f, "utf8")))
    .join("\n");
}

/* ═══════════════════════════════════════════════════════
 * Combat harness (mirrors ProductionMultiParticipantCombat.test.ts)
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

/** The current 18-field MobInstance shape — no inEncounter/pendingEncounterTarget. */
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
  const mob = makeMob(id, hp, hp !== 30 ? { baseHp: hp } : {});
  mob.x = x;
  mob.y = y;
  w.mobs.set(id, mob);
  w.entities.set(id, { health: hp, maxHealth: mob.maxHp });
  return mob;
}

/** Drive the mob's enemy turn: X attacks, turn wraps back to the player. */
function driveRoundBoundary(w: World, now = Date.now()): void {
  tickCombatEnemyTurns(w.deps, now + BATTLE_MOB_TURN_DELAY_MS);
}

/* ═══════════════════════════════════════════════════════
 * GameLoop construction harness (mocks for room/db/aoi only)
 * ═══════════════════════════════════════════════════════ */

function makeGrassWorldGen(): WorldGenerator {
  const tiles: TileType[][] = Array.from({ length: CHUNK_SIZE }, () =>
    Array.from({ length: CHUNK_SIZE }, () => TileType.Grass),
  );
  return { generateChunk: () => ({ tiles }) } as unknown as WorldGenerator;
}

function makeLoop(): { loop: GameLoop; bm: BattleManager; cm: CombatManager } {
  const bm = new BattleManager();
  const cm = new CombatManager();
  const bridge = new BattleCombatBridge(bm, cm);
  const room = {
    state: { players: new Map(), entities: new Map(), tiles: new Map() },
    clients: { getById: () => undefined },
    setSimulationInterval: () => {},
  } as any;
  const db = { prepare: () => ({ run: () => {} }) } as any;
  const aoi = {} as any;
  const movementSystem = { drainQueue: () => [], processMovement: () => ({ valid: false }) } as any;
  const mobSpawner = new MobSpawner({} as unknown as WorldGenerator);
  const loop = new GameLoop(room, db, aoi, movementSystem, mobSpawner, bm, cm, bridge);
  return { loop, bm, cm };
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Phase 3I-3B: Legacy Runtime Removal", () => {
  /* ── Static-scan tier ── */

  it("LR-001: no EncounterSystem token in non-test server files", () => {
    expect(allServerSource()).not.toContain("EncounterSystem");
  });

  it("LR-002: no ENABLE_BATTLE_COMBAT / isBattleCombatEnabled token", () => {
    const src = allServerSource();
    expect(src).not.toContain("ENABLE_BATTLE_COMBAT");
    expect(src).not.toContain("isBattleCombatEnabled");
  });

  it("LR-003: no tickEncounters token", () => {
    expect(allServerSource()).not.toContain("tickEncounters");
  });

  it("LR-004: no ENCOUNTER_ENGAGE_RANGE token", () => {
    expect(allServerSource()).not.toContain("ENCOUNTER_ENGAGE_RANGE");
  });

  it("LR-005: no pendingEncounterTarget token", () => {
    expect(allServerSource()).not.toContain("pendingEncounterTarget");
  });

  it("LR-006: no inEncounter field reference", () => {
    // "inEncounter" is a substring of the New Combat method beginEncounter
    // (beg + inEncounter), so match only the legacy FIELD reference — an
    // `inEncounter` preceded by a non-identifier char (`.inEncounter`,
    // `inEncounter:`, `inEncounter =`, bare `inEncounter` at a line start).
    expect(allServerSource()).not.toMatch(/(^|[^A-Za-z0-9_])inEncounter/m);
  });

  it('LR-007: no "fighting" aiState literal', () => {
    expect(allServerSource()).not.toContain('"fighting"');
  });

  it("LR-008: GameRoom.ts has no legacy encounter handler accessor", () => {
    const gameRoom = stripComments(readFileSync(join(SERVER_DIR, "GameRoom.ts"), "utf8"));
    expect(gameRoom).not.toContain("encounterSystem.");
    expect(gameRoom).not.toContain("endEncounterForMob");
    expect(gameRoom).not.toContain("playerAction");
  });

  it("LR-009: EncounterSystem.ts file does not exist", () => {
    expect(existsSync(join(SERVER_DIR, "EncounterSystem.ts"))).toBe(false);
  });

  /* ── Runtime tier ── */

  it("LR-010: GameLoop.tick advances CombatSessions unconditionally", () => {
    const { loop, cm } = makeLoop();
    const created = cm.createCombatSession("combat-lr010", "battle-lr010", [
      { participantId: "p1", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      { participantId: "e1", side: "enemy", currentHp: 80, maxHp: 80, initiative: 8, alive: true, defending: false },
    ]);
    expect("error" in created).toBe(false);

    // No flag gates the combat tick: a single tick must evaluate the session.
    const spy = vi.spyOn(cm, "evaluateTurnTimeout");
    loop.tick(1000);
    expect(spy).toHaveBeenCalled();
  });

  it("LR-011: routeRealtimeAttack is never fallback for a valid player+mob", () => {
    const w = makeWorld();
    addPlayer(w, "player-A");
    addPlayer(w, "player-B");
    const x = addMob(w, "mob-X");

    const allowed = ["blocked", "joined", "combat"] as const;
    const r1 = routeRealtimeAttack(w.deps, "player-A", x);
    expect(allowed).toContain(r1.kind);
    expect(r1.kind).toBe("combat"); // primary New-Combat path
    const r2 = routeRealtimeAttack(w.deps, "player-B", x); // join as pending
    expect(allowed).toContain(r2.kind);
    expect(r2.kind).toBe("joined");
    const r3 = routeRealtimeAttack(w.deps, "player-A", x); // already a participant
    expect(allowed).toContain(r3.kind);
    expect(r3.kind).toBe("blocked");

    // With a valid player present, creation never fails → never fallback.
    expect([r1.kind, r2.kind, r3.kind]).not.toContain("fallback");
  });

  it("LR-012: MobSpawner.tick at attack range stops the mob, writes no encounter state", () => {
    const spawner = new MobSpawner(makeGrassWorldGen());
    const spawned = spawner.spawnMobsForChunk(0, 0);
    expect(spawned.length).toBeGreaterThan(0);
    const mob = spawned[0];

    // Aggro set, player standing on the mob → dist 0 <= MOB_ATTACK_RANGE (1.5).
    mob.x = 10;
    mob.y = 10;
    mob.aggroTarget = "p1";
    mob.aiState = "chase";
    const players = new Map<string, { x: number; y: number; health: number }>([
      ["p1", { x: 10, y: 10, health: 100 }],
    ]);
    const beforeX = mob.x;
    const beforeY = mob.y;

    spawner.tick(0.1, players, Date.now());

    expect(mob.x).toBe(beforeX); // stopped at attack range (no movement)
    expect(mob.y).toBe(beforeY);
    expect(mob.aiState).not.toBe("fighting"); // "fighting" is not a valid aiState
    expect("inEncounter" in mob).toBe(false); // no encounter state written
    expect("pendingEncounterTarget" in mob).toBe(false);
  });

  it("LR-013: releaseMobCombatState resets aggro + aiState and touches no legacy fields", () => {
    const bm = new BattleManager();
    const created = bm.createBattle(
      "battle-lr013",
      { id: "p1", position: point(0, 0), combatPower: 10, personality: "aggressive", state: "ACTIVE" },
      { id: "mob-1", position: point(1, 0), combatPower: 5, personality: "aggressive", state: "ACTIVE" },
    );
    expect("error" in created).toBe(false);
    const battle = created.battle;

    const mob = makeMob("mob-1", 30);
    mob.aggroTarget = "p1";
    mob.aiState = "chase";
    const deps = { getMob: (id: string) => (id === "mob-1" ? mob : undefined) };

    releaseMobCombatState(deps, battle);

    expect(mob.aggroTarget).toBeNull();
    expect(mob.aiState).toBe("idle");
    // Compile-level: the legacy fields no longer exist on MobInstance.
    expect("inEncounter" in mob).toBe(false);
    expect("pendingEncounterTarget" in mob).toBe(false);
  });

  it("LR-014: createGameLoop signature has no encounterSystem/combatSystem params", () => {
    const loopSrc = stripComments(readFileSync(join(SERVER_DIR, "GameLoop.ts"), "utf8"));
    expect(loopSrc).not.toContain("encounterSystem");
    expect(loopSrc).not.toContain("combatSystem");
    // 9 params (8 required + optional productionCombatDeps), never more.
    expect(GameLoop.length).toBeLessThanOrEqual(9);
  });

  it("LR-015: runtime MobInstance has no inEncounter/pendingEncounterTarget keys", () => {
    const mob = makeMob("mob-1", 30);
    expect("inEncounter" in mob).toBe(false);
    expect("pendingEncounterTarget" in mob).toBe(false);
  });

  it("LR-016: GameLoop instance has no encounterSystem/combatSystem properties", () => {
    const { loop } = makeLoop();
    expect("encounterSystem" in loop).toBe(false);
    expect("combatSystem" in loop).toBe(false);
  });

  /* ── Migrated defend tests (New Combat has NO damage-halving) ── */

  it("LR-017: defend sets participant defending=true and advances the turn", () => {
    const w = makeWorld();
    addPlayer(w, "player-A");
    addMob(w, "mob-X");
    routeRealtimeAttack(w.deps, "player-A", w.mobs.get("mob-X")!); // A's hit, turn → X
    driveRoundBoundary(w); // X attacks → turn back to A
    const battle = w.bm.getBattleByParticipant("player-A")!.battle;
    let session = w.cm.getCombatSessionByBattle(battle.id)!;
    expect(session.currentActorId).toBe("player-A");

    const r = routeEncounterDefend({ battleManager: w.bm, combatManager: w.cm }, "player-A");
    expect(r.kind).toBe("combat");
    session = w.cm.getCombatSessionByBattle(battle.id)!;
    expect(session.participants.find((p) => p.participantId === "player-A")!.defending).toBe(true);
    expect(session.currentActorId).toBe("mob-X"); // advanced
  });

  it("LR-018: mob's next hit after defend deals FULL calculateDamage damage (no halving)", () => {
    const w = makeWorld();
    addPlayer(w, "player-A"); // attack 10, defense 5, level 1
    const x = addMob(w, "mob-X");
    // baseAttack 14 → full mob→player damage = calculateDamage(14,1,5) = 10,
    // so a (buggy) damage-halving defend would be visibly wrong (5 ≠ 10).
    x.config.baseAttack = 14;
    routeRealtimeAttack(w.deps, "player-A", x); // A hits X, turn → X
    driveRoundBoundary(w); // X hits A for 10 (full), turn → A

    // A defends → defending=true, turn → X
    const r = routeEncounterDefend({ battleManager: w.bm, combatManager: w.cm }, "player-A");
    expect(r.kind).toBe("combat");
    const session = w.cm.getCombatSessionByBattle(
      w.bm.getBattleByParticipant("player-A")!.battle.id,
    )!;
    expect(session.currentActorId).toBe("mob-X");

    const expected = calculateDamage(x.config.baseAttack, x.config.level, 5);
    const hpBefore = w.players.get("player-A")!.health;
    tickCombatEnemyTurns(w.deps, Date.now() + BATTLE_MOB_TURN_DELAY_MS);
    const hpAfter = w.players.get("player-A")!.health;

    // Full damage applied — never halved by the defending flag.
    expect(hpBefore - hpAfter).toBe(expected);
    const damaged = w.events.filter((e) => e.type === "player_damaged");
    expect(damaged[damaged.length - 1]!.damage).toBe(expected);
  });
});
