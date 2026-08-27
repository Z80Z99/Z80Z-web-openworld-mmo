// ── Constants ──

export const TURN_TIMEOUT_MS = 12_000;
export const FLEE_CHANCE = 0.6;
export const DEFEND_DAMAGE_MULTIPLIER = 0.5;
export const ENCOUNTER_ENGAGE_RANGE = 1.6;
export const MOB_TURN_DELAY_MS = 800;
export const MAX_ENCOUNTER_ROUNDS = 50;

// ── Types ──

export type EncounterTurn = "player" | "mob";
export type EncounterInitiator = "player" | "mob";
export type EncounterEndReason = "victory" | "fled" | "player_died" | "timeout";

export interface ActiveEncounter {
  playerId: string;
  mobId: string;
  turn: EncounterTurn;
  round: number;
  turnStartedAt: number;
  playerDefending: boolean;
  mobTurnScheduledAt?: number;
  /** Authoritative mirror of mob HP during this encounter. */
  mobHp: number;
  /** Authoritative mirror of player HP during this encounter. */
  playerHp: number;
  /** True after playerAction/resolveMobTurn ends this encounter. */
  ended?: boolean;
}

export interface BeginEncounterMobView {
  mobHp: number;
  mobMaxHp: number;
  playerHp: number;
  playerMaxHp: number;
}

export interface CombatParams {
  attack: number;
  level: number;
  mobDefense: number;
  playerDefense: number;
  mobMaxHp: number;
}

export interface ActionResult {
  events: CombatEvent[];
  ended?: boolean;
  reason?: EncounterEndReason;
  error?: string;
}

export interface CombatEvent {
  type: string;
  damage?: number;
  healing?: number;
  target?: string;
  attacker?: string;
  [key: string]: unknown;
}

export interface TickTimeoutResult {
  playerId: string;
  encounter: ActiveEncounter;
  timedOut: true;
}

// ── Implementation ──

/**
 * Pure state-machine for turn-based encounters.
 *
 * Owns authoritative combat math during the encounter.
 * Callers sync derived HP/XP to Colyseus schema + DB after each call.
 */
export class EncounterSystem {
  /** playerId → encounter */
  private encounters = new Map<string, ActiveEncounter>();
  /** mobId → playerId (reverse lookup) */
  private mobIndex = new Map<string, string>();

  // ── Queries ──

  hasEncounter(playerId: string): boolean {
    return this.encounters.has(playerId);
  }

  getEncounter(playerId: string): ActiveEncounter | undefined {
    return this.encounters.get(playerId);
  }

  getActiveEncounters(): ActiveEncounter[] {
    return [...this.encounters.values()];
  }

  // ── Lifecycle ──

  /**
   * Begin a new encounter.
   *
   * Returns `{ error }` on guard failure (never throws).
   */
  beginEncounter(
    playerId: string,
    mobId: string,
    initiator: EncounterInitiator,
    view: BeginEncounterMobView,
    now: number,
  ): { encounter?: ActiveEncounter; error?: string } {
    if (this.encounters.has(playerId)) {
      return { error: "player_busy" };
    }
    if (this.mobIndex.has(mobId)) {
      return { error: "mob_busy" };
    }

    const encounter: ActiveEncounter = {
      playerId,
      mobId,
      turn: initiator === "player" ? "player" : "mob",
      round: 1,
      turnStartedAt: now,
      playerDefending: false,
      mobHp: view.mobHp,
      playerHp: view.playerHp,
      ...(initiator === "mob" ? { mobTurnScheduledAt: now + MOB_TURN_DELAY_MS } : {}),
    };

    this.encounters.set(playerId, encounter);
    this.mobIndex.set(mobId, playerId);
    return { encounter };
  }

  endEncounter(encounter: ActiveEncounter, reason: EncounterEndReason): void {
    encounter.ended = true;
    this.encounters.delete(encounter.playerId);
    this.mobIndex.delete(encounter.mobId);
  }

  /**
   * End any encounter referencing this mob (e.g. the mob was removed from the
   * world by an AOI chunk prune). Releases both the player and mob slots.
   * Returns the released player ID, or undefined if the mob was not in an encounter.
   */
  endEncounterForMob(mobId: string): string | undefined {
    const playerId = this.mobIndex.get(mobId);
    if (!playerId) return undefined;
    const encounter = this.encounters.get(playerId);
    if (!encounter) return undefined;
    this.endEncounter(encounter, "player_died");
    return playerId;
  }

  // ── Player Actions ──

  /**
   * Process a player action. Returns `{ events, ended?, reason?, error? }`.
   */
  playerAction(
    encounter: ActiveEncounter,
    action: "attack" | "defend" | "flee",
    params: CombatParams,
    rng: () => number,
    now: number,
  ): ActionResult {
    if (encounter.ended) return { events: [], error: "no_encounter" };
    if (encounter.turn !== "player") return { events: [], error: "not_player_turn" };

    // Anti-stall: force flee after MAX_ENCOUNTER_ROUNDS
    if (encounter.round > MAX_ENCOUNTER_ROUNDS) {
      return this.endWithEvents(encounter, "fled");
    }

    switch (action) {
      case "attack":
        return this.resolvePlayerAttack(encounter, params, now);
      case "defend":
        return this.resolvePlayerDefend(encounter, now);
      case "flee":
        return this.resolvePlayerFlee(encounter, params, rng, now);
    }
  }

  private resolvePlayerAttack(
    encounter: ActiveEncounter,
    params: CombatParams,
    now: number,
  ): ActionResult {
    const damage = this.calculateDamage(params.attack, params.level, params.mobDefense);
    encounter.mobHp = max(0, encounter.mobHp - damage);

    const events: CombatEvent[] = [
      { type: "damage_dealt", damage, attacker: encounter.playerId, target: encounter.mobId },
    ];

    if (encounter.mobHp <= 0) {
      return this.endWithEvents(encounter, "victory", events);
    }

    // Hand turn to mob
    encounter.turn = "mob";
    encounter.round += 1;
    encounter.mobTurnScheduledAt = now + MOB_TURN_DELAY_MS;

    return { events, ended: false };
  }

  private resolvePlayerDefend(encounter: ActiveEncounter, now: number): ActionResult {
    encounter.playerDefending = true;
    encounter.turn = "mob";
    encounter.round += 1;
    encounter.mobTurnScheduledAt = now + MOB_TURN_DELAY_MS;

    return { events: [{ type: "defend", target: encounter.playerId }], ended: false };
  }

  private resolvePlayerFlee(
    encounter: ActiveEncounter,
    params: CombatParams,
    rng: () => number,
    now: number,
  ): ActionResult {
    const roll = rng();
    if (roll < FLEE_CHANCE || encounter.round > MAX_ENCOUNTER_ROUNDS) {
      return this.endWithEvents(encounter, "fled");
    }

    // Failed flee — mob attacks
    encounter.turn = "mob";
    encounter.round += 1;
    encounter.mobTurnScheduledAt = now + MOB_TURN_DELAY_MS;

    return { events: [], ended: false };
  }

  // ── Mob Turn ──

  /**
   * Resolve the mob's turn. Caller must check the mob turn is actually due
   * before calling (mobTurnScheduledAt <= now).
   */
  resolveMobTurn(
    encounter: ActiveEncounter,
    params: { mobAttack: number; mobLevel: number; playerDefense: number },
    rng: () => number,
    now: number,
  ): ActionResult {
    if (encounter.ended) return { events: [], error: "no_encounter" };
    if (encounter.turn !== "mob") return { events: [], error: "not_mob_turn" };

    let damage = this.calculateDamage(params.mobAttack, params.mobLevel, params.playerDefense);
    if (encounter.playerDefending) {
      damage = Math.floor(damage * DEFEND_DAMAGE_MULTIPLIER);
      encounter.playerDefending = false;
    }

    encounter.playerHp = max(0, encounter.playerHp - damage);

    const events: CombatEvent[] = [
      { type: "player_damaged", damage, attacker: encounter.mobId, target: encounter.playerId },
    ];

    if (encounter.playerHp <= 0) {
      return this.endWithEvents(encounter, "player_died", events);
    }

    // Hand turn back to player
    encounter.turn = "player";
    encounter.turnStartedAt = now;
    encounter.round += 1;

    return { events, ended: false };
  }

  // ── Timeouts (tick-driven) ──

  /**
   * Check all encounters for player-turn timeout.
   * Returns list of encounters that were auto-defended.
   */
  tickTimeouts(now: number): TickTimeoutResult[] {
    const timedOut: TickTimeoutResult[] = [];

    for (const enc of this.encounters.values()) {
      if (enc.ended || enc.turn !== "player") continue;
      if (now - enc.turnStartedAt > TURN_TIMEOUT_MS) {
        // Auto-defend
        enc.playerDefending = true;
        enc.turn = "mob";
        enc.round += 1;
        enc.mobTurnScheduledAt = now + MOB_TURN_DELAY_MS;
        timedOut.push({ playerId: enc.playerId, encounter: enc, timedOut: true });
      }
    }

    return timedOut;
  }

  // ── Helpers ──

  private endWithEvents(
    encounter: ActiveEncounter,
    reason: EncounterEndReason,
    priorEvents: CombatEvent[] = [],
  ): ActionResult {
    encounter.ended = true;
    const typeMap: Record<EncounterEndReason, string> = {
      victory: "mob_killed",
      fled: "encounter_fled",
      player_died: "player_died",
      timeout: "encounter_timeout",
    };
    this.endEncounter(encounter, reason);
    return {
      events: [...priorEvents, { type: typeMap[reason], reason }],
      ended: true,
      reason,
    };
  }

  /**
   * Attempt atk×(1+level×0.1) − def. Floor to ≥1.
   */
  calculateDamage(atk: number, level: number, def: number): number {
    return max(1, Math.floor(atk * (1 + level * 0.1)) - def);
  }
}

function max(a: number, b: number): number {
  return a > b ? a : b;
}
