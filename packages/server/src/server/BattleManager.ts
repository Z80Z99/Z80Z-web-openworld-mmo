// allow: SIZE_OK - exact guard-order state machine is constrained to this mandated file.
import { DEFAULT_BATTLE_RULES_CONFIG } from "@mmo/shared";
import {
  calculateBattleAreaRadius,
  selectNewLeader,
  shouldResolveBattle,
  shouldEnterFleeing,
  shouldRejoin,
  canJoinBattleSide,
  isPointInsideBattleArea,
} from "@mmo/shared/dist/battle/rules.js";
import type {
  BattleGroup,
  BattleParticipant,
  BattleRulesConfig,
  BattleSide,
  BattleState,
  CombatPoint,
  ParticipantState,
} from "@mmo/shared";

export type BattleSideId = "player" | "enemy";

export type BattleManagerError =
  | "INVALID_BATTLE_ID"
  | "BATTLE_ALREADY_EXISTS"
  | "BATTLE_NOT_FOUND"
  | "PARTICIPANT_NOT_FOUND"
  | "PARTICIPANT_ALREADY_IN_BATTLE"
  | "PARTICIPANT_ALREADY_IN_THIS_BATTLE"
  | "PARTICIPANT_DEAD"
  | "INVALID_SIDE"
  | "PARTICIPANT_NOT_IN_BATTLE"
  | "PARTICIPANT_NOT_ON_SIDE"
  | "LEADER_NOT_ON_SIDE"
  | "BATTLE_NOT_RESOLVED"
  | "POSITION_NOT_FINITE"
  | "CANDIDATE_NOT_ALIVE"
  | "CANDIDATE_WRONG_FACTION"
  | "CANDIDATE_OUT_OF_RANGE"
  | "NO_VALID_BATTLE";

type MutableParticipant = {
  id: string;
  state: ParticipantState;
  position: CombatPoint;
  source: BattleParticipant;
};

type MutableSide = {
  id: BattleSideId;
  leaderId: string | null;
  participants: MutableParticipant[];
  area: {
    center: CombatPoint;
    radius: number;
  };
  state: BattleState;
};

type MutableBattleGroup = {
  id: string;
  playerSide: MutableSide;
  enemySide: MutableSide;
};

type ParticipantIndexEntry = {
  battleId: string;
  sideId: BattleSideId;
};

type BattleSuccess = { readonly battle: BattleGroup };
type BattleFailure = { readonly error: BattleManagerError };
type BattleResult = BattleSuccess | BattleFailure;

function copyPoint(point: CombatPoint): CombatPoint {
  return { x: point.x, y: point.y };
}

function toMutableParticipant(source: BattleParticipant): MutableParticipant {
  return {
    id: source.id,
    state: source.state,
    position: copyPoint(source.position),
    source: {
      id: source.id,
      position: copyPoint(source.position),
      combatPower: source.combatPower,
      personality: source.personality,
      state: source.state,
    },
  };
}

function toSnapshotParticipant(participant: MutableParticipant): BattleParticipant {
  return {
    id: participant.id,
    position: copyPoint(participant.position),
    combatPower: participant.source.combatPower,
    personality: participant.source.personality,
    state: participant.state,
  };
}

function toSnapshotSide(side: MutableSide): BattleSide {
  return {
    id: side.id,
    leaderId: side.leaderId,
    participants: side.participants.map(toSnapshotParticipant),
    area: {
      center: copyPoint(side.area.center),
      radius: side.area.radius,
    },
    state: side.state,
  };
}

function toSnapshotBattle(battle: MutableBattleGroup): BattleGroup {
  return {
    id: battle.id,
    playerSide: toSnapshotSide(battle.playerSide),
    enemySide: toSnapshotSide(battle.enemySide),
  };
}

function isValidParticipantState(value: string): value is ParticipantState {
  switch (value) {
    case "ACTIVE":
    case "FLEEING":
    case "ELIMINATED":
      return true;
    default:
      return false;
  }
}

function isSurvivor(participant: MutableParticipant): boolean {
  return participant.state !== "ELIMINATED";
}

function getParticipant(
  side: MutableSide,
  participantId: string,
): MutableParticipant | undefined {
  return side.participants.find(({ id }) => id === participantId);
}

function getLeader(side: MutableSide): MutableParticipant | null {
  if (side.leaderId === null) return null;
  return getParticipant(side, side.leaderId) ?? null;
}

export class BattleManager {
  private readonly config: BattleRulesConfig;
  private readonly battles = new Map<string, MutableBattleGroup>();
  private readonly participantIndex = new Map<string, ParticipantIndexEntry>();

  constructor(config: BattleRulesConfig = DEFAULT_BATTLE_RULES_CONFIG) {
    this.config = {
      area: { ...config.area },
      engagement: { ...config.engagement },
    };
  }

  getBattle(battleId: string): BattleGroup | undefined {
    const battle = this.battles.get(battleId);
    return battle ? toSnapshotBattle(battle) : undefined;
  }

  hasBattle(battleId: string): boolean {
    return this.battles.has(battleId);
  }

  getBattleByParticipant(
    participantId: string,
  ): { readonly battle: BattleGroup; readonly sideId: BattleSideId } | undefined {
    const entry = this.participantIndex.get(participantId);
    if (!entry) return undefined;
    const battle = this.battles.get(entry.battleId);
    if (!battle) return undefined;
    return { battle: toSnapshotBattle(battle), sideId: entry.sideId };
  }

  createBattle(
    battleId: string,
    playerParticipant: BattleParticipant | undefined,
    enemyParticipant: BattleParticipant | undefined,
  ): BattleResult {
    if (typeof battleId !== "string" || battleId.trim().length === 0) {
      return { error: "INVALID_BATTLE_ID" };
    }
    if (this.battles.has(battleId)) return { error: "BATTLE_ALREADY_EXISTS" };
    if (!playerParticipant) return { error: "PARTICIPANT_NOT_FOUND" };
    if (!enemyParticipant) return { error: "PARTICIPANT_NOT_FOUND" };
    if (playerParticipant.id === enemyParticipant.id) {
      return { error: "PARTICIPANT_ALREADY_IN_THIS_BATTLE" };
    }
    if (playerParticipant.state === "ELIMINATED") return { error: "PARTICIPANT_DEAD" };
    if (enemyParticipant.state === "ELIMINATED") return { error: "PARTICIPANT_DEAD" };
    if (this.participantIndex.has(playerParticipant.id)) {
      return { error: "PARTICIPANT_ALREADY_IN_BATTLE" };
    }
    if (this.participantIndex.has(enemyParticipant.id)) {
      return { error: "PARTICIPANT_ALREADY_IN_BATTLE" };
    }

    const playerSide = this.createSide("player", playerParticipant);
    const enemySide = this.createSide("enemy", enemyParticipant);
    const battle: MutableBattleGroup = {
      id: battleId,
      playerSide,
      enemySide,
    };
    this.battles.set(battleId, battle);
    this.participantIndex.set(playerParticipant.id, { battleId, sideId: "player" });
    this.participantIndex.set(enemyParticipant.id, { battleId, sideId: "enemy" });
    return { battle: toSnapshotBattle(battle) };
  }

  addParticipant(
    battleId: string,
    sideId: BattleSideId,
    participant: BattleParticipant | undefined,
  ): BattleResult {
    const battle = this.battles.get(battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const side = this.getSide(battle, sideId);
    if (!side) return { error: "INVALID_SIDE" };
    if (!participant) return { error: "PARTICIPANT_NOT_FOUND" };
    const existing = this.participantIndex.get(participant.id);
    if (existing?.battleId === battleId) {
      return { error: "PARTICIPANT_ALREADY_IN_THIS_BATTLE" };
    }
    if (existing) return { error: "PARTICIPANT_ALREADY_IN_BATTLE" };
    if (participant.state === "ELIMINATED") return { error: "PARTICIPANT_DEAD" };
    if (side.state === "ELIMINATED") return { error: "PARTICIPANT_NOT_ON_SIDE" };
    if (side.state === "RESOLVED") return { error: "PARTICIPANT_NOT_ON_SIDE" };

    side.participants.push(toMutableParticipant(participant));
    this.participantIndex.set(participant.id, { battleId, sideId });
    this.recalculateRadius(side);
    return { battle: toSnapshotBattle(battle) };
  }

  removeParticipant(battleId: string, participantId: string): BattleResult {
    const battle = this.battles.get(battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const entry = this.participantIndex.get(participantId);
    if (!entry || entry.battleId !== battleId) {
      return { error: "PARTICIPANT_NOT_IN_BATTLE" };
    }
    const side = this.getSide(battle, entry.sideId);
    if (!side) return { error: "PARTICIPANT_NOT_IN_BATTLE" };
    const participantIndex = side.participants.findIndex(({ id }) => id === participantId);
    if (participantIndex < 0) return { error: "PARTICIPANT_NOT_IN_BATTLE" };

    const wasLeader = side.leaderId === participantId;
    side.participants.splice(participantIndex, 1);
    this.participantIndex.delete(participantId);
    this.recalculateRadius(side);
    if (wasLeader) this.selectLeader(side);
    return { battle: toSnapshotBattle(battle) };
  }

  updateParticipantState(
    battleId: string,
    participantId: string,
    state: ParticipantState,
  ): BattleResult {
    const battle = this.battles.get(battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const entry = this.participantIndex.get(participantId);
    if (!entry || entry.battleId !== battleId) {
      return { error: "PARTICIPANT_NOT_IN_BATTLE" };
    }
    if (!isValidParticipantState(state)) return { error: "PARTICIPANT_DEAD" };
    const side = this.getSide(battle, entry.sideId);
    const participant = side ? getParticipant(side, participantId) : undefined;
    if (!side || !participant) return { error: "PARTICIPANT_NOT_IN_BATTLE" };

    const wasLeader = side.leaderId === participantId;
    participant.state = state;
    if (wasLeader && participant.state === "ELIMINATED") this.selectLeader(side);
    else if (!side.participants.some(isSurvivor)) this.selectLeader(side);
    else if (side.leaderId === null && isSurvivor(participant)) this.selectLeader(side);
    return { battle: toSnapshotBattle(battle) };
  }

  transferLeader(
    battleId: string,
    sideId: BattleSideId,
    newLeaderId?: string,
  ): BattleResult {
    const battle = this.battles.get(battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const side = this.getSide(battle, sideId);
    if (!side) return { error: "INVALID_SIDE" };
    if (newLeaderId !== undefined) {
      const newLeader = getParticipant(side, newLeaderId);
      if (!newLeader) return { error: "LEADER_NOT_ON_SIDE" };
      if (!isSurvivor(newLeader)) return { error: "PARTICIPANT_DEAD" };
      side.leaderId = newLeader.id;
      side.area.center = copyPoint(newLeader.position);
      side.state = "ACTIVE";
    } else {
      this.selectLeader(side);
    }
    return { battle: toSnapshotBattle(battle) };
  }

  updateBattleArea(
    battleId: string,
    participantId: string,
    position: CombatPoint,
  ): BattleResult {
    const battle = this.battles.get(battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const entry = this.participantIndex.get(participantId);
    if (!entry || entry.battleId !== battleId) {
      return { error: "PARTICIPANT_NOT_IN_BATTLE" };
    }
    const side = this.getSide(battle, entry.sideId);
    const participant = side ? getParticipant(side, participantId) : undefined;
    if (!side || !participant) return { error: "PARTICIPANT_NOT_IN_BATTLE" };

    participant.position = copyPoint(position);
    if (side.leaderId === participantId) {
      side.area.center = copyPoint(position);
      this.recalculateRadius(side);
    }
    return { battle: toSnapshotBattle(battle) };
  }

  /**
   * Synchronize a participant's world position into the battle runtime.
   * Uses the reverse index — caller does not need to know the battle ID.
   * If the participant is the side's leader, the BattleArea center follows.
   *
   * Phase 2A: World → BattleManager position synchronization.
   */
  syncParticipantPosition(
    participantId: string,
    position: CombatPoint,
  ): BattleResult {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return { error: "POSITION_NOT_FINITE" };
    }
    const entry = this.participantIndex.get(participantId);
    if (!entry) return { error: "PARTICIPANT_NOT_IN_BATTLE" };
    const battle = this.battles.get(entry.battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const side = this.getSide(battle, entry.sideId);
    const participant = side ? getParticipant(side, participantId) : undefined;
    if (!side || !participant) return { error: "PARTICIPANT_NOT_IN_BATTLE" };

    participant.position = copyPoint(position);
    if (side.leaderId === participantId) {
      side.area.center = copyPoint(position);
    }
    return { battle: toSnapshotBattle(battle) };
  }

  removeBattle(battleId: string): { readonly removedBattleId: string } | BattleFailure {
    const battle = this.battles.get(battleId);
    if (!battle) return { error: "BATTLE_NOT_FOUND" };
    const firstLeader = getLeader(battle.playerSide);
    const secondLeader = getLeader(battle.enemySide);
    if (!shouldResolveBattle({
      firstLeader: firstLeader ? toSnapshotParticipant(firstLeader) : null,
      secondLeader: secondLeader ? toSnapshotParticipant(secondLeader) : null,
      // The shared rule compares firstLeader to secondEnemyArea and vice versa.
      firstEnemyArea: battle.playerSide.area,
      secondEnemyArea: battle.enemySide.area,
    })) {
      return { error: "BATTLE_NOT_RESOLVED" };
    }

    const participantIds = [
      ...battle.playerSide.participants,
      ...battle.enemySide.participants,
    ].map(({ id }) => id);
    this.battles.delete(battleId);
    for (const participantId of participantIds) this.participantIndex.delete(participantId);
    return { removedBattleId: battleId };
  }

  private createSide(
    sideId: BattleSideId,
    participant: BattleParticipant,
  ): MutableSide {
    return {
      id: sideId,
      leaderId: participant.id,
      participants: [toMutableParticipant(participant)],
      area: {
        center: copyPoint(participant.position),
        radius: calculateBattleAreaRadius(1, this.config.area),
      },
      state: "ACTIVE",
    };
  }

  private getSide(
    battle: MutableBattleGroup,
    sideId: BattleSideId,
  ): MutableSide | undefined {
    if (sideId === "player") return battle.playerSide;
    if (sideId === "enemy") return battle.enemySide;
    return undefined;
  }

  private recalculateRadius(side: MutableSide): void {
    side.area.radius = calculateBattleAreaRadius(side.participants.length, this.config.area);
  }

  private selectLeader(side: MutableSide): void {
    const selected = selectNewLeader(side.participants.map(toSnapshotParticipant));
    if (!selected) {
      side.leaderId = null;
      side.state = "ELIMINATED";
      return;
    }
    side.leaderId = selected.id;
    side.state = "ACTIVE";
    side.area.center = copyPoint(selected.position);
  }

  /**
   * Evaluate whether a candidate should dynamically join an active battle.
   *
   * Iterates all active battles and checks:
   *   1. Candidate is alive (state === "ACTIVE")
   *   2. Candidate is not already in any battle
   *   3. Candidate's position is inside a valid battle area
   *   4. Candidate's entity type is legally allowed on that side (faction gate)
   *
   * On the first valid match the candidate joins via `addParticipant()`.
   * Returns `NO_VALID_BATTLE` when no battle area contains the candidate.
   */
  evaluateDynamicJoin(candidate: {
    id: string;
    position: CombatPoint;
    state: ParticipantState;
    entityType: "player" | "mob";
  }): BattleResult {
    if (candidate.state !== "ACTIVE") {
      return { error: "CANDIDATE_NOT_ALIVE" };
    }
    if (this.participantIndex.has(candidate.id)) {
      return { error: "PARTICIPANT_ALREADY_IN_BATTLE" };
    }
    if (this.battles.size === 0) {
      return { error: "NO_VALID_BATTLE" };
    }

    let insideAnyArea = false;

    for (const [, battle] of this.battles) {
      for (const sideId of ["player", "enemy"] as const) {
        const side = this.getSide(battle, sideId);
        if (!side || side.state === "ELIMINATED") continue;

        const isLegalFaction = canJoinBattleSide(candidate.entityType, sideId);
        const isInside = isPointInsideBattleArea(candidate.position, side.area);

        if (!isLegalFaction) {
          if (isInside) insideAnyArea = true;
          continue;
        }
        if (!isInside) continue;

        const snapshotParticipant: BattleParticipant = {
          id: candidate.id,
          position: copyPoint(candidate.position),
          combatPower: 10,
          personality: "cautious",
          state: candidate.state,
        };
        return this.addParticipant(battle.id, sideId, snapshotParticipant);
      }
    }

    if (insideAnyArea) return { error: "CANDIDATE_WRONG_FACTION" };
    return { error: "CANDIDATE_OUT_OF_RANGE" };
  }

  /**
   * Convenience wrapper: remove a participant by their reverse-index lookup.
   * Used by death/disconnect hooks where the caller does not know the battle ID.
   *
   * Returns `PARTICIPANT_NOT_IN_BATTLE` when the participant is not tracked —
   * callers should treat this as non-fatal (the participant may have already
   * been removed by a concurrent path).
   */
  removeParticipantByDeath(participantId: string): BattleResult {
    const entry = this.participantIndex.get(participantId);
    if (!entry) return { error: "PARTICIPANT_NOT_IN_BATTLE" };
    return this.removeParticipant(entry.battleId, participantId);
  }

  /**
   * Phase 2C: Evaluate disengagement state for all active battles.
   *
   * For each battle, evaluates both sides against the opposing area:
   *   - ACTIVE  → FLEEING  when leader leaves enemy area
   *   - FLEEING → ACTIVE   when leader re-enters enemy area
   *   - Both sides RESOLVED when both leaders are outside opposing areas
   *
   * RESOLVED and ELIMINATED sides are skipped (terminal states).
   * Must be idempotent — repeated calls produce identical state.
   */
  evaluateBattleDisengagement(): void {
    for (const [, battle] of this.battles) {
      this.evaluateSideDisengagement(battle, battle.playerSide, battle.enemySide);
      this.evaluateSideDisengagement(battle, battle.enemySide, battle.playerSide);
      this.evaluateResolution(battle);
    }
  }

  /**
   * Evaluate flee/rejoin for a single side against the opposing area.
   * Terminal states (RESOLVED, ELIMINATED) are skipped.
   */
  private evaluateSideDisengagement(
    battle: MutableBattleGroup,
    side: MutableSide,
    opposingSide: MutableSide,
  ): void {
    if (side.state === "RESOLVED" || side.state === "ELIMINATED") return;
    if (opposingSide.state === "ELIMINATED") return;
    const leader = getLeader(side);
    if (!leader) return;

    // Check rejoin first (FLEEING → ACTIVE)
    if (shouldRejoin({ leader: toSnapshotParticipant(leader), enemyArea: opposingSide.area })) {
      if (side.state === "FLEEING") {
        side.state = "ACTIVE";
        leader.state = "ACTIVE";
      }
      return;
    }
    // Check flee (ACTIVE → FLEEING)
    if (shouldEnterFleeing({ leader: toSnapshotParticipant(leader), enemyArea: opposingSide.area })) {
      if (side.state === "ACTIVE") {
        side.state = "FLEEING";
        leader.state = "FLEEING";
      }
    }
  }

  /**
   * Evaluate whether both sides have disengaged → RESOLVED.
   * Once RESOLVED, the state is terminal and cannot be undone.
   * ELIMINATED sides are preserved — they lost the battle, not disengaged.
   */
  private evaluateResolution(battle: MutableBattleGroup): void {
    if (battle.playerSide.state === "RESOLVED" && battle.enemySide.state === "RESOLVED") return;

    const firstLeader = getLeader(battle.playerSide);
    const secondLeader = getLeader(battle.enemySide);
    if (shouldResolveBattle({
      firstLeader: firstLeader ? toSnapshotParticipant(firstLeader) : null,
      secondLeader: secondLeader ? toSnapshotParticipant(secondLeader) : null,
      firstEnemyArea: battle.playerSide.area,
      secondEnemyArea: battle.enemySide.area,
    })) {
      if (battle.playerSide.state !== "ELIMINATED" && battle.playerSide.state !== "RESOLVED") {
        battle.playerSide.state = "RESOLVED";
      }
      if (battle.enemySide.state !== "ELIMINATED" && battle.enemySide.state !== "RESOLVED") {
        battle.enemySide.state = "RESOLVED";
      }
    }
  }

}
