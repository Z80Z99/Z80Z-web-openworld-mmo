/**
 * Phase 3G-4A: Minimal structured logger for Production Combat events.
 * No telemetry framework — just a typed helper that calls deps.logCombatEvent if present.
 */
export type CombatLogEvent =
  | "new_battle_started"
  | "new_combat_started"
  | "legacy_fallback"
  | "battle_resolved"
  | "new_combat_resolved";

export interface CombatLogDeps {
  logCombatEvent?: (event: string, data: Record<string, unknown>) => void;
}

/**
 * Emit a structured combat log event. No-op when logCombatEvent is absent.
 */
export function emitCombatLog(
  deps: CombatLogDeps,
  event: CombatLogEvent,
  data: Record<string, unknown>,
): void {
  deps.logCombatEvent?.(event, data);
}

/**
 * Emit cleanup logs: always battle_resolved; when combatSessionId is present also
 * new_combat_resolved. Intended for GameLoop cleanup path (flag-gated → inert OFF).
 */
export function emitBattleCleanup(
  deps: CombatLogDeps,
  battleId: string,
  combatSessionId?: string,
): void {
  emitCombatLog(deps, "battle_resolved", { battleId });
  if (combatSessionId) {
    emitCombatLog(deps, "new_combat_resolved", { combatId: combatSessionId, battleId });
  }
}
