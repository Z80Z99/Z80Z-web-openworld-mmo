import type {
  CombatSession,
  CombatParticipantState,
  CombatState,
  CombatManagerError,
} from "@mmo/shared";

/* ── Mutable internal types (mirrors BattleManager pattern) ── */

type MutableCombatParticipant = {
  participantId: string;
  currentHp: number;
  maxHp: number;
  initiative: number;
  alive: boolean;
  defending: boolean;
};

type MutableCombatSession = {
  id: string;
  battleId: string;
  state: CombatState;
  round: number;
  currentActorId: string;
  turnOrder: string[];
  participants: MutableCombatParticipant[];
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

    // Create mutable session
    const turnOrder = participants.map((p) => p.participantId);
    const mutableParticipants: MutableCombatParticipant[] = participants.map(
      (p) => ({
        participantId: p.participantId,
        currentHp: p.currentHp,
        maxHp: p.maxHp,
        initiative: p.initiative,
        alive: p.alive,
        defending: p.defending,
      }),
    );

    const session: MutableCombatSession = {
      id: combatId,
      battleId,
      state: "ACTIVE",
      round: 1,
      currentActorId: turnOrder[0],
      turnOrder,
      participants: mutableParticipants,
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
        if (nextIndex === 0 && currentIndex >= 0) {
          // Wrapped around — increment round
          session.round++;
        }
        session.currentActorId = participantId;
        return;
      }

      nextIndex = (nextIndex + 1) % turnOrder.length;
      attempts++;

      // If we wrapped around during the search, increment round
      if (nextIndex === 0) {
        session.round++;
      }
    }

    // No alive participants found
    session.state = "RESOLVED";
  }
}
