import { Room } from "@colyseus/core";
import type { Client } from "@colyseus/core";
import { v4 as uuidv4 } from "uuid";
import {
  RoomState,
  PlayerState,
  EntityState,
  TileState,
  WorldGenerator,
  TICK_RATE,
  MOVE_SPEED,
  CHUNK_SIZE,
  DEFAULT_SEED,
} from "@mmo/shared";
import type {
  AuthRegister,
  AuthLogin,
  ChatMessage,
  TradeRequest,
  CraftRequest,
  MountAction,
} from "@mmo/shared";
import type Database from "better-sqlite3";
import { Auth } from "./Auth.js";
import { AOIManager } from "./AOI.js";
import { GameLoop, createGameLoop } from "./GameLoop.js";
import { CombatSystem } from "./CombatSystem.js";
import { MobSpawner } from "./MobSpawner.js";
import { QuestSystem } from "./QuestSystem.js";
import { MovementSystem } from "./MovementSystem.js";
import { MountSystem } from "./MountSystem.js";
import { TilePhysics, FIRE_TYPE, LAVA_TYPE } from "./TilePhysics.js";
import { TileEffects } from "./TileEffects.js";
import { TradeSystem } from "./TradeSystem.js";
import { CraftingSystem } from "./CraftingSystem.js";
import { ShopSystem } from "./ShopSystem.js";
import { TitleSystem } from "./TitleSystem.js";
import { IdleSystem } from "./IdleSystem.js";

export const GAME_ROOM_CAPACITY = 100;

/**
 * Authenticated user data stored on the client after authentication.
 */
interface ClientAuthData {
  accountId: string;
  playerId: string;
  guestToken: string;
  authenticated: boolean;
}

/**
 * Primary game room for the MMO.
 *
 * Handles player connection, authentication, movement, chat,
 * and state synchronization via Colyseus schema delta encoding.
 */
export class GameRoom extends Room<RoomState> {
  private auth!: Auth;
  private aoi!: AOIManager;
  private gameLoop!: GameLoop;
  private worldGen!: WorldGenerator;
  private db!: Database.Database;
  private combatSystem!: CombatSystem;
  private mobSpawner!: MobSpawner;
  private questSystem!: QuestSystem;
  private movementSystem!: MovementSystem;
  private mountSystem!: MountSystem;
  private tilePhysics!: TilePhysics;
  private tileEffects!: TileEffects;
  private tradeSystem!: TradeSystem;
  private craftingSystem!: CraftingSystem;
  private shopSystem!: ShopSystem;
  private titleSystem!: TitleSystem;
  private idleSystem!: IdleSystem;

  /** Expose physics system for GameLoop integration. */
  getTilePhysics(): TilePhysics { return this.tilePhysics; }
  getTileEffects(): TileEffects { return this.tileEffects; }

  /** Colyseus "database" option is used to pass the DB reference. */
  onCreate(options: { db?: Database.Database; seed?: number } = {}): void {
    this.maxClients = GAME_ROOM_CAPACITY;
    // Database reference (passed from GameServer or use in-memory for tests)
    this.db = options.db!;
    this.auth = new Auth(this.db);

    // World generator
    const seed = options.seed ?? DEFAULT_SEED;
    this.worldGen = new WorldGenerator(seed);

    // Initialize Colyseus state
    this.setState(new RoomState());

    // AOI manager
    this.aoi = new AOIManager(this.worldGen);

    // Quest system
    this.questSystem = new QuestSystem(this.db);

    // Movement system (validates speed + terrain)
    this.movementSystem = new MovementSystem(this.worldGen);

    // Combat system
    this.combatSystem = new CombatSystem();

    // Mount system
    this.mountSystem = new MountSystem(this.db);

    // Mob spawner
    this.mobSpawner = new MobSpawner(this.worldGen, this.combatSystem);

    // Tile physics system (event-driven, processes when tiles change)
    this.tilePhysics = new TilePhysics(this.db);

    // Tile effects (server-authoritative visual effects for physics)
    this.tileEffects = new TileEffects();

    // Trade system
    this.tradeSystem = new TradeSystem(this.db);

    // Crafting system
    this.craftingSystem = new CraftingSystem(this.db);

    // Shop system
    this.shopSystem = new ShopSystem(this.db);

    // Title system
    this.titleSystem = new TitleSystem();

    // Idle / AFK system
    this.idleSystem = new IdleSystem(this.db, this.worldGen);

    // Start game loop
    this.gameLoop = createGameLoop(this, this.db, this.aoi, this.movementSystem, this.combatSystem, this.mobSpawner);

    // Set patch rate to match tick rate
    this.setPatchRate(1000 / TICK_RATE);

    // Register message handlers
    this.registerMessageHandlers();
  }

  /**
   * Called when a client joins the room.
   *
   * Authentication happens via the `auth` options sent during connection.
   * If no auth is provided, the client is treated as a guest.
   */
  async onJoin(
    client: Client,
    options: { guestToken?: string; username?: string; password?: string } = {},
    auth?: ClientAuthData,
  ): Promise<void> {
    let accountId: string | undefined;
    let playerId: string | undefined;
    let guestToken = options.guestToken ?? uuidv4();

    // Auto-login if already authenticated (reconnection)
    if (auth?.authenticated) {
      accountId = auth.accountId;
      playerId = auth.playerId;
      guestToken = auth.guestToken;
    }

    // Authenticate if credentials provided
    if (!accountId && options.username && options.password) {
      const result = await this.auth.login(options.username, options.password);
      if (result.success) {
        accountId = result.accountId;
        playerId = result.playerId;
      }
    }

    // Guest login via token lookup
    if (!accountId && options.guestToken) {
      const result = this.auth.getByToken(options.guestToken);
      if (result.success) {
        accountId = result.accountId;
        playerId = result.playerId;
        guestToken = options.guestToken;
      }
    }

    // If still no account, this is a fresh guest — store for later registration
    if (!accountId) {
      accountId = uuidv4();
      playerId = uuidv4();
    }

    // Store auth data on client
    (client as any).authData = {
      accountId,
      playerId,
      guestToken,
      authenticated: false,
    } as ClientAuthData;

    // Load or create player state
    let playerState: PlayerState;
    let spawnX = 0;
    let spawnY = 0;
    let spawnChunkX = 0;
    let spawnChunkY = 0;
    let savedMountId = "";

    // Try to load saved position
    const savedPlayer = this.db
      .prepare("SELECT x, y, chunk_x, chunk_y, mount_id FROM players WHERE id = ?")
      .get(playerId!) as { x: number; y: number; chunk_x: number; chunk_y: number; mount_id: string } | undefined;

    if (savedPlayer) {
      spawnX = savedPlayer.x;
      spawnY = savedPlayer.y;
      spawnChunkX = savedPlayer.chunk_x;
      spawnChunkY = savedPlayer.chunk_y;
      savedMountId = savedPlayer.mount_id ?? "";
    }

    // Create player in state
    playerState = new PlayerState();
    playerState.x = spawnX;
    playerState.y = spawnY;
    playerState.chunkX = spawnChunkX;
    playerState.chunkY = spawnChunkY;
    playerState.name = options.username ?? `Guest_${playerId!.slice(0, 6)}`;
    playerState.health = 100;
    playerState.maxHealth = 100;
    playerState.speed = MOVE_SPEED;
    playerState.level = 1;

    // Set initial title based on level
    this.titleSystem.syncTitle(playerState);

    this.state.players.set(client.sessionId, playerState);

    // Restore mount if saved
    if (savedMountId) {
      this.mountSystem.restorePlayerMount(client.sessionId, playerState, savedMountId);
    }

    // Register with AOI and get initial visible chunks
    const visibleChunks = this.aoi.addPlayer(client.sessionId, spawnChunkX, spawnChunkY);

    // Generate and send initial chunk data
    for (const chunk of visibleChunks) {
      const tileKey = `${chunk.cx},${chunk.cy}`;
      if (!this.state.tiles.has(tileKey)) {
        const tiles = this.aoi.generateChunkTiles(chunk.cx, chunk.cy);
        const tileState = new TileState();
        tileState.chunkX = chunk.cx;
        tileState.chunkY = chunk.cy;
        tileState.tiles.push(...tiles);
        this.state.tiles.set(tileKey, tileState);
      }

      // Spawn mobs for this chunk
      this.mobSpawner.spawnMobsForChunk(chunk.cx, chunk.cy);
    }

    // Send auth success message
    client.send("auth_success", {
      accountId,
      playerId,
      guestToken,
      name: playerState.name,
    });

    // Check offline idle rewards
    const idleSummary = this.idleSystem.calculateIdleRewards(playerId!, spawnChunkX, spawnChunkY);
    if (idleSummary) {
      client.send("idle_summary", {
        type: "idle_summary",
        hours: idleSummary.hours,
        resources: idleSummary.resources,
      });
    }

    // Initialize quests for new players
    const questUpdate = this.questSystem.initPlayerQuests(playerId!);
    if (questUpdate) {
      client.send("quest_update", questUpdate);
    }

    // Update last login
    this.db
      .prepare("UPDATE players SET last_login = ? WHERE id = ?")
      .run(Date.now(), playerId);
  }

  /**
   * Called when a client leaves the room.
   * Saves player state and cleans up.
   */
  async onLeave(client: Client, consented?: boolean): Promise<void> {
    const authData = (client as any).authData as ClientAuthData | undefined;

    // Record idle logout timestamp before saving state
    if (authData?.playerId) {
      this.idleSystem.recordLogout(authData.playerId);
    }

    // Save player state to database
    if (authData?.playerId) {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        this.db
          .prepare(
            "UPDATE players SET x = ?, y = ?, chunk_x = ?, chunk_y = ?, mount_id = ?, last_login = ? WHERE id = ?",
          )
          .run(player.x, player.y, player.chunkX, player.chunkY, player.mountId, Date.now(), authData.playerId);
      }
    }

    // Remove from AOI
    this.aoi.removePlayer(client.sessionId);

    // Remove combat stats
    this.combatSystem.removePlayerStats(client.sessionId);

    // Remove mount tracking
    this.mountSystem.removePlayerMount(client.sessionId);

    // Remove player from state
    this.state.players.delete(client.sessionId);
  }

  /**
   * Register all message handlers.
   */
  private registerMessageHandlers(): void {
    // Auth messages
    this.onMessage("auth_register", async (client, message: AuthRegister) => {
      const result = await this.auth.register(
        message.guestToken,
        message.username,
        message.password,
      );

      if (result.success && result.accountId) {
        const authData = (client as any).authData as ClientAuthData;
        authData.accountId = result.accountId;
        authData.playerId = result.playerId!;
        authData.authenticated = true;

        // Update player name
        const player = this.state.players.get(client.sessionId);
        if (player) {
          player.name = message.username;
        }

        client.send("auth_success", {
          accountId: result.accountId,
          playerId: result.playerId,
          name: message.username,
        });
      } else {
        client.send("auth_error", { error: result.error });
      }
    });

    this.onMessage("auth_login", async (client, message: AuthLogin) => {
      const result = await this.auth.login(message.username, message.password);

      if (result.success && result.accountId) {
        const authData = (client as any).authData as ClientAuthData;
        authData.accountId = result.accountId;
        authData.playerId = result.playerId!;
        authData.authenticated = true;

        client.send("auth_success", {
          accountId: result.accountId,
          playerId: result.playerId,
          name: message.username,
        });
      } else {
        client.send("auth_error", { error: result.error });
      }
    });

    // Movement message
    this.onMessage("move", (client, message: { x: number; y: number }) => {
      if (typeof message.x !== "number" || typeof message.y !== "number") return;
      if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

      this.gameLoop.queueMovement(client.sessionId, message.x, message.y);
    });

    // Chat message
    this.onMessage("chat", (client, message: ChatMessage) => {
      if (typeof message.content !== "string" || message.content.length === 0) return;

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Truncate message
      const content = message.content.slice(0, 200);

      // Broadcast to all players in AOI
      for (const [sessionId, otherPlayer] of this.state.players.entries()) {
        if (sessionId === client.sessionId) continue;
        if (this.aoi.canPlayerSeeChunk(sessionId, player.chunkX, player.chunkY)) {
          const otherClient = this.clients.getById(sessionId);
          if (otherClient) {
            otherClient.send("chat", {
              sender: player.name,
              content,
              timestamp: Date.now(),
            });
          }
        }
      }

      // Echo back to sender
      client.send("chat", {
        sender: player.name,
        content,
        timestamp: Date.now(),
      });
    });

    // Trade request — creates a trade session between two players
    this.onMessage("trade_request", (client, message: TradeRequest) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const targetPlayer = this.state.players.get(message.targetId);
      if (!targetPlayer) {
        client.send("trade_error", { error: "Target player not found." });
        return;
      }

      if (!this.aoi.canPlayerSeeChunk(message.targetId, player.chunkX, player.chunkY)) {
        client.send("trade_error", { error: "Target player is too far away." });
        return;
      }

      const result = this.tradeSystem.createTrade(
        client.sessionId,
        message.targetId,
        { x: player.x, y: player.y },
        { x: targetPlayer.x, y: targetPlayer.y },
      );

      if (!result.success) {
        client.send("trade_error", { error: result.error });
        return;
      }

      const trade = this.tradeSystem.getPlayerTrade(client.sessionId);
      if (!trade) return;

      // Notify both players
      client.send("trade_started", {
        tradeId: trade.id,
        otherPlayerName: targetPlayer.name,
      });

      const targetClient = this.clients.getById(message.targetId);
      if (targetClient) {
        targetClient.send("trade_started", {
          tradeId: trade.id,
          otherPlayerName: player.name,
        });
      }
    });

    // Trade add item — add an item to the trade offer
    this.onMessage("trade_add_item", (client, message: { tradeId: string; itemId: string; count: number }) => {
      const authData = (client as any).authData as ClientAuthData | undefined;
      if (!authData?.playerId) return;

      const inventory = this.getPlayerInventory(authData.playerId);
      const result = this.tradeSystem.addItem(
        message.tradeId,
        client.sessionId,
        message.itemId,
        message.count,
        inventory,
      );

      if (!result.success) {
        client.send("trade_error", { error: result.error });
        return;
      }

      this.syncTradeState(message.tradeId);
    });

    // Trade remove item — remove an item from the trade offer
    this.onMessage("trade_remove_item", (client, message: { tradeId: string; itemId: string }) => {
      const result = this.tradeSystem.removeItem(
        message.tradeId,
        client.sessionId,
        message.itemId,
      );

      if (!result.success) {
        client.send("trade_error", { error: result.error });
        return;
      }

      this.syncTradeState(message.tradeId);
    });

    // Trade confirm — confirm the trade (locks items)
    this.onMessage("trade_confirm", (client, message: { tradeId: string }) => {
      const authData = (client as any).authData as ClientAuthData | undefined;
      if (!authData?.playerId) return;

      const inventory = this.getPlayerInventory(authData.playerId);
      const result = this.tradeSystem.confirmTrade(
        message.tradeId,
        client.sessionId,
        inventory,
      );

      if (!result.success) {
        client.send("trade_error", { error: result.error });
        return;
      }

      const trade = this.tradeSystem.getTrade(message.tradeId);
      if (!trade) return;

      // If both confirmed, execute the trade atomically
      if (trade.status === "executing") {
        this.executeTrade(trade);
      } else {
        this.syncTradeState(message.tradeId);
      }
    });

    // Trade cancel — cancel the trade
    this.onMessage("trade_cancel", (client, message: { tradeId: string }) => {
      const trade = this.tradeSystem.getTrade(message.tradeId);
      if (!trade) return;

      const playerA = this.clients.getById(trade.playerA);
      const playerB = this.clients.getById(trade.playerB);

      this.tradeSystem.cancelTrade(message.tradeId, client.sessionId);

      // Notify both players
      if (playerA) playerA.send("trade_cancelled", { tradeId: message.tradeId });
      if (playerB) playerB.send("trade_cancelled", { tradeId: message.tradeId });
    });

    // Mount action — full implementation with validation
    this.onMessage("mount_action", (client, message: MountAction) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Validate inputs
      if (!message.mountId || typeof message.mountId !== "string") return;
      if (message.action !== "mount" && message.action !== "dismount") return;

      // Check if player is in combat (simple check: health < max)
      const isInCombat = player.health < player.maxHealth;

      // Process mount action through MountSystem
      const result = this.mountSystem.processMountAction(
        client.sessionId,
        message.mountId,
        message.action,
        player,
        isInCombat,
      );

      // Send result back to client
      if (!result.success) {
        client.send("mount_error", { error: result.error });
      } else {
        client.send("mount_success", {
          action: message.action,
          mountId: result.mountId,
          speed: result.speed,
        });
      }
    });

    // Craft request — validates materials, consumes inputs, produces output
    this.onMessage("craft_request", (client, message: CraftRequest) => {
      if (typeof message.recipeId !== "string" || !message.recipeId) return;

      const authData = (client as any).authData as ClientAuthData | undefined;
      if (!authData?.playerId) return;

      const result = this.craftingSystem.craft(authData.playerId, message.recipeId);

      client.send("craft_result", {
        type: "craft_result",
        success: result.success,
        itemId: result.itemId,
        message: result.message,
        recipeId: result.recipeId,
      });
    });

    // Idle rewards claim — always use the authenticated player's database ID.
    this.onMessage("idle_claim", (client) => {
      const authData = (client as any).authData as ClientAuthData | undefined;
      if (!authData?.playerId) return;

      const result = this.idleSystem.claimRewards(authData.playerId);
      client.send("idle_claim_result", result);
    });

    // Shop buy — purchase an item from an NPC shop
    this.onMessage(
      "shop_buy",
      (client, message: { shopId: string; itemId: string; count: number }) => {
        if (typeof message.shopId !== "string" || !message.shopId) return;
        if (typeof message.itemId !== "string" || !message.itemId) return;
        const count = typeof message.count === "number" && message.count > 0 ? Math.floor(message.count) : 1;

        const authData = (client as any).authData as ClientAuthData | undefined;
        if (!authData?.playerId) return;

        const result = this.shopSystem.buy(authData.playerId, message.shopId, message.itemId, count);

        client.send("shop_result", {
          type: "shop_result",
          action: "buy",
          success: result.success,
          message: result.message,
          itemId: result.itemId,
          quantity: result.quantity,
          totalCost: result.totalCost,
        });
      },
    );

    // Shop sell — sell an item to any NPC shop
    this.onMessage(
      "shop_sell",
      (client, message: { itemId: string; count: number }) => {
        if (typeof message.itemId !== "string" || !message.itemId) return;
        const count = typeof message.count === "number" && message.count > 0 ? Math.floor(message.count) : 1;

        const authData = (client as any).authData as ClientAuthData | undefined;
        if (!authData?.playerId) return;

        const result = this.shopSystem.sell(authData.playerId, message.itemId, count);

        client.send("shop_result", {
          type: "shop_result",
          action: "sell",
          success: result.success,
          message: result.message,
          itemId: result.itemId,
          quantity: result.quantity,
          totalGain: result.totalGain,
        });
      },
    );

    // Attack message — player attacks a mob
    this.onMessage("attack", (client, message: { targetId: string }) => {
      if (typeof message.targetId !== "string") return;
      if (!message.targetId.startsWith("mob_")) return;

      const player = this.state.players.get(client.sessionId);
      if (!player || player.health <= 0) return;

      const mob = this.mobSpawner.getMob(message.targetId);
      if (!mob || mob.aiState === "dead") return;

      const events = this.combatSystem.processPlayerAttack(
        client.sessionId,
        mob,
        Date.now(),
      );

      if (!events) return;

      // Apply combat events
      for (const event of events) {
        if (event.type === "player_damaged" || event.type === "player_died") {
          // Mob damage to player — update player health
          if (event.currentHp !== undefined) {
            player.health = event.currentHp;
          }
        }

        if (event.type === "mob_killed") {
          // Sync mob death to clients
          const entity = this.state.entities.get(mob.id);
          if (entity) {
            entity.health = 0;
          }
        }

        if (event.type === "damage_dealt") {
          // Update mob health in entity state
          const entity = this.state.entities.get(mob.id);
          if (entity && event.currentHp !== undefined) {
            entity.health = event.currentHp;
          }
        }

        // Send combat event to relevant clients
        if (event.type === "damage_dealt" || event.type === "mob_killed" ||
            event.type === "xp_gained" || event.type === "loot_dropped") {
          const combatClient = this.clients.getById(client.sessionId);
          if (combatClient) {
            combatClient.send("combat_event", event);
          }
        }

        if (event.type === "player_damaged" || event.type === "player_died") {
          // Send damage event to the player
          const targetClient = this.clients.getById(event.targetId);
          if (targetClient) {
            targetClient.send("combat_event", event);
          }
        }
      }
    });

    // Quest event reporting
    this.onMessage(
      "quest_event",
      (
        client,
        message: { eventType: string; target?: string; amount?: number },
      ) => {
        const authData = (client as any).authData as ClientAuthData | undefined;
        if (!authData?.playerId) return;

        const update = this.questSystem.reportEvent(
          authData.playerId,
          message.eventType,
          message.target,
          message.amount ?? 1,
        );

        if (update) {
          client.send("quest_update", update);
        }
      },
    );

    // Place tile message — player places a physics tile (water, sand, fire, lava)
    this.onMessage(
      "place_tile",
      (client, message: { x: number; y: number; tileType: number }) => {
        if (typeof message.x !== "number" || typeof message.y !== "number") return;
        if (typeof message.tileType !== "number") return;
        if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;

        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        // Validate tile type (only physics-extended types allowed)
        const validTypes = new Set([
          1,  // Water
          2,  // Sand
          FIRE_TYPE,
          LAVA_TYPE,
        ]);
        if (!validTypes.has(message.tileType)) return;

        // Validate placement is within range of the player (max 3 tiles)
        const dx = message.x - player.x;
        const dy = message.y - player.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) return;

        const wx = Math.floor(message.x);
        const wy = Math.floor(message.y);

        // Ensure the chunk is loaded
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        const tileKey = `${cx},${cy}`;
        if (!this.state.tiles.has(tileKey)) return;

        // Queue physics change
        this.tilePhysics.queueChange(wx, wy, message.tileType);

        // Process physics immediately (event-driven)
        const physicsEffects = this.tilePhysics.processChanges(this.state.tiles as any);

        // Convert physics effects to visual effects
        const visualEffects = this.tileEffects.processEffects(physicsEffects);

        // Broadcast visual effects to players who can see affected chunks
        if (visualEffects.length > 0) {
          const affectedChunks = new Set<string>();
          for (const fx of visualEffects) {
            const fcx = Math.floor(fx.x / CHUNK_SIZE);
            const fcy = Math.floor(fx.y / CHUNK_SIZE);
            affectedChunks.add(`${fcx},${fcy}`);
          }

          for (const [sessionId] of this.state.players.entries()) {
            if (sessionId === client.sessionId) continue;
            for (const chunkKey of affectedChunks) {
              const [fcx, fcy] = chunkKey.split(",").map(Number);
              if (this.aoi.canPlayerSeeChunk(sessionId, fcx, fcy)) {
                const otherClient = this.clients.getById(sessionId);
                if (otherClient) {
                  otherClient.send("physics_effects", {
                    effects: visualEffects,
                  });
                }
                break;
              }
            }
          }
        }
      },
    );
  }

  /**
   * Get a player's inventory from the database.
   */
  private getPlayerInventory(playerId: string): Map<string, number> {
    const row = this.db
      .prepare("SELECT inventory FROM players WHERE id = ?")
      .get(playerId) as { inventory: string } | undefined;

    if (!row?.inventory) return new Map();

    try {
      const parsed = JSON.parse(row.inventory);
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  /**
   * Save a player's inventory to the database.
   */
  private savePlayerInventory(playerId: string, inventory: Map<string, number>): void {
    const inventoryJson = JSON.stringify(Object.fromEntries(inventory));
    this.db
      .prepare("UPDATE players SET inventory = ? WHERE id = ?")
      .run(inventoryJson, playerId);
  }

  /**
   * Execute a trade atomically — both succeed or both fail.
   */
  private executeTrade(trade: import("./TradeSystem.js").TradeSession): void {
    const authDataA = (this.clients.getById(trade.playerA) as any)?.authData as ClientAuthData | undefined;
    const authDataB = (this.clients.getById(trade.playerB) as any)?.authData as ClientAuthData | undefined;

    if (!authDataA?.playerId || !authDataB?.playerId) {
      this.tradeSystem.cancelTrade(trade.id, trade.playerA);
      return;
    }

    const inventoryA = this.getPlayerInventory(authDataA.playerId);
    const inventoryB = this.getPlayerInventory(authDataB.playerId);

    const result = this.tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

    const playerA = this.clients.getById(trade.playerA);
    const playerB = this.clients.getById(trade.playerB);

    if (result.success) {
      // Save updated inventories
      this.savePlayerInventory(authDataA.playerId, inventoryA);
      this.savePlayerInventory(authDataB.playerId, inventoryB);

      // Notify both players of success
      if (playerA) playerA.send("trade_complete", { tradeId: trade.id });
      if (playerB) playerB.send("trade_complete", { tradeId: trade.id });
    } else {
      // Notify both players of failure
      if (playerA) playerA.send("trade_error", { error: result.error });
      if (playerB) playerB.send("trade_error", { error: result.error });
    }
  }

  /**
   * Sync trade state to both players.
   */
  private syncTradeState(tradeId: string): void {
    const trade = this.tradeSystem.getTrade(tradeId);
    if (!trade) return;

    const playerA = this.clients.getById(trade.playerA);
    const playerB = this.clients.getById(trade.playerB);

    const itemsA = this.tradeSystem.getTradeItems(tradeId, trade.playerA);
    const itemsB = this.tradeSystem.getTradeItems(tradeId, trade.playerB);

    // Send to player A
    if (playerA) {
      playerA.send("trade_update", {
        tradeId: trade.id,
        myItems: itemsA,
        theirItems: itemsB,
        myConfirmed: trade.confirmedBy.has(trade.playerA),
        theirConfirmed: trade.confirmedBy.has(trade.playerB),
        status: trade.status,
      });
    }

    // Send to player B
    if (playerB) {
      playerB.send("trade_update", {
        tradeId: trade.id,
        myItems: itemsB,
        theirItems: itemsA,
        myConfirmed: trade.confirmedBy.has(trade.playerB),
        theirConfirmed: trade.confirmedBy.has(trade.playerA),
        status: trade.status,
      });
    }
  }

  /**
   * Process any pending physics changes (called by GameLoop each tick).
   */
  tickPhysics(): void {
    if (!this.tilePhysics.hasPendingChanges()) return;

    const physicsEffects = this.tilePhysics.processChanges(this.state.tiles as any);
    const visualEffects = this.tileEffects.processEffects(physicsEffects);

    if (visualEffects.length > 0) {
      // Broadcast to affected players
      const affectedChunks = new Set<string>();
      for (const fx of visualEffects) {
        const fcx = Math.floor(fx.x / CHUNK_SIZE);
        const fcy = Math.floor(fx.y / CHUNK_SIZE);
        affectedChunks.add(`${fcx},${fcy}`);
      }

      for (const [sessionId] of this.state.players.entries()) {
        for (const chunkKey of affectedChunks) {
          const [fcx, fcy] = chunkKey.split(",").map(Number);
          if (this.aoi.canPlayerSeeChunk(sessionId, fcx, fcy)) {
            const client = this.clients.getById(sessionId);
            if (client) {
              client.send("physics_effects", { effects: visualEffects });
            }
            break;
          }
        }
      }
    }
  }
}
