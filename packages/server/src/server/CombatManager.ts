import type {
  CombatSession,
  CombatParticipantState,
  CombatState,
  CombatManagerError,
  CombatStatsProvider,
  DamageResult,
} from "@mmo/shared";
import { calculateDamage } from "./CombatSystem.js";

/* ── Mutable internal types (mirrors BattleManager pattern) ── */

type MutableCombatParticipant = {
  participantId: string;
  currentHp: number;
  maxHp: number;
  initiative: number;
  alive: boolean;
  defending: boolean;
  side: "player" | "enemy";
};

type MutableCombatSession = {
  id: string;
  battleId: string;
  state: CombatState;
  round: number;
  currentActorId: string;
  turnOrder: string[];
  participants: MutableCombatParticipant[];
  turnStartedAt: number | null;
  turnTimeoutMs: number | null;
};

/* ── Result types ── */

type CombatSuccess = { readonly session: CombatSession };
type CombatFailure = { readonly error: CombatManagerError };
type CombatResult = CombatSuccess | CombatFailure;

/* ── Snapshot converter ── */

function toSnapshotSession(session: MutableCombatSession): CombatSession {
  return {
    id: session.id,
    battleId: session.battleId,
    state: session.state,
    round: session.round,
    currentActorId: session.currentActorId,
    turnOrder: [...session.turnOrder],
    participants: session.participants.map((p) => ({ ...p })),
    turnStartedAt: session.turnStartedAt,
    turnTimeoutMs: session.turnTimeoutMs,
  };
}

/* ════════════════ CombatManager ════════════════ */

/**
 * Runtime manager for CombatSession lifecycle.
 *
 * Follows the same MutableInternal + Snapshot pattern as BattleManager:
 * - Internal state is mutable (Map of MutableCombatSession)
 * - Public API returns deep-cloned snapshots (CombatSession)
 * - Error handling: returns { error: "..." }, never throws
 *
 * CombatManager owns combat state (turn order, HP, initiative, rounds).
 * BattleManager owns spatial state (BattleArea, positions, join/leave).
 * They are connected via battleId but never depend on each other.
 */
export class CombatManager {
  /** Active combat sessions, keyed by combatId. */
  private readonly sessions = new Map<string, MutableCombatSession>();
  /** Reverse index: battleId → combatId. */
  private readonly battleIndex = new Map<string, string>();
  /** Reverse index: participantId → combatId. */
  private readonly participantIndex = new Map<string, string>();

  /* ── Public API ── */

  /**
   * Create a new combat session for a battle.
   * Each battle can have at most one active combat session.
   */
  createCombatSession(
    combatId: string,
    battleId: string,
    participants: readonly CombatParticipantState[],
    timeoutMs?: number,
  ): CombatResult {
    // Validate combat ID
    if (typeof combatId !== "string" || combatId.trim().length === 0) {
      return { error: "INVALID_COMBAT_ID" };
    }

    // Validate battle ID
    if (typeof battleId !== "string" || battleId.trim().length === 0) {
      return { error: "INVALID_BATTLE_ID" };
    }

    // No duplicate combat for same battle
    if (this.battleIndex.has(battleId)) {
      return { error: "ACTIVE_COMBAT_EXISTS_FOR_BATTLE" };
    }

    // No duplicate combat ID
    if (this.sessions.has(combatId)) {
      return { error: "COMBAT_ALREADY_EXISTS" };
    }

    // Validate participants
    if (participants.length === 0) {
      return { error: "PARTICIPANT_NOT_FOUND" };
    }

    // Validate unique participant IDs
    const seenIds = new Set<string>();
    for (const p of participants) {
      if (seenIds.has(p.participantId)) {
        return { error: "PARTICIPANT_ALREADY_IN_COMBAT" };
      }
      seenIds.add(p.participantId);
    }

    // Sort by initiative descending for deterministic turn order
    const sorted = [...participants].sort((a, b) => b.initiative - a.initiative);
    const turnOrder = sorted.map((p) => p.participantId);

    const mutableParticipants: MutableCombatParticipant[] = sorted.map(
      (p) => ({
        participantId: p.participantId,
        currentHp: p.currentHp,
        maxHp: p.maxHp,
        initiative: p.initiative,
        alive: p.alive,
        defending: p.defending,
        side: p.side,
      }),
    );

    // Find first alive participant for initial currentActorId
    const firstAlive = mutableParticipants.find((p) => p.alive);
    const initialActorId = firstAlive ? firstAlive.participantId : turnOrder[0];

    const session: MutableCombatSession = {
      id: combatId,
      battleId,
      state: "ACTIVE",
      round: 1,
      currentActorId: initialActorId,
      turnOrder,
      participants: mutableParticipants,
      turnStartedAt: Date.now(),
      turnTimeoutMs: timeoutMs ?? null,
    };

    // Store and index
    this.sessions.set(combatId, session);
    this.battleIndex.set(battleId, combatId);
    for (const p of participants) {
      this.participantIndex.set(p.participantId, combatId);
    }

    return { session: toSnapshotSession(session) };
  }

  /** Get a combat session by its ID. Returns snapshot or undefined. */
  getCombatSession(combatId: string): CombatSession | undefined {
    const session = this.sessions.get(combatId);
    return session ? toSnapshotSession(session) : undefined;
  }

  /** Get a combat session by battle ID. Returns snapshot or undefined. */
  getCombatSessionByBattle(battleId: string): CombatSession | undefined {
    const combatId = this.battleIndex.get(battleId);
    if (!combatId) return undefined;
    const session = this.sessions.get(combatId);
    return session ? toSnapshotSession(session) : undefined;
  }

  /** Check if a combat session exists. */
  hasCombatSession(combatId: string): boolean {
    return this.sessions.has(combatId);
  }

  /** Get all ACTIVE combat sessions as deep-cloned snapshots. */
  getActiveSessions(): readonly CombatSession[] {
    const sessions: CombatSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.state === "ACTIVE") {
        sessions.push(toSnapshotSession(session));
      }
    }
    return sessions;
  }

  /** Look up the combatId for a given battleId, or undefined. */
  getCombatIdByBattle(battleId: string): string | undefined {
    return this.battleIndex.get(battleId);
  }

  /** Return all battle-to-combat mappings. */
  getAllCombatMappings(): ReadonlyArray<{ readonly battleId: string; readonly combatId: string }> {
    const result: Array<{ readonly battleId: string; readonly combatId: string }> = [];
    for (const [battleId, combatId] of this.battleIndex) {
      result.push({ battleId, combatId });
    }
    return result;
  }

  /** Add a participant to an existing combat session. */
  addCombatParticipant(
    combatId: string,
    participant: CombatParticipantState,
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    // Cannot add to resolved session
    if (session.state === "RESOLVED") {
      return { error: "COMBAT_NOT_ACTIVE" };
    }

    // Check duplicate
    const existing = session.participants.find(
      (p) => p.participantId === participant.participantId,
    );
    if (existing) return { error: "PARTICIPANT_ALREADY_IN_COMBAT" };

    // Add participant
    session.participants.push({
      participantId: participant.participantId,
      currentHp: participant.currentHp,
      maxHp: participant.maxHp,
      initiative: participant.initiative,
      alive: participant.alive,
      defending: participant.defending,
      side: participant.side,
    });
    session.turnOrder.push(participant.participantId);
    this.participantIndex.set(participant.participantId, combatId);

    return { session: toSnapshotSession(session) };
  }

  /** Remove a participant from a combat session. */
  removeCombatParticipant(
    combatId: string,
    participantId: string,
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    // Check participant exists
    const pIndex = session.participants.findIndex(
      (p) => p.participantId === participantId,
    );
    if (pIndex === -1) return { error: "PARTICIPANT_NOT_FOUND" };

    // Remove from participants and turnOrder
    session.participants.splice(pIndex, 1);
    const tIndex = session.turnOrder.indexOf(participantId);
    if (tIndex !== -1) session.turnOrder.splice(tIndex, 1);
    this.participantIndex.delete(participantId);

    // If removed participant was current actor, advance to next alive
    if (session.currentActorId === participantId) {
      this.advanceToNextAlive(session);
    }

    // If no alive participants, resolve
    if (!session.participants.some((p) => p.alive)) {
      session.state = "RESOLVED";
    }

    return { session: toSnapshotSession(session) };
  }

  /** Advance turn to the next alive participant. */
  advanceTurn(combatId: string): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    this.advanceToNextAlive(session);

    return { session: toSnapshotSession(session) };
  }

  /**
   * Apply an attack from attacker to target within a combat session.
   *
   * Validates: combat exists, active, attacker/target exist and alive,
   * attacker is current actor, opposing sides, no self-attack.
   *
   * Uses CombatSystem.calculateDamage() for damage formula (no duplication).
   * Advances turn after successful attack.
   */
  applyAttack(
    combatId: string,
    attackerId: string,
    targetId: string,
    statsProvider: CombatStatsProvider,
  ): { readonly result: DamageResult } | CombatFailure {
    // 1. Combat exists
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    // 2. Combat ACTIVE
    if (session.state !== "ACTIVE") return { error: "COMBAT_NOT_ACTIVE" };

    // 3. Attacker exists
    const attacker = session.participants.find(
      (p) => p.participantId === attackerId,
    );
    if (!attacker) return { error: "PARTICIPANT_NOT_FOUND" };

    // 4. Attacker alive
    if (!attacker.alive) return { error: "ATTACKER_NOT_ALIVE" };

    // 5. Target exists
    const target = session.participants.find(
      (p) => p.participantId === targetId,
    );
    if (!target) return { error: "TARGET_NOT_FOUND" };

    // 6. Target alive
    if (!target.alive) return { error: "TARGET_NOT_ALIVE" };

    // 7. Attacker is current actor
    if (session.currentActorId !== attackerId) return { error: "NOT_CURRENT_ACTOR" };

    // 8. No self-attack (must be before friendly-fire check)
    if (attackerId === targetId) return { error: "SELF_ATTACK_REJECTED" };

    // 9. Opposing sides (敌对)
    if (attacker.side === target.side) return { error: "FRIENDLY_FIRE_REJECTED" };

    // Resolve stats
    const attackerStats = statsProvider.getStats(attackerId);
    const targetStats = statsProvider.getStats(targetId);
    if (!attackerStats || !targetStats) return { error: "PARTICIPANT_NOT_FOUND" };

    // Calculate damage (reuse existing function — no formula duplication)
    const damage = calculateDamage(
      attackerStats.attack,
      attackerStats.level,
      targetStats.defense,
    );

    // Apply damage: clamp to [0, maxHp]
    target.currentHp = Math.max(0, target.currentHp - damage);

    // Kill check
    const targetKilled = target.currentHp === 0;
    if (targetKilled) {
      target.alive = false;
      target.defending = false;
    }

    // Advance turn
    this.advanceToNextAlive(session);

    // Return result
    return {
      result: {
        attackerId,
        targetId,
        damage,
        remainingHp: target.currentHp,
        targetKilled,
      },
    };
  }

  /** Set the combat state directly. */
  setCombatState(combatId: string, state: CombatState): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    session.state = state;
    return { session: toSnapshotSession(session) };
  }

  /** Toggle defending state for a participant. */
  setCombatParticipantDefending(
    combatId: string,
    participantId: string,
    defending: boolean,
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    const participant = session.participants.find(
      (p) => p.participantId === participantId,
    );
    if (!participant) return { error: "PARTICIPANT_NOT_FOUND" };

    participant.defending = defending;
    return { session: toSnapshotSession(session) };
  }

  /** Remove a combat session and clean up all indices. */
  removeCombatSession(
    combatId: string,
  ): { readonly removedCombatId: string } | CombatFailure {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    // Clean up indices
    this.battleIndex.delete(session.battleId);
    for (const p of session.participants) {
      this.participantIndex.delete(p.participantId);
    }
    this.sessions.delete(combatId);

    return { removedCombatId: combatId };
  }

  /**
   * Evaluate whether the current turn has timed out.
   * If timed out: sets current actor to defending and advances turn.
   * Idempotent: calling again after advance returns no-op (new actor hasn't timed out).
   */
  evaluateTurnTimeout(
    combatId: string,
    now: number,
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };
    if (session.state !== "ACTIVE") return { error: "COMBAT_NOT_ACTIVE" };
    if (session.turnTimeoutMs === null) return { session: toSnapshotSession(session) };

    const elapsed = now - (session.turnStartedAt ?? 0);
    if (elapsed < session.turnTimeoutMs) {
      return { session: toSnapshotSession(session) };
    }

    // Timeout: auto-defend current actor
    const currentActor = session.participants.find(
      (p) => p.participantId === session.currentActorId,
    );
    if (currentActor && currentActor.alive) {
      currentActor.defending = true;
    }

    // Advance turn
    this.advanceToNextAlive(session);

    return { session: toSnapshotSession(session) };
  }

  /* ── Private helpers ── */

  /**
   * Advance currentActorId to the next alive participant.
   * Wraps around and increments round when reaching the end.
   * Sets RESOLVED if no alive participants remain.
   */
  private advanceToNextAlive(session: MutableCombatSession): void {
    const { turnOrder, participants } = session;

    // If no participants, resolve
    if (turnOrder.length === 0) {
      session.state = "RESOLVED";
      return;
    }

    // Find current index
    let currentIndex = turnOrder.indexOf(session.currentActorId);
    if (currentIndex === -1) {
      // currentActorId not in turnOrder — find first alive
      currentIndex = -1;
    }

    // Try to find next alive participant
    let nextIndex = (currentIndex + 1) % turnOrder.length;
    let attempts = 0;

    while (attempts < turnOrder.length) {
      const participantId = turnOrder[nextIndex];
      const participant = participants.find(
        (p) => p.participantId === participantId,
      );

      if (participant && participant.alive) {
        // Found next alive participant
        // Only increment round when wrapping from non-zero to index 0
        if (nextIndex === 0 && currentIndex !== 0) {
          session.round++;
        }
        session.currentActorId = participantId;
        session.turnStartedAt = Date.now();
        return;
      }

      nextIndex = (nextIndex + 1) % turnOrder.length;
      attempts++;
      // REMOVED: premature round++ that caused double-increment bug
    }

    // No alive participants found
    session.state = "RESOLVED";
  }
}
