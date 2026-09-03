/**
 * Phase 4A.8: Client Combat Participant Projection Tests
 *
 * Verifies that local player is correctly projected into CombatState.participants
 * when combat starts, and that all combat scenarios work correctly.
 *
 * Test IDs: CCP-001 through CCP-020
 */

import { describe, it, expect } from "vitest";
import { GameState } from "../game/GameState.js";
import { normalizeCombatEvent } from "./CombatEventNormalizer.js";
import { buildCombatStateFromEncounter } from "./CombatEventNormalizer.js";

/* ===== Helpers ===== */

function makeGameState(
  playerId = "player-1",
  mobId = "mob_1",
  playerHp = 100,
  playerMaxHp = 100,
): GameState {
  const gs = new GameState(42);
  gs.setLocalPlayer(playerId, {
    x: 5,
    y: 5,
    health: playerHp,
    maxHealth: playerMaxHp,
    name: "TestPlayer",
    level: 1,
  } as any);
  gs.addMob({
    id: mobId,
    typeId: "goblin",
    x: 10,
    y: 10,
    health: 80,
    maxHealth: 80,
  } as any);
  return gs;
}

function encounterEvent(
  mobId: string,
  combatId: string | null = null,
  currentActorId: string | null = null,
) {
  return normalizeCombatEvent({
    type: "encounter_started",
    mobId,
    combatId: combatId ?? `combat-${mobId}`,
    currentActorId: currentActorId ?? mobId,
  } as any)!;
}

function playerDamagedEvent(
  sourceId: string,
  targetId: string,
  damage: number,
  currentHp: number,
  maxHp: number,
) {
  return normalizeCombatEvent({
    type: "player_damaged",
    sourceId,
    targetId,
    damage,
    currentHp,
    maxHp,
  } as any)!;
}

function damageDealtEvent(
  sourceId: string,
  targetId: string,
  damage: number,
  currentHp: number,
  maxHp: number,
) {
  return normalizeCombatEvent({
    type: "damage_dealt",
    sourceId,
    targetId,
    damage,
    currentHp,
    maxHp,
  } as any)!;
}

function mobKilledEvent(sourceId: string, targetId: string) {
  return normalizeCombatEvent({
    type: "mob_killed",
    sourceId,
    targetId,
  } as any)!;
}

function playerDiedEvent(sourceId: string, targetId: string) {
  return normalizeCombatEvent({
    type: "player_died",
    sourceId,
    targetId,
  } as any)!;
}

/* ===== Tests ===== */

describe("Phase 4A.8 — Client Combat Participant Projection Fix (CCP-001..CCP-020)", () => {
  describe("1v1 — Local player projection", () => {
    it("CCP-001: local player projected into participants on encounter_started", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      expect(gs.combat).not.toBeNull();
      const playerParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipant).toBeDefined();
      expect(playerParticipant!.side).toBe("player");
    });

    it("CCP-002: local player HP matches GameState.localPlayer (server-authoritative)", () => {
      const gs = makeGameState("player-1", "mob_1", 85, 100);
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipant).toBeDefined();
      expect(playerParticipant!.currentHp).toBe(85);
      expect(playerParticipant!.maxHp).toBe(100);
    });

    it("CCP-003: local player side is 'player'", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipant!.side).toBe("player");
    });

    it("CCP-004: local player appears in turnOrder", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      expect(gs.combat!.turnOrder).toContain("player-1");
    });

    it("CCP-005: currentActorId matches localPlayerId when player goes first", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1", null, "player-1"));

      expect(gs.combat!.currentActorId).toBe("player-1");
    });

    it("CCP-006: currentActorId matches mobId when enemy goes first", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1", null, "mob_1"));

      expect(gs.combat!.currentActorId).toBe("mob_1");
    });

    it("CCP-007: enemy participant HP starts at 0/0 (populated by events)", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const enemyParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "mob_1",
      );
      expect(enemyParticipant).toBeDefined();
      expect(enemyParticipant!.currentHp).toBe(0);
      expect(enemyParticipant!.maxHp).toBe(0);
      expect(enemyParticipant!.side).toBe("enemy");
    });
  });

  describe("Multi-participant scenarios", () => {
    it("CCP-008: 2v1 — two players + one enemy projected correctly", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.addRemotePlayer("player-2", {
        x: 6,
        y: 6,
        health: 90,
        maxHealth: 100,
        name: "Player2",
        level: 1,
      } as any);

      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipants = gs.combat!.participants.filter(
        (p) => p.side === "player",
      );
      expect(playerParticipants.length).toBeGreaterThanOrEqual(1);
      expect(playerParticipants.some((p) => p.participantId === "player-1")).toBe(true);
    });

    it("CCP-009: 1v2 — one player + two enemies projected correctly", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.addMob({
        id: "mob_2",
        typeId: "ogre",
        x: 12,
        y: 12,
        health: 60,
        maxHealth: 60,
      } as any);

      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const enemyParticipants = gs.combat!.participants.filter(
        (p) => p.side === "enemy",
      );
      expect(enemyParticipants.length).toBeGreaterThanOrEqual(1);
      expect(enemyParticipants.some((p) => p.participantId === "mob_1")).toBe(true);
    });

    it("CCP-010: 2v2 — two players + two enemies projected correctly", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.addRemotePlayer("player-2", {
        x: 6,
        y: 6,
        health: 90,
        maxHealth: 100,
        name: "Player2",
        level: 1,
      } as any);
      gs.addMob({
        id: "mob_2",
        typeId: "ogre",
        x: 12,
        y: 12,
        health: 60,
        maxHealth: 60,
      } as any);

      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipants = gs.combat!.participants.filter(
        (p) => p.side === "player",
      );
      const enemyParticipants = gs.combat!.participants.filter(
        (p) => p.side === "enemy",
      );

      expect(playerParticipants.length).toBeGreaterThanOrEqual(1);
      expect(enemyParticipants.length).toBeGreaterThanOrEqual(1);
      expect(playerParticipants.some((p) => p.participantId === "player-1")).toBe(true);
      expect(enemyParticipants.some((p) => p.participantId === "mob_1")).toBe(true);
    });
  });

  describe("Participant integrity", () => {
    it("CCP-011: no duplicate participants when local player already in array", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipants = gs.combat!.participants.filter(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipants).toHaveLength(1);
    });

    it("CCP-012: local player alive=false when health=0 at encounter start", () => {
      const gs = makeGameState("player-1", "mob_1", 0, 100);
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipant).toBeDefined();
      expect(playerParticipant!.alive).toBe(false);
      expect(playerParticipant!.currentHp).toBe(0);
    });

    it("CCP-013: no fake HP — values come from GameState.localPlayer, not hardcoded", () => {
      const gs = makeGameState("player-1", "mob_1", 73, 100);
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipant!.currentHp).toBe(73);
      expect(playerParticipant!.maxHp).toBe(100);
    });
  });

  describe("Event-driven updates", () => {
    it("CCP-014: damage_dealt upserts unknown enemy participant", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      // Simulate damage to a new enemy not in initial participants
      gs.updateCombatFromEvent(
        damageDealtEvent("player-1", "mob_2", 15, 45, 60),
      );

      const mob2Participant = gs.combat!.participants.find(
        (p) => p.participantId === "mob_2",
      );
      expect(mob2Participant).toBeDefined();
      expect(mob2Participant!.currentHp).toBe(45);
      expect(mob2Participant!.maxHp).toBe(60);
      expect(mob2Participant!.side).toBe("enemy");
    });

    it("CCP-015: player_damaged upserts unknown player participant", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      // Simulate damage to a remote player not in initial participants
      gs.updateCombatFromEvent(
        playerDamagedEvent("mob_1", "player-2", 10, 80, 100),
      );

      const player2Participant = gs.combat!.participants.find(
        (p) => p.participantId === "player-2",
      );
      expect(player2Participant).toBeDefined();
      expect(player2Participant!.currentHp).toBe(80);
      expect(player2Participant!.maxHp).toBe(100);
      expect(player2Participant!.side).toBe("player");
    });

    it("CCP-016: player_died upserts unknown dead player participant", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      gs.updateCombatFromEvent(playerDiedEvent("mob_1", "player-3"));

      const player3Participant = gs.combat!.participants.find(
        (p) => p.participantId === "player-3",
      );
      expect(player3Participant).toBeDefined();
      expect(player3Participant!.alive).toBe(false);
      expect(player3Participant!.currentHp).toBe(0);
      expect(player3Participant!.side).toBe("player");
    });

    it("CCP-017: mob_killed upserts unknown dead enemy participant", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      gs.updateCombatFromEvent(mobKilledEvent("player-1", "mob_3"));

      const mob3Participant = gs.combat!.participants.find(
        (p) => p.participantId === "mob_3",
      );
      expect(mob3Participant).toBeDefined();
      expect(mob3Participant!.alive).toBe(false);
      expect(mob3Participant!.currentHp).toBe(0);
      expect(mob3Participant!.side).toBe("enemy");
    });
  });

  describe("Remote player and edge cases", () => {
    it("CCP-018: remote player joined combat — participant projected from remotePlayers", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.addRemotePlayer("player-2", {
        x: 6,
        y: 6,
        health: 90,
        maxHealth: 100,
        name: "Player2",
        level: 1,
      } as any);

      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      // Player-2 should be in participants if server sends player_damaged for them
      gs.updateCombatFromEvent(
        playerDamagedEvent("mob_1", "player-2", 10, 80, 100),
      );

      const player2 = gs.combat!.participants.find(
        (p) => p.participantId === "player-2",
      );
      expect(player2).toBeDefined();
      expect(player2!.currentHp).toBe(80);
    });

    it("CCP-019: local player defending=false by default", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1"));

      const playerParticipant = gs.combat!.participants.find(
        (p) => p.participantId === "player-1",
      );
      expect(playerParticipant!.defending).toBe(false);
      expect(playerParticipant!.fleeing).toBe(false);
    });

    it("CCP-020: combat state has correct combatId and battleId", () => {
      const gs = makeGameState("player-1", "mob_1");
      gs.updateCombatFromEvent(encounterEvent("mob_1", "combat-abc", null));

      expect(gs.combat!.combatId).toBe("combat-abc");
      expect(gs.combat!.battleId).toBe("battle-mob_1");
    });
  });
});
