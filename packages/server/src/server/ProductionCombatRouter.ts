/**
 * ProductionCombatRouter — 3G-2/3G-3: production Battle/Combat activation.
 *
 * Owns the single-ownership decision between the Legacy EncounterSystem and
 * the New Battle/Combat stack. Every attack is routed to EXACTLY ONE owner:
 *   - flag OFF                         → Legacy (byte-identical to HEAD cc4dd29)
 *   - mob owned by a CombatSession     → New Combat only (Legacy realtime blocked;
 *                                         a non-participant attacker JOINS pending)
 *   - flag ON, no combat yet           → New Combat (battle + combat created)
 *   - New-Combat creation fails BEFORE any side effect → safe Legacy fallback
 *
 * Multi-participant (2v1/1v2/2v2) routing primitives live in
 * ProductionMultiParticipantCombat.ts (join / target / defend / notify / enemy
 * turns) — imported and re-exported here so GameRoom/GameLoop keep one import path.
 *
 * Damage formula stays CombatSystem.calculateDamage (single authority).
 * Reward stays CombatEffects.resolveMobKill (single authority — via deps.resolveKill).
 * No second tick loop — enemy turns are driven inside GameLoop.tickCombatSessions.
 */

import type {
  BattleGroup,
  CombatSession,
  DamageResult,
} from "@mmo/shared";
import type { BattleManager } from "./BattleManager.js";
import type { CombatManager } from "./CombatManager.js";
import type { BattleCombatBridge } from "./BattleCombatBridge.js";
import type { CombatSystem, MobInstance } from "./CombatSystem.js";
import { TURN_TIMEOUT_MS } from "./EncounterSystem.js";
import {
  buildStatsProvider,
  buildCombatStartedPayload,
  buildPlayerBattleParticipant,
  markCombatNotified,
  joinAttackerToCombat,
  resolveEncounterTarget,
  tickCombatEnemyTurns,
  releaseMobCombatState,
  routeEncounterDefend,
  notifyCombatJoinedPlayers,
} from "./ProductionMultiParticipantCombat.js";

// Re-exported for GameRoom/GameLoop (single import path)
export {
  tickCombatEnemyTurns,
  releaseMobCombatState,
  routeEncounterDefend,
  notifyCombatJoinedPlayers,
};

/** Minimal player view needed for combat routing. */
export interface CombatPlayerView {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  level: number;
}

/** Everything the router needs from the production runtime. */
export interface ProductionCombatDeps {
  battleManager: BattleManager;
  combatManager: CombatManager;
  bridge: BattleCombatBridge;
  combatSystem: CombatSystem;
  getMob: (id: string) => MobInstance | undefined;
  getPlayer: (id: string) => CombatPlayerView | undefined;
  getHp: (id: string) => { currentHp: number; maxHp: number } | undefined;
  sendCombatEvent: (sessionId: string, event: { type: string; [key: string]: unknown }) => void;
  respawnPlayer: (sessionId: string) => void;
  /** Single reward authority — GameRoom wires this to CombatEffects.resolveMobKill. */
  resolveKill: (mob: MobInstance, playerSessionId: string) => void;
  /**
   * Phase 3G-3: dedup authority for encounter_started notifications
   * (combatId → player session ids already notified). Optional — absent in
   * tests that do not exercise joined-player notification.
   */
  combatNotifiedPlayers?: Map<string, Set<string>>;
}

/* ── Feature flag ── */

/**
 * Reuses the project's env-var config pattern (cf. COLYSEUS_PORT).
 * Default OFF → 100% Legacy behavior.
 */
export function isBattleCombatEnabled(): boolean {
  return process.env.ENABLE_BATTLE_COMBAT === "true";
}

/* ── Ownership predicates (single-ownership core) ── */

/**
 * The CombatSession mapped to the mob's battle, or undefined.
 * Ownership = session existence (ACTIVE or RESOLVED): a RESOLVED session still
 * blocks Legacy attack until the next-tick cleanup removes the battle (PBA-024).
 */
export function getCombatSessionForMob(
  deps: Pick<ProductionCombatDeps, "battleManager" | "combatManager">,
  mobId: string,
): CombatSession | undefined {
  const lookup = deps.battleManager.getBattleByParticipant(mobId);
  if (!lookup) return undefined;
  return deps.combatManager.getCombatSessionByBattle(lookup.battle.id);
}

/** True when the mob belongs to a battle that has a CombatSession (any state). */
export function isMobOwnedByCombat(
  deps: Pick<ProductionCombatDeps, "battleManager" | "combatManager">,
  mobId: string,
): boolean {
  return getCombatSessionForMob(deps, mobId) !== undefined;
}

/** True when the player belongs to a battle with an ACTIVE CombatSession. */
export function isPlayerOwnedByCombat(
  deps: Pick<ProductionCombatDeps, "battleManager" | "combatManager">,
  playerSessionId: string,
): boolean {
  const lookup = deps.battleManager.getBattleByParticipant(playerSessionId);
  if (!lookup) return false;
  const session = deps.combatManager.getCombatSessionByBattle(lookup.battle.id);
  return session !== undefined && session.state === "ACTIVE";
}

/** The battle owning this mob, or undefined. */
export function getBattleForMob(
  deps: Pick<ProductionCombatDeps, "battleManager">,
  mobId: string,
): BattleGroup | undefined {
  return deps.battleManager.getBattleByParticipant(mobId)?.battle;
}

/* ── Battle/Combat creation (single-owner New path) ── */

/**
 * Create (or reuse) the 1v1 BattleGroup + CombatSession for a player↔mob contact.
 *
 * Returns the ACTIVE session, or `null` when creation failed WITHOUT any side
 * effect (no damage, no event, battle rolled back if created here) — safe for
 * the caller to fall back to the Legacy path (PBA-020/021).
 * Passes TURN_TIMEOUT_MS so production turn timeout is active (MP-022..024).
 */
export function ensurePlayerCombat(
  deps: ProductionCombatDeps,
  playerSessionId: string,
  mob: MobInstance,
): CombatSession | null {
  let battle = getBattleForMob(deps, mob.id);
  let createdBattle = false;

  if (!battle) {
    const player = deps.getPlayer(playerSessionId);
    if (!player || player.health <= 0) return null;
    const pStats = deps.combatSystem.getPlayerStats(playerSessionId);
    const created = deps.battleManager.createBattle(
      `battle-${playerSessionId}-${mob.id}`,
      buildPlayerBattleParticipant(deps, playerSessionId) ?? {
        id: playerSessionId,
        position: { x: player.x, y: player.y },
        combatPower: pStats.attack,
        personality: "aggressive",
        state: "ACTIVE",
      },
      {
        id: mob.id,
        position: { x: mob.x, y: mob.y },
        combatPower: mob.config.baseAttack,
        personality: "aggressive",
        state: "ACTIVE",
      },
    );
    if ("error" in created) return null;
    battle = created.battle;
    createdBattle = true;
  }

  let session = deps.combatManager.getCombatSessionByBattle(battle.id);
  if (!session || session.state === "RESOLVED") {
    const begin = deps.bridge.beginEncounter(
      battle.id,
      { getHp: deps.getHp },
      undefined,
      TURN_TIMEOUT_MS,
    );
    if ("error" in begin) {
      // No damage / no event produced yet — roll back only what we created here,
      // then let the caller fall back to Legacy safely (PBA-020).
      if (createdBattle) deps.battleManager.removeBattle(battle.id);
      return null;
    }
    session = begin.session;
    deps.sendCombatEvent(
      playerSessionId,
      buildCombatStartedPayload(deps, playerSessionId, session, battle),
    );
    markCombatNotified(deps, session.id, playerSessionId);
  }

  return session;
}

/* ── Routing (single owner per attack) ── */

export type RealtimeAttackResult =
  | { kind: "blocked" }
  | { kind: "joined" }
  | { kind: "combat"; damage?: DamageResult }
  | { kind: "fallback" };

/**
 * Route a realtime `attack` message.
 * - blocked:  the mob's combat owns it and the attacker is already a
 *             participant (or the battle is resolving) → ignore (PBA-007/024).
 * - joined:   a non-participant attacker joined the ACTIVE combat as PENDING
 *             (no action this round — pending policy, MP-007/009).
 * - combat:   New path handled it (damage applied through the combat system).
 * - fallback: creation failed before side effects → caller may run Legacy.
 */
export function routeRealtimeAttack(
  deps: ProductionCombatDeps,
  playerSessionId: string,
  mob: MobInstance,
): RealtimeAttackResult {
  const session = getCombatSessionForMob(deps, mob.id);
  if (session) {
    if (session.state !== "ACTIVE") return { kind: "blocked" }; // RESOLVED (PBA-024)
    // Already a participant of this battle → no realtime bypass of turn order
    if (deps.battleManager.getBattleByParticipant(playerSessionId)) return { kind: "blocked" };
    // Non-participant attacker → join as pending (MP-001/003/007)
    if (joinAttackerToCombat(deps, playerSessionId, mob)) return { kind: "joined" };
    return { kind: "blocked" };
  }

  const ensured = ensurePlayerCombat(deps, playerSessionId, mob);
  if (!ensured) return { kind: "fallback" };

  const result = deps.bridge.applyCombatAction(
    ensured.battleId,
    playerSessionId,
    mob.id,
    buildStatsProvider(deps),
  );
  if ("error" in result) {
    // The session owns the mob — NEVER fall back to Legacy after creation.
    return { kind: "combat" };
  }
  mob.aggroTarget = playerSessionId;
  if (result.damage.targetKilled) {
    deps.resolveKill(mob, playerSessionId);
  }
  return { kind: "combat", damage: result.damage };
}

export type EncounterActionResult =
  | { kind: "not-in-combat" }
  | { kind: "combat"; damage?: DamageResult };

/**
 * Route a turn-based `encounter_action` for a player in New Combat.
 * The enemy target is derived (enemy leader, else first alive enemy) for the
 * old client; the engine still receives explicit actorId + targetId (MP-010).
 * Never falls back to Legacy once owned.
 */
export function routeEncounterAction(
  deps: ProductionCombatDeps,
  playerSessionId: string,
): EncounterActionResult {
  const resolved = resolveEncounterTarget(deps, playerSessionId);
  if (resolved.kind !== "combat") return { kind: "not-in-combat" };

  const { session, enemy } = resolved;
  const result = deps.bridge.applyCombatAction(
    session.battleId,
    playerSessionId,
    enemy.participantId,
    buildStatsProvider(deps),
  );
  if ("error" in result) {
    // Not the player's turn (NOT_CURRENT_ACTOR) or similar — combat owns it.
    return { kind: "combat" };
  }
  const mob = deps.getMob(enemy.participantId);
  if (mob) mob.aggroTarget = playerSessionId;
  if (result.damage.targetKilled && mob) {
    deps.resolveKill(mob, playerSessionId);
  }
  return { kind: "combat", damage: result.damage };
}
