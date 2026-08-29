/**
 * Phase 3H.1: Legacy Encounter Tick Guard Tests (LEG-001..007)
 *
 * Validates:
 * - tickEncounters is skipped when ENABLE_BATTLE_COMBAT=true
 * - tickEncounters runs when ENABLE_BATTLE_COMBAT=false
 * - tickCombatSessions always runs (New Combat)
 * - No double turns when flag is ON
 * - Legacy timeout still works when flag is OFF
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { GameLoop, createGameLoop } from "./GameLoop.js";
import { EncounterSystem } from "./EncounterSystem.js";
import { CombatSystem } from "./CombatSystem.js";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import { MovementSystem } from "./MovementSystem.js";
import { MobSpawner } from "./MobSpawner.js";

/* ═══════════════════════════════════════════════════════
 * Mock Room (minimal Colyseus Room stub)
 * ═══════════════════════════════════════════════════════ */

function createMockRoom() {
  return {
    state: {
      players: new Map(),
      entities: new Map(),
    },
    clients: {
      getById: () => null,
    },
    setSimulationInterval: vi.fn(),
  } as any;
}

function createMockDb() {
  return {} as any;
}

function createMockAOI() {
  return {
    getVisibleChunks: () => [],
    getVisibleEntities: () => [],
  } as any;
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Phase 3H.1 — Legacy Encounter Tick Guard", () => {
  beforeEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  afterEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  /* ── LEG-001: flag=true → tickEncounters skipped ── */

  it("LEG-001: flag=true → tickEncounters skipped", () => {
    process.env.ENABLE_BATTLE_COMBAT = "true";

    const encounterSystem = new EncounterSystem();
    const spy = vi.spyOn(encounterSystem, "getActiveEncounters");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const combatManager = new CombatManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    // Trigger tick (setSimulationInterval is mocked, so call tick directly)
    // The tick method is public, so we can call it
    loop.tick(1000);

    // getActiveEncounters should NOT be called when flag is ON
    expect(spy).not.toHaveBeenCalled();
  });

  /* ── LEG-002: flag=false → tickEncounters runs ── */

  it("LEG-002: flag=false → tickEncounters runs", () => {
    process.env.ENABLE_BATTLE_COMBAT = "false";

    const encounterSystem = new EncounterSystem();
    const spy = vi.spyOn(encounterSystem, "getActiveEncounters");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const combatManager = new CombatManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    loop.tick(1000);

    // getActiveEncounters SHOULD be called when flag is OFF
    expect(spy).toHaveBeenCalled();
  });

  /* ── LEG-003: flag=true → New Combat tick still runs ── */

  it("LEG-003: flag=true → New Combat tickCombatSessions still runs", () => {
    process.env.ENABLE_BATTLE_COMBAT = "true";

    const combatManager = new CombatManager();
    const spy = vi.spyOn(combatManager, "getActiveSessions");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const encounterSystem = new EncounterSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    loop.tick(1000);

    // tickCombatSessions calls getActiveSessions — should be called
    expect(spy).toHaveBeenCalled();
  });

  /* ── LEG-004: flag=true → no Legacy combat turn ── */

  it("LEG-004: flag=true → no Legacy combat turn via resolveMobTurn", () => {
    process.env.ENABLE_BATTLE_COMBAT = "true";

    const encounterSystem = new EncounterSystem();
    const spy = vi.spyOn(encounterSystem, "resolveMobTurn");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const combatManager = new CombatManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    loop.tick(1000);

    // resolveMobTurn should NOT be called when flag is ON
    expect(spy).not.toHaveBeenCalled();
  });

  /* ── LEG-005: flag=false → Legacy timeout still works ── */

  it("LEG-005: flag=false → tickTimeouts still works", () => {
    process.env.ENABLE_BATTLE_COMBAT = "false";

    const encounterSystem = new EncounterSystem();
    const spy = vi.spyOn(encounterSystem, "tickTimeouts");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const combatManager = new CombatManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    loop.tick(1000);

    // tickTimeouts SHOULD be called when flag is OFF
    expect(spy).toHaveBeenCalled();
  });

  /* ── LEG-006: flag=true → no double turn ── */

  it("LEG-006: flag=true → only tickCombatSessions, no tickEncounters", () => {
    process.env.ENABLE_BATTLE_COMBAT = "true";

    const encounterSystem = new EncounterSystem();
    const combatManager = new CombatManager();
    const encounterSpy = vi.spyOn(encounterSystem, "getActiveEncounters");
    const combatSpy = vi.spyOn(combatManager, "getActiveSessions");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    loop.tick(1000);

    // encounterSystem should NOT be ticked
    expect(encounterSpy).not.toHaveBeenCalled();
    // combatManager SHOULD be ticked
    expect(combatSpy).toHaveBeenCalled();
  });

  /* ── LEG-007: flag=false → Legacy regression ── */

  it("LEG-007: flag=false → full Legacy tick path executes", () => {
    process.env.ENABLE_BATTLE_COMBAT = "false";

    const encounterSystem = new EncounterSystem();
    const getActiveSpy = vi.spyOn(encounterSystem, "getActiveEncounters");
    const timeoutSpy = vi.spyOn(encounterSystem, "tickTimeouts");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const mobSpawner = new MobSpawner({} as any, () => {});
    const battleManager = new BattleManager();
    const combatManager = new CombatManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    loop.tick(1000);

    // Both encounter tick functions should be called when flag is OFF
    expect(getActiveSpy).toHaveBeenCalled();
    expect(timeoutSpy).toHaveBeenCalled();
  });
});
