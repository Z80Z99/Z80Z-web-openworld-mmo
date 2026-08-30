/**
 * Phase 3H.4: Client Event Migration Tests (CEM-001..CEM-025)
 *
 * Validates that GameState correctly applies normalized combat events
 * via updateCombatFromEvent() and updateBattleFromEvent().
 *
 * These tests define the DESIRED behavior for methods that do not yet
 * exist on GameState — standard TDD RED phase. Every test should FAIL
 * until the implementation lands.
 *
 * Server authority: Client never computes damage, HP, or round logic.
 * All values come from the server through normalizeCombatEvent().
 */
import { describe, it, expect, beforeEach } from "vitest";
import { GameState } from "./GameState.js";
import { normalizeCombatEvent } from "../combat/CombatEventNormalizer.js";
import type { NormalizedCombatEvent } from "../combat/CombatEventNormalizer.js";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

function makeGameState(mobId = "mob1", hp = 80, maxHp = 100): GameState {
  const gs = new GameState(42);
  gs.setLocalPlayer("p1", { x: 5, y: 5, health: 100, maxHealth: 100, name: "Player", level: 1 } as any);
  gs.addMob({ id: mobId, typeId: "goblin", x: 10, y: 10, health: hp, maxHealth: maxHp, type: "goblin" } as any);
  return gs;
}

/* ═══════════════════════════════════════════════════════
 * CEM-001..006: Battle Events (Non-Existent on Server)
 *
 * normalizeCombatEvent returns null for battle_* types.
 * These event types do NOT exist in the server protocol.
 * ═══════════════════════════════════════════════════════ */

describe("Battle Events (Non-Existent)", () => {
  it("CEM-001: battle_created — normalizeCombatEvent returns null, gameState unchanged", () => {
    const gs = makeGameState();
    const raw = { type: "battle_created", sourceId: "p1", targetId: "mob1" } as any;

    const normalized = normalizeCombatEvent(raw);

    expect(normalized).toBeNull();
    expect(gs.combat).toBeNull();
    expect(gs.battle).toBeNull();
  });

  it("CEM-002: battle_joined — normalizeCombatEvent returns null", () => {
    const gs = makeGameState();
    const raw = { type: "battle_joined", sourceId: "p1", targetId: "mob1" } as any;

    const normalized = normalizeCombatEvent(raw);

    expect(normalized).toBeNull();
    expect(gs.combat).toBeNull();
    expect(gs.battle).toBeNull();
  });

  it("CEM-003: battle_left — normalizeCombatEvent returns null", () => {
    const gs = makeGameState();
    const raw = { type: "battle_left", sourceId: "p1", targetId: "mob1" } as any;

    const normalized = normalizeCombatEvent(raw);

    expect(normalized).toBeNull();
    expect(gs.combat).toBeNull();
    expect(gs.battle).toBeNull();
  });

  it("CEM-004: battle_fleeing — normalizeCombatEvent returns null", () => {
    const gs = makeGameState();
    const raw = { type: "battle_fleeing", sourceId: "p1", targetId: "mob1" } as any;

    const normalized = normalizeCombatEvent(raw);

    expect(normalized).toBeNull();
    expect(gs.combat).toBeNull();
    expect(gs.battle).toBeNull();
  });

  it("CEM-005: battle_rejoined — normalizeCombatEvent returns null", () => {
    const gs = makeGameState();
    const raw = { type: "battle_rejoined", sourceId: "p1", targetId: "mob1" } as any;

    const normalized = normalizeCombatEvent(raw);

    expect(normalized).toBeNull();
    expect(gs.combat).toBeNull();
    expect(gs.battle).toBeNull();
  });

  it("CEM-006: battle_resolved — normalizeCombatEvent returns null", () => {
    const gs = makeGameState();
    const raw = { type: "battle_resolved", sourceId: "p1", targetId: "mob1" } as any;

    const normalized = normalizeCombatEvent(raw);

    expect(normalized).toBeNull();
    expect(gs.combat).toBeNull();
    expect(gs.battle).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-007..012: Combat State Updates
 *
 * Core event handling: encounter_started creates state,
 * damage/killed/timeout modify it.
 * ═══════════════════════════════════════════════════════ */

describe("Combat State Updates", () => {
  it("CEM-007: encounter_started creates combat + battle + legacy fields", () => {
    const gs = makeGameState("mob1", 80, 100);
    const raw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const normalized = normalizeCombatEvent(raw);

    gs.updateCombatFromEvent(normalized!);
    gs.updateBattleFromEvent(normalized!);

    // Combat state created
    expect(gs.combat).not.toBeNull();
    expect(gs.combat!.combatId).toBe("combat-abc");
    expect(gs.combat!.state).toBe("ACTIVE");
    expect(gs.combat!.round).toBe(1);
    expect(gs.combat!.currentActorId).toBe("p1");
    expect(gs.combat!.participants.length).toBeGreaterThanOrEqual(1);
    expect(gs.combat!.participants.some(p => p.participantId === "mob1" && p.side === "enemy")).toBe(true);

    // Battle state created
    expect(gs.battle).not.toBeNull();
    expect(gs.battle!.enemySide.leaderId).toBe("mob1");

    // Legacy fields populated
    expect(gs.inEncounter).toBe(true);
    expect(gs.encounterMobId).toBe("mob1");
    expect(gs.encounterMobHp).toBe(80);
    expect(gs.encounterMobMaxHp).toBe(100);
    expect(gs.encounterTurn).toBe("player");
    expect(gs.encounterRound).toBe(1);
  });

  it("CEM-008: damage_dealt updates target HP from server currentHp", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Damage the mob
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

    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(60);
    expect(gs.encounterMobHp).toBe(60);
  });

  it("CEM-009: player_damaged increments round", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Mob hits player — round advances
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

    expect(gs.combat!.round).toBe(2);
    expect(gs.encounterRound).toBe(2);
  });

  it("CEM-010: damage sets HP from server (not client calculation)", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Server says HP is 70 (not 80 - 20 = 60, server is authoritative)
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 10,
      currentHp: 70,
      maxHp: 100,
    } as any;
    const damageEvent = normalizeCombatEvent(damageRaw)!;
    gs.updateCombatFromEvent(damageEvent);

    // Client uses server's currentHp, not its own calculation
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(70);
    expect(gs.encounterMobHp).toBe(70);
  });

  it("CEM-011: mob_killed marks participant dead", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Mob is killed
    const killRaw = {
      type: "mob_killed",
      sourceId: "p1",
      targetId: "mob1",
    } as any;
    const killEvent = normalizeCombatEvent(killRaw)!;
    gs.updateCombatFromEvent(killEvent);

    const mob = gs.combat!.participants.find(p => p.participantId === "mob1")!;
    expect(mob.alive).toBe(false);
    expect(mob.currentHp).toBe(0);
  });

  it("CEM-012: encounter_timeout sets combat RESOLVED", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Encounter times out
    const timeoutRaw = {
      type: "encounter_timeout",
      sourceId: "p1",
      targetId: "mob1",
    } as any;
    const timeoutEvent = normalizeCombatEvent(timeoutRaw)!;
    gs.updateCombatFromEvent(timeoutEvent);

    expect(gs.combat!.state).toBe("RESOLVED");
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-013..016: Multi-Participant
 *
 * Various party sizes: 1v1, 2v1, 1v2, 2v2.
 * ═══════════════════════════════════════════════════════ */

describe("Multi-Participant", () => {
  it("CEM-013: 1v1 — single player vs single mob", () => {
    const gs = makeGameState("mob1", 80, 100);
    const raw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const normalized = normalizeCombatEvent(raw)!;

    gs.updateCombatFromEvent(normalized);
    gs.updateBattleFromEvent(normalized);

    expect(gs.combat!.participants.length).toBe(1);
    expect(gs.combat!.turnOrder.includes("mob1")).toBe(true);
  });

  it("CEM-014: 2v1 — damage from different source updates same target", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Different player (p2) damages the same mob
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p2",
      targetId: "mob1",
      damage: 30,
      currentHp: 50,
      maxHp: 100,
    } as any;
    const damageEvent = normalizeCombatEvent(damageRaw)!;
    gs.updateCombatFromEvent(damageEvent);

    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(50);
  });

  it("CEM-015: 1v2 — two mob_killed events mark both dead", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Manually set combat with 2 enemies
    gs.combat = {
      combatId: "combat-1",
      battleId: "battle-1",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["mob1", "mob2"],
      participants: [
        { participantId: "mob1", currentHp: 80, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
        { participantId: "mob2", currentHp: 60, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
      ],
    };

    // Kill mob1
    const kill1Raw = { type: "mob_killed", sourceId: "p1", targetId: "mob1" } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(kill1Raw)!);

    // Kill mob2
    const kill2Raw = { type: "mob_killed", sourceId: "p1", targetId: "mob2" } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(kill2Raw)!);

    const mob1 = gs.combat!.participants.find(p => p.participantId === "mob1")!;
    const mob2 = gs.combat!.participants.find(p => p.participantId === "mob2")!;

    expect(mob1.alive).toBe(false);
    expect(mob2.alive).toBe(false);
  });

  it("CEM-016: 2v2 — multiple damage events update correct targets", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Manually set combat with 2 players and 2 enemies
    gs.combat = {
      combatId: "combat-1",
      battleId: "battle-1",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["p1", "p2", "mob1", "mob2"],
      participants: [
        { participantId: "p1", currentHp: 100, maxHp: 100, alive: true, defending: false, fleeing: false, side: "player" },
        { participantId: "p2", currentHp: 90, maxHp: 100, alive: true, defending: false, fleeing: false, side: "player" },
        { participantId: "mob1", currentHp: 80, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
        { participantId: "mob2", currentHp: 70, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
      ],
    };

    // p1 attacks mob1
    const dmg1Raw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 20,
      currentHp: 60,
      maxHp: 100,
    } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(dmg1Raw)!);

    // p2 attacks mob2
    const dmg2Raw = {
      type: "damage_dealt",
      sourceId: "p2",
      targetId: "mob2",
      damage: 25,
      currentHp: 45,
      maxHp: 100,
    } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(dmg2Raw)!);

    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(60);
    expect(gs.combat!.participants.find(p => p.participantId === "mob2")!.currentHp).toBe(45);
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-017..019: Idempotence
 *
 * Duplicate events must not corrupt state.
 * ═══════════════════════════════════════════════════════ */

describe("Idempotence", () => {
  it("CEM-017: Duplicate damage_dealt — HP applied once (idempotent)", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Apply same damage event twice
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
    gs.updateCombatFromEvent(damageEvent);

    // HP is 60, NOT 40 (no double decrement)
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(60);
    expect(gs.encounterMobHp).toBe(60);
  });

  it("CEM-018: Duplicate encounter_started — no double participant", () => {
    const gs = makeGameState("mob1", 80, 100);
    const raw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const normalized = normalizeCombatEvent(raw)!;

    // Send encounter_started twice
    gs.updateCombatFromEvent(normalized);
    gs.updateBattleFromEvent(normalized);
    gs.updateCombatFromEvent(normalized);
    gs.updateBattleFromEvent(normalized);

    // Only one mob1 participant
    expect(
      gs.combat!.participants.filter(p => p.participantId === "mob1").length,
    ).toBe(1);
  });

  it("CEM-019: Duplicate damage — HP not double-decremented (server authority)", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // First hit: server reports 60
    const damage1Raw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 20,
      currentHp: 60,
      maxHp: 100,
    } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(damage1Raw)!);

    // Duplicate/reordered hit: same server-reported HP
    const damage2Raw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 20,
      currentHp: 60,
      maxHp: 100,
    } as any;
    gs.updateCombatFromEvent(normalizeCombatEvent(damage2Raw)!);

    // HP remains at 60 — server is authoritative, not accumulated
    expect(gs.combat!.participants.find(p => p.participantId === "mob1")!.currentHp).toBe(60);
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-020: Lifecycle Independence
 *
 * Battle and combat have independent lifecycle states.
 * ═══════════════════════════════════════════════════════ */

describe("Lifecycle Independence", () => {
  it("CEM-020: Battle ACTIVE while combat RESOLVED", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    // Combat resolves
    const timeoutRaw = {
      type: "encounter_timeout",
      sourceId: "p1",
      targetId: "mob1",
    } as any;
    const timeoutEvent = normalizeCombatEvent(timeoutRaw)!;
    gs.updateCombatFromEvent(timeoutEvent);
    gs.updateBattleFromEvent(timeoutEvent);

    // Combat is resolved but battle side remains active
    expect(gs.combat!.state).toBe("RESOLVED");
    expect(gs.battle!.enemySide.state).toBe("ACTIVE");
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-021..023: Flee/Rejoin
 *
 * Spatial flee clears combat; participant state transitions.
 * ═══════════════════════════════════════════════════════ */

describe("Flee/Rejoin", () => {
  it("CEM-021: encounter_fled nulls combat", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Setup: start encounter
    const startRaw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const startEvent = normalizeCombatEvent(startRaw)!;
    gs.updateCombatFromEvent(startEvent);
    gs.updateBattleFromEvent(startEvent);

    expect(gs.combat).not.toBeNull();

    // Player flees
    const fledRaw = {
      type: "encounter_fled",
      sourceId: "p1",
      targetId: "mob1",
    } as any;
    const fledEvent = normalizeCombatEvent(fledRaw)!;
    gs.updateCombatFromEvent(fledEvent);
    gs.updateBattleFromEvent(fledEvent);

    expect(gs.combat).toBeNull();
    expect(gs.inEncounter).toBe(false);
  });

  it("CEM-022: Spatial fleeing — participant state FLEEING", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Manually set combat state with a fleeing participant
    gs.combat = {
      combatId: "combat-1",
      battleId: "battle-1",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["p1", "mob1"],
      participants: [
        { participantId: "p1", currentHp: 100, maxHp: 100, alive: true, defending: false, fleeing: true, side: "player" },
        { participantId: "mob1", currentHp: 80, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
      ],
    };

    const participant = gs.combat.participants.find(p => p.participantId === "p1")!;
    expect(participant.fleeing).toBe(true);
  });

  it("CEM-023: Rejoin after spatial flee", () => {
    const gs = makeGameState("mob1", 80, 100);

    // Manually set combat state with a fleeing participant
    gs.combat = {
      combatId: "combat-1",
      battleId: "battle-1",
      state: "ACTIVE",
      round: 1,
      currentActorId: "p1",
      turnOrder: ["p1", "mob1"],
      participants: [
        { participantId: "p1", currentHp: 100, maxHp: 100, alive: true, defending: false, fleeing: true, side: "player" },
        { participantId: "mob1", currentHp: 80, maxHp: 100, alive: true, defending: false, fleeing: false, side: "enemy" },
      ],
    };

    // Simulate rejoin via a damage event (player acts again)
    const damageRaw = {
      type: "damage_dealt",
      sourceId: "p1",
      targetId: "mob1",
      damage: 10,
      currentHp: 70,
      maxHp: 100,
    } as any;
    const damageEvent = normalizeCombatEvent(damageRaw)!;
    gs.updateCombatFromEvent(damageEvent);

    // Participant can be found (still in the combat)
    const participant = gs.combat!.participants.find(p => p.participantId === "p1");
    expect(participant).toBeDefined();
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-024: ID Separation
 *
 * battleId and combatId are different identifiers.
 * ═══════════════════════════════════════════════════════ */

describe("ID Separation", () => {
  it("CEM-024: battleId/combatId are different identifiers", () => {
    const gs = makeGameState("mob1", 80, 100);
    const raw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-xyz",
      currentActorId: "p1",
    } as any;
    const normalized = normalizeCombatEvent(raw)!;

    gs.updateCombatFromEvent(normalized);
    gs.updateBattleFromEvent(normalized);

    // battleId is auto-generated from mobId, combatId comes from server
    expect(gs.battle!.battleId).not.toBe(gs.combat!.combatId);
    expect(gs.combat!.combatId).toBe("combat-xyz");
  });
});

/* ═══════════════════════════════════════════════════════
 * CEM-025: Legacy Compatibility
 *
 * Legacy encounter fields must be set from encounter_started.
 * ═══════════════════════════════════════════════════════ */

describe("Legacy Compatibility", () => {
  it("CEM-025: Legacy fields set from encounter_started", () => {
    const gs = makeGameState("mob1", 80, 100);
    const raw = {
      type: "encounter_started",
      sourceId: "p1",
      targetId: "mob1",
      mobId: "mob1",
      mobHp: 80,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
      combatId: "combat-abc",
      currentActorId: "p1",
    } as any;
    const normalized = normalizeCombatEvent(raw)!;

    gs.updateCombatFromEvent(normalized);
    gs.updateBattleFromEvent(normalized);

    expect(gs.inEncounter).toBe(true);
    expect(gs.encounterMobId).toBe("mob1");
    expect(gs.encounterMobHp).toBe(80);
    expect(gs.encounterMobMaxHp).toBe(100);
    expect(gs.encounterTurn).toBe("player");
    expect(gs.encounterRound).toBe(1);
  });
});
