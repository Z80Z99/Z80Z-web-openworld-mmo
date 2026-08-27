import { describe, it, expect, beforeEach } from "vitest";
import {
  EncounterSystem,
  FLEE_CHANCE,
  MAX_ENCOUNTER_ROUNDS,
  TURN_TIMEOUT_MS,
  MOB_TURN_DELAY_MS,
} from "./EncounterSystem.js";

/* ── Fixtures ── */

function makeSystem(): EncounterSystem {
  return new EncounterSystem();
}

const NOW = 1_000_000;

/** Begin a player-initiated encounter with sane defaults; returns the encounter. */
function beginPlayerFight(sys: EncounterSystem, opts?: { mobHp?: number }) {
  const res = sys.beginEncounter(
    "p1",
    "m1",
    "player",
    {
      mobHp: opts?.mobHp ?? 100,
      mobMaxHp: 100,
      playerHp: 100,
      playerMaxHp: 100,
    },
    NOW,
  );
  if (!res.encounter) throw new Error("begin failed: " + res.error);
  return res.encounter;
}

/** Resolve a full mob turn with fixed stats; defaults keep player alive. */
function mobTurn(
  sys: EncounterSystem,
  enc: ReturnType<EncounterSystem["beginEncounter"]>["encounter"] extends infer E ? E : never,
  over?: Partial<{ mobAttack: number; mobLevel: number; playerDefense: number; rngValue: number }>,
) {
  const mobAttack = over?.mobAttack ?? 10;
  const mobLevel = over?.mobLevel ?? 2;
  const playerDefense = over?.playerDefense ?? 5;
  const rng = () => over?.rngValue ?? 0.99;
  const dueAt = NOW + MOB_TURN_DELAY_MS + 1;
  return sys.resolveMobTurn(enc!, { mobAttack, mobLevel, playerDefense }, rng, dueAt);
}

/* ── beginEncounter ── */

describe("beginEncounter", () => {
  let sys: EncounterSystem;
  beforeEach(() => {
    sys = makeSystem();
  });

  it("1. player-initiated: turn starts with the player, round 1", () => {
    const { encounter, error } = sys.beginEncounter(
      "p1",
      "m1",
      "player",
      { mobHp: 80, mobMaxHp: 80, playerHp: 100, playerMaxHp: 100 },
      NOW,
    );
    expect(error).toBeUndefined();
    expect(encounter!.turn).toBe("player");
    expect(encounter!.round).toBe(1);
    expect(encounter!.mobHp).toBe(80);
    expect(encounter!.playerHp).toBe(100);
  });

  it("2. mob-initiated: turn starts with the mob after pacing delay", () => {
    const { encounter, error } = sys.beginEncounter(
      "p1",
      "m1",
      "mob",
      { mobHp: 80, mobMaxHp: 80, playerHp: 100, playerMaxHp: 100 },
      NOW,
    );
    expect(error).toBeUndefined();
    expect(encounter!.turn).toBe("mob");
    expect(encounter!.mobTurnScheduledAt).toBe(NOW + MOB_TURN_DELAY_MS);
  });

  it("5. rejects when the player is already in an encounter", () => {
    beginPlayerFight(sys);
    const { encounter, error } = sys.beginEncounter(
      "p1",
      "m2",
      "player",
      { mobHp: 50, mobMaxHp: 50, playerHp: 100, playerMaxHp: 100 },
      NOW,
    );
    expect(encounter).toBeUndefined();
    expect(error).toBe("player_busy");
  });

  it("6. rejects when the mob is already fighting someone else", () => {
    beginPlayerFight(sys);
    const { encounter, error } = sys.beginEncounter(
      "p2",
      "m1",
      "player",
      { mobHp: 50, mobMaxHp: 50, playerHp: 100, playerMaxHp: 100 },
      NOW,
    );
    expect(encounter).toBeUndefined();
    expect(error).toBe("mob_busy");
  });
});

/* ── playerAction ── */

describe("playerAction", () => {
  let sys: EncounterSystem;
  let enc: ReturnType<typeof beginPlayerFight>;
  beforeEach(() => {
    sys = makeSystem();
    enc = beginPlayerFight(sys);
  });

  const atkParams = { attack: 10, level: 1, mobDefense: 1, playerDefense: 5, mobMaxHp: 100 };
  // calculateDamage(10, 1, 1) = round(10 * 1.1) - 1 = 10

  it("7. attack deals damage and hands the turn to the mob", () => {
    const { events, ended } = sys.playerAction(enc!, "attack", atkParams, () => 0.99, NOW);
    expect(ended).toBe(false);
    expect(events.some((e) => e.type === "damage_dealt")).toBe(true);
    const dmgEvent = events.find((e) => e.type === "damage_dealt")!;
    expect(dmgEvent.damage).toBe(10);
    expect(enc!.mobHp).toBe(90);
    expect(enc!.turn).toBe("mob");
    expect(enc!.round).toBe(2);
    expect(enc!.mobTurnScheduledAt).toBe(NOW + MOB_TURN_DELAY_MS);
  });

  it("8. attack that drops mob hp to 0 ends the encounter with victory", () => {
    enc!.mobHp = 5;
    const { events, ended, reason } = sys.playerAction(
      enc!,
      "attack",
      atkParams,
      () => 0.99,
      NOW,
    );
    expect(ended).toBe(true);
    expect(reason).toBe("victory");
    expect(events.some((e) => e.type === "damage_dealt")).toBe(true);
    expect(events.some((e) => e.type === "mob_killed")).toBe(true);
    expect(sys.hasEncounter("p1")).toBe(false);
  });

  it("9. defend sets the defending flag and hands the turn over", () => {
    const { ended, events } = sys.playerAction(enc!, "defend", atkParams, () => 0.99, NOW);
    expect(ended).toBe(false);
    expect(events.some((e) => e.type === "defend")).toBe(true);
    expect(enc!.playerDefending).toBe(true);
    expect(enc!.turn).toBe("mob");
  });

  it("10. flee succeeds when rng beats FLEE_CHANCE", () => {
    const { ended, reason } = sys.playerAction(
      enc!,
      "flee",
      atkParams,
      () => FLEE_CHANCE - 0.01,
      NOW,
    );
    expect(ended).toBe(true);
    expect(reason).toBe("fled");
    expect(sys.hasEncounter("p1")).toBe(false);
  });

  it("11. flee fails when rng loses; turn passes to the mob", () => {
    const { ended, reason } = sys.playerAction(
      enc!,
      "flee",
      atkParams,
      () => FLEE_CHANCE + 0.01,
      NOW,
    );
    expect(ended).toBe(false);
    expect(reason).toBeUndefined();
    expect(enc!.turn).toBe("mob");
  });

  it("12. flee auto-succeeds past MAX_ENCOUNTER_ROUNDS even on bad rng", () => {
    enc!.round = MAX_ENCOUNTER_ROUNDS + 1;
    const { ended, reason } = sys.playerAction(
      enc!,
      "flee",
      atkParams,
      () => 0.999,
      NOW,
    );
    expect(ended).toBe(true);
    expect(reason).toBe("fled");
  });

  it("21. rejects actions while it is the mob's turn", () => {
    sys.playerAction(enc!, "defend", atkParams, () => 0.99, NOW); // -> mob turn
    const { error } = sys.playerAction(enc!, "attack", atkParams, () => 0.99, NOW);
    expect(error).toBe("not_player_turn");
  });

  it("22. rejects actions on an encounter that already ended", () => {
    sys.playerAction(enc!, "flee", atkParams, () => 0.0, NOW); // ends
    const { error } = sys.playerAction(enc!, "attack", atkParams, () => 0.99, NOW);
    expect(error).toBe("no_encounter");
  });
});

/* ── resolveMobTurn ── */

describe("resolveMobTurn", () => {
  let sys: EncounterSystem;
  let enc: ReturnType<typeof beginPlayerFight>;
  beforeEach(() => {
    sys = makeSystem();
    enc = beginPlayerFight(sys);
    sys.playerAction(enc!, "defend", { attack: 10, level: 1, mobDefense: 1, playerDefense: 5, mobMaxHp: 100 }, () => 0.99, NOW);
  });

  it("13. mob attacks back, halved while defending, then returns the turn", () => {
    // calculateDamage(10, 2, 5) = round(10 * 1.2) - 5 = 7 ; defending halves -> 3
    const { events, ended } = mobTurn(sys, enc);
    expect(ended).toBe(false);
    const dmg = events.find((e) => e.type === "player_damaged")!;
    expect(dmg.damage).toBe(Math.floor(7 * 0.5));
    expect(enc!.playerHp).toBe(100 - Math.floor(7 * 0.5));
    expect(enc!.turn).toBe("player");
    expect(enc!.playerDefending).toBe(false);
    expect(enc!.round).toBe(3);
  });

  it("14. mob strike that drops player to 0 ends the encounter (player_died)", () => {
    enc!.playerHp = 3;
    const { events, ended, reason } = mobTurn(sys, enc, { mobAttack: 30 });
    expect(ended).toBe(true);
    expect(reason).toBe("player_died");
    expect(events.some((e) => e.type === "player_died")).toBe(true);
    expect(sys.hasEncounter("p1")).toBe(false);
  });

  it("15. defending consumes itself: the next mob hit is full damage", () => {
    mobTurn(sys, enc); // defending hit (halved), flag consumed
    // Player attacks (NOT defend) for the coming turn, then we resolve another mob turn.
    sys.playerAction(enc!, "attack", { attack: 10, level: 1, mobDefense: 1, playerDefense: 5, mobMaxHp: 100 }, () => 0.99, NOW + 10_000);
    const { events } = mobTurn(sys, enc);
    const dmg = events.find((e) => e.type === "player_damaged")!;
    expect(dmg.damage).toBe(7); // full damage again
  });

  it("16b. full-damage baseline without defend", () => {
    // Fresh encounter without defending to pin the unhalved value.
    const sys2 = makeSystem();
    const enc2 = beginPlayerFight(sys2);
    sys2.playerAction(enc2!, "attack", { attack: 10, level: 1, mobDefense: 1, playerDefense: 5, mobMaxHp: 100 }, () => 0.99, NOW);
    const { events } = mobTurn(sys2, enc2!);
    expect(events.find((e) => e.type === "player_damaged")!.damage).toBe(7);
  });
});

/* ── tickTimeouts ── */

describe("tickTimeouts", () => {
  let sys: EncounterSystem;
  let enc: ReturnType<typeof beginPlayerFight>;
  beforeEach(() => {
    sys = makeSystem();
    enc = beginPlayerFight(sys);
  });

  it("16. player turn exceeding TURN_TIMEOUT_MS auto-defends", () => {
    const timedOut = sys.tickTimeouts(NOW + TURN_TIMEOUT_MS + 1);
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0].playerId).toBe("p1");
    expect(enc!.playerDefending).toBe(true);
    expect(enc!.turn).toBe("mob");
  });

  it("does nothing while the player is still within the timeout window", () => {
    expect(sys.tickTimeouts(NOW + TURN_TIMEOUT_MS - 1)).toHaveLength(0);
    expect(enc!.turn).toBe("player");
  });
});

/* ── endEncounter / lifecycle ── */

describe("endEncounter", () => {
  let sys: EncounterSystem;
  let enc: ReturnType<typeof beginPlayerFight>;
  beforeEach(() => {
    sys = makeSystem();
    enc = beginPlayerFight(sys);
  });

  it("18. victory cleanup frees both the player and the mob slots", () => {
    sys.endEncounter(enc!, "victory");
    expect(sys.hasEncounter("p1")).toBe(false);
    // The mob slot must be freed too.
    const { error } = sys.beginEncounter(
      "p2",
      "m1",
      "player",
      { mobHp: 50, mobMaxHp: 50, playerHp: 100, playerMaxHp: 100 },
      NOW,
    );
    expect(error).toBeUndefined();
  });

  it("after endEncounter, pending player actions report no_encounter", () => {
    sys.endEncounter(enc!, "victory");
    const { error } = sys.playerAction(enc!, "attack", { attack: 10, level: 1, mobDefense: 1, playerDefense: 5, mobMaxHp: 100 }, () => 0.99, NOW);
    expect(error).toBe("no_encounter");
  });
});

/* ── endEncounterForMob (mob removed from world, e.g. AOI chunk prune) ── */

describe("endEncounterForMob", () => {
  let sys: EncounterSystem;
  beforeEach(() => {
    sys = makeSystem();
  });

  it("releases the player and mob slots when a mob is removed", () => {
    beginPlayerFight(sys, { mobHp: 80 });
    expect(sys.hasEncounter("p1")).toBe(true);

    const releasedPlayer = sys.endEncounterForMob("m1");
    expect(releasedPlayer).toBe("p1");
    expect(sys.hasEncounter("p1")).toBe(false);

    // The same mob can now start an encounter with another player.
    const { encounter, error } = sys.beginEncounter(
      "p2",
      "m1",
      "player",
      { mobHp: 80, mobMaxHp: 80, playerHp: 100, playerMaxHp: 100 },
      NOW,
    );
    expect(error).toBeUndefined();
    expect(encounter!.playerId).toBe("p2");
  });

  it("returns undefined when the mob is not in any encounter", () => {
    expect(sys.endEncounterForMob("m1")).toBeUndefined();
  });
});
