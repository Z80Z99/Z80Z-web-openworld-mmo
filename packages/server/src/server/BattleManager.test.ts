// allow: SIZE_OK - required BM contract matrix stays in the mandated test file.
import {
  DEFAULT_BATTLE_RULES_CONFIG,
  type BattleGroup,
  type BattleParticipant,
  type BattleRulesConfig,
  type CombatPoint,
  type ParticipantState,
} from "@mmo/shared";
import {
  calculateBattleAreaRadius,
  selectNewLeader,
} from "@mmo/shared/dist/battle/rules.js";
import { describe, expect, it } from "vitest";
import {
  BattleManager,
  type BattleManagerError,
} from "./BattleManager.js";

type BattleResult =
  | { readonly battle: BattleGroup }
  | { readonly error: BattleManagerError };

type BattleFixture = {
  readonly id?: string;
  readonly player?: BattleParticipant;
  readonly enemy?: BattleParticipant;
};

const point = (x: number, y: number): CombatPoint => ({ x, y });

function participant(
  id: string,
  position: CombatPoint,
  state: ParticipantState = "ACTIVE",
): BattleParticipant {
  return {
    id,
    position,
    combatPower: 10,
    personality: "cautious",
    state,
  };
}

function battleOf(result: BattleResult): BattleGroup {
  expect(result).not.toHaveProperty("error");
  if ("battle" in result) return result.battle;
  return expect.fail(`Expected battle result, received ${result.error}`);
}

function expectError(result: unknown, error: BattleManagerError): void {
  expect(result).toEqual({ error });
}

function createBattle(
  manager: BattleManager,
  fixture: BattleFixture = {},
): BattleGroup {
  return battleOf(
    manager.createBattle(
      fixture.id ?? "battle",
      fixture.player ?? participant("player-1", point(0, 0)),
      fixture.enemy ?? participant("enemy-1", point(1, 0)),
    ),
  );
}

describe("BattleManager runtime", () => {
  it("BM-001 creates a 1v1 battle with leader-owned areas", () => {
    // Given
    const manager = new BattleManager();
    const player = participant("player-1", point(2, 3));
    const enemy = participant("enemy-1", point(4, 5));

    // When
    const battle = battleOf(manager.createBattle("battle", player, enemy));

    // Then
    expect(battle.id).toBe("battle");
    expect(battle.playerSide.participants).toHaveLength(1);
    expect(battle.enemySide.participants).toHaveLength(1);
    expect(battle.playerSide.leaderId).toBe(player.id);
    expect(battle.enemySide.leaderId).toBe(enemy.id);
    expect(battle.playerSide.area.center).toEqual(player.position);
    expect(battle.enemySide.area.center).toEqual(enemy.position);
    expect(battle.playerSide.area.radius).toBe(calculateBattleAreaRadius(1));
    expect(battle.enemySide.area.radius).toBe(calculateBattleAreaRadius(1));
  });

  it("BM-002 returns isolated snapshots and undefined for an unknown battle", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);

    // When
    const first = manager.getBattle("battle");
    const missing = manager.getBattle("missing");
    expect(first).toBeDefined();
    if (!first) return;
    Object.assign(first, { id: "corrupted" });
    Object.assign(first.playerSide.area.center, { x: 999 });
    const firstParticipant = first.playerSide.participants[0];
    if (firstParticipant) Object.assign(firstParticipant.position, { y: 999 });
    const second = manager.getBattle("battle");

    // Then
    expect(missing).toBeUndefined();
    expect(second?.id).toBe("battle");
    expect(second?.playerSide.area.center).toEqual(point(0, 0));
    expect(second?.playerSide.participants[0]?.position).toEqual(point(0, 0));
    expect(second).not.toBe(first);
    expect(second?.playerSide).not.toBe(first.playerSide);
  });

  it("BM-003 looks up both participant sides and isolates lookup snapshots", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);

    // When
    const playerLookup = manager.getBattleByParticipant("player-1");
    const enemyLookup = manager.getBattleByParticipant("enemy-1");
    const missing = manager.getBattleByParticipant("unknown");
    if (playerLookup) Object.assign(playerLookup.battle.playerSide.area.center, { x: 50 });

    // Then
    expect(playerLookup?.sideId).toBe("player");
    expect(enemyLookup?.sideId).toBe("enemy");
    expect(missing).toBeUndefined();
    expect(manager.getBattle("battle")?.playerSide.area.center).toEqual(point(0, 0));
  });

  it("BM-004 blocks a duplicate participant on either side without side effects", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    const before = manager.getBattle("battle");
    const duplicate = participant("player-1", point(10, 10));

    // When
    const sameSide = manager.addParticipant("battle", "player", duplicate);
    const otherSide = manager.addParticipant("battle", "enemy", duplicate);

    // Then
    expectError(sameSide, "PARTICIPANT_ALREADY_IN_THIS_BATTLE");
    expectError(otherSide, "PARTICIPANT_ALREADY_IN_THIS_BATTLE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-005 blocks a participant from joining a second battle atomically", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager, { id: "battle-a" });
    createBattle(manager, {
      id: "battle-b",
      player: participant("player-2", point(2, 0)),
      enemy: participant("enemy-2", point(3, 0)),
    });
    const before = manager.getBattle("battle-b");

    // When
    const result = manager.addParticipant(
      "battle-b",
      "player",
      participant("player-1", point(4, 0)),
    );

    // Then
    expectError(result, "PARTICIPANT_ALREADY_IN_BATTLE");
    expect(manager.getBattle("battle-b")).toEqual(before);
    expect(manager.getBattleByParticipant("player-1")?.battle.id).toBe("battle-a");
  });

  it("BM-006 adds an ally in insertion order and expands the player area", () => {
    // Given
    const manager = new BattleManager();
    const initial = createBattle(manager);
    const ally = participant("player-2", point(2, 0));

    // When
    const battle = battleOf(manager.addParticipant("battle", "player", ally));

    // Then
    expect(battle.playerSide.participants.map(({ id }) => id)).toEqual([
      "player-1",
      "player-2",
    ]);
    expect(battle.enemySide.participants).toHaveLength(1);
    expect(battle.playerSide.area.radius).toBeGreaterThan(initial.playerSide.area.radius);
    expect(battle.playerSide.area.center).toEqual(initial.playerSide.area.center);
  });

  it("BM-007 adds an enemy without changing the player side", () => {
    // Given
    const manager = new BattleManager();
    const initial = createBattle(manager);

    // When
    const battle = battleOf(
      manager.addParticipant(
        "battle",
        "enemy",
        participant("enemy-2", point(3, 0)),
      ),
    );

    // Then
    expect(battle.playerSide).toEqual(initial.playerSide);
    expect(battle.enemySide.participants.map(({ id }) => id)).toEqual([
      "enemy-1",
      "enemy-2",
    ]);
    expect(battle.enemySide.area.radius).toBe(calculateBattleAreaRadius(2));
  });

  it("BM-008 recalculates radius from the new participant count", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);

    // When
    const two = battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(2, 0))),
    );
    const three = battleOf(
      manager.addParticipant("battle", "player", participant("player-3", point(3, 0))),
    );

    // Then
    expect(two.playerSide.area.radius).toBe(calculateBattleAreaRadius(2));
    expect(three.playerSide.area.radius).toBe(calculateBattleAreaRadius(3));
    expect(three.playerSide.area.radius).toBeGreaterThan(two.playerSide.area.radius);
  });

  it("BM-009 shrinks radius after removing a side member", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    const expanded = battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(2, 0))),
    );

    // When
    const battle = battleOf(manager.removeParticipant("battle", "player-2"));

    // Then
    expect(battle.playerSide.area.radius).toBe(calculateBattleAreaRadius(1));
    expect(battle.playerSide.area.radius).toBeLessThan(expanded.playerSide.area.radius);
  });

  it("BM-010 removes a non-leader and clears its reverse lookup", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(2, 0))),
    );

    // When
    const battle = battleOf(manager.removeParticipant("battle", "player-2"));

    // Then
    expect(battle.playerSide.participants.map(({ id }) => id)).toEqual(["player-1"]);
    expect(battle.playerSide.leaderId).toBe("player-1");
    expect(manager.getBattleByParticipant("player-2")).toBeUndefined();
    expect(manager.getBattleByParticipant("player-1")?.sideId).toBe("player");
  });

  it("BM-011 selects the first active successor when a leader is removed", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(
      manager.addParticipant(
        "battle",
        "player",
        participant("player-fleeing", point(5, 0), "FLEEING"),
      ),
    );
    const successor = participant("player-2", point(7, 8));
    battleOf(manager.addParticipant("battle", "player", successor));

    // When
    const battle = battleOf(manager.removeParticipant("battle", "player-1"));

    // Then
    expect(selectNewLeader(battle.playerSide.participants)?.id).toBe(successor.id);
    expect(battle.playerSide.leaderId).toBe(successor.id);
    expect(battle.playerSide.area.center).toEqual(successor.position);
  });

  it("BM-012 transfers leadership and rejects off-side or dead leaders atomically", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    const newLeader = participant("player-2", point(6, 7));
    const dead = participant("player-dead", point(8, 9));
    battleOf(manager.addParticipant("battle", "player", newLeader));
    battleOf(manager.addParticipant("battle", "player", dead));
    battleOf(manager.updateParticipantState("battle", dead.id, "ELIMINATED"));

    // When
    const transferred = battleOf(manager.transferLeader("battle", "player", newLeader.id));
    const beforeFailures = manager.getBattle("battle");
    const offSide = manager.transferLeader("battle", "player", "enemy-1");
    const deadResult = manager.transferLeader("battle", "player", dead.id);

    // Then
    expect(transferred.playerSide.leaderId).toBe(newLeader.id);
    expect(transferred.playerSide.area.center).toEqual(newLeader.position);
    expectError(offSide, "LEADER_NOT_ON_SIDE");
    expectError(deadResult, "PARTICIPANT_DEAD");
    expect(manager.getBattle("battle")).toEqual(beforeFailures);
  });

  it("BM-013 eliminates a side when its final active survivor dies", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(2, 0))),
    );
    battleOf(manager.updateParticipantState("battle", "player-1", "ELIMINATED"));

    // When
    const battle = battleOf(
      manager.updateParticipantState("battle", "player-2", "ELIMINATED"),
    );

    // Then
    expect(battle.playerSide.state).toBe("ELIMINATED");
    expect(battle.playerSide.leaderId).toBeNull();
    expect(battle.playerSide.participants).toHaveLength(2);
    expect(manager.hasBattle("battle")).toBe(true);
  });

  it("BM-013b eliminates a side when its final survivor is removed", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);

    // When
    const battle = battleOf(manager.removeParticipant("battle", "player-1"));

    // Then
    expect(battle.playerSide.state).toBe("ELIMINATED");
    expect(battle.playerSide.leaderId).toBeNull();
    expect(battle.playerSide.participants).toEqual([]);
    expect(manager.hasBattle("battle")).toBe(true);
  });

  it("BM-014 resolves only after both leaders are outside opposing areas", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);

    // When
    const premature = manager.removeBattle("battle");
    battleOf(manager.updateBattleArea("battle", "player-1", point(-100, 0)));
    battleOf(manager.updateBattleArea("battle", "enemy-1", point(100, 0)));
    const removed = manager.removeBattle("battle");

    // Then
    expectError(premature, "BATTLE_NOT_RESOLVED");
    expect(removed).toEqual({ removedBattleId: "battle" });
    expect(manager.hasBattle("battle")).toBe(false);
  });

  it("BM-015 removes the battle, every index entry, and rejects a second removal", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("player-1", point(-100, 0)),
      enemy: participant("enemy-1", point(100, 0)),
    });
    battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(-99, 0))),
    );
    battleOf(
      manager.addParticipant("battle", "enemy", participant("enemy-2", point(99, 0))),
    );

    // When
    const removed = manager.removeBattle("battle");
    const second = manager.removeBattle("battle");

    // Then
    expect(removed).toEqual({ removedBattleId: "battle" });
    expect(manager.getBattle("battle")).toBeUndefined();
    expect(manager.hasBattle("battle")).toBe(false);
    for (const id of ["player-1", "player-2", "enemy-1", "enemy-2"]) {
      expect(manager.getBattleByParticipant(id)).toBeUndefined();
    }
    expectError(second, "BATTLE_NOT_FOUND");
  });

  it("BM-016 produces identical snapshots for identical operation sequences", () => {
    // Given
    const first = new BattleManager();
    const second = new BattleManager();
    const managers = [first, second] as const;

    // When
    for (const manager of managers) {
      createBattle(manager);
      battleOf(
        manager.addParticipant("battle", "player", participant("player-2", point(3, 4))),
      );
      battleOf(manager.updateParticipantState("battle", "enemy-1", "FLEEING"));
      battleOf(manager.transferLeader("battle", "player", "player-2"));
      battleOf(manager.updateBattleArea("battle", "player-1", point(8, 9)));
      battleOf(manager.removeParticipant("battle", "player-1"));
    }

    // Then
    expect(first.getBattle("battle")).toEqual(second.getBattle("battle"));
    expect(first.getBattleByParticipant("player-2")).toEqual(
      second.getBattleByParticipant("player-2"),
    );
  });
});

describe("BattleManager ordered guards", () => {
  it.each(["", "   "])("BM-G01 rejects invalid battle id %j", (battleId) => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.createBattle(
      battleId,
      participant("player-1", point(0, 0)),
      participant("enemy-1", point(1, 0)),
    );

    // Then
    expectError(result, "INVALID_BATTLE_ID");
    expect(manager.hasBattle(battleId)).toBe(false);
    expect(manager.getBattleByParticipant("player-1")).toBeUndefined();
  });

  it("BM-G02 rejects a non-string battle id without throwing", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result: unknown = Reflect.apply(manager.createBattle, manager, [
      42,
      participant("player-1", point(0, 0)),
      participant("enemy-1", point(1, 0)),
    ]);

    // Then
    expectError(result, "INVALID_BATTLE_ID");
    expect(manager.getBattleByParticipant("player-1")).toBeUndefined();
  });

  it("BM-G03 checks duplicate battle id before missing participants", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result = manager.createBattle("battle", undefined, undefined);

    // Then
    expectError(result, "BATTLE_ALREADY_EXISTS");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G04 checks a missing player before a missing enemy", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.createBattle("battle", undefined, undefined);

    // Then
    expectError(result, "PARTICIPANT_NOT_FOUND");
    expect(manager.hasBattle("battle")).toBe(false);
  });

  it("BM-G05 rejects a missing enemy atomically", () => {
    // Given
    const manager = new BattleManager();
    const player = participant("player-1", point(0, 0));

    // When
    const result = manager.createBattle("battle", player, undefined);

    // Then
    expectError(result, "PARTICIPANT_NOT_FOUND");
    expect(manager.hasBattle("battle")).toBe(false);
    expect(manager.getBattleByParticipant(player.id)).toBeUndefined();
  });

  it("BM-G06 checks equal participant ids before dead state", () => {
    // Given
    const manager = new BattleManager();
    const dead = participant("same", point(0, 0), "ELIMINATED");

    // When
    const result = manager.createBattle("battle", dead, dead);

    // Then
    expectError(result, "PARTICIPANT_ALREADY_IN_THIS_BATTLE");
    expect(manager.hasBattle("battle")).toBe(false);
  });

  it("BM-G07 checks a dead player before a dead enemy", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.createBattle(
      "battle",
      participant("player-1", point(0, 0), "ELIMINATED"),
      participant("enemy-1", point(1, 0), "ELIMINATED"),
    );

    // Then
    expectError(result, "PARTICIPANT_DEAD");
    expect(manager.hasBattle("battle")).toBe(false);
  });

  it("BM-G08 rejects a dead enemy atomically", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.createBattle(
      "battle",
      participant("player-1", point(0, 0)),
      participant("enemy-1", point(1, 0), "ELIMINATED"),
    );

    // Then
    expectError(result, "PARTICIPANT_DEAD");
    expect(manager.hasBattle("battle")).toBe(false);
    expect(manager.getBattleByParticipant("player-1")).toBeUndefined();
  });

  it("BM-G09 checks the indexed player before the indexed enemy", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager, { id: "battle-a" });

    // When
    const result = manager.createBattle(
      "battle-b",
      participant("player-1", point(10, 0)),
      participant("enemy-1", point(11, 0)),
    );

    // Then
    expectError(result, "PARTICIPANT_ALREADY_IN_BATTLE");
    expect(manager.hasBattle("battle-b")).toBe(false);
  });

  it("BM-G10 rejects an indexed enemy without committing the player", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager, { id: "battle-a" });
    const player = participant("player-2", point(10, 0));

    // When
    const result = manager.createBattle(
      "battle-b",
      player,
      participant("enemy-1", point(11, 0)),
    );

    // Then
    expectError(result, "PARTICIPANT_ALREADY_IN_BATTLE");
    expect(manager.hasBattle("battle-b")).toBe(false);
    expect(manager.getBattleByParticipant(player.id)).toBeUndefined();
  });

  it("BM-G11 checks unknown battle before invalid side and missing participant", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result: unknown = Reflect.apply(manager.addParticipant, manager, [
      "missing",
      "invalid",
      undefined,
    ]);

    // Then
    expectError(result, "BATTLE_NOT_FOUND");
  });

  it("BM-G12 checks invalid side before a missing participant", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result: unknown = Reflect.apply(manager.addParticipant, manager, [
      "battle",
      "invalid",
      undefined,
    ]);

    // Then
    expectError(result, "INVALID_SIDE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G13 rejects a missing participant without changing the side", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result = manager.addParticipant("battle", "player", undefined);

    // Then
    expectError(result, "PARTICIPANT_NOT_FOUND");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G14 checks same-battle membership before dead state", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result = manager.addParticipant(
      "battle",
      "player",
      participant("player-1", point(9, 9), "ELIMINATED"),
    );

    // Then
    expectError(result, "PARTICIPANT_ALREADY_IN_THIS_BATTLE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G15 checks other-battle membership before dead state", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager, { id: "battle-a" });
    const before = createBattle(manager, {
      id: "battle-b",
      player: participant("player-2", point(2, 0)),
      enemy: participant("enemy-2", point(3, 0)),
    });

    // When
    const result = manager.addParticipant(
      "battle-b",
      "player",
      participant("player-1", point(9, 9), "ELIMINATED"),
    );

    // Then
    expectError(result, "PARTICIPANT_ALREADY_IN_BATTLE");
    expect(manager.getBattle("battle-b")).toEqual(before);
  });

  it("BM-G16 rejects a dead participant without adding an index entry", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);
    const dead = participant("player-dead", point(2, 0), "ELIMINATED");

    // When
    const result = manager.addParticipant("battle", "player", dead);

    // Then
    expectError(result, "PARTICIPANT_DEAD");
    expect(manager.getBattle("battle")).toEqual(before);
    expect(manager.getBattleByParticipant(dead.id)).toBeUndefined();
  });

  it("BM-G17 rejects adding to an eliminated side without reviving it", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    const eliminated = battleOf(manager.removeParticipant("battle", "player-1"));
    const replacement = participant("player-2", point(2, 0));

    // When
    const result = manager.addParticipant("battle", "player", replacement);

    // Then
    expect(result).toHaveProperty("error");
    expect(manager.getBattle("battle")).toEqual(eliminated);
    expect(manager.getBattleByParticipant(replacement.id)).toBeUndefined();
  });

  it("BM-G18 rejects removal from an unknown battle", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.removeParticipant("missing", "player-1");

    // Then
    expectError(result, "BATTLE_NOT_FOUND");
  });

  it("BM-G19 rejects removal of a participant with no index", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result = manager.removeParticipant("battle", "unknown");

    // Then
    expectError(result, "PARTICIPANT_NOT_IN_BATTLE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G20 rejects removal through the wrong battle", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager, { id: "battle-a" });
    createBattle(manager, {
      id: "battle-b",
      player: participant("player-2", point(2, 0)),
      enemy: participant("enemy-2", point(3, 0)),
    });

    // When
    const result = manager.removeParticipant("battle-a", "player-2");

    // Then
    expectError(result, "PARTICIPANT_NOT_IN_BATTLE");
    expect(manager.getBattle("battle-a")).toEqual(before);
    expect(manager.getBattleByParticipant("player-2")?.battle.id).toBe("battle-b");
  });

  it("BM-G21 rejects state updates for an unknown battle", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.updateParticipantState("missing", "player-1", "ELIMINATED");

    // Then
    expectError(result, "BATTLE_NOT_FOUND");
  });

  it("BM-G22 rejects state updates for a non-member", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result = manager.updateParticipantState("battle", "unknown", "ELIMINATED");

    // Then
    expectError(result, "PARTICIPANT_NOT_IN_BATTLE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G23 rejects an invalid participant state without mutation", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result: unknown = Reflect.apply(manager.updateParticipantState, manager, [
      "battle",
      "player-1",
      "INVALID",
    ]);

    // Then
    expect(result).toHaveProperty("error");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G24 rejects leader transfer for an unknown battle", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.transferLeader("missing", "player");

    // Then
    expectError(result, "BATTLE_NOT_FOUND");
  });

  it("BM-G25 rejects an invalid transfer side before leader lookup", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result: unknown = Reflect.apply(manager.transferLeader, manager, [
      "battle",
      "invalid",
      "unknown",
    ]);

    // Then
    expectError(result, "INVALID_SIDE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G26 auto-selects the first active leader when no id is supplied", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(5, 6))),
    );
    battleOf(manager.updateParticipantState("battle", "player-1", "FLEEING"));

    // When
    const battle = battleOf(manager.transferLeader("battle", "player"));

    // Then
    expect(battle.playerSide.leaderId).toBe("player-2");
    expect(battle.playerSide.area.center).toEqual(point(5, 6));
  });

  it("BM-G27 eliminates a side when automatic leader selection has no candidate", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(manager.updateParticipantState("battle", "player-1", "FLEEING"));

    // When
    const battle = battleOf(manager.transferLeader("battle", "player"));

    // Then
    expect(battle.playerSide.leaderId).toBeNull();
    expect(battle.playerSide.state).toBe("ELIMINATED");
  });

  it("BM-G28 rejects area updates for an unknown battle", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.updateBattleArea("missing", "player-1", point(2, 3));

    // Then
    expectError(result, "BATTLE_NOT_FOUND");
  });

  it("BM-G29 rejects area updates for a non-member", () => {
    // Given
    const manager = new BattleManager();
    const before = createBattle(manager);

    // When
    const result = manager.updateBattleArea("battle", "unknown", point(2, 3));

    // Then
    expectError(result, "PARTICIPANT_NOT_IN_BATTLE");
    expect(manager.getBattle("battle")).toEqual(before);
  });

  it("BM-G30 rejects removing an unknown battle", () => {
    // Given
    const manager = new BattleManager();

    // When
    const result = manager.removeBattle("missing");

    // Then
    expectError(result, "BATTLE_NOT_FOUND");
  });
});

describe("BattleManager ownership and configuration", () => {
  it("BM-R01 copies create inputs instead of retaining caller references", () => {
    // Given
    const manager = new BattleManager();
    const player = {
      id: "player-1",
      position: { x: 0, y: 0 },
      combatPower: 10,
      personality: "cautious",
      state: "ACTIVE",
    } satisfies BattleParticipant;

    // When
    createBattle(manager, { player });
    player.position.x = 500;
    player.combatPower = 500;
    const battle = manager.getBattle("battle");

    // Then
    expect(battle?.playerSide.participants[0]?.position).toEqual(point(0, 0));
    expect(battle?.playerSide.participants[0]?.combatPower).toBe(10);
    expect(battle?.playerSide.area.center).toEqual(point(0, 0));
  });

  it("BM-R02 copies add inputs and returns an isolated mutation snapshot", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    const ally = {
      id: "player-2",
      position: { x: 2, y: 3 },
      combatPower: 20,
      personality: "aggressive",
      state: "ACTIVE",
    } satisfies BattleParticipant;

    // When
    const returned = battleOf(manager.addParticipant("battle", "player", ally));
    ally.position.x = 200;
    const returnedAlly = returned.playerSide.participants[1];
    if (returnedAlly) Object.assign(returnedAlly.position, { y: 300 });
    const stored = manager.getBattle("battle");

    // Then
    expect(stored?.playerSide.participants[1]?.position).toEqual(point(2, 3));
    expect(stored?.playerSide.participants[1]?.combatPower).toBe(20);
  });

  it("BM-R03 copies update positions and moves only a leader-owned center", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(
      manager.addParticipant("battle", "player", participant("player-2", point(2, 0))),
    );
    const leaderPosition = { x: 10, y: 11 };
    const memberPosition = { x: 20, y: 21 };

    // When
    const leaderUpdate = battleOf(
      manager.updateBattleArea("battle", "player-1", leaderPosition),
    );
    const radius = leaderUpdate.playerSide.area.radius;
    const memberUpdate = battleOf(
      manager.updateBattleArea("battle", "player-2", memberPosition),
    );
    leaderPosition.x = 100;
    memberPosition.x = 200;

    // Then
    expect(memberUpdate.playerSide.area.center).toEqual(point(10, 11));
    expect(memberUpdate.playerSide.area.radius).toBe(radius);
    expect(memberUpdate.playerSide.participants[1]?.position).toEqual(point(20, 21));
    expect(manager.getBattle("battle")?.playerSide.area.center).toEqual(point(10, 11));
  });

  it("BM-R04 copies custom config and leaves the shared default untouched", () => {
    // Given
    const custom = {
      area: {
        baseRadius: 2,
        expansionRate: 10,
        diminishingReturnScale: 2,
        maxRadius: 20,
      },
      engagement: {
        maxEngagementDistance: 7,
        cowardFleeRatio: 0.5,
        cowardEngageRatio: 1.5,
        cautiousEngageRatio: 1,
      },
    } satisfies BattleRulesConfig;
    const expectedRadius = calculateBattleAreaRadius(1, custom.area);
    const defaultRadius = calculateBattleAreaRadius(1, DEFAULT_BATTLE_RULES_CONFIG.area);
    const manager = new BattleManager(custom);

    // When
    custom.area.baseRadius = 18;
    custom.area.expansionRate = 1;
    const battle = createBattle(manager);

    // Then
    expect(battle.playerSide.area.radius).toBe(expectedRadius);
    expect(calculateBattleAreaRadius(1, DEFAULT_BATTLE_RULES_CONFIG.area)).toBe(defaultRadius);
  });

  it("BM-R05 keeps a state update snapshot isolated from runtime state", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);

    // When
    const returned = battleOf(
      manager.updateParticipantState("battle", "player-1", "FLEEING"),
    );
    const returnedPlayer = returned.playerSide.participants[0];
    if (returnedPlayer) Object.assign(returnedPlayer, { state: "ELIMINATED" });

    // Then
    expect(manager.getBattle("battle")?.playerSide.participants[0]?.state).toBe("FLEEING");
  });

  it("BM-R06 restores leadership when an indexed participant becomes active again", () => {
    // Given
    const manager = new BattleManager();
    createBattle(manager);
    battleOf(manager.updateParticipantState("battle", "player-1", "ELIMINATED"));

    // When
    const battle = battleOf(
      manager.updateParticipantState("battle", "player-1", "ACTIVE"),
    );

    // Then
    expect(battle.playerSide.state).toBe("ACTIVE");
    expect(battle.playerSide.leaderId).toBe("player-1");
    expect(battle.playerSide.area.center).toEqual(point(0, 0));
  });
});

describe("BattleManager lifecycle invariants", () => {
  it("BM-L01 createBattle sets both sides to ACTIVE (never FLEEING/RESOLVED)", () => {
    const manager = new BattleManager();
    const battle = battleOf(
      manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))),
    );
    expect(battle.playerSide.state).toBe("ACTIVE");
    expect(battle.enemySide.state).toBe("ACTIVE");
  });

  it("BM-L02 eliminating all participants sets side to ELIMINATED (not FLEEING/RESOLVED)", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    battleOf(manager.updateParticipantState("b1", "p1", "ELIMINATED"));
    const battle = battleOf(manager.updateParticipantState("b1", "e1", "ELIMINATED"));
    expect(battle.enemySide.state).toBe("ELIMINATED");
    expect(battle.enemySide.state).not.toBe("FLEEING");
    expect(battle.enemySide.state).not.toBe("RESOLVED");
  });

  it("BM-L03 setting participant to FLEEING does not change side state", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    const battle = battleOf(manager.updateParticipantState("b1", "p1", "FLEEING"));
    expect(battle.playerSide.state).toBe("ACTIVE");
    expect(battle.playerSide.participants[0].state).toBe("FLEEING");
  });
});

/* ════════════════ Phase 2A: syncParticipantPosition ════════════════ */

describe("syncParticipantPosition", () => {
  it("P2A-001 leader position sync updates participant position", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    const result = manager.syncParticipantPosition("p1", point(10, 20));
    expect(result).toHaveProperty("battle");
    const battle = (result as { battle: any }).battle;
    expect(battle.playerSide.participants[0].position).toEqual(point(10, 20));
  });

  it("P2A-002 leader area follow — center moves with leader", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    manager.syncParticipantPosition("p1", point(10, 20));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.area.center).toEqual(point(10, 20));
  });

  it("P2A-003 member position sync updates position but not area center", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    battleOf(manager.addParticipant("b1", "player", participant("p2", point(1, 1))));
    const beforeCenter = manager.getBattle("b1")!.playerSide.area.center;
    manager.syncParticipantPosition("p2", point(50, 50));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.participants[1].position).toEqual(point(50, 50));
    expect(battle.playerSide.area.center).toEqual(beforeCenter);
  });

  it("P2A-004 non-member rejected with PARTICIPANT_NOT_IN_BATTLE", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    const result = manager.syncParticipantPosition("ghost", point(10, 10));
    expect(result).toHaveProperty("error", "PARTICIPANT_NOT_IN_BATTLE");
  });

  it("P2A-005 removed participant rejected", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    battleOf(manager.addParticipant("b1", "player", participant("p2", point(1, 1))));
    manager.removeParticipant("b1", "p2");
    const result = manager.syncParticipantPosition("p2", point(10, 10));
    expect(result).toHaveProperty("error", "PARTICIPANT_NOT_IN_BATTLE");
  });

  it("P2A-006 removed battle rejected", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(-100, 0)), participant("e1", point(100, 0))));
    manager.updateBattleArea("b1", "p1", point(-200, 0));
    manager.updateBattleArea("b1", "e1", point(200, 0));
    manager.removeBattle("b1");
    const result = manager.syncParticipantPosition("p1", point(10, 10));
    expect(result).toHaveProperty("error");
  });

  it("P2A-007 negative world coordinates accepted", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    manager.syncParticipantPosition("p1", point(-100, -200));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.participants[0].position).toEqual(point(-100, -200));
    expect(battle.playerSide.area.center).toEqual(point(-100, -200));
  });

  it("P2A-008 cross chunk X — position crosses chunk boundary on X axis", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    manager.syncParticipantPosition("p1", point(33, 0));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.participants[0].position).toEqual(point(33, 0));
    expect(battle.playerSide.area.center).toEqual(point(33, 0));
  });

  it("P2A-009 cross chunk Y — position crosses chunk boundary on Y axis", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    manager.syncParticipantPosition("p1", point(0, 33));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.participants[0].position).toEqual(point(0, 33));
    expect(battle.playerSide.area.center).toEqual(point(0, 33));
  });

  it("P2A-010 cross chunk XY — position crosses chunk boundary on both axes", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    manager.syncParticipantPosition("p1", point(33, 33));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.participants[0].position).toEqual(point(33, 33));
    expect(battle.playerSide.area.center).toEqual(point(33, 33));
  });

  it("P2A-011 repeated sync deterministic — same operations produce same result", () => {
    const first = new BattleManager();
    const second = new BattleManager();
    for (const m of [first, second]) {
      battleOf(m.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
      m.syncParticipantPosition("p1", point(10, 20));
      m.syncParticipantPosition("p1", point(30, 40));
      m.syncParticipantPosition("e1", point(50, 60));
    }
    expect(first.getBattle("b1")).toEqual(second.getBattle("b1"));
  });

  it("P2A-012 leader change then position sync — new leader controls center", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    battleOf(manager.addParticipant("b1", "player", participant("p2", point(10, 10))));
    manager.transferLeader("b1", "player", "p2");
    manager.syncParticipantPosition("p2", point(25, 25));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.leaderId).toBe("p2");
    expect(battle.playerSide.area.center).toEqual(point(25, 25));
  });

  it("P2A-013 new leader controls area center after transfer", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    battleOf(manager.addParticipant("b1", "player", participant("p2", point(10, 10))));
    manager.transferLeader("b1", "player", "p2");
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.area.center).toEqual(point(10, 10));
  });

  it("P2A-014 member movement does not change area center", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    battleOf(manager.addParticipant("b1", "player", participant("p2", point(1, 1))));
    manager.syncParticipantPosition("p2", point(100, 100));
    const battle = manager.getBattle("b1")!;
    expect(battle.playerSide.area.center).toEqual(point(0, 0));
  });

  it("P2A-015 invalid coordinates rejected with POSITION_NOT_FINITE", () => {
    const manager = new BattleManager();
    battleOf(manager.createBattle("b1", participant("p1", point(0, 0)), participant("e1", point(5, 0))));
    expect(manager.syncParticipantPosition("p1", { x: NaN, y: 0 })).toHaveProperty("error", "POSITION_NOT_FINITE");
    expect(manager.syncParticipantPosition("p1", { x: 0, y: Infinity })).toHaveProperty("error", "POSITION_NOT_FINITE");
    expect(manager.syncParticipantPosition("p1", { x: -Infinity, y: 0 })).toHaveProperty("error", "POSITION_NOT_FINITE");
  });
});

/* ════════════════ Phase 2B — Dynamic join ════════════════ */

describe("evaluateDynamicJoin", () => {
  function candidate(
    id: string,
    x: number,
    y: number,
    entityType: "player" | "mob" = "player",
    state: ParticipantState = "ACTIVE",
  ) {
    return { id, position: point(x, y), state, entityType };
  }

  it("B1: active player inside player-side area joins", () => {
    const manager = new BattleManager();
    // Leader at (0,0), enemy at (10,0). Player-side area center=(0,0), radius=baseRadius=8.
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    const result = manager.evaluateDynamicJoin(candidate("p2", 2, 2, "player"));
    expect(result).toHaveProperty("battle");
    const battle = (result as { battle: BattleGroup }).battle;
    expect(battle.playerSide.participants).toHaveLength(2);
    expect(battle.playerSide.participants.map(p => p.id)).toContain("p2");
  });

  it("B2: active mob inside player-side area rejected with CANDIDATE_WRONG_FACTION", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    // Mob at (-5,0) is inside player-side area (center=(0,0), radius≈13.3) but
    // far outside enemy-side area (center=(10,0), radius≈13.3).
    // mob→player is illegal faction, so CANDIDATE_WRONG_FACTION.
    expectError(manager.evaluateDynamicJoin(candidate("mob1", -5, 0, "mob")), "CANDIDATE_WRONG_FACTION");
  });

  it("B3: active player outside all battle areas rejected with CANDIDATE_OUT_OF_RANGE", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    // (50,50) is far outside both areas (radius ~= 8).
    expectError(manager.evaluateDynamicJoin(candidate("p2", 50, 50, "player")), "CANDIDATE_OUT_OF_RANGE");
  });

  it("B4: eliminated candidate rejected with CANDIDATE_NOT_ALIVE", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    expectError(
      manager.evaluateDynamicJoin(candidate("p2", 2, 2, "player", "ELIMINATED")),
      "CANDIDATE_NOT_ALIVE",
    );
  });

  it("B5: candidate already in a battle rejected with PARTICIPANT_ALREADY_IN_BATTLE", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    const result = manager.evaluateDynamicJoin(candidate("p2", 2, 2, "player"));
    expect(result).toHaveProperty("battle");
    // p2 is now in battle — try again.
    expectError(manager.evaluateDynamicJoin(candidate("p2", 2, 2, "player")), "PARTICIPANT_ALREADY_IN_BATTLE");
  });

  it("B6: no active battles returns NO_VALID_BATTLE", () => {
    const manager = new BattleManager();
    expectError(manager.evaluateDynamicJoin(candidate("p1", 0, 0, "player")), "NO_VALID_BATTLE");
  });

  it("B7: mob inside enemy-side area joins enemy side", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    // enemy-side area center=(10,0), radius=8. mob at (11,1) is inside.
    const result = manager.evaluateDynamicJoin(candidate("mob1", 11, 1, "mob"));
    expect(result).toHaveProperty("battle");
    const battle = (result as { battle: BattleGroup }).battle;
    expect(battle.enemySide.participants).toHaveLength(2);
    expect(battle.enemySide.participants.map(p => p.id)).toContain("mob1");
  });

  it("B8: player joins player side → radius recalculates (increases)", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    const before = manager.getBattle("battle")!.playerSide.area.radius;
    manager.evaluateDynamicJoin(candidate("p2", 2, 2, "player"));
    const after = manager.getBattle("battle")!.playerSide.area.radius;
    expect(after).toBeGreaterThan(before);
  });

  it("B9: mob joins enemy side → radius recalculates (increases)", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    const before = manager.getBattle("battle")!.enemySide.area.radius;
    manager.evaluateDynamicJoin(candidate("mob1", 11, 1, "mob"));
    const after = manager.getBattle("battle")!.enemySide.area.radius;
    expect(after).toBeGreaterThan(before);
  });

  it("B10: candidate exactly on boundary joins", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    // baseRadius = 8. Point at (8, 0) is exactly on boundary of player area.
    const result = manager.evaluateDynamicJoin(candidate("p2", 8, 0, "player"));
    expect(result).toHaveProperty("battle");
  });

  it("B11: fleeing candidate does not join", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("leader", point(0, 0)),
      enemy: participant("enemy-1", point(10, 0)),
    });
    expectError(
      manager.evaluateDynamicJoin(candidate("p2", 2, 2, "player", "FLEEING")),
      "CANDIDATE_NOT_ALIVE",
    );
  });
});

/* ════════════════ Phase 2B — removeParticipantByDeath ════════════════ */

describe("removeParticipantByDeath", () => {
  it("D1: remove participant in battle → success + radius shrinks", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("p1", point(0, 0)),
      enemy: participant("e1", point(10, 0)),
    });
    battleOf(manager.addParticipant("battle", "player", participant("p2", point(2, 2))));
    const before = manager.getBattle("battle")!.playerSide.area.radius;
    const result = manager.removeParticipantByDeath("p2");
    expect(result).toHaveProperty("battle");
    const after = (result as { battle: BattleGroup }).battle;
    expect(after.playerSide.participants.map(p => p.id)).not.toContain("p2");
    expect(after.playerSide.area.radius).toBeLessThan(before);
  });

  it("D2: remove participant not in any battle → PARTICIPANT_NOT_IN_BATTLE", () => {
    const manager = new BattleManager();
    expectError(manager.removeParticipantByDeath("ghost"), "PARTICIPANT_NOT_IN_BATTLE");
  });

  it("D3: remove leader → leader reselected from remaining", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("p1", point(0, 0)),
      enemy: participant("e1", point(10, 0)),
    });
    battleOf(manager.addParticipant("battle", "player", participant("p2", point(2, 2))));
    const result = manager.removeParticipantByDeath("p1");
    const battle = (result as { battle: BattleGroup }).battle;
    expect(battle.playerSide.leaderId).toBe("p2");
    expect(battle.playerSide.leaderId).not.toBe("p1");
  });

  it("D4: remove last participant on side → side ELIMINATED", () => {
    const manager = new BattleManager();
    createBattle(manager, {
      player: participant("p1", point(0, 0)),
      enemy: participant("e1", point(10, 0)),
    });
    const result = manager.removeParticipantByDeath("p1");
    const battle = (result as { battle: BattleGroup }).battle;
    expect(battle.playerSide.state).toBe("ELIMINATED");
    expect(battle.playerSide.leaderId).toBeNull();
  });
});
