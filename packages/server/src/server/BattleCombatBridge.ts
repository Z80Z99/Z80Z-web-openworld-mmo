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
  | "COMBAT_CREATION_FAILED";

/** Bridge result type. */
export type BridgeResult =
  | { readonly session: CombatSession }
  | { readonly error: BridgeError };

/** Snapshot of bridge internal state. */
export interface BridgeSnapshot {
  readonly battleId: string;
  readonly combatId: string;
}

/* ── Implementation ── */

export class BattleCombatBridge {
  private readonly battleManager: BattleManager;
  private readonly combatManager: CombatManager;

  /** battleId → combatId mapping. */
  private readonly battleToCombat = new Map<string, string>();

  constructor(battleManager: BattleManager, combatManager: CombatManager) {
    this.battleManager = battleManager;
    this.combatManager = combatManager;
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

    // 3. Collect eligible participants from both sides
    const allParticipants = [
      ...battle.playerSide.participants,
      ...battle.enemySide.participants,
    ];

    const combatParticipants = this.buildCombatParticipants(
      allParticipants,
      hpProvider,
    );

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

  /* ── Private Helpers ── */

  /**
   * Filter battle participants to eligible combatants and build
   * CombatParticipantState for each.
   */
  private buildCombatParticipants(
    participants: readonly BattleParticipant[],
    hpProvider: HpProvider,
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
      });
    }

    return result;
  }
}
