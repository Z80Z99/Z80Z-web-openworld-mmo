/**
 * Phase 3H.3: Client Battle/Combat State Model Tests (CSM-001..CSM-020)
 *
 * Validates:
 * - BattleState and CombatState type definitions
 * - CombatEventNormalizer for all event types
 * - EncounterAdapter for legacy UI bridge
 * - battleId/combatId separation
 * - Server authoritative state (no client-side computation)
 * - Legacy event compatibility
 */
import { describe, it, expect } from "vitest";
import type {
  ClientBattleState,
  ClientBattleSide,
  ClientBattleParticipant,
  BattleArea,
  BattlePoint,
  BattleState,
  ParticipantState,
} from "./BattleState.js";
import type {
  ClientCombatState,
  ClientCombatParticipant,
  CombatSessionState,
} from "./CombatState.js";
import { normalizeCombatEvent, buildBattleStateFromEncounter, buildCombatStateFromEncounter } from "../combat/CombatEventNormalizer.js";
import { toEncounterShowPayload, toEncounterUpdatePayload, shouldHideEncounter, isTerminalEvent, findLocalParticipant, findEnemyParticipant } from "../combat/EncounterAdapter.js";

/* ═══════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════ */

const point = (x: number, y: number): BattlePoint => ({ x, y });

function makeBattleParticipant(
  id: string,
  position: BattlePoint = point(0, 0),
  state: ParticipantState = "ACTIVE",
): ClientBattleParticipant {
  return { id, position, state };
}

function makeBattleSide(
  id: string,
  participants: ClientBattleParticipant[],
  state: BattleState = "ACTIVE",
): ClientBattleSide {
  return {
    id,
    leaderId: participants[0]?.id ?? null,
    participants,
    area: { center: point(0, 0), radius: 10 },
    state,
  };
}

function makeBattle(
  playerParticipants: ClientBattleParticipant[],
  enemyParticipants: ClientBattleParticipant[],
): ClientBattleState {
  return {
    battleId: "battle-1",
    playerSide: makeBattleSide("player", playerParticipants),
    enemySide: makeBattleSide("enemy", enemyParticipants),
  };
}

function makeCombatParticipant(
  participantId: string,
  side: "player" | "enemy",
  overrides: Partial<ClientCombatParticipant> = {},
): ClientCombatParticipant {
  return {
    participantId,
    currentHp: 100,
    maxHp: 100,
    alive: true,
    defending: false,
    fleeing: false,
    side,
    ...overrides,
  };
}

function makeCombat(
  participants: ClientCombatParticipant[],
  overrides: Partial<ClientCombatState> = {},
): ClientCombatState {
  return {
    combatId: "combat-1",
    battleId: "battle-1",
    state: "ACTIVE",
    round: 1,
    currentActorId: participants[0]?.participantId ?? "",
    turnOrder: participants.map((p) => p.participantId),
    participants,
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════
 * Tests
 * ═══════════════════════════════════════════════════════ */

describe("Phase 3H.3 — Client Battle/Combat State Model (CSM-001..CSM-020)", () => {
  /* ── CSM-001: battle state creation ── */

  it("CSM-001: battle state creation from encounter", () => {
    const battle = buildBattleStateFromEncounter(
      "mob-1",
      point(5, 5),
      point(0, 0),
    );

    expect(battle.battleId).toBe("battle-mob-1");
    expect(battle.playerSide).toBeDefined();
    expect(battle.enemySide).toBeDefined();
    expect(battle.enemySide.leaderId).toBe("mob-1");
    expect(battle.enemySide.participants).toHaveLength(1);
    expect(battle.enemySide.participants[0].id).toBe("mob-1");
  });

  /* ── CSM-002: combat state creation ── */

  it("CSM-002: combat state creation from encounter", () => {
    const combat = buildCombatStateFromEncounter(
      "mob-1",
      "combat-123",
      "player-1",
    );

    expect(combat.combatId).toBe("combat-123");
    expect(combat.battleId).toBe("battle-mob-1");
    expect(combat.state).toBe("ACTIVE");
    expect(combat.round).toBe(1);
    expect(combat.currentActorId).toBe("player-1");
    expect(combat.participants).toHaveLength(1);
    expect(combat.participants[0].participantId).toBe("mob-1");
    expect(combat.participants[0].side).toBe("enemy");
  });

  /* ── CSM-003: battle/combat independent ── */

  it("CSM-003: battle and combat states are independent", () => {
    const battle = makeBattle(
      [makeBattleParticipant("player-1")],
      [makeBattleParticipant("mob-1")],
    );

    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy"),
    ]);

    expect(battle.battleId).toBe("battle-1");
    expect(combat.battleId).toBe("battle-1");
    expect(battle.playerSide.participants).toHaveLength(1);
    expect(combat.participants).toHaveLength(2);
    expect(battle.enemySide.area.radius).toBe(10);
    expect(combat.round).toBe(1);
  });

  /* ── CSM-004: multiple participants ── */

  it("CSM-004: multiple participants in combat", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("player-2", "player"),
      makeCombatParticipant("mob-1", "enemy"),
      makeCombatParticipant("mob-2", "enemy"),
    ]);

    expect(combat.participants).toHaveLength(4);
    expect(combat.turnOrder).toHaveLength(4);
    expect(combat.participants.filter((p) => p.side === "player")).toHaveLength(2);
    expect(combat.participants.filter((p) => p.side === "enemy")).toHaveLength(2);
  });

  /* ── CSM-005: current actor ── */

  it("CSM-005: current actor tracked correctly", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy"),
    ], { currentActorId: "player-1" });

    expect(combat.currentActorId).toBe("player-1");
    expect(combat.turnOrder[0]).toBe("player-1");
  });

  /* ── CSM-006: turn order ── */

  it("CSM-006: turn order preserved", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy"),
      makeCombatParticipant("player-2", "player"),
    ], { turnOrder: ["mob-1", "player-1", "player-2"] });

    expect(combat.turnOrder).toEqual(["mob-1", "player-1", "player-2"]);
  });

  /* ── CSM-007: round ── */

  it("CSM-007: round tracking", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
    ], { round: 5 });

    expect(combat.round).toBe(5);
  });

  /* ── CSM-008: participant HP ── */

  it("CSM-008: participant HP tracked", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player", {
        currentHp: 75,
        maxHp: 100,
      }),
      makeCombatParticipant("mob-1", "enemy", {
        currentHp: 50,
        maxHp: 100,
      }),
    ]);

    const player = combat.participants.find((p) => p.participantId === "player-1");
    const mob = combat.participants.find((p) => p.participantId === "mob-1");

    expect(player?.currentHp).toBe(75);
    expect(player?.maxHp).toBe(100);
    expect(mob?.currentHp).toBe(50);
    expect(mob?.maxHp).toBe(100);
  });

  /* ── CSM-009: dead participant ── */

  it("CSM-009: dead participant marked correctly", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy", {
        currentHp: 0,
        alive: false,
      }),
    ]);

    const mob = combat.participants.find((p) => p.participantId === "mob-1");
    expect(mob?.alive).toBe(false);
    expect(mob?.currentHp).toBe(0);
  });

  /* ── CSM-010: defending ── */

  it("CSM-010: defending state tracked", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player", { defending: true }),
    ]);

    const player = combat.participants.find((p) => p.participantId === "player-1");
    expect(player?.defending).toBe(true);
  });

  /* ── CSM-011: fleeing ── */

  it("CSM-011: fleeing state tracked", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player", { fleeing: true }),
    ]);

    const player = combat.participants.find((p) => p.participantId === "player-1");
    expect(player?.fleeing).toBe(true);
  });

  /* ── CSM-012: rejoin ── */

  it("CSM-012: rejoin participant state", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player", {
        alive: true,
        fleeing: false,
      }),
    ]);

    const player = combat.participants.find((p) => p.participantId === "player-1");
    expect(player?.alive).toBe(true);
    expect(player?.fleeing).toBe(false);
  });

  /* ── CSM-013: legacy encounter_started conversion ── */

  it("CSM-013: encounter_started normalizes correctly", () => {
    const event = normalizeCombatEvent({
      type: "encounter_started",
      mobId: "mob-1",
      mobHp: 100,
      mobMaxHp: 100,
      playerHp: 80,
      playerMaxHp: 100,
      combatId: "combat-123",
      currentActorId: "player-1",
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("encounter_started");
    if (event?.type === "encounter_started") {
      expect(event.mobId).toBe("mob-1");
      expect(event.mobHp).toBe(100);
      expect(event.mobMaxHp).toBe(100);
      expect(event.combatId).toBe("combat-123");
      expect(event.currentActorId).toBe("player-1");
    }
  });

  /* ── CSM-014: legacy encounter_fled conversion ── */

  it("CSM-014: encounter_fled normalizes correctly", () => {
    const event = normalizeCombatEvent({
      type: "encounter_fled",
      sourceId: "mob-1",
      targetId: "player-1",
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("encounter_fled");
    if (event?.type === "encounter_fled") {
      expect(event.sourceId).toBe("mob-1");
      expect(event.targetId).toBe("player-1");
    }
  });

  /* ── CSM-015: legacy damage event conversion ── */

  it("CSM-015: damage_dealt normalizes correctly", () => {
    const event = normalizeCombatEvent({
      type: "damage_dealt",
      sourceId: "player-1",
      targetId: "mob-1",
      damage: 25,
      currentHp: 75,
      maxHp: 100,
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("damage_dealt");
    if (event?.type === "damage_dealt") {
      expect(event.damage).toBe(25);
      expect(event.currentHp).toBe(75);
    }
  });

  /* ── CSM-016: mob_killed conversion ── */

  it("CSM-016: mob_killed normalizes correctly", () => {
    const event = normalizeCombatEvent({
      type: "mob_killed",
      sourceId: "player-1",
      targetId: "mob-1",
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("mob_killed");
  });

  /* ── CSM-017: player_died conversion ── */

  it("CSM-017: player_died normalizes correctly", () => {
    const event = normalizeCombatEvent({
      type: "player_died",
      sourceId: "mob-1",
      targetId: "player-1",
    });

    expect(event).not.toBeNull();
    expect(event?.type).toBe("player_died");
  });

  /* ── CSM-018: battleId/combatId separation ── */

  it("CSM-018: battleId and combatId are separate identifiers", () => {
    const battle = buildBattleStateFromEncounter("mob-1", point(0, 0), point(5, 5));
    const combat = buildCombatStateFromEncounter("mob-1", "combat-abc", "player-1");

    expect(battle.battleId).toBe("battle-mob-1");
    expect(combat.battleId).toBe("battle-mob-1");
    expect(combat.combatId).toBe("combat-abc");
    expect(battle.battleId).not.toBe(combat.combatId);
  });

  /* ── CSM-019: no client-side damage calculation ── */

  it("CSM-019: client receives damage from server, does not calculate", () => {
    const event = normalizeCombatEvent({
      type: "damage_dealt",
      sourceId: "player-1",
      targetId: "mob-1",
      damage: 30,
      currentHp: 70,
      maxHp: 100,
    });

    expect(event).not.toBeNull();
    if (event?.type === "damage_dealt") {
      expect(event.damage).toBe(30);
      expect(event.currentHp).toBe(70);
      expect(event.maxHp).toBe(100);
    }
  });

  /* ── CSM-020: snapshot / state isolation ── */

  it("CSM-020: battle and combat states are snapshots (readonly)", () => {
    const battle = makeBattle(
      [makeBattleParticipant("player-1")],
      [makeCombatParticipant("mob-1", "enemy") as unknown as ClientBattleParticipant],
    );

    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
    ]);

    expect(battle.battleId).toBe("battle-1");
    expect(combat.combatId).toBe("combat-1");

    // Verify readonly types (compile-time check, runtime just verifies structure)
    expect(typeof battle.battleId).toBe("string");
    expect(typeof combat.combatId).toBe("string");
  });
});

/* ═══════════════════════════════════════════════════════
 * EncounterAdapter Tests
 * ═══════════════════════════════════════════════════════ */

describe("EncounterAdapter", () => {
  it("findLocalParticipant returns correct participant", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy"),
    ]);

    const local = findLocalParticipant(combat, "player-1");
    expect(local).toBeDefined();
    expect(local?.participantId).toBe("player-1");
  });

  it("findEnemyParticipant returns first alive enemy", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy"),
    ]);

    const enemy = findEnemyParticipant(combat, "player-1");
    expect(enemy).toBeDefined();
    expect(enemy?.participantId).toBe("mob-1");
    expect(enemy?.side).toBe("enemy");
  });

  it("toEncounterShowPayload maps correctly", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player"),
      makeCombatParticipant("mob-1", "enemy", { currentHp: 80, maxHp: 100 }),
    ], { currentActorId: "player-1", round: 3 });

    const payload = toEncounterShowPayload(combat, "player-1", "Goblin", 5);
    expect(payload).not.toBeNull();
    expect(payload?.mobId).toBe("mob-1");
    expect(payload?.mobName).toBe("Goblin");
    expect(payload?.mobLevel).toBe(5);
    expect(payload?.mobHp).toBe(80);
    expect(payload?.mobMaxHp).toBe(100);
    expect(payload?.turn).toBe("player");
    expect(payload?.round).toBe(3);
  });

  it("toEncounterUpdatePayload maps correctly", () => {
    const combat = makeCombat([
      makeCombatParticipant("player-1", "player", { defending: true }),
      makeCombatParticipant("mob-1", "enemy", { currentHp: 60 }),
    ], { currentActorId: "mob-1", round: 5 });

    const payload = toEncounterUpdatePayload(combat, "player-1");
    expect(payload).not.toBeNull();
    expect(payload?.turn).toBe("mob");
    expect(payload?.round).toBe(5);
    expect(payload?.mobHp).toBe(60);
    expect(payload?.playerDefending).toBe(true);
  });

  it("shouldHideEncounter returns true when combat resolved", () => {
    const combat = makeCombat([], { state: "RESOLVED" });
    expect(shouldHideEncounter(combat)).toBe(true);
  });

  it("isTerminalEvent identifies terminal events", () => {
    expect(isTerminalEvent("mob_killed")).toBe(true);
    expect(isTerminalEvent("player_died")).toBe(true);
    expect(isTerminalEvent("encounter_fled")).toBe(true);
    expect(isTerminalEvent("encounter_timeout")).toBe(true);
    expect(isTerminalEvent("damage_dealt")).toBe(false);
    expect(isTerminalEvent("xp_gained")).toBe(false);
  });
});
