export { DEFAULT_BATTLE_RULES_CONFIG } from "./constants.js";
export {
  distanceSquared,
  isPointInsideBattleArea,
  calculateBattleAreaRadius,
  shouldJoinBattle,
  decideEngagement,
  shouldEnterFleeing,
  shouldRejoin,
  shouldResolveBattle,
  selectNewLeader,
  canJoinBattleSide,
} from "./rules.js";

export type {
  CombatPoint,
  BattleArea,
  BattleParticipant,
  BattleSide,
  BattleGroup,
  BattleState,
  ParticipantState,
  BattlePersonality,
  EngagementDecision,
  BattleAreaConfig,
  EngagementConfig,
  BattleRulesConfig,
  JoinBattleContext,
  EngagementContext,
  LeaderAreaContext,
  BattleResolutionContext,
  /* ── Phase 3B: Combat Session ── */
  CombatState,
  CombatParticipantState,
  CombatSession,
  /* ── Phase 3C: CombatManager ── */
  CombatManagerError,
} from "./types.js";
