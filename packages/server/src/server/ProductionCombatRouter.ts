/**
 * ProductionCombatRouter — 3G-2: production 1v1 Battle/Combat activation.
 *
 * Owns the single-ownership decision between the Legacy EncounterSystem and
 * the New Battle/Combat stack. Every attack is routed to EXACTLY ONE owner:
 *   - flag OFF                         → Legacy (byte-identical to HEAD cc4dd29)
 *   - mob owned by a CombatSession     → New Combat only (Legacy realtime blocked)
 *   - flag ON, no combat yet           → New Combat (battle + combat created)
 *   - New-Combat creation fails BEFORE any side effect → safe Legacy fallback
 *
 * Follows the CombatEffects.ts precedent: pure orchestration + deps context,
 * so production wiring (GameRoom/GameLoop) stays thin and tests need no Colyseus.
 *
 * Damage formula stays CombatSystem.calculateDamage (single authority).
 * Reward stays CombatEffects.resolveMobKill (single authority — via deps.resolveKill).
 * No second tick loop — enemy turns are driven inside GameLoop.tickCombatSessions.
 */

import type {
  BattleGroup,
  CombatSession,
  CombatPoint,
  DamageResult,
  ParticipantState,
} from "@mmo/shared";
import type { BattleManager } from "./BattleManager.js";
import type { CombatManager } from "./CombatManager.js";
import type { BattleCombatBridge } from "./BattleCombatBridge.js";
import type { CombatSystem, MobInstance } from "./CombatSystem.js";
import { MOB_TURN_DELAY_MS } from "./EncounterSystem.js";

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

function toBattleParticipant(
  id: string,
  position: CombatPoint,
  combatPower: number,
  state: ParticipantState,
) {
  return { id, position, combatPower, personality: "aggressive" as const, state };
}

function buildCombatStartedPayload(
  deps: ProductionCombatDeps,
  playerSessionId: string,
  mob: MobInstance,
  session: CombatSession,
): { type: string; [key: string]: unknown } {
  const player = deps.getPlayer(playerSessionId);
  const pStats = deps.combatSystem.getPlayerStats(playerSessionId);
  return {
    type: "encounter_started",
    mobId: mob.id,
    mobHp: mob.currentHp,
    mobMaxHp: mob.maxHp,
    playerHp: player?.health ?? 0,
    playerMaxHp: player?.maxHealth ?? 0,
    attack: pStats.attack,
    defense: pStats.defense,
    level: player?.level ?? 1,
    // Additive fields — the old client reads only the six above (main.ts:240-263).
    combatId: session.id,
    currentActorId: session.currentActorId,
  };
}

/**
 * Create (or reuse) the 1v1 BattleGroup + CombatSession for a player↔mob contact.
 *
 * Returns the ACTIVE session, or `null` when creation failed WITHOUT any side
 * effect (no damage, no event, battle rolled back if created here) — safe for
 * the caller to fall back to the Legacy path (PBA-020/021).
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
      toBattleParticipant(playerSessionId, { x: player.x, y: player.y }, pStats.attack, "ACTIVE"),
      toBattleParticipant(mob.id, { x: mob.x, y: mob.y }, mob.config.baseAttack, "ACTIVE"),
    );
    if ("error" in created) return null;
    battle = created.battle;
    createdBattle = true;
  }

  let session = deps.combatManager.getCombatSessionByBattle(battle.id);
  if (!session || session.state === "RESOLVED") {
    const begin = deps.bridge.beginEncounter(battle.id, { getHp: deps.getHp });
    if ("error" in begin) {
      // No damage / no event produced yet — roll back only what we created here,
      // then let the caller fall back to Legacy safely (PBA-020).
      if (createdBattle) deps.battleManager.removeBattle(battle.id);
      return null;
    }
    session = begin.session;
    deps.sendCombatEvent(playerSessionId, buildCombatStartedPayload(deps, playerSessionId, mob, session));
  }

  return session;
}

/** Shared stats provider (identical shape to the inline one it replaces). */
function buildStatsProvider(deps: ProductionCombatDeps): {
  getStats: (id: string) =>
    | { attack: number; defense: number; level: number }
    | undefined;
} {
  return {
    getStats: (id: string) => {
      const mob = deps.getMob(id);
      if (mob) {
        return {
          attack: mob.config.baseAttack,
          defense: mob.config.baseDefense,
          level: mob.config.level,
        };
      }
      const player = deps.getPlayer(id);
      const ps = deps.combatSystem.getPlayerStats(id);
      if (player && ps) {
        return { attack: ps.attack, defense: ps.defense, level: player.level };
      }
      return undefined;
    },
  };
}

/* ── Routing (single owner per attack) ── */

export type RealtimeAttackResult =
  | { kind: "blocked" }
  | { kind: "combat"; damage?: DamageResult }
  | { kind: "fallback" };

/**
 * Route a realtime `attack` message.
 * - blocked:   a CombatSession owns the mob → ignore (PBA-007/024).
 * - combat:    New path handled it (damage applied through the combat system).
 * - fallback:  creation failed before side effects → caller may run Legacy.
 */
export function routeRealtimeAttack(
  deps: ProductionCombatDeps,
  playerSessionId: string,
  mob: MobInstance,
): RealtimeAttackResult {
  if (isMobOwnedByCombat(deps, mob.id)) return { kind: "blocked" };

  const session = ensurePlayerCombat(deps, playerSessionId, mob);
  if (!session) return { kind: "fallback" };

  const result = deps.bridge.applyCombatAction(
    session.battleId,
    playerSessionId,
    mob.id,
    buildStatsProvider(deps),
  );
  if ("error" in result) {
    // The session owns the mob — NEVER fall back to Legacy after creation.
    return { kind: "combat" };
  }
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
 * The target mob is derived from the player's own battle membership (1v1),
 * so no client change is needed. Never falls back to Legacy once owned.
 */
export function routeEncounterAction(
  deps: ProductionCombatDeps,
  playerSessionId: string,
): EncounterActionResult {
  const lookup = deps.battleManager.getBattleByParticipant(playerSessionId);
  const session = lookup
    ? deps.combatManager.getCombatSessionByBattle(lookup.battle.id)
    : undefined;
  if (!session || session.state !== "ACTIVE") return { kind: "not-in-combat" };

  const enemy = session.participants.find((p) => p.side === "enemy" && p.alive);
  if (!enemy) return { kind: "not-in-combat" };

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
  if (result.damage.targetKilled) {
    const mob = deps.getMob(enemy.participantId);
    if (mob) deps.resolveKill(mob, playerSessionId);
  }
  return { kind: "combat", damage: result.damage };
}

/* ── Enemy-turn engine (driven inside the existing CombatManager tick) ── */

/**
 * Auto-resolve enemy-side current actors for all ACTIVE sessions.
 * Mirrors legacy resolveMobTurn: when an enemy participant is currentActor and
 * MOB_TURN_DELAY_MS has elapsed since the turn started, it attacks the first
 * alive player participant through the bridge, then hands the turn back.
 * No second tick loop — callers invoke this from GameLoop.tickCombatSessions.
 */
export function tickCombatEnemyTurns(deps: ProductionCombatDeps, now: number): void {
  for (const session of deps.combatManager.getActiveSessions()) {
    if (session.state !== "ACTIVE") continue;

    const actor = session.participants.find(
      (p) => p.participantId === session.currentActorId,
    );
    if (!actor || actor.side !== "enemy") continue;
    if (now - (session.turnStartedAt ?? 0) < MOB_TURN_DELAY_MS) continue;

    const target = session.participants.find((p) => p.side === "player" && p.alive);
    if (!target) continue;

    const mob = deps.getMob(actor.participantId);
    if (!mob) continue;

    const result = deps.bridge.applyCombatAction(
      session.battleId,
      actor.participantId,
      target.participantId,
      buildStatsProvider(deps),
    );
    if ("error" in result) continue;

    const dmg = result.damage;
    const player = deps.getPlayer(target.participantId);
    deps.sendCombatEvent(target.participantId, {
      type: dmg.targetKilled ? "player_died" : "player_damaged",
      sourceId: actor.participantId,
      targetId: target.participantId,
      damage: dmg.damage,
      currentHp: dmg.remainingHp,
      maxHp: player?.maxHealth ?? 0,
    });

    if (dmg.targetKilled) {
      deps.respawnPlayer(target.participantId);
    }
  }
}

/* ── Cleanup / ownership release ── */

/**
 * Release combat-ownership state on mobs when their battle is cleaned up
 * (resolved or eliminated). New Combat never sets mob.inEncounter, but the
 * mob may hold aggro/pending-encounter state that must not leak into the
 * post-battle world.
 */
export function releaseMobCombatState(
  deps: Pick<ProductionCombatDeps, "getMob">,
  battle: BattleGroup,
): void {
  for (const p of [...battle.enemySide.participants, ...battle.playerSide.participants]) {
    const mob = deps.getMob(p.id);
    if (!mob) continue;
    mob.inEncounter = false;
    mob.pendingEncounterTarget = null;
    mob.aggroTarget = null;
    if (mob.aiState !== "dead") mob.aiState = "idle";
  }
}
