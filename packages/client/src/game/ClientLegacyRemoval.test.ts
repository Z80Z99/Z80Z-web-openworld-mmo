/**
 * Phase 3H.6B: Client Legacy Removal Verification (CLR-001..CLR-014)
 *
 * Validates that all legacy client state has been removed while
 * preserving new Battle/Combat system, server compatibility, and
 * production functionality.
 *
 * These are ASSERTION tests — they verify the absence of legacy code
 * and the presence of required new code.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GameState } from "./GameState.js";
import { normalizeCombatEvent, buildCombatStateFromEncounter } from "../combat/CombatEventNormalizer.js";
import * as fs from "fs";
import * as path from "path";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

function makeGameState(mobId = "mob1", hp = 80, maxHp = 100): GameState {
  const gs = new GameState(42);
  gs.setLocalPlayer("p1", {
    x: 5, y: 5, health: 100, maxHealth: 100, name: "Player", level: 1,
  } as any);
  gs.addMob({ id: mobId, typeId: "goblin", x: 10, y: 10, health: hp, maxHealth: maxHp, type: "goblin" } as any);
  return gs;
}

const CLIENT_SRC = path.resolve(__dirname);

function fileExists(relativePath: string): boolean {
  const fullPath = path.join(CLIENT_SRC, "..", relativePath);
  return fs.existsSync(fullPath);
}

function fileContains(filePath: string, searchString: string): boolean {
  try {
    const fullPath = path.join(CLIENT_SRC, "..", filePath);
    const content = fs.readFileSync(fullPath, "utf-8");
    return content.includes(searchString);
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════
 * CLR-001..004: Legacy State Fields Removed
 * ═══════════════════════════════════════════════════════ */

describe("CLR-001..004: Legacy State Fields Removed", () => {
  it("CLR-001: GameState no longer has inEncounter field", () => {
    const gs = new GameState(42);
    expect((gs as any).inEncounter).toBeUndefined();
  });

  it("CLR-002: GameState no longer has encounterMobId field", () => {
    const gs = new GameState(42);
    expect((gs as any).encounterMobId).toBeUndefined();
  });

  it("CLR-003: GameState no longer has encounterMobHp/encounterMobMaxHp fields", () => {
    const gs = new GameState(42);
    expect((gs as any).encounterMobHp).toBeUndefined();
    expect((gs as any).encounterMobMaxHp).toBeUndefined();
  });

  it("CLR-004: GameState no longer has encounterTurn/encounterRound fields", () => {
    const gs = new GameState(42);
    expect((gs as any).encounterTurn).toBeUndefined();
    expect((gs as any).encounterRound).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════
 * CLR-005..007: Legacy Files Deleted
 * ═══════════════════════════════════════════════════════ */

describe("CLR-005..007: Legacy Files Deleted", () => {
  it("CLR-005: EncounterPanel.ts no longer exists", () => {
    expect(fileExists("src/ui/EncounterPanel.ts")).toBe(false);
  });

  it("CLR-006: EncounterAdapter.ts no longer exists", () => {
    expect(fileExists("src/combat/EncounterAdapter.ts")).toBe(false);
  });

  it("CLR-007: ClientLegacyDependencyAudit.test.ts no longer exists", () => {
    expect(fileExists("src/game/ClientLegacyDependencyAudit.test.ts")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
 * CLR-008..010: Legacy Exports Removed from Index
 * ═══════════════════════════════════════════════════════ */

describe("CLR-008..010: Legacy Exports Removed from Index", () => {
  it("CLR-008: ui/index.ts no longer exports EncounterPanel", () => {
    expect(fileContains("src/ui/index.ts", "EncounterPanel")).toBe(false);
  });

  it("CLR-009: CombatState.ts no longer exports LegacyEncounterState", () => {
    expect(fileContains("src/game/CombatState.ts", "LegacyEncounterState")).toBe(false);
  });

  it("CLR-010: CombatState.ts no longer exports DEFAULT_LEGACY_ENCOUNTER", () => {
    expect(fileContains("src/game/CombatState.ts", "DEFAULT_LEGACY_ENCOUNTER")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════
 * CLR-011..014: updateCombatFromEvent No Legacy Writes
 * ═══════════════════════════════════════════════════════ */

describe("CLR-011..014: updateCombatFromEvent No Legacy Writes", () => {
  it("CLR-011: encounter_started does not set inEncounter", () => {
    const gs = makeGameState("mob1", 80, 100);
    const raw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const normalized = normalizeCombatEvent(raw)!;
    gs.updateCombatFromEvent(normalized);

    // Combat state should be created
    expect(gs.combat).not.toBeNull();
    expect(gs.combat!.combatId).toBe("combat-abc");

    // Legacy fields must NOT be set
    expect((gs as any).inEncounter).toBeUndefined();
    expect((gs as any).encounterMobId).toBeUndefined();
    expect((gs as any).encounterMobHp).toBeUndefined();
    expect((gs as any).encounterTurn).toBeUndefined();
    expect((gs as any).encounterRound).toBeUndefined();
  });

  it("CLR-012: damage_dealt does not set encounterMobHp", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);

    // Deal damage
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 20,
      currentHp: 60,
      maxHp: 100,
    } as any;
    const damageEvent = normalizeCombatEvent(damageRaw)!;
    gs.updateCombatFromEvent(damageEvent);

    // Combat state should be updated
    const mob = gs.combat!.participants.find(p => p.participantId === "mob1")!;
    expect(mob.currentHp).toBe(60);

    // Legacy fields must NOT be set
    expect((gs as any).encounterMobHp).toBeUndefined();
  });

  it("CLR-013: player_damaged does not set encounterRound", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);

    // Player takes damage
    const playerDmgRaw = {
      type: "player_damaged",
      sourceId: "mob1",
      targetId: "p1",
      damage: 15,
      currentHp: 85,
      maxHp: 100,
    } as any;
    const playerDmgEvent = normalizeCombatEvent(playerDmgRaw)!;
    gs.updateCombatFromEvent(playerDmgEvent);

    // Round should increment in combat state
    expect(gs.combat!.round).toBe(2);

    // Legacy fields must NOT be set
    expect((gs as any).encounterRound).toBeUndefined();
  });

  it("CLR-014: encounter_fled does not reset legacy fields", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);

    // Flee
    const fledRaw = {
      type: "encounter_fled",
      sourceId: "p1",
      targetId: "mob1",
    } as any;
    const fledEvent = normalizeCombatEvent(fledRaw)!;
    gs.updateCombatFromEvent(fledEvent);

    // Combat should end
    expect(gs.combat).toBeNull();

    // Legacy fields must NOT be set
    expect((gs as any).inEncounter).toBeUndefined();
    expect((gs as any).encounterMobId).toBeUndefined();
  });
});
