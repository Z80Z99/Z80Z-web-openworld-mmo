import { describe, it, expect } from "vitest";
import {
  distanceSquared,
  isPointInsideBattleArea,
  calculateBattleAreaRadius,
  shouldJoinBattle,
  decideEngagement,
  shouldEnterFleeing,
  shouldRejoin,
  shouldResolveBattle,
  selectNewLeader,
} from "./rules.js";
import { DEFAULT_BATTLE_RULES_CONFIG } from "./constants.js";
import type {
  BattleArea,
  BattleAreaConfig,
  BattleParticipant,
  EngagementConfig,
  ParticipantState,
} from "./types.js";

/* ── Fixtures ── */

const AREA: BattleAreaConfig = DEFAULT_BATTLE_RULES_CONFIG.area;
const ENGAGE: EngagementConfig = DEFAULT_BATTLE_RULES_CONFIG.engagement;

const at = (x: number, y: number) => ({ x, y });

function participant(
  id: string,
  x: number,
  y: number,
  over?: Partial<BattleParticipant>,
): BattleParticipant {
  return {
    id,
    position: at(x, y),
    combatPower: 10,
    personality: "cautious",
    state: "ACTIVE",
    ...over,
  };
}

function area(center: { x: number; y: number }, radius: number): BattleArea {
  return { center, radius };
}

/* ════════════════ BattleArea geometry ════════════════ */

describe("BattleArea geometry", () => {
  const a = area(at(0, 0), 10);

  it("BA-001 center point is inside", () => {
    expect(isPointInsideBattleArea(at(0, 0), a)).toBe(true);
  });

  it("BA-002 clearly inside point is inside", () => {
    expect(isPointInsideBattleArea(at(3, 4), a)).toBe(true);
  });

  it("BA-003 exact radius boundary is inside", () => {
    expect(isPointInsideBattleArea(at(0, 10), a)).toBe(true);
  });

  it("BA-004 just outside boundary is outside", () => {
    expect(isPointInsideBattleArea(at(0, 10.001), a)).toBe(false);
  });

  it("BA-005 non-origin center translates correctly", () => {
    const shifted = area(at(100, 50), 5);
    expect(isPointInsideBattleArea(at(103, 54), shifted)).toBe(true);
    expect(isPointInsideBattleArea(at(103, 56), shifted)).toBe(false);
  });

  it("BA-006 distanceSquared is exact for horizontal/vertical/diagonal", () => {
    expect(distanceSquared(at(0, 0), at(3, 0))).toBe(9);
    expect(distanceSquared(at(0, 0), at(0, 4))).toBe(16);
    expect(distanceSquared(at(0, 0), at(3, 4))).toBe(25);
    expect(distanceSquared(at(1, 2), at(4, 6))).toBe(25);
  });
});

/* ════════════════ Radius expansion ════════════════ */

describe("calculateBattleAreaRadius", () => {
  it("BA-007 zero participants returns baseRadius", () => {
    expect(calculateBattleAreaRadius(0, AREA)).toBe(AREA.baseRadius);
  });

  it("BA-008 radius increases monotonically with participant count", () => {
    let prev = calculateBattleAreaRadius(0, AREA);
    for (let n = 1; n <= 20; n++) {
      const r = calculateBattleAreaRadius(n, AREA);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it("BA-009 each later increment is smaller than the previous (diminishing return)", () => {
    const r1 = calculateBattleAreaRadius(1, AREA);
    const r2 = calculateBattleAreaRadius(2, AREA);
    const r3 = calculateBattleAreaRadius(3, AREA);
    expect(r2 - r1).toBeGreaterThan(r3 - r2);
  });

  it("BA-010 large participant count never exceeds maxRadius", () => {
    for (const n of [10, 25, 50, 100, 1000]) {
      expect(calculateBattleAreaRadius(n, AREA)).toBeLessThanOrEqual(AREA.maxRadius);
    }
  });

  it("BA-011 count beyond clamp stays at the same clamped radius", () => {
    // Counts far past the exponential saturation point (floating point fully
    // converged to maxRadius) must produce an identical clamped result.
    const sat1 = calculateBattleAreaRadius(500, AREA);
    const sat2 = calculateBattleAreaRadius(5000, AREA);
    expect(sat1).toBe(sat2);
    expect(sat1).toBe(AREA.maxRadius);
  });

  it("BA-012 negative count normalizes to baseRadius", () => {
    expect(calculateBattleAreaRadius(-5, AREA)).toBe(AREA.baseRadius);
  });

  it("BA-013 custom config uses the supplied formula", () => {
    const custom: BattleAreaConfig = {
      baseRadius: 2,
      expansionRate: 10,
      diminishingReturnScale: 2,
      maxRadius: 7,
    };
    expect(calculateBattleAreaRadius(0, custom)).toBe(2);
    expect(calculateBattleAreaRadius(1, custom)).toBeLessThanOrEqual(7);
    expect(calculateBattleAreaRadius(1000, custom)).toBe(7);
  });
});

/* ════════════════ Join ════════════════ */

describe("shouldJoinBattle", () => {
  it("BA-014 active participant inside area joins", () => {
    expect(
      shouldJoinBattle({
        participant: participant("p", 1, 1),
        battleArea: area(at(0, 0), 5),
        alreadyJoined: false,
      }),
    ).toBe(true);
  });

  it("BA-015 active participant on boundary joins", () => {
    expect(
      shouldJoinBattle({
        participant: participant("p", 5, 0),
        battleArea: area(at(0, 0), 5),
        alreadyJoined: false,
      }),
    ).toBe(true);
  });

  it("BA-016 active participant outside does not join", () => {
    expect(
      shouldJoinBattle({
        participant: participant("p", 6, 0),
        battleArea: area(at(0, 0), 5),
        alreadyJoined: false,
      }),
    ).toBe(false);
  });

  it("BA-017 fleeing participant inside does not join", () => {
    expect(
      shouldJoinBattle({
        participant: participant("p", 1, 1, { state: "FLEEING" as ParticipantState }),
        battleArea: area(at(0, 0), 5),
        alreadyJoined: false,
      }),
    ).toBe(false);
  });

  it("BA-018 already-joined participant inside does not join again", () => {
    expect(
      shouldJoinBattle({
        participant: participant("p", 1, 1),
        battleArea: area(at(0, 0), 5),
        alreadyJoined: true,
      }),
    ).toBe(false);
  });
});

/* ════════════════ Engagement decision ════════════════ */

describe("decideEngagement", () => {
  const ctx = (over: Partial<Parameters<typeof decideEngagement>[0]>) => ({
    distance: 5,
    combatPowerRatio: 1,
    personality: "cautious" as const,
    config: ENGAGE,
    ...over,
  });

  it("EN-001 strong aggressive in range ENGAGES", () => {
    expect(decideEngagement(ctx({ personality: "aggressive", combatPowerRatio: 2 }))).toBe("ENGAGE");
  });

  it("EN-002 strong cautious ENGAGES", () => {
    expect(decideEngagement(ctx({ combatPowerRatio: 2 }))).toBe("ENGAGE");
  });

  it("EN-003 equal cautious ENGAGES", () => {
    expect(decideEngagement(ctx({ combatPowerRatio: 1 }))).toBe("ENGAGE");
  });

  it("EN-004 weak cautious AVOIDS", () => {
    expect(decideEngagement(ctx({ combatPowerRatio: 0.5 }))).toBe("AVOID");
  });

  it("EN-005 weak coward FLEES", () => {
    expect(decideEngagement(ctx({ personality: "coward", combatPowerRatio: 0.5 }))).toBe("FLEE");
  });

  it("EN-006 equal coward AVOIDS", () => {
    expect(decideEngagement(ctx({ personality: "coward", combatPowerRatio: 1 }))).toBe("AVOID");
  });

  it("EN-007 strong coward ENGAGES", () => {
    expect(decideEngagement(ctx({ personality: "coward", combatPowerRatio: 2 }))).toBe("ENGAGE");
  });

  it("EN-008 aggressive weak in range still ENGAGES", () => {
    expect(decideEngagement(ctx({ personality: "aggressive", combatPowerRatio: 0.3 }))).toBe("ENGAGE");
  });

  it("EN-009 any personality beyond max distance AVOIDS", () => {
    for (const personality of ["aggressive", "cautious", "coward"] as const) {
      expect(decideEngagement(ctx({ personality, distance: 13 }))).toBe("AVOID");
    }
  });

  it("EN-010 identical contexts always produce identical decisions", () => {
    const cases = [
      { personality: "aggressive" as const, combatPowerRatio: 0.3, distance: 5 },
      { personality: "coward" as const, combatPowerRatio: 0.5, distance: 5 },
      { personality: "cautious" as const, combatPowerRatio: 0.5, distance: 5 },
    ];
    for (const c of cases) {
      const first = decideEngagement(ctx(c));
      for (let i = 0; i < 50; i++) {
        expect(decideEngagement(ctx(c))).toBe(first);
      }
    }
  });

  it("EN-011 invalid distance or ratio throws RangeError deterministically", () => {
    expect(() => decideEngagement(ctx({ distance: -1 }))).toThrow(RangeError);
    expect(() => decideEngagement(ctx({ distance: NaN }))).toThrow(RangeError);
    expect(() => decideEngagement(ctx({ combatPowerRatio: -0.5 }))).toThrow(RangeError);
    expect(() => decideEngagement(ctx({ combatPowerRatio: Infinity }))).toThrow(RangeError);
  });
});

/* ════════════════ Flee / rejoin / resolve ════════════════ */

describe("shouldEnterFleeing", () => {
  it("FL-001 leader inside enemy area does not flee", () => {
    expect(
      shouldEnterFleeing({ leader: participant("L", 1, 1), enemyArea: area(at(0, 0), 5) }),
    ).toBe(false);
  });

  it("FL-002 leader outside enemy area flees", () => {
    expect(
      shouldEnterFleeing({ leader: participant("L", 6, 0), enemyArea: area(at(0, 0), 5) }),
    ).toBe(true);
  });

  it("FL-002b eliminated leader does not enter fleeing", () => {
    expect(
      shouldEnterFleeing({
        leader: participant("L", 6, 0, { state: "ELIMINATED" as ParticipantState }),
        enemyArea: area(at(0, 0), 5),
      }),
    ).toBe(false);
  });

  it("FL-002c null leader does not enter fleeing", () => {
    expect(shouldEnterFleeing({ leader: null, enemyArea: area(at(0, 0), 5) })).toBe(false);
  });
});

describe("shouldRejoin", () => {
  it("FL-003 fleeing leader re-entering enemy area rejoins", () => {
    expect(
      shouldRejoin({
        leader: participant("L", 1, 1, { state: "FLEEING" as ParticipantState }),
        enemyArea: area(at(0, 0), 5),
      }),
    ).toBe(true);
  });

  it("FL-004 active leader inside enemy area does not rejoin", () => {
    expect(
      shouldRejoin({
        leader: participant("L", 1, 1, { state: "ACTIVE" as ParticipantState }),
        enemyArea: area(at(0, 0), 5),
      }),
    ).toBe(false);
  });

  it("FL-005 fleeing leader still outside does not rejoin", () => {
    expect(
      shouldRejoin({
        leader: participant("L", 6, 0, { state: "FLEEING" as ParticipantState }),
        enemyArea: area(at(0, 0), 5),
      }),
    ).toBe(false);
  });
});

describe("shouldResolveBattle", () => {
  const bothOut = () => ({
    firstLeader: participant("A", 6, 0),
    secondLeader: participant("B", 6, 0),
    firstEnemyArea: area(at(0, 0), 5),
    secondEnemyArea: area(at(0, 0), 5),
  });

  it("FL-006 both leaders outside enemy areas resolves", () => {
    expect(shouldResolveBattle(bothOut())).toBe(true);
  });

  it("FL-007 first leader still inside does not resolve", () => {
    expect(shouldResolveBattle({ ...bothOut(), firstLeader: participant("A", 1, 1) })).toBe(false);
  });

  it("FL-008 second leader still inside does not resolve", () => {
    expect(shouldResolveBattle({ ...bothOut(), secondLeader: participant("B", 1, 1) })).toBe(false);
  });

  it("FL-009 eliminated or null leader counts as outside", () => {
    const eliminated = { ...bothOut(), firstLeader: participant("A", 6, 0, { state: "ELIMINATED" as ParticipantState }) };
    expect(shouldResolveBattle(eliminated)).toBe(true);
    expect(shouldResolveBattle({ ...bothOut(), secondLeader: null })).toBe(true);
  });
});

/* ════════════════ Leader selection ════════════════ */

describe("selectNewLeader", () => {
  it("LD-001 active leader is returned when first", () => {
    const leader = participant("L", 0, 0, { state: "ACTIVE" as ParticipantState });
    expect(selectNewLeader([leader, participant("m", 1, 1)])?.id).toBe("L");
  });

  it("LD-002 leader eliminated, member survives — member is selected", () => {
    const members = [
      participant("L", 0, 0, { state: "ELIMINATED" as ParticipantState }),
      participant("m1", 1, 1),
    ];
    expect(selectNewLeader(members)?.id).toBe("m1");
  });

  it("LD-003 multiple survivors — first active in array order wins", () => {
    const members = [
      participant("L", 0, 0, { state: "ELIMINATED" as ParticipantState }),
      participant("m1", 1, 1),
      participant("m2", 2, 2),
    ];
    expect(selectNewLeader(members)?.id).toBe("m1");
  });

  it("LD-004 no active participants returns null (side eliminated)", () => {
    expect(selectNewLeader([])).toBeNull();
  });

  it("LD-005 all participants eliminated returns null", () => {
    const allGone = [
      participant("a", 0, 0, { state: "ELIMINATED" as ParticipantState }),
      participant("b", 1, 1, { state: "ELIMINATED" as ParticipantState }),
    ];
    expect(selectNewLeader(allGone)).toBeNull();
  });
});

/* ════════════════ Cross chunk / world coordinates ════════════════ */

describe("Cross chunk (world coordinates)", () => {
  it("CH-001 negative world coordinates compute correct geometry", () => {
    const a = area(at(-32, -32), 10);
    expect(isPointInsideBattleArea(at(-25, -32), a)).toBe(true);
    expect(isPointInsideBattleArea(at(-20, -32), a)).toBe(false);
    expect(distanceSquared(at(-32, -32), at(-25, -32))).toBe(49);
  });

  it("CH-002 points in different chunks compute the same distance", () => {
    // Chunk size is 32 tiles; these points straddle a chunk boundary.
    const distAcross = distanceSquared(at(31, 0), at(33, 0));
    const distWithin = distanceSquared(at(-1, 0), at(1, 0));
    expect(distAcross).toBe(4);
    expect(distWithin).toBe(4);
  });

  it("CH-003 area center on chunk boundary is correct", () => {
    const a = area(at(32, 0), 5);
    expect(isPointInsideBattleArea(at(32, 5), a)).toBe(true);
    expect(isPointInsideBattleArea(at(32, 5.1), a)).toBe(false);
  });

  it("CH-004 negative chunk boundary has no truncation/modulo error", () => {
    const a = area(at(-32, 0), 8);
    expect(isPointInsideBattleArea(at(-40, 0), a)).toBe(true);
    expect(isPointInsideBattleArea(at(-41, 0), a)).toBe(false);
  });

  it("CH-005 result is independent of chunk partitioning", () => {
    // Same physical distance expressed at different absolute offsets.
    expect(distanceSquared(at(0, 0), at(3, 4))).toBe(25);
    expect(distanceSquared(at(100, 100), at(103, 104))).toBe(25);
    expect(distanceSquared(at(-100, -100), at(-97, -96))).toBe(25);
  });
});

/* ════════════════ Purity / isolation ════════════════ */

describe("Purity", () => {
  it("PU-001 rules do not mutate their inputs", () => {
    const p = participant("p", 1, 1);
    const a = area(at(0, 0), 5);
    const frozenP = { ...p, position: { ...p.position } };
    const frozenA = { ...a, center: { ...a.center } };

    shouldJoinBattle({ participant: p, battleArea: a, alreadyJoined: false });
    decideEngagement({ distance: 5, combatPowerRatio: 1, personality: "cautious", config: ENGAGE });
    shouldEnterFleeing({ leader: p, enemyArea: a });
    shouldResolveBattle({
      firstLeader: p,
      secondLeader: p,
      firstEnemyArea: a,
      secondEnemyArea: a,
    });

    expect(p).toEqual(frozenP);
    expect(a).toEqual(frozenA);
  });

  it("PU-002 identical inputs produce referentially equal results", () => {
    const c1 = { distance: 5, combatPowerRatio: 1, personality: "cautious" as const, config: ENGAGE };
    expect(decideEngagement(c1)).toBe(decideEngagement({ ...c1 }));
    expect(calculateBattleAreaRadius(3, AREA)).toBe(calculateBattleAreaRadius(3, AREA));
    expect(distanceSquared(at(1, 2), at(4, 6))).toBe(distanceSquared(at(1, 2), at(4, 6)));
  });
});
