import { describe, it, expect } from "vitest";
import type { BattleGroup, CombatEventPayload, CombatEventType, CombatSession } from "@mmo/shared";
import { buildCombatStartedPayload } from "./ProductionMultiParticipantCombat.js";

/**
 * Phase 3I-3C: Legacy Protocol Cleanup (LPC-001..008).
 *
 * Proves buildCombatStartedPayload has been slimmed from the legacy 11-field
 * shape ({type, mobId, mobHp, mobMaxHp, playerHp, playerMaxHp, attack,
 * defense, level, combatId, currentActorId}) to the minimal 4-field shape
 * ({type, mobId, combatId, currentActorId}).
 */

/* ── Mock helpers ── */

function makeSession(overrides: Partial<CombatSession> = {}): CombatSession {
  return {
    id: "combat-001",
    battleId: "battle-001",
    state: "ACTIVE",
    round: 1,
    currentActorId: "player-001",
    turnOrder: ["player-001", "mob-001"],
    turnStartedAt: 0,
    turnTimeoutMs: null,
    participants: [
      {
        participantId: "player-001",
        side: "player",
        currentHp: 100,
        maxHp: 100,
        initiative: 10,
        alive: true,
        defending: false,
      },
      {
        participantId: "mob-001",
        side: "enemy",
        currentHp: 80,
        maxHp: 80,
        initiative: 8,
        alive: true,
        defending: false,
      },
    ],
    pendingParticipants: [],
    ...overrides,
  };
}

function makeBattle(overrides: Partial<BattleGroup> = {}): BattleGroup {
  return {
    id: "battle-001",
    enemySide: {
      id: "enemy-side-001",
      leaderId: "mob-001",
      participants: [{ id: "mob-001", position: { x: 1, y: 0 }, combatPower: 5, personality: "aggressive", state: "ACTIVE" }],
      area: { center: { x: 1, y: 0 }, radius: 3 },
      state: "ACTIVE",
    },
    playerSide: {
      id: "player-side-001",
      leaderId: "player-001",
      participants: [{ id: "player-001", position: { x: 0, y: 0 }, combatPower: 10, personality: "aggressive", state: "ACTIVE" }],
      area: { center: { x: 0, y: 0 }, radius: 3 },
      state: "ACTIVE",
    },
    ...overrides,
  };
}

/* ── Tests ── */

describe("Phase 3I-3C: Legacy Protocol Cleanup", () => {
  it("LPC-001: buildCombatStartedPayload returns type \"encounter_started\"", () => {
    const session = makeSession();
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect(payload.type).toBe("encounter_started");
  });

  it("LPC-002: buildCombatStartedPayload returns mobId from enemy participant", () => {
    const session = makeSession();
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect(payload.mobId).toBe("mob-001");
  });

  it("LPC-003: buildCombatStartedPayload returns combatId from session.id", () => {
    const session = makeSession({ id: "combat-lpc003" });
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect(payload.combatId).toBe("combat-lpc003");
  });

  it("LPC-004: buildCombatStartedPayload returns currentActorId from session", () => {
    const session = makeSession({ currentActorId: "player-001" });
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect(payload.currentActorId).toBe("player-001");
  });

  it("LPC-005: buildCombatStartedPayload returns empty mobId when no enemy", () => {
    const session = makeSession({
      participants: [
        { participantId: "player-001", side: "player", currentHp: 100, maxHp: 100, initiative: 10, alive: true, defending: false },
      ],
    });
    const battle = makeBattle({
      enemySide: {
        id: "enemy-side-001",
        leaderId: null,
        participants: [],
        area: { center: { x: 1, y: 0 }, radius: 3 },
        state: "ACTIVE",
      },
    });
    const payload = buildCombatStartedPayload(session, battle);
    expect(payload.mobId).toBe("");
  });

  it("LPC-006: buildCombatStartedPayload does NOT include mobHp field", () => {
    const session = makeSession();
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect("mobHp" in payload).toBe(false);
  });

  it("LPC-007: buildCombatStartedPayload does NOT include playerHp field", () => {
    const session = makeSession();
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect("playerHp" in payload).toBe(false);
  });

  it("LPC-008: buildCombatStartedPayload does NOT include attack/defense/level fields", () => {
    const session = makeSession();
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect("attack" in payload).toBe(false);
    expect("defense" in payload).toBe(false);
    expect("level" in payload).toBe(false);
  });

  /* ── LPC-009..017: CombatEventType union & CombatEventPayload shape ── */

  /** Canonical list of every member of the current CombatEventType union. */
  const VALID_COMBAT_EVENT_TYPES: CombatEventType[] = [
    "damage_dealt",
    "mob_killed",
    "player_damaged",
    "player_died",
    "xp_gained",
    "loot_dropped",
    "player_respawn",
    "level_up",
    "encounter_started",
    "encounter_fled",
  ];

  it("LPC-009: encounter_started is a valid CombatEventType (positive control)", () => {
    expect(VALID_COMBAT_EVENT_TYPES).toContain("encounter_started");
  });

  it("LPC-010: encounter_fled is a valid CombatEventType (positive control)", () => {
    expect(VALID_COMBAT_EVENT_TYPES).toContain("encounter_fled");
  });

  it("LPC-011: encounter_timeout is NOT a valid CombatEventType", () => {
    expect(VALID_COMBAT_EVENT_TYPES).not.toContain("encounter_timeout");
  });

  it("LPC-012: defend is NOT a valid CombatEventType", () => {
    expect(VALID_COMBAT_EVENT_TYPES).not.toContain("defend");
  });

  it("LPC-013: mob_respawn is NOT a valid CombatEventType", () => {
    expect(VALID_COMBAT_EVENT_TYPES).not.toContain("mob_respawn");
  });

  it("LPC-014: CombatEventPayload excludes legacy HP fields", () => {
    const payload: CombatEventPayload = { type: "encounter_started", sourceId: "", targetId: "" };
    expect(payload).not.toHaveProperty("mobHp");
    expect(payload).not.toHaveProperty("mobMaxHp");
    expect(payload).not.toHaveProperty("playerHp");
    expect(payload).not.toHaveProperty("playerMaxHp");
  });

  it("LPC-015: CombatEventPayload retains attack/defense/level", () => {
    const payload: CombatEventPayload = {
      type: "level_up",
      sourceId: "",
      targetId: "",
      attack: 10,
      defense: 5,
      level: 3,
    };
    expect(payload.attack).toBe(10);
    expect(payload.defense).toBe(5);
    expect(payload.level).toBe(3);
  });

  it("LPC-016: CombatEventPayload retains mobId", () => {
    const payload: CombatEventPayload = {
      type: "encounter_started",
      sourceId: "",
      targetId: "",
      mobId: "mob-001",
    };
    expect(payload.mobId).toBe("mob-001");
  });

  it("LPC-017: buildCombatStartedPayload carries currentActorId on encounter_started", () => {
    const session = makeSession({ currentActorId: "player-099" });
    const battle = makeBattle();
    const payload = buildCombatStartedPayload(session, battle);
    expect(payload).toHaveProperty("currentActorId");
    expect(payload.currentActorId).toBe("player-099");
  });
});
