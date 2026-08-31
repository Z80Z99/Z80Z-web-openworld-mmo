// @vitest-environment jsdom
/**
 * BattlePanel HP Correctness Tests (BHP-001..012)
 *
 * Validates that BattlePanel HP is resolved from CombatState,
 * not hardcoded to 100/100.
 */
import { describe, it, expect } from "vitest";
import { resolveBattleParticipantHp } from "./resolveBattleParticipantHp.js";
import type { ClientCombatParticipant } from "./CombatState.js";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

function makeCombatParticipant(overrides: Partial<ClientCombatParticipant> = {}): ClientCombatParticipant {
  return {
    participantId: "mob-1",
    currentHp: 80,
    maxHp: 100,
    alive: true,
    defending: false,
    fleeing: false,
    side: "enemy",
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════
 * BHP-001..012
 * ═══════════════════════════════════════════════════════ */

describe("BattlePanel HP Resolution", () => {
  /* ── BHP-001: 1v1 real HP ── */

  it("BHP-001: resolves real HP for 1v1", () => {
    const combat = [makeCombatParticipant({ participantId: "mob-1", currentHp: 80, maxHp: 100 })];
    const hp = resolveBattleParticipantHp("mob-1", combat);
    expect(hp.currentHp).toBe(80);
    expect(hp.maxHp).toBe(100);
  });

  /* ── BHP-002: 2v1 multiple HP ── */

  it("BHP-002: resolves HP for multiple participants (2v1)", () => {
    const combat = [
      makeCombatParticipant({ participantId: "player-1", currentHp: 100, maxHp: 100, side: "player" }),
      makeCombatParticipant({ participantId: "player-2", currentHp: 60, maxHp: 80, side: "player" }),
      makeCombatParticipant({ participantId: "mob-1", currentHp: 30, maxHp: 50, side: "enemy" }),
    ];
    expect(resolveBattleParticipantHp("player-1", combat)).toEqual({ currentHp: 100, maxHp: 100 });
    expect(resolveBattleParticipantHp("player-2", combat)).toEqual({ currentHp: 60, maxHp: 80 });
    expect(resolveBattleParticipantHp("mob-1", combat)).toEqual({ currentHp: 30, maxHp: 50 });
  });

  /* ── BHP-003: 2v2 multiple HP ── */

  it("BHP-003: resolves HP for 2v2", () => {
    const combat = [
      makeCombatParticipant({ participantId: "A", currentHp: 90, maxHp: 100, side: "player" }),
      makeCombatParticipant({ participantId: "B", currentHp: 70, maxHp: 80, side: "player" }),
      makeCombatParticipant({ participantId: "X", currentHp: 45, maxHp: 60, side: "enemy" }),
      makeCombatParticipant({ participantId: "Y", currentHp: 20, maxHp: 40, side: "enemy" }),
    ];
    expect(resolveBattleParticipantHp("A", combat)).toEqual({ currentHp: 90, maxHp: 100 });
    expect(resolveBattleParticipantHp("B", combat)).toEqual({ currentHp: 70, maxHp: 80 });
    expect(resolveBattleParticipantHp("X", combat)).toEqual({ currentHp: 45, maxHp: 60 });
    expect(resolveBattleParticipantHp("Y", combat)).toEqual({ currentHp: 20, maxHp: 40 });
  });

  /* ── BHP-004: maxHp correct ── */

  it("BHP-004: maxHp is preserved from CombatState", () => {
    const combat = [makeCombatParticipant({ participantId: "mob-1", currentHp: 1, maxHp: 200 })];
    const hp = resolveBattleParticipantHp("mob-1", combat);
    expect(hp.maxHp).toBe(200);
  });

  /* ── BHP-005: currentHp updates ── */

  it("BHP-005: currentHp reflects latest CombatState", () => {
    const combat = [makeCombatParticipant({ participantId: "mob-1", currentHp: 50, maxHp: 100 })];
    expect(resolveBattleParticipantHp("mob-1", combat).currentHp).toBe(50);

    // Simulate damage event
    combat[0] = makeCombatParticipant({ participantId: "mob-1", currentHp: 30, maxHp: 100 });
    expect(resolveBattleParticipantHp("mob-1", combat).currentHp).toBe(30);
  });

  /* ── BHP-006: dead participant ── */

  it("BHP-006: dead participant shows 0 HP", () => {
    const combat = [makeCombatParticipant({ participantId: "mob-1", currentHp: 0, maxHp: 100, alive: false })];
    const hp = resolveBattleParticipantHp("mob-1", combat);
    expect(hp.currentHp).toBe(0);
    expect(hp.maxHp).toBe(100);
  });

  /* ── BHP-007: fleeing participant ── */

  it("BHP-007: fleeing participant shows correct HP", () => {
    const combat = [makeCombatParticipant({ participantId: "mob-1", currentHp: 40, maxHp: 100, fleeing: true })];
    const hp = resolveBattleParticipantHp("mob-1", combat);
    expect(hp.currentHp).toBe(40);
    expect(hp.maxHp).toBe(100);
  });

  /* ── BHP-008: missing CombatState ── */

  it("BHP-008: returns 0/0 when CombatState is undefined", () => {
    const hp = resolveBattleParticipantHp("mob-1", undefined);
    expect(hp.currentHp).toBe(0);
    expect(hp.maxHp).toBe(0);
  });

  /* ── BHP-009: Combat resolved + Battle active ── */

  it("BHP-009: returns 0/0 when combat participants empty (combat resolved)", () => {
    const hp = resolveBattleParticipantHp("mob-1", []);
    expect(hp.currentHp).toBe(0);
    expect(hp.maxHp).toBe(0);
  });

  /* ── BHP-010: no hardcoded 100/100 ── */

  it("BHP-010: never returns 100/100 unless CombatState actually has 100/100", () => {
    // With non-100 HP
    const combat1 = [makeCombatParticipant({ participantId: "mob-1", currentHp: 73, maxHp: 150 })];
    const hp1 = resolveBattleParticipantHp("mob-1", combat1);
    expect(hp1.currentHp).not.toBe(100);
    expect(hp1.maxHp).not.toBe(100);

    // With actual 100/100 — should still return 100/100
    const combat2 = [makeCombatParticipant({ participantId: "mob-1", currentHp: 100, maxHp: 100 })];
    const hp2 = resolveBattleParticipantHp("mob-1", combat2);
    expect(hp2.currentHp).toBe(100);
    expect(hp2.maxHp).toBe(100);
  });

  /* ── BHP-011: HP source is CombatState ── */

  it("BHP-011: HP values come from CombatState participant matching by ID", () => {
    const combat = [
      makeCombatParticipant({ participantId: "player-1", currentHp: 42, maxHp: 88, side: "player" }),
      makeCombatParticipant({ participantId: "mob-1", currentHp: 17, maxHp: 65, side: "enemy" }),
    ];
    // Must match by participantId, not by index or position
    expect(resolveBattleParticipantHp("player-1", combat)).toEqual({ currentHp: 42, maxHp: 88 });
    expect(resolveBattleParticipantHp("mob-1", combat)).toEqual({ currentHp: 17, maxHp: 65 });
  });

  /* ── BHP-012: no duplicate HP state ── */

  it("BHP-012: returns same reference values as CombatState (no copy/duplication)", () => {
    const participant = makeCombatParticipant({ participantId: "mob-1", currentHp: 55, maxHp: 90 });
    const combat = [participant];
    const hp = resolveBattleParticipantHp("mob-1", combat);
    // Values should match exactly — no intermediate transformation
    expect(hp.currentHp).toBe(participant.currentHp);
    expect(hp.maxHp).toBe(participant.maxHp);
  });
});
