import { describe, it, expect } from "vitest";
import type { BattleGroup, CombatSession } from "@mmo/shared";
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
});
