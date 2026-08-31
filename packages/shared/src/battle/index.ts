export {
  DEFAULT_BATTLE_RULES_CONFIG,
  BATTLE_TURN_TIMEOUT_MS,
  BATTLE_MOB_TURN_DELAY_MS,
} from "./constants.js";
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
  /* ── Phase 3D-2A: Combat Damage Result Pipeline ── */
  CombatActionType,
  CombatAction,
  DamageResult,
  CombatStatsProvider,
  /* ── Phase 3D-2B: World HP Synchronization ── */
  WorldHealthWriter,
} from "./types.js";
