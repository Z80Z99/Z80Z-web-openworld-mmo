import type {
  CombatSession,
  CombatParticipantState,
  CombatState,
  CombatManagerError,
  CombatStatsProvider,
  CombatAction,
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
  /** FLEEING marker — alive=true + fleeing=true = FLEEING; alive=false = DEAD. */
  fleeing: boolean;
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
  pendingParticipants: MutableCombatParticipant[];
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
    pendingParticipants: session.pendingParticipants.map((p) => ({
      participantId: p.participantId,
      maxHp: p.maxHp,
      currentHp: p.currentHp,
      initiative: p.initiative,
      alive: p.alive,
      fleeing: p.fleeing,
      defending: p.defending,
      side: p.side,
    })),
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
        fleeing: p.fleeing ?? false,
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
      pendingParticipants: [],
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

  /** Remove the battle→combat mapping and clean up the session (cleanup after resolve). */
  removeCombatMapping(battleId: string): void {
    const combatId = this.battleIndex.get(battleId);
    this.battleIndex.delete(battleId);
    if (combatId) {
      const session = this.sessions.get(combatId);
      if (session) {
        for (const p of session.participants) {
          this.participantIndex.delete(p.participantId);
        }
        for (const p of session.pendingParticipants) {
          this.participantIndex.delete(p.participantId);
        }
        this.sessions.delete(combatId);
      }
    }
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
      fleeing: participant.fleeing ?? false,
      defending: participant.defending,
      side: participant.side,
    });
    session.turnOrder.push(participant.participantId);
    // Re-sort turnOrder by initiative descending to maintain correct ordering
    const initMap = new Map(session.participants.map((p) => [p.participantId, p.initiative]));
    session.turnOrder.sort((a, b) => (initMap.get(b) ?? 0) - (initMap.get(a) ?? 0));
    this.participantIndex.set(participant.participantId, combatId);

    return { session: toSnapshotSession(session) };
  }

  /**
   * Add a participant to the pending queue.
   * Pending participants are flushed into active combat at the next round boundary.
   */
  /**
   * Add a participant to the pending queue.
   * Pending participants are visible in participants but NOT in turnOrder
   * until the next round boundary flush.
   */
  addPendingCombatParticipant(
    combatId: string,
    participant: Omit<MutableCombatParticipant, "id"> & { id: string },
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };
    if (session.state !== "ACTIVE") return { error: "COMBAT_NOT_ACTIVE" };

    // Check for duplicate in active participants
    if (session.participants.some((p) => p.participantId === participant.id)) {
      return { error: "PARTICIPANT_ALREADY_IN_COMBAT" };
    }
    // Check for duplicate in pending queue
    if (session.pendingParticipants.some((p) => p.participantId === participant.id)) {
      return { error: "PARTICIPANT_ALREADY_IN_COMBAT" };
    }

    const mutable: MutableCombatParticipant = {
      participantId: participant.id,
      maxHp: participant.maxHp,
      currentHp: participant.currentHp,
      initiative: participant.initiative,
      alive: participant.alive,
      fleeing: participant.fleeing ?? false,
      defending: participant.defending,
      side: participant.side,
    };

    // Add to participants (visible to queries) but NOT to turnOrder (pending)
    session.participants.push(mutable);
    session.pendingParticipants.push(mutable);

    return { session: toSnapshotSession(session) };
  }

  /** Get pending participants for a combat session (public for test visibility). */
  getPendingParticipants(combatId: string): readonly CombatParticipantState[] {
    const session = this.sessions.get(combatId);
    if (!session) return [];
    return session.pendingParticipants.map((p) => ({
      participantId: p.participantId,
      maxHp: p.maxHp,
      currentHp: p.currentHp,
      initiative: p.initiative,
      alive: p.alive,
      fleeing: p.fleeing,
      defending: p.defending,
      side: p.side,
    }));
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

    // Bug #3: also remove from the pending queue so a departed participant is
    // never flushed back into turnOrder ("left battle" must not flush).
    const pendingIndex = session.pendingParticipants.findIndex(
      (p) => p.participantId === participantId,
    );
    if (pendingIndex !== -1) session.pendingParticipants.splice(pendingIndex, 1);

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
    action: CombatAction,
    statsProvider: CombatStatsProvider,
  ): { readonly result: DamageResult } | CombatFailure {
    const attackerId = action.actorId;
    const targetId = action.targetId;
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
      target.fleeing = false; // DEAD strictly clears FLEEING — FLEEING ≠ DEAD (FR-009)
      target.defending = false;
    }

    // Advance turn
    this.advanceToNextAlive(session);

    // MF3-008/009: Side elimination check — if all enemies or all players
    // are dead, combat auto-resolves (not just "all participants dead")
    this.checkSideElimination(session);

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

    // Case A: current actor still present in turnOrder → normal wrap detection.
    // Case B: current actor was removed before advancing (flee / death / removal)
    //         → indexOf === -1. No cycle boundary was crossed, so round MUST NOT
    //         increment and pending MUST NOT be flushed mid-round.
    const currentIndex = turnOrder.indexOf(session.currentActorId);
    const currentActorPresent = currentIndex !== -1;

    // Try to find next alive participant
    let nextIndex = (currentIndex + 1) % turnOrder.length;
    let attempts = 0;

    while (attempts < turnOrder.length) {
      const participantId = turnOrder[nextIndex];
      const participant = participants.find(
        (p) => p.participantId === participantId,
      );

      if (participant && participant.alive) {
        // Found next alive participant.
        // Round boundary is crossed when advancing wraps past the end of the
        // order (next index ≤ current index) — including the single-member
        // case where every turn completes a cycle (enables pending flush).
        // When the current actor was removed before advancing (Case B, index -1),
        // no cycle boundary was crossed — no round++ and no premature pending flush.
        if (currentActorPresent && nextIndex <= currentIndex) {
          session.round++;
          this.flushPendingParticipants(session);
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

  /**
   * MF3-008/009: Check if one side is fully eliminated.
   * If all enemies OR all players are dead, combat auto-resolves.
   * Called after advanceToNextAlive in applyAttack.
   */
  private checkSideElimination(session: MutableCombatSession): void {
    if (session.state !== "ACTIVE") return;

    const enemies = session.participants.filter((p) => p.side === "enemy");
    const players = session.participants.filter((p) => p.side === "player");

    const allEnemiesDead = enemies.length > 0 && enemies.every((p) => !p.alive);
    const allPlayersDead = players.length > 0 && players.every((p) => !p.alive);

    if (allEnemiesDead || allPlayersDead) {
      session.state = "RESOLVED";
    }
  }

  /**
   * MF3-021 / Bug #1+#2+#3: Mark a participant as FLEEING.
   *
   * - Sets `fleeing = true` (alive stays true — FLEEING ≠ DEAD, FR-009).
   * - Removes the participant from turnOrder (FR-013: FLEEING never in turnOrder).
   * - Pending participants keep their pending+FLEEING state — flushPendingParticipants
   *   skips them until rejoin (Bug #3, FR-007).
   * - If the fleeing participant was the current actor, advance to the next alive
   *   participant WITHOUT a premature round++ / pending flush (Bug #2 — handled by
   *   advanceToNextAlive's Case B).
   * - Idempotent: re-fleeing an already-fleeing participant is a success no-op (FR-011).
   */
  setParticipantFleeing(
    combatId: string,
    participantId: string,
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };

    const participant = session.participants.find(
      (p) => p.participantId === participantId,
    );
    if (!participant) return { error: "PARTICIPANT_NOT_FOUND" };

    // Idempotent no-op (FR-011)
    if (participant.fleeing) {
      return { session: toSnapshotSession(session) };
    }

    participant.fleeing = true;

    // Remove from turnOrder (FLEEING = excluded from rotation)
    const tIndex = session.turnOrder.indexOf(participantId);
    if (tIndex !== -1) session.turnOrder.splice(tIndex, 1);

    // If current actor fled, advance to next alive (Case B — no round++/flush)
    if (session.currentActorId === participantId) {
      this.advanceToNextAlive(session);
    }

    return { session: toSnapshotSession(session) };
  }

  /**
   * Bug #1 fix: Restore a FLEEING combat participant's turn eligibility.
   *
   * Rejoin semantics:
   * - Participant must exist and be alive (DEAD can never rejoin — FR-010).
   * - Idempotent: rejoin on a non-fleeing participant is a success no-op (FR-012).
   * - The participant returns to the PENDING queue — NOT directly to turnOrder.
   *   Turn eligibility is restored at the next round boundary via
   *   flushPendingParticipants, so the rejoiner never steals the current turn (FR-004).
   * - HP / initiative / defending are preserved (FR-002 / FR-003).
   */
  rejoinCombatParticipant(
    combatId: string,
    participantId: string,
  ): CombatResult {
    const session = this.sessions.get(combatId);
    if (!session) return { error: "COMBAT_NOT_FOUND" };
    if (session.state !== "ACTIVE") return { error: "COMBAT_NOT_ACTIVE" };

    const participant = session.participants.find(
      (p) => p.participantId === participantId,
    );
    if (!participant) return { error: "PARTICIPANT_NOT_FOUND" };
    if (!participant.alive) return { error: "PARTICIPANT_NOT_ALIVE" };

    // Idempotent no-op when already active (FR-012)
    if (!participant.fleeing) {
      return { session: toSnapshotSession(session) };
    }

    participant.fleeing = false;

    // Rejoin enters the pending queue — never mid-turn (FR-004)
    if (
      !session.pendingParticipants.some((p) => p.participantId === participantId)
    ) {
      session.pendingParticipants.push(participant);
    }

    return { session: toSnapshotSession(session) };
  }

  /**
   * Move eligible pending participants into active combat turn order.
   * Called at round boundaries (inside advanceToNextAlive).
   *
   * Bug #3: Only pending participants that are alive AND not fleeing are
   * flushed. FLEEING / DEAD pending stay stably queued — they are NOT deleted
   * here; they rejoin via rejoinCombatParticipant or are removed by
   * syncParticipants / battle cleanup. This keeps pendingParticipants and
   * CombatParticipant state consistent.
   */
  private flushPendingParticipants(session: MutableCombatSession): void {
    if (session.pendingParticipants.length === 0) return;

    const flushedIds: string[] = [];
    for (const p of session.pendingParticipants) {
      if (p.alive && !p.fleeing) {
        flushedIds.push(p.participantId);
      }
    }
    if (flushedIds.length === 0) return;

    // Add to turnOrder (participants are already in participants list from addPendingCombatParticipant)
    for (const id of flushedIds) {
      session.turnOrder.push(id);
      this.participantIndex.set(id, session.id);
    }

    // Re-sort turnOrder by initiative descending
    const initMap = new Map(session.participants.map((p) => [p.participantId, p.initiative]));
    session.turnOrder.sort((a, b) => (initMap.get(b) ?? 0) - (initMap.get(a) ?? 0));

    // Remove only flushed from pending; keep fleeing/dead pending queued
    session.pendingParticipants = session.pendingParticipants.filter(
      (p) => !flushedIds.includes(p.participantId),
    );
  }
}
