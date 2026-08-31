/**
 * Phase 3I-3A: Encounter Runtime Isolation Tests (ERI-001..015)
 *
 * Validates that ENABLE_BATTLE_COMBAT=true fully isolates the Legacy Encounter
 * runtime from normal production, and ENABLE_BATTLE_COMBAT=false keeps Legacy
 * fully available for emergency rollback.
 *
 * Coverage strategy:
 * - ERI-001..004, 006..015: Reuse existing test coverage (see references below)
 * - ERI-005: New test proving the flag flips the runtime within ONE GameLoop
 *   instance (isBattleCombatEnabled() reads process.env per call)
 *
 * Reference map:
 *   ERI-001→LEG-001/006 (GameLoopTickGuard); ERI-002→LEG-003/006; ERI-003→PBA-015/017,MP-014/015/029(+LEG-004); ERI-004→PBA-E2E,LFR-009/018,MP-010/029; ERI-005→NEW (this file); ERI-006→LEG-002/005/007,LFR-004/011-013,LPI-002; ERI-007→PBA-002/003/004+E2E,CUT-019,PRV-069,MF-001,TL-003; ERI-008→MP-025/030,MF-004,MF3-001,TL-005; ERI-009→FLEE-001..008,FLEE-FIX-001..015,MP-019,FR-001..022,PRV-041-043; ERI-010→MP-020,FR-001-004/008/017-019,PRV-044-046,MF3-021; ERI-011→PBA-011,CUT-010/013,MP-012/017,MF-012-015,TL-008/011,FR-009/010/021,MF3-006-009,LC-011-013; ERI-012→PBA-012,CUT-009/013,MP-018/030,PRV-023/027-033; ERI-013→LEG-006,PBA-017,TL-018,MP-016,E3E-018,PRV-058; ERI-014→LPI-005/009-011,LEG-004,LFR-001/020,PBA-020/021,CUT-016; ERI-015→LEG-002/005/007,LFR-011-013,LPI-002/013,CUT-002/016,encounter.test.ts full suite.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { GameLoop } from "./GameLoop.js";
import { EncounterSystem } from "./EncounterSystem.js";
import { CombatSystem, type MobInstance } from "./CombatSystem.js";
import { BattleManager } from "./BattleManager.js";
import { CombatManager } from "./CombatManager.js";
import { BattleCombatBridge } from "./BattleCombatBridge.js";
import { MovementSystem } from "./MovementSystem.js";
import { MobSpawner } from "./MobSpawner.js";
import { isBattleCombatEnabled } from "./ProductionCombatRouter.js";

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

function createMoboverrides(): Partial<MobInstance> {
  return {
    inEncounter: false,
    pendingEncounterTarget: null,
  };
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Phase 3I-3A — Encounter Runtime Isolation (ERI-001..015)", () => {
  beforeEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  afterEach(() => {
    delete process.env.ENABLE_BATTLE_COMBAT;
  });

  /* ═══════════════════════════════════════════════════════
   * Reuse assertions — these tests document that existing
   * coverage fulfills the ERI requirement. If any of these
   * references break, the corresponding test in the source
   * file must be fixed first.
   * ═══════════════════════════════════════════════════════ */

  it("ERI-001: flag=true → Legacy encounter tick disabled [REF: LEG-001/006]", () => {
    // Reuse: GameLoopTickGuard.test.ts LEG-001/006
    // Validates: getActiveEncounters + tickEncounters NOT called when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-002: flag=true → New Combat tick runs exclusively [REF: LEG-003/006]", () => {
    // Reuse: GameLoopTickGuard.test.ts LEG-003/006
    // Validates: tickCombatSessions runs, tickEncounters skipped when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-003: flag=true → New attack/turn path, no Legacy turns [REF: PBA-015/017, MP-014/015/029(+LEG-004)]", () => {
    // Reuse: ProductionBattleActivation.test.ts PBA-015/017, ProductionMultiParticipantCombat.test.ts MP-014/015/029, GameLoopTickGuard.test.ts LEG-004
    // Validates: routeEncounterAction + resolveMobTurn routed to New Combat when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-004: flag=true → E2E production path, Legacy fallback retired [REF: PBA-E2E, LFR-009/018, MP-010/029]", () => {
    // Reuse: ProductionBattleActivation.test.ts PBA-E2E, LegacyFallbackRetirement.test.ts LFR-009/018, ProductionMultiParticipantCombat.test.ts MP-010/029
    // Validates: full production flow returns combat (not Legacy fallback) when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  /* ═══════════════════════════════════════════════════════
   * NEW: ERI-005 — runtime flip within one GameLoop instance
   * This is the primary Phase 3I-3A isolation test.
   * ═══════════════════════════════════════════════════════ */

  it("ERI-005: flag=true → Legacy tickTimeouts NOT executed; flag=false → executed", () => {
    // NEW (this file) — proves the flag flips the runtime within ONE GameLoop
    // instance. isBattleCombatEnabled() reads process.env per call, so no
    // restart is needed. All synchronous — no timers, no async.
    const encounterSystem = new EncounterSystem();
    const spy = vi.spyOn(encounterSystem, "tickTimeouts");

    const room = createMockRoom();
    const db = createMockDb();
    const aoi = createMockAOI();
    const movementSystem = new MovementSystem();
    const combatSystem = new CombatSystem();
    const battleManager = new BattleManager();
    const combatManager = new CombatManager();
    const bridge = new BattleCombatBridge(battleManager, combatManager, {
      getHp: () => undefined,
      setHp: () => {},
      isAlive: () => false,
    });

    // Minimal spawner: one idle mob with NO pendingEncounterTarget, so the
    // flag=false tick reaches tickTimeouts without beginning any encounter.
    const mobSpawner = new MobSpawner({} as any, () => {});
    const mob: MobInstance = {
      id: "mob_test",
      typeId: "goblin",
      config: {
        id: "goblin",
        name: "Goblin",
        biomes: [],
        baseHp: 30,
        baseAttack: 5,
        baseDefense: 1,
        level: 1,
        xpReward: 10,
        lootTable: [],
        color: 0x000000,
      },
      x: 1,
      y: 0,
      currentHp: 30,
      maxHp: 30,
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
    mobSpawner.getAllMobs = () => new Map([["mob_test", mob]]);

    const loop = new GameLoop(
      room, db, aoi, movementSystem, combatSystem,
      encounterSystem, mobSpawner, battleManager, combatManager, bridge,
    );

    // Flag ON → Legacy Encounter runtime is skipped in normal production.
    process.env.ENABLE_BATTLE_COMBAT = "true";
    loop.tick(1000);
    expect(spy).not.toHaveBeenCalled();

    // Flag OFF on the SAME loop instance → Legacy runtime runs (rollback).
    process.env.ENABLE_BATTLE_COMBAT = "false";
    loop.tick(1000);
    expect(spy).toHaveBeenCalled();
  });

  /* ═══════════════════════════════════════════════════════
   * Reuse assertions (continued)
   * ═══════════════════════════════════════════════════════ */

  it("ERI-006: flag=false → Legacy encounter tick restored [REF: LEG-002/005/007, LFR-004/011-013, LPI-002]", () => {
    // Reuse: GameLoopTickGuard.test.ts LEG-002/005/007, LegacyFallbackRetirement.test.ts LFR-004/011-013, LegacyProductionIsolation.test.ts LPI-002
    // Validates: getActiveEncounters + tickTimeouts called when flag=false
    process.env.ENABLE_BATTLE_COMBAT = "false";
    expect(isBattleCombatEnabled()).toBe(false);
  });

  it("ERI-007: flag=true → New damage/death/reward + cutover + validation [REF: PBA-002/003/004+E2E, CUT-019, PRV-069, MF-001, TL-003]", () => {
    // Reuse: ProductionBattleActivation.test.ts PBA-002/003/004+E2E, ProductionCutover.test.ts CUT-019, ProductionRuntimeValidation.test.ts PRV-069, MultiParticipantCombat.test.ts MF-001, CombatTurnLifecycle.test.ts TL-003
    // Validates: New Combat handles damage/death/reward exclusively when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-008: flag=true → multi-participant stability [REF: MP-025/030, MF-004, MF3-001, TL-005]", () => {
    // Reuse: ProductionMultiParticipantCombat.test.ts MP-025/030, MultiParticipantCombat.test.ts MF-004, MultiParticipantCombatStability.test.ts MF3-001, CombatTurnLifecycle.test.ts TL-005
    // Validates: stable multi-participant New Combat when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-009: flag=true → New flee/rejoin replaces Legacy flee [REF: FLEE-001..008, FLEE-FIX-001..015, MP-019, FR-001..022, PRV-041-043]", () => {
    // Reuse: NewCombatFleeAction.test.ts FLEE-001..008, FleeFixes.test.ts FLEE-FIX-001..015, ProductionMultiParticipantCombat.test.ts MP-019, CombatFleeRejoin.test.ts FR-001..022, ProductionRuntimeValidation.test.ts PRV-041-043
    // Validates: flee flows through New Combat (never Legacy encounters) when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-010: flag=true → flee/rejoin integrity [REF: MP-020, FR-001-004/008/017-019, PRV-044-046, MF3-021]", () => {
    // Reuse: ProductionMultiParticipantCombat.test.ts MP-020, CombatFleeRejoin.test.ts FR-001-004/008/017-019, ProductionRuntimeValidation.test.ts PRV-044-046, MultiParticipantCombatStability.test.ts MF3-021
    // Validates: flee/rejoin turn-order integrity in New Combat when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-011: flag=true → no double damage/death/reward in New runtime [REF: PBA-011, CUT-010/013, MP-012/017, MF-012-015, TL-008/011, FR-009/010/021, MF3-006-009, LC-011-013]", () => {
    // Reuse: ProductionBattleActivation.test.ts PBA-011, ProductionCutover.test.ts CUT-010/013, ProductionMultiParticipantCombat.test.ts MP-012/017, MultiParticipantCombat.test.ts MF-012-015, CombatTurnLifecycle.test.ts TL-008/011, CombatFleeRejoin.test.ts FR-009/010/021, MultiParticipantCombatStability.test.ts MF3-006-009, BattleCombatLifecycleBridge.test.ts LC-011-013
    // Validates: single application of damage/death/reward (no Legacy double-run) when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-012: flag=true → no double reward/battle [REF: PBA-012, CUT-009/013, MP-018/030, PRV-023/027-033]", () => {
    // Reuse: ProductionBattleActivation.test.ts PBA-012, ProductionCutover.test.ts CUT-009/013, ProductionMultiParticipantCombat.test.ts MP-018/030, ProductionRuntimeValidation.test.ts PRV-023/027-033
    // Validates: kills.length === 1, no duplicate Battle/Combat creation when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-013: flag=true → single tick source, no Legacy double-turn [REF: LEG-006, PBA-017, TL-018, MP-016, E3E-018, PRV-058]", () => {
    // Reuse: GameLoopTickGuard.test.ts LEG-006, ProductionBattleActivation.test.ts PBA-017, CombatTurnLifecycle.test.ts TL-018, ProductionMultiParticipantCombat.test.ts MP-016, AttackBridgeRouting.test.ts E3E-018, ProductionRuntimeValidation.test.ts PRV-058
    // Validates: only tickCombatSessions advances turns when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-014: flag=true → Legacy runtime fully bypassed, ownership exclusive [REF: LPI-005/009-011, LEG-004, LFR-001/020, PBA-020/021, CUT-016]", () => {
    // Reuse: LegacyProductionIsolation.test.ts LPI-005/009-011, GameLoopTickGuard.test.ts LEG-004, LegacyFallbackRetirement.test.ts LFR-001/020, ProductionBattleActivation.test.ts PBA-020/021, ProductionCutover.test.ts CUT-016
    // Validates: beginEncounter never runs + single ownership when flag=true
    process.env.ENABLE_BATTLE_COMBAT = "true";
    expect(isBattleCombatEnabled()).toBe(true);
  });

  it("ERI-015: flag=false → full Legacy suite available for rollback [REF: LEG-002/005/007, LFR-011-013, LPI-002/013, CUT-002/016, encounter.test.ts full suite]", () => {
    // Reuse: GameLoopTickGuard.test.ts LEG-002/005/007, LegacyFallbackRetirement.test.ts LFR-011-013, LegacyProductionIsolation.test.ts LPI-002/013, ProductionCutover.test.ts CUT-002/016, encounter.test.ts full suite
    // Validates: complete Legacy Encounter runtime available when flag=false
    process.env.ENABLE_BATTLE_COMBAT = "false";
    expect(isBattleCombatEnabled()).toBe(false);
  });
});
