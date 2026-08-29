/**
 * ProductionMultiParticipantCombat — Phase 3G-3: multi-participant production
 * combat (2v1 / 1v2 / 2v2) routing primitives.
 *
 * Extends ProductionCombatRouter (1v1 activation) with:
 *  - dynamic join of a player attacking a combat-owned mob (pending policy)
 *  - enemy-target derivation for the old client (explicit at the engine)
 *  - defend routing (defending=true + advanceTurn, no new damage formula)
 *  - turn timeout threading (TURN_TIMEOUT_MS via beginEncounter)
 *  - joined-player notification (encounter_started dedup via combatNotifiedPlayers)
 *  - aggro-aware enemy turns + mob combat-state release
 *
 * Single-ownership is preserved: every attack still runs Legacy XOR New Combat.
 * This module imports only shared types + managers + EncounterSystem constants,
 * so ProductionCombatRouter can import from it without a cycle.
 */

import type {
  BattleGroup,
  BattleParticipant,
  CombatSession,
  CombatPoint,
  ParticipantState,
} from "@mmo/shared";
import type { BattleManager } from "./BattleManager.js";
import type { CombatManager } from "./CombatManager.js";
import type { BattleCombatBridge } from "./BattleCombatBridge.js";
import type { CombatSystem, MobInstance } from "./CombatSystem.js";
import { MOB_TURN_DELAY_MS } from "./EncounterSystem.js";
import type { ProductionCombatDeps } from "./ProductionCombatRouter.js";

/* ── Participant construction ── */

function toBattleParticipant(
  id: string,
  position: CombatPoint,
  combatPower: number,
  state: ParticipantState,
) {
  return { id, position, combatPower, personality: "aggressive" as const, state };
}

/** Build the player-side BattleParticipant (combatPower = player attack). */
export function buildPlayerBattleParticipant(
  deps: Pick<ProductionCombatDeps, "getPlayer" | "combatSystem">,
  playerSessionId: string,
): BattleParticipant | undefined {
  const player = deps.getPlayer(playerSessionId);
  if (!player || player.health <= 0) return undefined;
  const pStats = deps.combatSystem.getPlayerStats(playerSessionId);
  return toBattleParticipant(
    playerSessionId,
    { x: player.x, y: player.y },
    pStats.attack,
    "ACTIVE",
  );
}

/* ── Shared stats provider (identical shape to the inline one it replaces) ── */

export function buildStatsProvider(deps: Pick<ProductionCombatDeps, "getMob" | "getPlayer" | "combatSystem">): {
  getStats: (id: string) => { attack: number; defense: number; level: number } | undefined;
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

/* ── encounter_started compat payload ── */

/**
 * The enemy reference shown in the client panel: the enemy-side leader if it is
 * an alive, non-fleeing combat participant, else the first such enemy.
 */
export function getCombatEnemyReference(
  session: CombatSession,
  battle: BattleGroup,
): CombatSession["participants"][number] | undefined {
  const leaderId = battle.enemySide.leaderId;
  if (leaderId) {
    const leader = session.participants.find((p) => p.participantId === leaderId);
    if (leader && leader.alive && !leader.fleeing) return leader;
  }
  return session.participants.find((p) => p.side === "enemy" && p.alive && !p.fleeing);
}

export function buildCombatStartedPayload(
  deps: Pick<ProductionCombatDeps, "getPlayer" | "getHp" | "combatSystem">,
  playerSessionId: string,
  session: CombatSession,
  battle: BattleGroup,
): { type: string; [key: string]: unknown } {
  const player = deps.getPlayer(playerSessionId);
  const pStats = deps.combatSystem.getPlayerStats(playerSessionId);
  const enemy = getCombatEnemyReference(session, battle);
  const enemyHp = enemy ? deps.getHp(enemy.participantId) : undefined;
  return {
    type: "encounter_started",
    mobId: enemy?.participantId ?? "",
    mobHp: enemyHp?.currentHp ?? 0,
    mobMaxHp: enemyHp?.maxHp ?? 0,
    playerHp: player?.health ?? 0,
    playerMaxHp: player?.maxHealth ?? 0,
    attack: pStats.attack,
    defense: pStats.defense,
    level: player?.level ?? 1,
    // Additive fields — the old client reads only the six above.
    combatId: session.id,
    currentActorId: session.currentActorId,
  };
}

/* ── Join notification dedup ── */

export function markCombatNotified(
  deps: Pick<ProductionCombatDeps, "combatNotifiedPlayers">,
  combatId: string,
  playerSessionId: string,
): void {
  const map = deps.combatNotifiedPlayers;
  if (!map) return;
  let set = map.get(combatId);
  if (!set) {
    set = new Set<string>();
    map.set(combatId, set);
  }
  set.add(playerSessionId);
}

/* ── Dynamic join (player attacks a combat-owned mob) ── */

/**
 * Join a player to an ACTIVE combat: add to the battle (player side) and to the
 * combat as a PENDING participant, then notify the client. The player does NOT
 * act this round (pending policy — next round boundary flush grants eligibility).
 *
 * Returns false (no side effects) when the join is invalid: attacker already a
 * participant of the battle, attacker in a different battle (single-battle
 * membership), battle side terminal, or a bridge add failure (rolls back the
 * battle join).
 */
export function joinAttackerToCombat(
  deps: ProductionCombatDeps,
  playerSessionId: string,
  mob: MobInstance,
): boolean {
  const battle = deps.battleManager.getBattleByParticipant(mob.id)?.battle;
  if (!battle) return false;

  const session = deps.combatManager.getCombatSessionByBattle(battle.id);
  if (!session || session.state !== "ACTIVE") return false;

  // Already a participant of this battle (pending or active) → nothing to join
  const playerBattle = deps.battleManager.getBattleByParticipant(playerSessionId);
  if (playerBattle) return false;

  // Terminal player side → no join
  if (battle.playerSide.state === "ELIMINATED") return false;

  const participant = buildPlayerBattleParticipant(deps, playerSessionId);
  if (!participant) return false;

  const addBattle = deps.battleManager.addParticipant(battle.id, "player", participant);
  if ("error" in addBattle) return false;

  const addCombat = deps.bridge.addParticipantToCombat(
    battle.id,
    playerSessionId,
    { getHp: deps.getHp },
  );
  if ("error" in addCombat) {
    // Roll back the battle join — no side effects on failure
    deps.battleManager.removeParticipant(battle.id, playerSessionId);
    return false;
  }

  const combatSession = deps.combatManager.getCombatSessionByBattle(battle.id);
  if (!combatSession) return false;

  deps.sendCombatEvent(playerSessionId, buildCombatStartedPayload(deps, playerSessionId, combatSession, battle));
  markCombatNotified(deps, combatSession.id, playerSessionId);
  mob.aggroTarget = playerSessionId;
  return true;
}

/* ── Turn-based target derivation (old client sends only {action}) ── */

export type EncounterTargetResult =
  | { kind: "combat"; session: CombatSession; enemy: CombatSession["participants"][number]; battle: BattleGroup }
  | { kind: "not-in-combat" };

/**
 * Derive the explicit enemy target for a player's turn-based action:
 * the enemy-side leader if alive && !fleeing in combat, else the first alive
 * && !fleeing enemy participant. The engine still receives explicit
 * actorId + targetId.
 */
export function resolveEncounterTarget(
  deps: Pick<ProductionCombatDeps, "battleManager" | "combatManager">,
  playerSessionId: string,
): EncounterTargetResult {
  const lookup = deps.battleManager.getBattleByParticipant(playerSessionId);
  if (!lookup) return { kind: "not-in-combat" };
  const session = deps.combatManager.getCombatSessionByBattle(lookup.battle.id);
  if (!session || session.state !== "ACTIVE") return { kind: "not-in-combat" };
  const enemy = getCombatEnemyReference(session, lookup.battle);
  if (!enemy) return { kind: "not-in-combat" };
  return { kind: "combat", session, enemy, battle: lookup.battle };
}

/* ── Defend (no new damage formula — defending=true + advanceTurn) ── */

export type EncounterDefendResult = { kind: "combat" } | { kind: "not-in-combat" };

export function routeEncounterDefend(
  deps: Pick<ProductionCombatDeps, "battleManager" | "combatManager">,
  playerSessionId: string,
): EncounterDefendResult {
  const lookup = deps.battleManager.getBattleByParticipant(playerSessionId);
  if (!lookup) return { kind: "not-in-combat" };
  const session = deps.combatManager.getCombatSessionByBattle(lookup.battle.id);
  if (!session || session.state !== "ACTIVE") return { kind: "not-in-combat" };

  // Defend only on your own turn; otherwise it is a no-op (combat owns the turn)
  if (session.currentActorId !== playerSessionId) return { kind: "combat" };

  deps.combatManager.setCombatParticipantDefending(session.id, playerSessionId, true);
  deps.combatManager.advanceTurn(session.id);
  return { kind: "combat" };
}

/* ── Joined-player notification (auto-join path) ── */

/**
 * Send the encounter_started compat payload to player participants of an ACTIVE
 * session who have not been notified yet (dedup via combatNotifiedPlayers).
 * Covers players auto-joined by GameLoop's dynamic-membership sync.
 */
export function notifyCombatJoinedPlayers(
  deps: Pick<ProductionCombatDeps, "battleManager" | "combatManager" | "getHp" | "getPlayer" | "combatSystem" | "sendCombatEvent" | "combatNotifiedPlayers">,
  session: CombatSession,
): void {
  if (session.state !== "ACTIVE") return;
  const battle = deps.battleManager.getBattle(session.battleId);
  if (!battle) return;

  for (const p of session.participants) {
    if (p.side !== "player" || !p.alive) continue;
    const notified = deps.combatNotifiedPlayers?.get(session.id);
    if (notified?.has(p.participantId)) continue;
    deps.sendCombatEvent(p.participantId, buildCombatStartedPayload(deps, p.participantId, session, battle));
    markCombatNotified(deps, session.id, p.participantId);
  }
}

/* ── Enemy-turn engine (driven inside the existing CombatManager tick) ── */

/**
 * Auto-resolve enemy-side current actors for all ACTIVE sessions.
 * Target = the mob's aggro target if it is an alive, non-fleeing player
 * participant, else the first alive player participant; the mob's aggro follows
 * the chosen target. No second tick loop.
 */
export function tickCombatEnemyTurns(deps: ProductionCombatDeps, now: number): void {
  for (const session of deps.combatManager.getActiveSessions()) {
    if (session.state !== "ACTIVE") continue;

    const actor = session.participants.find(
      (p) => p.participantId === session.currentActorId,
    );
    if (!actor || actor.side !== "enemy") continue;
    if (now - (session.turnStartedAt ?? 0) < MOB_TURN_DELAY_MS) continue;

    const mob = deps.getMob(actor.participantId);
    if (!mob) continue;

    // Aggro-aware target selection
    let target = session.participants.find(
      (p) => p.side === "player" && p.alive && !p.fleeing && p.participantId === mob.aggroTarget,
    );
    if (!target) {
      target = session.participants.find((p) => p.side === "player" && p.alive && !p.fleeing);
    }
    if (!target) continue;

    const result = deps.bridge.applyCombatAction(
      session.battleId,
      actor.participantId,
      target.participantId,
      buildStatsProvider(deps),
    );
    if ("error" in result) continue;

    const dmg = result.damage;
    mob.aggroTarget = target.participantId;
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
 * Release combat-ownership state on mobs when their battle is cleaned up.
 * New Combat never sets mob.inEncounter, but the mob may hold aggro/pending
 * state that must not leak into the post-battle world.
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
