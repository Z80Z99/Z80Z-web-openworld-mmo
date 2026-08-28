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
  | "NO_WORLD_HP_WRITER";

/** Bridge result type. */
export type BridgeResult =
  | { readonly session: CombatSession }
  | { readonly error: BridgeError };

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

  /** battleId → combatId mapping. */
  private readonly battleToCombat = new Map<string, string>();

  constructor(
    battleManager: BattleManager,
    combatManager: CombatManager,
    worldHp?: WorldHealthWriter,
  ) {
    this.battleManager = battleManager;
    this.combatManager = combatManager;
    this.worldHp = worldHp;
  }

  /* ── Queries ── */

  /** Get the combatId for a given battleId, or undefined if no combat exists. */
  getCombatId(battleId: string): string | undefined {
    return this.battleToCombat.get(battleId);
  }

  /** Get the battleId for a given combatId, or undefined. */
  getBattleId(combatId: string): string | undefined {
    for (const [bId, cId] of this.battleToCombat) {
      if (cId === combatId) return bId;
    }
    return undefined;
  }

  /** Check if a battle has an active combat session. */
  hasActiveCombat(battleId: string): boolean {
    const combatId = this.battleToCombat.get(battleId);
    if (!combatId) return false;
    return this.combatManager.hasCombatSession(combatId);
  }

  /** Get all battle-to-combat mappings as snapshots. */
  getMappings(): readonly BridgeSnapshot[] {
    const snapshots: BridgeSnapshot[] = [];
    for (const [battleId, combatId] of this.battleToCombat) {
      snapshots.push({ battleId, combatId });
    }
    return snapshots;
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
    if (existingSession && existingSession.state !== "RESOLVED") {
      return { error: "ACTIVE_COMBAT_EXISTS" };
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

    // 6. Store mapping
    this.battleToCombat.set(battleId, resolvedCombatId);

    return result;
  }

  /**
   * Resolve the combat session for a battle.
   * Sets combat state to RESOLVED and removes the mapping.
   */
  resolveCombat(battleId: string): BridgeResult {
    const combatId = this.battleToCombat.get(battleId);
    if (!combatId) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    const session = this.combatManager.getCombatSession(combatId);
    if (!session) {
      this.battleToCombat.delete(battleId);
      return { error: "COMBAT_CREATION_FAILED" };
    }

    if (session.state === "RESOLVED") {
      this.battleToCombat.delete(battleId);
      return { session };
    }

    const setResult = this.combatManager.setCombatState(combatId, "RESOLVED");
    if ("error" in setResult) {
      return { error: "COMBAT_CREATION_FAILED" };
    }

    this.battleToCombat.delete(battleId);
    return setResult;
  }

  /**
   * Remove a combat participant from the session for a battle.
   */
  removeParticipant(battleId: string, participantId: string): BridgeResult {
    const combatId = this.battleToCombat.get(battleId);
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

    return result;
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
    const combatId = this.battleToCombat.get(battleId);
    if (!combatId) return { error: "BATTLE_NOT_FOUND" };

    // 3. Target must be alive in World HP (authority)
    if (!this.worldHp.isAlive(targetId)) return { error: "TARGET_NOT_ALIVE" };

    // 4. Delegate to CombatManager
    const attackResult = this.combatManager.applyAttack(
      combatId,
      attackerId,
      targetId,
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
