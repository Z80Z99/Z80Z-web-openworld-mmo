import { DEFAULT_BATTLE_RULES_CONFIG } from "./constants.js";
import type {
  BattleArea,
  BattleAreaConfig,
  BattleParticipant,
  BattleResolutionContext,
  EngagementConfig,
  EngagementContext,
  EngagementDecision,
  JoinBattleContext,
  LeaderAreaContext,
} from "./types.js";

/* ── Geometric helpers ── */

/**
 * Squared Euclidean distance between two world-space points.
 * Uses squared distance to avoid square roots in hot paths.
 */
export function distanceSquared(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Whether a point lies inside (or exactly on the boundary of) a circular
 * battle area. Boundary inclusion is intentional.
 */
export function isPointInsideBattleArea(
  point: { readonly x: number; readonly y: number },
  area: BattleArea,
): boolean {
  const r2 = area.radius * area.radius;
  return distanceSquared(point, area.center) <= r2;
}

/* ── Battle area radius ── */

function validateAreaConfig(config: BattleAreaConfig): void {
  if (
    !Number.isFinite(config.baseRadius) ||
    !Number.isFinite(config.expansionRate) ||
    !Number.isFinite(config.diminishingReturnScale) ||
    !Number.isFinite(config.maxRadius)
  ) {
    throw new RangeError("BattleAreaConfig values must be finite numbers");
  }
  if (config.baseRadius < 0 || config.expansionRate < 0 || config.maxRadius < 0) {
    throw new RangeError("BattleAreaConfig values must be non-negative");
  }
  if (config.diminishingReturnScale <= 0) {
    throw new RangeError("BattleAreaConfig.diminishingReturnScale must be positive");
  }
  if (config.baseRadius > config.maxRadius) {
    throw new RangeError("BattleAreaConfig.baseRadius must not exceed maxRadius");
  }
}

/**
 * Deterministic battle-area radius from participant count.
 *
 *   radius = baseRadius + expansionRate * (1 - exp(-count / scale))
 *   radius = min(maxRadius, radius)
 *
 * The exponential term gives diminishing returns: each additional
 * participant contributes less than the previous one, and the radius is
 * clamped at maxRadius — never a linear baseRadius * count multiplication.
 *
 * Edge cases:
 *   - participantCount <= 0 yields baseRadius (a battle area with no
 *     participants still has a defined radius for zone calculations).
 *   - NaN or Infinity throws RangeError.
 *   - Invalid config (e.g. baseRadius > maxRadius) throws RangeError.
 */
export function calculateBattleAreaRadius(
  participantCount: number,
  config: BattleAreaConfig = DEFAULT_BATTLE_RULES_CONFIG.area,
): number {
  validateAreaConfig(config);
  if (!Number.isFinite(participantCount)) {
    throw new RangeError("participantCount must be a finite number");
  }

  const effectiveCount = Math.max(0, participantCount);
  const growth = 1 - Math.exp(-effectiveCount / config.diminishingReturnScale);
  const expanded = config.baseRadius + config.expansionRate * growth;
  return Math.min(config.maxRadius, expanded);
}

/* ── Joining ── */

/**
 * Whether an individual participant should join a battle.
 * Joins only when the participant is active, not already in a battle,
 * and physically inside the battle area (boundary included).
 */
export function shouldJoinBattle(context: JoinBattleContext): boolean {
  const { participant, battleArea, alreadyJoined } = context;
  if (participant.state !== "ACTIVE") return false;
  if (alreadyJoined) return false;
  return isPointInsideBattleArea(participant.position, battleArea);
}

/* ── Engagement decision ── */

function validateEngagementContext(ctx: EngagementContext, config: EngagementConfig): void {
  if (!Number.isFinite(ctx.distance) || ctx.distance < 0) {
    throw new RangeError("EngagementContext.distance must be a finite non-negative number");
  }
  if (!Number.isFinite(ctx.combatPowerRatio) || ctx.combatPowerRatio < 0) {
    throw new RangeError("EngagementContext.combatPowerRatio must be a finite non-negative number");
  }
  if (
    !Number.isFinite(config.maxEngagementDistance) ||
    !Number.isFinite(config.cowardFleeRatio) ||
    !Number.isFinite(config.cowardEngageRatio) ||
    !Number.isFinite(config.cautiousEngageRatio)
  ) {
    throw new RangeError("EngagementConfig values must be finite numbers");
  }
}

/**
 * Deterministic engagement decision based on distance, combat-power ratio,
 * and AI personality. No randomness.
 *
 * Decision table:
 *   - distance > maxEngagementDistance  → AVOID (for every personality)
 *   - aggressive                        → ENGAGE (within range, regardless of ratio)
 *   - cautious, ratio >= cautiousEngageRatio → ENGAGE; otherwise AVOID
 *   - coward,  ratio <  cowardFleeRatio → FLEE
 *   - coward,  cowardFleeRatio <= ratio < cowardEngageRatio → AVOID
 *   - coward,  ratio >= cowardEngageRatio → ENGAGE
 */
export function decideEngagement(
  context: EngagementContext,
): EngagementDecision {
  const config = context.config ?? DEFAULT_BATTLE_RULES_CONFIG.engagement;
  validateEngagementContext(context, config);

  if (context.distance > config.maxEngagementDistance) {
    return "AVOID";
  }

  switch (context.personality) {
    case "aggressive":
      return "ENGAGE";
    case "cautious":
      return context.combatPowerRatio >= config.cautiousEngageRatio ? "ENGAGE" : "AVOID";
    case "coward":
      if (context.combatPowerRatio < config.cowardFleeRatio) return "FLEE";
      if (context.combatPowerRatio >= config.cowardEngageRatio) return "ENGAGE";
      return "AVOID";
  }
}

/* ── Flee / rejoin / resolve ── */

/**
 * Whether a side's leader should enter FLEEING state.
 *
 * Returns true when the leader exists, is not ELIMINATED, and stands
 * outside the enemy battle area.
 *
 * **Important**: This function does NOT check whether the leader is
 * already FLEEING — the caller is responsible for state gating before
 * calling this predicate.
 *
 * This is a pure predicate for the side-level flee decision; it is not
 * yet wired into BattleManager (Phase 2+).
 */
export function shouldEnterFleeing(context: LeaderAreaContext): boolean {
  const { leader, enemyArea } = context;
  if (!leader) return false;
  if (leader.state === "ELIMINATED") return false;
  return !isPointInsideBattleArea(leader.position, enemyArea);
}

/**
 * Whether a FLEEING leader should rejoin (return to ACTIVE) when back
 * inside the enemy battle area.
 *
 * Only returns true when the leader's current state is FLEEING and their
 * position is inside the enemy area. This is the symmetric counterpart
 * to `shouldEnterFleeing()`.
 *
 * Not yet wired into BattleManager (Phase 2+).
 */
export function shouldRejoin(context: LeaderAreaContext): boolean {
  const { leader, enemyArea } = context;
  if (!leader) return false;
  if (leader.state !== "FLEEING") return false;
  return isPointInsideBattleArea(leader.position, enemyArea);
}

/**
 * Whether a battle group has met the conditions for resolution.
 *
 * Resolved when BOTH leaders are outside opposing battle areas.
 * An ELIMINATED or null leader counts as "outside" (already withdrawn).
 *
 * Used by `BattleManager.removeBattle()` as a guard — if this returns
 * false, removal is rejected with `BATTLE_NOT_RESOLVED`. Note that
 * BattleManager never sets `BattleSide.state` to `"RESOLVED"`; it
 * deletes the battle directly after this guard passes.
 */
export function shouldResolveBattle(context: BattleResolutionContext): boolean {
  const { firstLeader, secondLeader, firstEnemyArea, secondEnemyArea } = context;

  const firstOutside =
    !firstLeader || firstLeader.state === "ELIMINATED" || !isPointInsideBattleArea(firstLeader.position, secondEnemyArea);
  const secondOutside =
    !secondLeader ||
    secondLeader.state === "ELIMINATED" ||
    !isPointInsideBattleArea(secondLeader.position, firstEnemyArea);

  return firstOutside && secondOutside;
}

/* ── Leader selection ── */

/**
 * Select the next leader from the surviving (ACTIVE) participants.
 * Array order is the explicit deterministic tie-break.
 * Returns null when the side has no surviving participant (side eliminated).
 */
export function selectNewLeader(
  participants: readonly BattleParticipant[],
): BattleParticipant | null {
  for (const p of participants) {
    if (p.state === "ACTIVE") return p;
  }
  return null;
}
