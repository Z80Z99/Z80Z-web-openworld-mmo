/**
 * BattleCombatBridge — Orchestration layer between BattleManager and CombatManager.
 *
 * Converts eligible battle participants into combat participants by reading
 * World entity HP via an injectable HpProvider, creating CombatParticipantState
 * for each, and establishing a CombatSession via the CombatManager.
 *
 * Responsibilities:
 *   - Validate battle exists and no active combat already present
 *   - Filter ELIMINATED and dead (HP <= 0) participants
 *   - Map BattleParticipant → CombatParticipantState
 *   - Create CombatSession via CombatManager
 *   - Maintain battleId → combatId mapping
 *
 * Does NOT:
 *   - Modify World HP
 *   - Calculate damage
 *   - Handle XP / Loot
 *   - Replace EncounterSystem
 */

import type {
  BattleGroup,
  BattleParticipant,
  CombatParticipantState,
  CombatSession,
  WorldHealthWriter,
  DamageResult,
  CombatManagerError,
  CombatStatsProvider,
} from "@mmo/shared";
import type { BattleManager } from "./BattleManager.js";
import type { CombatManager } from "./CombatManager.js";

/* ── Types ── */

/** Injectable interface for reading World entity HP. */
export interface HpProvider {
  /** Returns current and max HP for the given entity, or undefined if not found. */
  getHp(entityId: string): { currentHp: number; maxHp: number } | undefined;
}

/** Bridge error codes. */
export type BridgeError =
  | "BATTLE_NOT_FOUND"
  | "ACTIVE_COMBAT_EXISTS"
  | "NO_ELIGIBLE_PARTICIPANTS"
  | "COMBAT_CREATION_FAILED"
  | "NO_WORLD_HP_WRITER"
  | "BATTLE_RESOLVED"
  | "COMBAT_RESOLVED"
  | "PARTICIPANT_ALREADY_IN_COMBAT";

/** Bridge result type. */
export type BridgeResult =
  | { readonly session: CombatSession }
  | { readonly error: BridgeError | CombatManagerError };

/** Result of applyCombatAction. */
export type CombatActionBridgeResult =
  | { readonly damage: DamageResult }
  | { readonly error: BridgeError | CombatManagerError };

/** Snapshot of bridge internal state. */
export interface BridgeSnapshot {
  readonly battleId: string;
  readonly combatId: string;
}

/* ── Implementation ── */

export class BattleCombatBridge {
  private readonly battleManager: BattleManager;
  private readonly combatManager: CombatManager;
  private readonly worldHp?: WorldHealthWriter;
  /** Battle IDs whose combat has been resolved (prevents reactivation). */
  private readonly resolvedBattleIds = new Set<string>();

  constructor(
    battleManager: BattleManager,
    combatManager: CombatManager,
    worldHp?: WorldHealthWriter,
  ) {
    this.battleManager = battleManager;
    this.combatManager = combatManager;
    this.worldHp = worldHp;
  }

  /**
   * Register a leader transfer handler for a specific battle.
   * Synchronizes combat's currentActor when battle leader changes.
   */
  registerLeaderTransfer(battleId: string): void {
    this.battleManager.onLeaderTransfer(battleId, (_bid, newLeaderId) => {
      const combatId = this.combatManager.getCombatIdByBattle(battleId);
      if (!combatId) return;
      const session = this.combatManager.getCombatSession(combatId);
      if (!session || session.state === "RESOLVED") return;

      // If the current actor is on the same side as the new leader
      // but is NOT the new leader, the old leader was replaced — advance turn.
      if (session.currentActorId === newLeaderId) return;

      const newLeaderParticipant = session.participants.find(
        (p) => p.participantId === newLeaderId,
      );
      if (!newLeaderParticipant) return;

      const currentParticipant = session.participants.find(
        (p) => p.participantId === session.currentActorId,
      );
      if (
        currentParticipant &&
        currentParticipant.side === newLeaderParticipant.side
      ) {
        this.combatManager.advanceTurn(combatId);
      }
    });
  }

  /* ── Queries ── */

  /** Get the combatId for a given battleId, or undefined if no combat exists. */
  getCombatId(battleId: string): string | undefined {
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) return undefined;
    // Return undefined for RESOLVED sessions (mapping cleaned)
    const session = this.combatManager.getCombatSession(combatId);
    if (session?.state === "RESOLVED") return undefined;
    return combatId;
  }

  /** Get the battleId for a given combatId, or undefined. */
  getBattleId(combatId: string): string | undefined {
    const session = this.combatManager.getCombatSession(combatId);
    if (!session || session.state === "RESOLVED") return undefined;
    return session.battleId;
  }

  /** Check if a battle has an active combat session. */
  hasActiveCombat(battleId: string): boolean {
    const session = this.combatManager.getCombatSessionByBattle(battleId);
    return session !== undefined && session.state === "ACTIVE";
  }

  /** Get all active battle-to-combat mappings (excludes RESOLVED). */
  getMappings(): readonly BridgeSnapshot[] {
    return this.combatManager
      .getAllCombatMappings()
      .filter((m) => {
        const session = this.combatManager.getCombatSession(m.combatId);
        return session !== undefined && session.state !== "RESOLVED";
      });
  }

  /* ── Commands ── */

  /**
   * Begin a combat encounter within an existing battle.
   *
   * 1. Validates battle exists
   * 2. Checks no active combat already exists
   * 3. Filters eligible participants (not ELIMINATED, HP > 0)
   * 4. Reads World HP via HpProvider
   * 5. Creates CombatParticipantState for each eligible participant
   * 6. Creates CombatSession via CombatManager
   *
   * @param battleId - The battle to begin combat in
   * @param hpProvider - Injectable HP reader for World entities
   * @param combatId - Optional explicit combatId; auto-generated if omitted
   * @returns CombatSession on success, BridgeError on failure
   */
  beginEncounter(
    battleId: string,
    hpProvider: HpProvider,
    combatId?: string,
  ): BridgeResult {
    // 1. Validate battle exists
    const battle = this.battleManager.getBattle(battleId);
    if (!battle) {
      return { error: "BATTLE_NOT_FOUND" };
    }

    // 2. Check no active combat already exists (check CombatManager directly)
    const existingSession = this.combatManager.getCombatSessionByBattle(battleId);
    if (existingSession) {
      if (existingSession.state === "RESOLVED" || this.resolvedBattleIds.has(battleId)) {
        return { error: "COMBAT_RESOLVED" };
      }
      return { error: "ACTIVE_COMBAT_EXISTS" };
    }
    if (this.resolvedBattleIds.has(battleId)) {
      return { error: "COMBAT_RESOLVED" };
    }

    // 3. Collect eligible participants from both sides with side info
    const combatParticipants = [
      ...this.buildCombatParticipants(battle.playerSide.participants, hpProvider, "player"),
      ...this.buildCombatParticipants(battle.enemySide.participants, hpProvider, "enemy"),
    ];

    if (combatParticipants.length === 0) {
      return { error: "NO_ELIGIBLE_PARTICIPANTS" };
    }

    // 4. Generate combatId if not provided
    const resolvedCombatId =
      combatId ?? `combat-${battleId}-${Date.now()}`;

    // 5. Create CombatSession
    const result = this.combatManager.createCombatSession(
      resolvedCombatId,
      battleId,
      combatParticipants,
    );

    if ("error" in result) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    // 6. Register leader transfer handler to sync combat with battle leader changes
    this.registerLeaderTransfer(battleId);

    return result;
  }

  /**
   * Resolve the combat session for a battle.
   * Sets combat state to RESOLVED and removes the mapping.
   */
  resolveCombat(battleId: string): BridgeResult {
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    const session = this.combatManager.getCombatSession(combatId);
    if (!session) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    if (session.state === "RESOLVED") {
      return { session };
    }

    const setResult = this.combatManager.setCombatState(combatId, "RESOLVED");
    if ("error" in setResult) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    // Clean up leader transfer handler
    this.battleManager.offLeaderTransfer(battleId);

    // MF3-010/013: clean up the battle→combat mapping so the battle is free
    this.combatManager.removeCombatMapping(battleId);

    // Track resolved battle to prevent reactivation (MF3-020)
    this.resolvedBattleIds.add(battleId);

    return setResult;
  }

  /**
   * Handle battle lifecycle event: battle has been resolved.
   * If an active combat exists for this battle, resolve it too.
   * Idempotent: calling multiple times is safe.
   */
  handleBattleResolved(battleId: string): BridgeResult {
    // Check CombatManager directly for existing session
    const existingSession = this.combatManager.getCombatSessionByBattle(battleId);
    if (existingSession) {
      // Already resolved — return it
      if (existingSession.state === "RESOLVED") {
        return { session: existingSession };
      }
      // Active — resolve it
      const result = this.combatManager.setCombatState(existingSession.id, "RESOLVED");
      if ("error" in result) {
        return { error: "COMBAT_CREATION_FAILED" };
      }
      // Clean up leader transfer handler
      this.battleManager.offLeaderTransfer(battleId);
      return { session: result.session };
    }
    // Mapping was already cleaned up by resolveCombat — idempotent success
    if (this.resolvedBattleIds.has(battleId)) {
      return { error: "COMBAT_RESOLVED" };
    }
    // No session at all — return error
    return { error: "BATTLE_NOT_FOUND" };
  }

  /**
   * Remove a combat participant from the session for a battle.
   */
  removeParticipant(battleId: string, participantId: string): BridgeResult {
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    const result = this.combatManager.removeCombatParticipant(
      combatId,
      participantId,
    );

    if ("error" in result) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    // MF3-004: also remove from BattleManager (triggers leader transfer if needed)
    this.battleManager.removeParticipant(battleId, participantId);

    return result;
  }

  /**
   * Add a single battle participant to an existing combat session.
   *
   * Flow:
   * 1. Validate combat session exists for this battle
   * 2. Check participant not already in combat
   * 3. Read World HP via HpProvider
   * 4. Build CombatParticipantState and delegate to CombatManager
   *
   * @param battleId - The battle with an active combat session
   * @param participantId - The battle participant to add
   * @param hpProvider - Injectable HP reader for World entities
   * @returns CombatSession on success, BridgeError on failure
   */
  addParticipantToCombat(
    battleId: string,
    participantId: string,
    hpProvider: HpProvider,
  ): BridgeResult {
    // 1. Validate combat session exists
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    // 2. Determine side from BattleManager
    const battleInfo = this.battleManager.getBattleByParticipant(participantId);
    if (!battleInfo) {
      return { error: "BATTLE_NOT_FOUND" };
    }

    const side: "player" | "enemy" = battleInfo.sideId === "player" ? "player" : "enemy";

    // 3. Check participant not already in combat (check both active and pending)
    const combatSession = this.combatManager.getCombatSession(combatId);
    if (combatSession?.participants.some((p) => p.participantId === participantId)) {
      return { error: "PARTICIPANT_ALREADY_IN_COMBAT" };
    }

    // 4. Read World HP
    const hp = hpProvider.getHp(participantId);
    if (!hp || hp.currentHp <= 0) {
      return { error: "NO_ELIGIBLE_PARTICIPANTS" };
    }

    // 5. Build CombatParticipantState
    // Use the battle's participant data for initiative, or a default
    const battleParticipant = battleInfo.sideId === "player"
      ? battleInfo.battle.playerSide.participants.find((p) => p.id === participantId)
      : battleInfo.battle.enemySide.participants.find((p) => p.id === participantId);

    if (battleParticipant && battleParticipant.state === "ELIMINATED") {
      return { error: "NO_ELIGIBLE_PARTICIPANTS" };
    }

    const combatParticipant: CombatParticipantState = {
      participantId,
      currentHp: hp.currentHp,
      maxHp: hp.maxHp,
      initiative: battleParticipant?.combatPower ?? 10,
      alive: true,
      defending: false,
      side,
    };

    // 6. Delegate to CombatManager (pending — enters turn order next round)
    const result = this.combatManager.addPendingCombatParticipant(combatId, {
      ...combatParticipant,
      id: combatParticipant.participantId,
    });
    if ("error" in result) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    // Register leader transfer handler for this battle
    this.registerLeaderTransfer(battleId);

    return result;
  }

  /**
   * MF3-021: Sync FLEEING state from BattleManager to CombatManager.
   * Reads battle participant states and removes FLEEING participants
   * from the combat turn order.
   */
  syncFleeingState(battleId: string): BridgeResult {
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    const battle = this.battleManager.getBattle(battleId);
    if (!battle) {
      return { error: "BATTLE_NOT_FOUND" };
    }

    const combatSession = this.combatManager.getCombatSession(combatId);
    if (!combatSession) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    // Collect all battle participants
    const allBattleParticipants = [
      ...battle.playerSide.participants,
      ...battle.enemySide.participants,
    ];

    // Find FLEEING participants that are still in combat turnOrder
    for (const bp of allBattleParticipants) {
      if (bp.state === "FLEEING") {
        const inCombat = combatSession.participants.some(
          (p) => p.participantId === bp.id,
        );
        const inTurnOrder = combatSession.turnOrder.includes(bp.id);
        if (inCombat && inTurnOrder) {
          this.combatManager.setParticipantFleeing(combatId, bp.id);
        }
      }
    }

    const finalSession = this.combatManager.getCombatSession(combatId);
    if (!finalSession) {
      return { error: "COMBAT_CREATION_FAILED" };
    }
    return { session: finalSession };
  }

  /**
   * Sync all eligible battle participants into the combat session.
   *
   * Adds any battle participants not yet in combat, and removes
   * any combat participants no longer in the battle. Idempotent.
   *
   * Flow:
   * 1. Validate combat session exists
   * 2. Get battle participants from BattleManager
   * 3. Add missing participants (filter ELIMINATED, dead)
   * 4. Remove stale participants (dead, removed from battle)
   *
   * @param battleId - The battle with an active combat session
   * @param hpProvider - Injectable HP reader for World entities
   * @returns CombatSession on success, BridgeError on failure
   */
  syncParticipants(
    battleId: string,
    hpProvider: HpProvider,
  ): BridgeResult {
    // 1. Validate combat session exists
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    const battle = this.battleManager.getBattle(battleId);
    if (!battle) {
      return { error: "BATTLE_NOT_FOUND" };
    }

    // 2. Collect all eligible battle participants
    const eligibleParticipants = [
      ...this.buildCombatParticipants(battle.playerSide.participants, hpProvider, "player"),
      ...this.buildCombatParticipants(battle.enemySide.participants, hpProvider, "enemy"),
    ];

    // 3. Add missing participants as pending (queued for next round boundary)
    const combatSession = this.combatManager.getCombatSession(combatId);
    if (!combatSession) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    const existingIds = new Set(combatSession.participants.map((p) => p.participantId));
    const pendingParticipants = this.combatManager.getPendingParticipants(combatId);
    const pendingIds = new Set(pendingParticipants.map((p) => p.participantId));

    for (const participant of eligibleParticipants) {
      if (!existingIds.has(participant.participantId) && !pendingIds.has(participant.participantId)) {
        const addResult = this.combatManager.addPendingCombatParticipant(combatId, {
          ...participant,
          id: participant.participantId,
        });
        if ("error" in addResult) {
          return { error: "COMBAT_CREATION_FAILED" };
        }
      }
    }

    // 4. Remove stale participants (in combat but not in eligible battle participants)
    const eligibleIds = new Set(eligibleParticipants.map((p) => p.participantId));
    const refreshedSession = this.combatManager.getCombatSession(combatId);
    if (!refreshedSession) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    for (const combatParticipant of refreshedSession.participants) {
      if (!eligibleIds.has(combatParticipant.participantId)) {
        const removeResult = this.combatManager.removeCombatParticipant(
          combatId,
          combatParticipant.participantId,
        );
        if ("error" in removeResult) {
          return { error: "COMBAT_CREATION_FAILED" };
        }
      }
    }

    // 5. Return final session
    const finalSession = this.combatManager.getCombatSession(combatId);
    if (!finalSession) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    return { session: finalSession };
  }

  /**
   * Apply a combat attack with World HP write-back.
   *
   * Flow:
   * 1. Validate WorldHealthWriter exists
   * 2. Look up combatId for this battle
   * 3. Check target is alive in World HP (authority)
   * 4. Delegate to CombatManager.applyAttack()
   * 5. Write remaining HP back to World HP
   * 6. On kill: update battle state + remove by death
   */
  applyCombatAction(
    battleId: string,
    attackerId: string,
    targetId: string,
    statsProvider: CombatStatsProvider,
  ): CombatActionBridgeResult {
    // 1. WorldHealthWriter required
    if (!this.worldHp) return { error: "NO_WORLD_HP_WRITER" };

    // 2. Combat must exist for this battle
    const combatId = this.combatManager.getCombatIdByBattle(battleId);
    if (!combatId) return { error: "BATTLE_NOT_FOUND" };

    // 3. Target must be alive in World HP (authority)
    if (!this.worldHp.isAlive(targetId)) return { error: "TARGET_NOT_ALIVE" };

    // 4. Delegate to CombatManager
    const attackResult = this.combatManager.applyAttack(
      combatId,
      { actorId: attackerId, targetId: targetId, actionType: "ATTACK" },
      statsProvider,
    );
    if ("error" in attackResult) return { error: attackResult.error };

    const damage = attackResult.result;

    // 5. Write remaining HP back to World
    this.worldHp.setHp(targetId, damage.remainingHp);

    // 6. Death handling
    if (damage.targetKilled) {
      this.battleManager.updateParticipantState(battleId, targetId, "ELIMINATED");
      this.battleManager.removeParticipantByDeath(targetId);
    }

    return { damage };
  }

  /* ── Private Helpers ── */

  /**
   * Filter battle participants to eligible combatants and build
   * CombatParticipantState for each.
   */
  private buildCombatParticipants(
    participants: readonly BattleParticipant[],
    hpProvider: HpProvider,
    side: "player" | "enemy",
  ): CombatParticipantState[] {
    const result: CombatParticipantState[] = [];
    const seenIds = new Set<string>();

    for (const p of participants) {
      // Skip duplicates (shouldn't happen, but defensive)
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);

      // Skip ELIMINATED participants
      if (p.state === "ELIMINATED") continue;

      // Read World HP
      const hp = hpProvider.getHp(p.id);
      if (!hp) continue;

      // Skip dead entities
      if (hp.currentHp <= 0) continue;

      result.push({
        participantId: p.id,
        currentHp: hp.currentHp,
        maxHp: hp.maxHp,
        initiative: p.combatPower,
        alive: true,
        defending: false,
        side,
      });
    }

    return result;
  }
}
