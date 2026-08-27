import type { Room } from "@colyseus/core";
import { RoomState, PlayerState, EntityState, TileState, TICK_RATE, MOVE_SPEED, CHUNK_SIZE } from "@mmo/shared";
import type Database from "better-sqlite3";
import { AOIManager } from "./AOI.js";
import { MovementSystem } from "./MovementSystem.js";
import type { MovementCommand } from "./MovementSystem.js";
import { CombatSystem } from "./CombatSystem.js";
import { EncounterSystem, MOB_TURN_DELAY_MS } from "./EncounterSystem.js";
import { MobSpawner } from "./MobSpawner.js";

/**
 * Server-side game loop running at 20 Hz.
 *
 * Each tick:
 *  1. Processes queued movement commands (validates speed, updates position).
 *  2. Marks dirty tiles for broadcast.
 *  3. Triggers Colyseus state patch broadcast to AOI-filtered clients.
 */
export class GameLoop {
  private room: Room<RoomState>;
  private db: Database.Database;
  private aoi: AOIManager;
  private movementSystem: MovementSystem;
  private combatSystem: CombatSystem;
  private encounterSystem: EncounterSystem;
  private mobSpawner: MobSpawner;
  private lastTickTime: number = 0;

  constructor(
    room: Room<RoomState>,
    db: Database.Database,
    aoi: AOIManager,
    movementSystem: MovementSystem,
    combatSystem: CombatSystem,
    encounterSystem: EncounterSystem,
    mobSpawner: MobSpawner,
  ) {
    this.room = room;
    this.db = db;
    this.aoi = aoi;
    this.movementSystem = movementSystem;
    this.combatSystem = combatSystem;
    this.encounterSystem = encounterSystem;
    this.mobSpawner = mobSpawner;
  }

  /**
   * Enqueue a movement command to be processed on the next tick.
   */
  queueMovement(sessionId: string, targetX: number, targetY: number): void {
    this.movementSystem.queueMovement(sessionId, targetX, targetY);
  }

  /**
   * Single tick of the game loop.
   * Called by `room.setSimulationInterval()`.
   *
   * @param deltaTime - Milliseconds since last tick.
   */
  tick = (deltaTime: number): void => {
    const now = Date.now();
    const dt = this.lastTickTime > 0 ? (now - this.lastTickTime) / 1000 : 1 / TICK_RATE;
    this.lastTickTime = now;

    this.processMovement(dt);
    this.tickMobAI(dt, now);
    this.tickEncounters(now);
    this.syncMobEntities();
  };

  /**
   * Process all queued movement commands using MovementSystem validation.
   */
  private processMovement(dt: number): void {
    const commands = this.movementSystem.drainQueue();

    for (const cmd of commands) {
      const player = this.room.state.players.get(cmd.sessionId);
      if (!player) continue;

      // Use MovementSystem for speed + terrain validation
      const result = this.movementSystem.processMovement(cmd, player, dt);

      if (!result.valid) {
        // Invalid movement — server rejects and keeps player at current position
        continue;
      }

      // Update player position
      const oldChunkX = player.chunkX;
      const oldChunkY = player.chunkY;

      player.x = result.x;
      player.y = result.y;
      player.chunkX = result.chunkX;
      player.chunkY = result.chunkY;

      // If player moved to a new chunk, recalculate AOI
      if (result.chunkX !== oldChunkX || result.chunkY !== oldChunkY) {
        const aoiDelta = this.aoi.movePlayer(cmd.sessionId, result.chunkX, result.chunkY);
        if (aoiDelta) {
          this.handleAOIDelta(cmd.sessionId, aoiDelta);
        }
      }
    }

    // Save player positions to database periodically (every 5 seconds)
    this.savePlayerPositions();
  }

  /**
   * Handle AOI delta when a player moves to a new chunk.
   * Send newly visible chunks and entities to the player.
   * Spawn mobs for newly entered chunks.
   */
  private handleAOIDelta(
    sessionId: string,
    aoiDelta: { entered: { cx: number; cy: number }[]; exited: { cx: number; cy: number }[] },
  ): void {
    const client = this.room.clients.getById(sessionId);
    if (!client) return;

    // Send tile data for newly entered chunks
    for (const chunk of aoiDelta.entered) {
      const tileKey = `${chunk.cx},${chunk.cy}`;
      if (!this.room.state.tiles.has(tileKey)) {
        // Generate tiles for this chunk and add to state
        const tiles = this.aoi.generateChunkTiles(chunk.cx, chunk.cy);
        const tileState = new TileState();
        tileState.chunkX = chunk.cx;
        tileState.chunkY = chunk.cy;
        tileState.tiles.push(...tiles);
        this.room.state.tiles.set(tileKey, tileState);
      }

      // Spawn mobs for this chunk
      this.mobSpawner.spawnMobsForChunk(chunk.cx, chunk.cy);
    }

    // Remove tile data for chunks no longer visible (if no other player can see them)
    for (const chunk of aoiDelta.exited) {
      const tileKey = `${chunk.cx},${chunk.cy}`;
      const playersSeeing = this.aoi.getPlayersWhoCanSeeChunk(chunk.cx, chunk.cy);
      if (playersSeeing.length === 0) {
        this.room.state.tiles.delete(tileKey);
        this.mobSpawner.removeMobsForChunk(chunk.cx, chunk.cy);
      }
    }
  }

  /**
   * Tick mob AI — move mobs, process aggro, attack players.
   */
  private tickMobAI(dt: number, now: number): void {
    // Gather player positions for AI
    const players = new Map<string, { x: number; y: number; health: number }>();
    for (const [sessionId, player] of this.room.state.players.entries()) {
      players.set(sessionId, { x: player.x, y: player.y, health: player.health });
    }

    const events = this.mobSpawner.tick(dt, players, now);

    // NOTE: MobSpawner no longer emits combat events directly.
    // Mob-initiated combat now flows through pendingEncounterTarget → beginEncounter.

    // Begin encounters for mobs that have a pending target
    for (const [, mob] of this.mobSpawner.getAllMobs()) {
      if (!mob.pendingEncounterTarget || mob.inEncounter) continue;

      const targetSessionId = mob.pendingEncounterTarget;
      const player = this.room.state.players.get(targetSessionId);
      if (!player || player.health <= 0) {
        mob.pendingEncounterTarget = null;
        continue;
      }

      // Must be within encounter engage range
      const dist = Math.hypot(player.x - mob.x, player.y - mob.y);
      if (dist > 1.6) continue;

      const pStats = this.combatSystem.getPlayerStats(targetSessionId);
      const result = this.encounterSystem.beginEncounter(
        targetSessionId,
        mob.id,
        "mob",
        { mobHp: mob.currentHp, mobMaxHp: mob.maxHp, playerHp: player.health, playerMaxHp: player.maxHealth },
        now,
      );

      if (result.encounter) {
        mob.pendingEncounterTarget = null;
        mob.inEncounter = true;
        mob.aiState = "fighting";
        mob.aggroTarget = null;

        const client = this.room.clients.getById(targetSessionId);
        if (client) {
          client.send("combat_event", {
            type: "encounter_started",
            mobId: mob.id,
            mobHp: mob.currentHp,
            mobMaxHp: mob.maxHp,
            playerHp: player.health,
            playerMaxHp: player.maxHealth,
            attack: pStats.attack,
            defense: pStats.defense,
            level: player.level,
          });
        }
      }
    }
  }

  /**
   * Tick turn-based encounters: resolve due mob turns and player-turn timeouts.
   */
  private tickEncounters(now: number): void {
    // Resolve mob turns that are due
    for (const enc of this.encounterSystem.getActiveEncounters()) {
      if (enc.ended || enc.turn !== "mob" || !enc.mobTurnScheduledAt) continue;
      if (now < enc.mobTurnScheduledAt) continue;

      const mob = this.mobSpawner.getMob(enc.mobId);
      if (!mob) {
        // Mob removed from the world while the encounter was active — release
        // the player (defense-in-depth; the MobSpawner removal hook normally
        // handles this first). endEncounterForMob returns undefined when the
        // hook already released it, avoiding duplicate notifications.
        const releasedPlayer = this.encounterSystem.endEncounterForMob(enc.mobId);
        if (releasedPlayer) {
          const client = this.room.clients.getById(releasedPlayer);
          client?.send("combat_event", {
            type: "encounter_fled",
            sourceId: enc.mobId,
            targetId: releasedPlayer,
          });
        }
        continue;
      }

      const player = this.room.state.players.get(enc.playerId);
      if (!player) continue;

      const pStats = this.combatSystem.getPlayerStats(enc.playerId);
      const result = this.encounterSystem.resolveMobTurn(
        enc,
        { mobAttack: mob.config.baseAttack, mobLevel: mob.config.level, playerDefense: pStats.defense },
        Math.random,
        now,
      );

      if (result.error) continue;

      // Apply encounter events to state
      for (const evt of result.events) {
        if (evt.type === "player_damaged" && typeof evt.damage === "number") {
          player.health = Math.max(0, player.health - evt.damage);
          const client = this.room.clients.getById(enc.playerId);
          client?.send("combat_event", {
            ...evt,
            currentHp: player.health,
            maxHp: player.maxHealth,
          });
        }
      }

      // Handle encounter end
      if (result.ended) {
        mob.inEncounter = false;
        mob.aiState = "idle";
        mob.aggroTarget = null;
        mob.patrolTarget = null;

        const client = this.room.clients.getById(enc.playerId);
        if (result.reason === "player_died") {
          player.health = 0;
          client?.send("combat_event", { type: "player_died", sourceId: mob.id, targetId: enc.playerId });
          setTimeout(() => {
            const respawning = this.room.state.players.get(enc.playerId);
            if (!respawning) return;
            respawning.health = respawning.maxHealth;
            respawning.x = 0;
            respawning.y = 0;
            respawning.chunkX = 0;
            respawning.chunkY = 0;
            for (const [, m] of this.mobSpawner.getAllMobs()) {
              if (m.aggroTarget === enc.playerId) {
                m.aggroTarget = null;
                m.aiState = "patrol";
              }
            }
            const respawnClient = this.room.clients.getById(enc.playerId);
            respawnClient?.send("combat_event", {
              type: "player_respawn",
              sourceId: enc.playerId,
              targetId: enc.playerId,
              currentHp: respawning.health,
              maxHp: respawning.maxHealth,
            });
          }, 3000);
        }
      }
    }

    // Player-turn timeouts
    const timedOut = this.encounterSystem.tickTimeouts(now);
    for (const { playerId, encounter: enc } of timedOut) {
      const client = this.room.clients.getById(playerId);
      client?.send("combat_event", {
        type: "encounter_timeout",
        sourceId: enc.mobId,
        targetId: playerId,
      });
    }
  }

  /**
   * Sync mob positions and states to Colyseus entity state.
   * Creates/updates/removes EntityState entries for mobs.
   */
  private syncMobEntities(): void {
    const mobs = this.mobSpawner.getAllMobs();
    const syncedIds = new Set<string>();

    for (const [id, mob] of mobs) {
      syncedIds.add(id);

      let entity = this.room.state.entities.get(id);
      if (!entity) {
        // Create new entity
        entity = new EntityState();
        entity.id = id;
        entity.type = mob.typeId;
        entity.health = mob.currentHp;
        this.room.state.entities.set(id, entity);
      }

      // Update position and health
      entity.x = mob.x;
      entity.y = mob.y;
      entity.health = mob.currentHp;
    }

    // Remove entities for mobs that no longer exist
    for (const [id] of this.room.state.entities.entries()) {
      if (id.startsWith("mob_") && !syncedIds.has(id)) {
        this.room.state.entities.delete(id);
      }
    }
  }
  private savePlayerPositions(): void {
    const now = Date.now();
    // Only save every 5 seconds
    if (!this._lastSave || now - this._lastSave < 5000) return;
    this._lastSave = now;

    const stmt = this.db.prepare(
      "UPDATE players SET x = ?, y = ?, chunk_x = ?, chunk_y = ?, last_login = ? WHERE id = ?",
    );

    // We can't directly iterate Colyseus MapSchema with for-of in a type-safe way,
    // so we use the internal structure
    const players = this.room.state.players;
    for (const [sessionId, player] of players.entries()) {
      // Save using the player's name as identifier (or session ID for guest accounts)
      stmt.run(player.x, player.y, player.chunkX, player.chunkY, now, sessionId);
    }
  }

  private _lastSave: number = 0;
}

/**
 * Create and attach the game loop to a room.
 * Returns the GameLoop instance for queuing movements.
 */
export function createGameLoop(
  room: Room<RoomState>,
  db: Database.Database,
  aoi: AOIManager,
  movementSystem: MovementSystem,
  combatSystem: CombatSystem,
  encounterSystem: EncounterSystem,
  mobSpawner: MobSpawner,
): GameLoop {
  const loop = new GameLoop(room, db, aoi, movementSystem, combatSystem, encounterSystem, mobSpawner);
  const tickInterval = 1000 / TICK_RATE;
  room.setSimulationInterval(loop.tick, tickInterval);
  return loop;
}
