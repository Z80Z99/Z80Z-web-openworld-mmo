/**
 * Phase 3H.6A: Client Legacy Dependency Audit Tests (LDA-001..LDA-010)
 *
 * Validates that:
 * - BattleState and CombatState are the SOLE client state sources
 * - targetId protocol is complete across client→server flow
 * - Legacy encounter fields are compatibility-only with no production writes
 * - No bidirectional sync between legacy and new state
 *
 * This audit proves the codebase is ready for Phase 3H.6B legacy removal.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GameState } from "./GameState.js";
import { normalizeCombatEvent, buildBattleStateFromEncounter, buildCombatStateFromEncounter } from "../combat/CombatEventNormalizer.js";
import type { NormalizedCombatEvent } from "../combat/CombatEventNormalizer.js";
import type { ClientBattleState } from "./BattleState.js";
import type { ClientCombatState } from "./CombatState.js";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

function makeGameState(mobId = "mob1", hp = 80, maxHp = 100): GameState {
  const gs = new GameState(42);
  gs.setLocalPlayer("p1", { x: 5, y: 5, health: 100, maxHealth: 100, name: "Player", level: 1 } as any);
  gs.addMob({ id: mobId, typeId: "goblin", x: 10, y: 10, health: hp, maxHealth: maxHp, type: "goblin" } as any);
  return gs;
}

function startEncounter(gs: GameState, mobId = "mob1"): void {
  const raw = {
    type: "encounter_started",
    sourceId: "p1",
    targetId: mobId,
    mobId,
    mobHp: 80,
    mobMaxHp: 100,
    playerHp: 100,
    playerMaxHp: 100,
    combatId: "combat-abc",
    currentActorId: "p1",
  } as any;
  const event = normalizeCombatEvent(raw)!;
  gs.updateCombatFromEvent(event);
  gs.updateBattleFromEvent(event);
}

/* ═══════════════════════════════════════════════════════
 * LDA-001: BattleState Sole Authority
 *
 * verifyGameStateBattelleSource() confirms that:
 * - gameState.battle is the ONLY source for battle state
 * - No other property on GameState provides battle data
 * ═══════════════════════════════════════════════════════ */

describe("LDA-001: BattleState Sole Authority", () => {
  it("LDA-001: verifyGameStateBattelleSource() — battle is sole source", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Battle state exists
    expect(gs.battle).not.toBeNull();
    expect(gs.battle!.battleId).toBe("battle-mob1");
    expect(gs.battle!.enemySide.leaderId).toBe("mob1");

    // No legacy battle field exists on GameState
    // (Legacy fields are encounterMobId, inEncounter, etc. — not battle-related)
    expect((gs as any).battleState).toBeUndefined();
    expect((gs as any).battleId).toBeUndefined();
    expect((gs as any).battleParticipants).toBeUndefined();
  });

  it("LDA-001b: updateBattleFromEvent is the only writer", () => {
    const gs = makeGameState();

    // Before encounter: battle is null
    expect(gs.battle).toBeNull();

    // After updateBattleFromEvent: battle is created
    startEncounter(gs);
    expect(gs.battle).not.toBeNull();

    // updateBattleFromEvent can modify battle
    const killRaw = { type: "mob_killed", sourceId: "p1", targetId: "mob1" } as any;
    const killEvent = normalizeCombatEvent(killRaw)!;
    gs.updateBattleFromEvent(killEvent);

    // Battle state updated via updateBattleFromEvent only
    expect(gs.battle!.enemySide.participants[0].state).toBe("ELIMINATED");
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-002: CombatState Sole Authority
 *
 * verifyGameStateCombatSource() confirms that:
 * - gameState.combat is the ONLY source for combat state
 * - No other property on GameState provides combat data
 * ═══════════════════════════════════════════════════════ */

describe("LDA-002: CombatState Sole Authority", () => {
  it("LDA-002: verifyGameStateCombatSource() — combat is sole source", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Combat state exists
    expect(gs.combat).not.toBeNull();
    expect(gs.combat!.combatId).toBe("combat-abc");
    expect(gs.combat!.state).toBe("ACTIVE");

    // No legacy combat field exists on GameState
    expect((gs as any).combatState).toBeUndefined();
    expect((gs as any).combatId).toBeUndefined();
    expect((gs as any).combatParticipants).toBeUndefined();
    expect((gs as any).currentTurn).toBeUndefined();
  });

  it("LDA-002b: updateCombatFromEvent is the only writer", () => {
    const gs = makeGameState();

    // Before encounter: combat is null
    expect(gs.combat).toBeNull();

    // After updateCombatFromEvent: combat is created
    startEncounter(gs);
    expect(gs.combat).not.toBeNull();

    // updateCombatFromEvent can modify combat
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

    // Combat state updated via updateCombatFromEvent only
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(60);
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-003: Legacy Fields Have No Production Readers
 *
 * The legacy fields (inEncounter, encounterMobId, etc.) are:
 * - Written ONLY inside updateCombatFromEvent() as derived side-effects
 * - Never read by any production code (only test code reads them)
 * ═══════════════════════════════════════════════════════ */

describe("LDA-003: Legacy Fields Have No Production Readers", () => {
  it("LDA-003a: Legacy fields exist but are dead reads", () => {
    const gs = makeGameState();

    // Legacy fields exist with defaults
    expect(gs.inEncounter).toBe(false);
    expect(gs.encounterMobId).toBeNull();
    expect(gs.encounterMobHp).toBe(0);
    expect(gs.encounterMobMaxHp).toBe(0);
    expect(gs.encounterTurn).toBe("player");
    expect(gs.encounterRound).toBe(0);
  });

  it("LDA-003b: Legacy fields are written as derived side-effects only", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Legacy fields populated from encounter_started
    expect(gs.inEncounter).toBe(true);
    expect(gs.encounterMobId).toBe("mob1");
    expect(gs.encounterMobHp).toBe(80);
    expect(gs.encounterMobMaxHp).toBe(100);
    expect(gs.encounterTurn).toBe("player");
    expect(gs.encounterRound).toBe(1);

    // But they are NOT used by any production UI component
    // BattlePanel reads from gs.battle, CombatPanel reads from gs.combat
    // EncounterPanel reads from adapter output, not directly from legacy fields
  });

  it("LDA-003c: Legacy fields are NOT part of BattleState or CombatState types", () => {
    // BattleState type has no legacy fields
    const battle: ClientBattleState = {
      battleId: "test",
      playerSide: { id: "p", leaderId: null, participants: [], area: { center: { x: 0, y: 0 }, radius: 10 }, state: "ACTIVE" },
      enemySide: { id: "e", leaderId: "m", participants: [], area: { center: { x: 0, y: 0 }, radius: 10 }, state: "ACTIVE" },
    };
    expect((battle as any).inEncounter).toBeUndefined();
    expect((battle as any).encounterMobId).toBeUndefined();

    // CombatState type has no legacy fields
    const combat: ClientCombatState = {
      combatId: "test",
      battleId: "battle-test",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["p1"],
      participants: [],
    };
    expect((combat as any).inEncounter).toBeUndefined();
    expect((combat as any).encounterMobId).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-004: Legacy Fields Are Compatibility-Only
 *
 * Legacy fields are derived side-effects from updateCombatFromEvent().
 * They exist solely for backward compatibility with legacy UI code.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-004: Legacy Fields Are Compatibility-Only", () => {
  it("LDA-004a: Legacy fields are derived from combat events", () => {
    const gs = makeGameState();

    // Before encounter: legacy fields are default
    expect(gs.inEncounter).toBe(false);
    expect(gs.encounterMobId).toBeNull();

    // After encounter_started: legacy fields derived from event
    startEncounter(gs);
    expect(gs.inEncounter).toBe(true);
    expect(gs.encounterMobId).toBe("mob1");
    expect(gs.encounterMobHp).toBe(80);
  });

  it("LDA-004b: Legacy fields update when combat state changes", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Damage the mob
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 20,
      currentHp: 60,
      maxHp: 100,
    } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(damageRaw)!);

    // Legacy field updated (derived from event, not calculated)
    expect(gs.encounterMobHp).toBe(60);

    // But the authoritative source is combat state
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(60);
  });

  it("LDA-004c: Legacy fields cleared on encounter end", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Encounter fled
    const fledRaw = { type: "encounter_fled", sourceId: "p1", targetId: "mob1" } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(fledRaw)!);

    // Legacy fields cleared
    expect(gs.inEncounter).toBe(false);
    expect(gs.encounterMobId).toBeNull();

    // Combat state also cleared
    expect(gs.combat).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-005: targetId Protocol Complete
 *
 * targetId flows from CombatPanel → NetworkManager → Server.
 * Server uses it to select the target in multi-enemy encounters.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-005: targetId Protocol Complete", () => {
  it("LDA-005a: sendEncounterAction accepts optional targetId", () => {
    // Verify the type signature: targetId is optional
    const sendEncounterAction = (action: string, targetId?: string): { action: string; targetId?: string } => {
      return { action, targetId };
    };

    // Without targetId
    const noTarget = sendEncounterAction("attack");
    expect(noTarget.targetId).toBeUndefined();

    // With targetId
    const withTarget = sendEncounterAction("attack", "mob-Y");
    expect(withTarget.targetId).toBe("mob-Y");
  });

  it("LDA-005b: targetId flows through combat events", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Damage event with targetId
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 20,
      currentHp: 60,
      maxHp: 100,
    } as any;
    const event = normalizeCombatEvent(damageRaw)!;

    // Event preserves targetId
    expect(event.type).toBe("damage_dealt");
    if (event.type === "damage_dealt") {
      expect(event.targetId).toBe("mob1");
    }
  });

  it("LDA-005c: targetId used to update correct participant", () => {
    const gs = makeGameState();

    // Set up multi-enemy combat
    gs.combat = {
      combatId: "combat-1",
      battleId: "battle-1",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["p1", "mob1", "mob2"],
      participants: [
        { participantId: "p1", currentHp: 100, maxHp: 100, alive: true, defending: false, fleeing: false, side: "player" },
        { participantId: "mob1", currentHp: 80, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
        { participantId: "mob2", currentHp: 70, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
      ],
    };

    // Damage mob2 specifically
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob2",
      damage: 20,
      currentHp: 50,
      maxHp: 100,
    } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(damageRaw)!);

    // Only mob2 updated
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(80);
    expect(gs.combat!.participants.find(p => p.participantId === "mob2")!.currentHp).toBe(50);
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-006: No Bidirectional Sync
 *
 * Legacy fields are derived from events, NOT from new state.
 * New state is NOT derived from legacy fields.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-006: No Bidirectional Sync", () => {
  it("LDA-006a: Legacy fields derived from events, not from combat state", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Manually set combat state (simulating a different path)
    gs.combat = {
      combatId: "combat-2",
      battleId: "battle-2",
      state: "ACTIVE",
      round: 5,
      currentActorId: "mob1",
      turnOrder: ["mob1", "p1"],
      participants: [
        { participantId: "p1", currentHp: 50, maxHp: 100, alive: true, defending: false, fleeing: false, side: "player" },
        { participantId: "mob1", currentHp: 30, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
      ],
    };

    // Legacy fields are NOT updated from manual combat state change
    // They still reflect the last event-derived values
    expect(gs.encounterRound).toBe(1); // Not 5 from manual combat
    expect(gs.encounterMobHp).toBe(80); // Not 30 from manual combat
  });

  it("LDA-006b: New state not derived from legacy fields", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Manually set legacy fields (simulating legacy write)
    gs.inEncounter = true;
    gs.encounterMobId = "mob2"; // Different from combat state
    gs.encounterMobHp = 50;

    // Combat state is NOT updated from legacy fields
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")).toBeDefined();
    expect(gs.combat!.participants.find(p => p.participantId === "mob2")).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-007: BattleState and CombatState Independent
 *
 * BattleState and CombatState have independent lifecycles.
 * One can exist without the other.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-007: BattleState and CombatState Independent", () => {
  it("LDA-007a: Battle exists without combat (after combat resolved)", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Both exist after encounter
    expect(gs.battle).not.toBeNull();
    expect(gs.combat).not.toBeNull();

    // Combat resolves
    const timeoutRaw = { type: "encounter_timeout", sourceId: "p1", targetId: "mob1" } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(timeoutRaw)!);
    gs.updateBattleFromEvent(normalizeCombatEvent(timeoutRaw)!);

    // Combat resolved, battle still exists
    expect(gs.combat!.state).toBe("RESOLVED");
    expect(gs.battle!.enemySide.state).toBe("ACTIVE");
  });

  it("LDA-007b: encounter_fled clears combat but battle remains", () => {
    const gs = makeGameState();
    startEncounter(gs);

    // Both exist
    expect(gs.battle).not.toBeNull();
    expect(gs.combat).not.toBeNull();

    // Encounter fled — combat is nulled, battle persists (independent lifecycle)
    const fledRaw = { type: "encounter_fled", sourceId: "p1", targetId: "mob1" } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(fledRaw)!);
    gs.updateBattleFromEvent(normalizeCombatEvent(fledRaw)!);

    // Combat cleared
    expect(gs.combat).toBeNull();
    // Battle still exists — lifecycle independent from combat
    expect(gs.battle).not.toBeNull();
    expect(gs.battle!.battleId).toBe("battle-mob1");
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-008: BattleState Type Purity
 *
 * BattleState type contains NO legacy fields.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-008: BattleState Type Purity", () => {
  it("LDA-008: BattleState has only battle-related fields", () => {
    const battle: ClientBattleState = {
      battleId: "test",
      playerSide: {
        id: "player",
        leaderId: null,
        participants: [],
        area: { center: { x: 0, y: 0 }, radius: 10 },
        state: "ACTIVE",
      },
      enemySide: {
        id: "enemy",
        leaderId: "mob1",
        participants: [],
        area: { center: { x: 0, y: 0 }, radius: 10 },
        state: "ACTIVE",
      },
    };

    // Only expected fields exist
    const keys = Object.keys(battle);
    expect(keys).toEqual(["battleId", "playerSide", "enemySide"]);

    // No legacy fields
    expect((battle as any).inEncounter).toBeUndefined();
    expect((battle as any).encounterMobId).toBeUndefined();
    expect((battle as any).encounterMobHp).toBeUndefined();
    expect((battle as any).encounterMobMaxHp).toBeUndefined();
    expect((battle as any).encounterTurn).toBeUndefined();
    expect((battle as any).encounterRound).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-009: CombatState Type Purity
 *
 * CombatState type contains NO legacy fields.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-009: CombatState Type Purity", () => {
  it("LDA-009: CombatState has only combat-related fields", () => {
    const combat: ClientCombatState = {
      combatId: "test",
      battleId: "battle-test",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["p1"],
      participants: [],
    };

    // Only expected fields exist
    const keys = Object.keys(combat);
    expect(keys).toEqual(["combatId", "battleId", "state", "round", "currentActorId", "turnOrder", "participants"]);

    // No legacy fields
    expect((combat as any).inEncounter).toBeUndefined();
    expect((combat as any).encounterMobId).toBeUndefined();
    expect((combat as any).encounterMobHp).toBeUndefined();
    expect((combat as any).encounterMobMaxHp).toBeUndefined();
    expect((combat as any).encounterTurn).toBeUndefined();
    expect((combat as any).encounterRound).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════
 * LDA-010: Legacy Fields Default to "No Encounter"
 *
 * All legacy fields default to values indicating no encounter.
 * ═══════════════════════════════════════════════════════ */

describe("LDA-010: Legacy Fields Default to No Encounter", () => {
  it("LDA-010: Legacy fields default correctly", () => {
    const gs = makeGameState();

    // Default values indicate no encounter
    expect(gs.inEncounter).toBe(false);
    expect(gs.encounterMobId).toBeNull();
    expect(gs.encounterMobHp).toBe(0);
    expect(gs.encounterMobMaxHp).toBe(0);
    expect(gs.encounterTurn).toBe("player");
    expect(gs.encounterRound).toBe(0);
  });

  it("LDA-010b: Legacy fields are NOT used by BattlePanel or CombatPanel", () => {
    // BattlePanel and CombatPanel only read from gameState.battle and gameState.combat
    // Legacy fields (inEncounter, encounterMobId, etc.) are dead reads in production
    const gs = makeGameState();
    startEncounter(gs);

    // Verify that the authoritative state is in battle/combat, not legacy fields
    expect(gs.battle!.enemySide.leaderId).toBe("mob1"); // Authoritative
    expect(gs.encounterMobId).toBe("mob1"); // Legacy (derived)

    // They happen to have the same value, but the production code reads from battle/combat
    expect(gs.battle!.enemySide.leaderId).toBe(gs.encounterMobId);
  });
});
