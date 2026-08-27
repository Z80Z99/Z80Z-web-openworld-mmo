/* ── Dynamic Battle Area — Domain Types (Phase 0) ──
 *
 * Pure, runtime-free type definitions for the future persistent-world
 * turn-combat model.  These types MUST NOT depend on GameRoom, Colyseus,
 * Player/Mob classes, or any network layer — the battle rule layer works
 * exclusively on plain data so it stays unit-testable in isolation.
 */

/** Continuous world-space position (tiles).  Cross-chunk by construction. */
export interface CombatPoint {
  readonly x: number;
  readonly y: number;
}

/** A circular area in world space.  Boundary points are considered inside. */
export interface BattleArea {
  readonly center: CombatPoint;
  readonly radius: number;
}

/**
 * One unit taking part in a battle.  Deliberately decoupled from any
 * concrete Player/Mob entity — the caller maps entity → participant.
 */
export interface BattleParticipant {
  readonly id: string;
  /** Current world position of the unit. */
  readonly position: CombatPoint;
  /** Scalar combat power supplied by the caller (not computed here). */
  readonly combatPower: number;
  readonly personality: BattlePersonality;
  readonly state: ParticipantState;
}

/** Aggregation of combat units on one side of a battle. */
export interface BattleSide {
  readonly id: string;
  /** ID of the side's leader participant, or null when leaderless/eliminated. */
  readonly leaderId: string | null;
  readonly participants: readonly BattleParticipant[];
  /** Side-owned battle area (center follows the leader's position). */
  readonly area: BattleArea;
  readonly state: BattleState;
}

/** A battle instance: two opposing sides. */
export interface BattleGroup {
  readonly id: string;
  readonly playerSide: BattleSide;
  readonly enemySide: BattleSide;
}

/* ── State / decision unions ── */

/**
 * Side-level lifecycle state for a BattleSide within a BattleGroup.
 *
 * ACTIVE   — Side has living participants and a leader; normal engagement.
 * FLEEING  — Leader has retreated outside the enemy area; reserved for
 *            Phase 2+ state-machine wiring (not yet set by BattleManager).
 * RESOLVED — Both leaders outside opposing areas; battle can be removed.
 *            Checked by `shouldResolveBattle()` but state is never set —
 *            BattleManager deletes directly after the guard passes.
 * ELIMINATED — All participants dead or removed; no survivors remain.
 *
 * BattleManager currently only transitions between ACTIVE ↔ ELIMINATED.
 * FLEEING and RESOLVED are declared for future rule integration.
 */
export type BattleState = "ACTIVE" | "FLEEING" | "RESOLVED" | "ELIMINATED";

/**
 * Individual participant lifecycle state, independent of side-level state.
 *
 * ACTIVE     — Unit is alive and participating.
 * FLEEING    — Unit has retreated; set via `BattleManager.updateParticipantState()`.
 * ELIMINATED — Unit is dead or removed.
 *
 * Participant FLEEING is a distinct concept from side-level FLEEING
 * (leader retreat). The two are not yet wired together.
 */
export type ParticipantState = "ACTIVE" | "FLEEING" | "ELIMINATED";

/** AI behavioural disposition used by the engagement decision. */
export type BattlePersonality = "aggressive" | "cautious" | "coward";

/** Outcome of an engagement decision. */
export type EngagementDecision = "ENGAGE" | "AVOID" | "FLEE";

/* ── Configuration ── */

/** Battle-area radius growth configuration (centralised). */
export interface BattleAreaConfig {
  /** Radius when a side has a single participant. */
  readonly baseRadius: number;
  /** Overall growth coefficient — larger expands faster. */
  readonly expansionRate: number;
  /** Diminishing-return scale — larger spreads growth over more participants. */
  readonly diminishingReturnScale: number;
  /** Hard cap on the area radius. */
  readonly maxRadius: number;
}

/** Engagement-decision thresholds (centralised). */
export interface EngagementConfig {
  /** Beyond this distance a unit will never ENGAGE. */
  readonly maxEngagementDistance: number;
  /** Coward flees when own/opposing power ratio is below this. */
  readonly cowardFleeRatio: number;
  /** Coward engages only when ratio is at or above this. */
  readonly cowardEngageRatio: number;
  /** Cautious unit engages when ratio is at or above this. */
  readonly cautiousEngageRatio: number;
}

/** Aggregated battle rule configuration. */
export interface BattleRulesConfig {
  readonly area: BattleAreaConfig;
  readonly engagement: EngagementConfig;
}

/* ── Rule input contexts (explicit, so every rule is a pure function) ── */

export interface JoinBattleContext {
  readonly participant: BattleParticipant;
  readonly battleArea: BattleArea;
  /** True when the participant already belongs to a battle group. */
  readonly alreadyJoined: boolean;
}

export interface EngagementContext {
  /** Distance in world units to the opposing force. */
  readonly distance: number;
  /** Own combat power / opposing combat power (caller computes). */
  readonly combatPowerRatio: number;
  readonly personality: BattlePersonality;
  readonly config?: EngagementConfig;
}

export interface LeaderAreaContext {
  readonly leader: BattleParticipant | null;
  readonly enemyArea: BattleArea;
}

export interface BattleResolutionContext {
  readonly firstLeader: BattleParticipant | null;
  readonly secondLeader: BattleParticipant | null;
  /** Enemy area of the FIRST leader (belongs to the second side). */
  readonly firstEnemyArea: BattleArea;
  /** Enemy area of the SECOND leader (belongs to the first side). */
  readonly secondEnemyArea: BattleArea;
}
