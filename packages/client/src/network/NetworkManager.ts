import { Client, type Room } from "colyseus.js";
import type {
  PlayerState,
  EntityState,
  RoomState,
  ChatMessage,
  ClientMessage,
  CombatEventPayload,
} from "@mmo/shared";
import { GameState } from "../game/GameState.js";
import { MovementManager } from "./MovementManager.js";

export interface IdleSummary {
  readonly hours: number;
  readonly resources: Readonly<Record<string, number>>;
}

export interface IdleClaimResult {
  readonly success: boolean;
  readonly resources: Readonly<Record<string, number>>;
}

interface IdleClaimMessage {
  readonly type: "idle_claim";
}

/** Callbacks the rest of the client can register. */
export interface NetworkCallbacks {
  onRoomJoin?: (roomId: string) => void;
  onLocalPlayerReady?: (playerId: string, state: PlayerState) => void;
  onPlayerAdd?: (playerId: string, state: PlayerState) => void;
  onPlayerRemove?: (playerId: string) => void;
  onPlayerMove?: (playerId: string, state: PlayerState) => void;
  onTileUpdate?: (chunkKey: string, tiles: number[]) => void;
  onEntityAdd?: (entityId: string, entity: EntityState) => void;
  onEntityUpdate?: (entityId: string, entity: EntityState) => void;
  onEntityRemove?: (entityId: string) => void;
  onCombatEvent?: (event: CombatEventPayload) => void;
  onChat?: (sender: string, content: string) => void;
  onError?: (message: string) => void;
  onMountSuccess?: (action: "mount" | "dismount", mountId: string, speed?: number) => void;
  onMountError?: (error: string) => void;
  onIdleSummary?: (summary: IdleSummary) => void;
  onIdleClaimResult?: (result: IdleClaimResult) => void;
  onQuestUpdate?: (data: any) => void;
  onCraftResult?: (data: any) => void;
  onShopResult?: (data: any) => void;
  onTradeStarted?: (data: any) => void;
  onTradeUpdate?: (data: any) => void;
  onTradeCancelled?: (data: any) => void;
  onTradeComplete?: (data: any) => void;
  onTradeError?: (error: string) => void;
  onTitleUpdate?: (data: any) => void;
}

/**
 * Manages Colyseus client connection, room join, and message dispatch.
 *
 * Mirrors server state into a local {@link GameState} and re-broadcasts
 * events through typed callbacks for the rendering / HUD layers.
 */
export class NetworkManager {
  private readonly client: Client;
  private room: Room<RoomState> | null = null;
  private readonly callbacks: NetworkCallbacks;
  private readonly gameState: GameState;
  private readonly movementManager: MovementManager;

  constructor(
    serverUrl = "ws://localhost:2567",
    gameState: GameState,
    callbacks: NetworkCallbacks = {},
  ) {
    this.client = new Client(serverUrl);
    this.gameState = gameState;
    this.callbacks = callbacks;

    // Create movement manager with send function bound to room
    this.movementManager = new MovementManager(
      gameState,
      (x, y) => this.room?.send("move", { x, y }),
    );
  }

  /** Connect and join the "GameRoom" room. */
  async connect(): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate<RoomState>("GameRoom");
      this.gameState.roomId = this.room.id;
      this.callbacks.onRoomJoin?.(this.room.id);
      this.bindStateListeners();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.callbacks.onError?.(msg);
    }
  }

  /** Apply movement locally (prediction) and send to server. */
  sendMovement(dx: number, dy: number, speed: number, dt: number): void {
    this.movementManager.move(dx, dy, speed, dt);
  }

  /** Send a chat message to the server. */
  sendChat(content: string): void {
    this.room?.send("chat", { type: "chat", content } satisfies ChatMessage);
  }

  /** Send an attack message to the server. */
  sendAttack(targetId: string): void {
    this.room?.send("attack", { targetId });
  }

  /** Send a turn-based encounter action (attack / defend / flee) to the server. */
  sendEncounterAction(action: "attack" | "defend" | "flee", targetId?: string): void {
    this.room?.send("encounter_action", { type: "encounter_action", action, targetId });
  }

  /** Send a mount action to the server. */
  sendMountAction(action: "mount" | "dismount", mountId: string): void {
    this.room?.send("mount_action", { type: "mount_action", action, mountId });
  }

  /** Request that the server grants the pending idle rewards. */
  sendIdleClaim(): void {
    const message: IdleClaimMessage = { type: "idle_claim" };
    this.room?.send(message.type, message);
  }

  /** Send an auth message to the server. */
  sendAuth(message: ClientMessage): void {
    this.room?.send(message.type, message);
  }

  /** Request quest event reporting to the server. */
  sendQuestEvent(eventType: string, target?: string, amount?: number): void {
    this.room?.send("quest_event", { eventType, target, amount });
  }

  /** Send a craft request to the server. */
  sendCraftRequest(recipeId: string): void {
    this.room?.send("craft_request", { type: "craft_request", recipeId });
  }

  /** Send a shop buy request to the server. */
  sendShopBuy(shopId: string, itemId: string, count: number): void {
    this.room?.send("shop_buy", { shopId, itemId, count });
  }

  /** Send a shop sell request to the server. */
  sendShopSell(itemId: string, count: number): void {
    this.room?.send("shop_sell", { itemId, count });
  }

  /** Send a trade request to the server. */
  sendTradeRequest(targetId: string): void {
    this.room?.send("trade_request", { type: "trade_request", targetId });
  }

  /** Add an item to an active trade. */
  sendTradeAddItem(tradeId: string, itemId: string, count: number): void {
    this.room?.send("trade_add_item", { tradeId, itemId, count });
  }

  /** Remove an item from an active trade. */
  sendTradeRemoveItem(tradeId: string, itemId: string): void {
    this.room?.send("trade_remove_item", { tradeId, itemId });
  }

  /** Confirm the current trade. */
  sendTradeConfirm(tradeId: string): void {
    this.room?.send("trade_confirm", { tradeId });
  }

  /** Cancel the current trade. */
  sendTradeCancel(tradeId: string): void {
    this.room?.send("trade_cancel", { tradeId });
  }

  /** Leave the current room and disconnect. */
  disconnect(): void {
    this.room?.leave();
    this.room = null;
  }

  /**
   * Reconcile local prediction with authoritative server state.
   * Called when server sends updated player position.
   */
  reconcile(serverX: number, serverY: number): void {
    this.movementManager.reconcile(serverX, serverY);
  }

  /**
   * Update smooth interpolation toward server position.
   * Called each frame to correct prediction drift.
   */
  updateMovement(dt: number): void {
    this.movementManager.update(dt);
  }

  /** The current Colyseus room (null if not connected). */
  get currentRoom(): Room<RoomState> | null {
    return this.room;
  }

  /* ── Private ── */

  private bindStateListeners(): void {
    if (!this.room) return;

    const state = this.room.state;

    // Listen for player additions
    state.players.onAdd((player: PlayerState, playerId: string) => {
      if (playerId === this.room?.sessionId) {
        this.gameState.setLocalPlayer(playerId, player);
        this.callbacks.onLocalPlayerReady?.(playerId, player);
      } else {
        this.gameState.addRemotePlayer(playerId, player);
        this.callbacks.onPlayerAdd?.(playerId, player);
      }

      // Listen for individual player changes
      player.onChange(() => {
        if (playerId === this.room?.sessionId) {
          // Server reconciliation: reconcile prediction with authoritative state
          this.movementManager.reconcile(player.x, player.y);
        } else {
          this.gameState.updateRemotePlayer(playerId, player);
        }
        this.callbacks.onPlayerMove?.(playerId, player);
      });
    });

    // Listen for player removals
    state.players.onRemove((_player: PlayerState, playerId: string) => {
      this.gameState.removeRemotePlayer(playerId);
      this.callbacks.onPlayerRemove?.(playerId);
    });

    // Listen for tile updates
    state.tiles.onAdd((tile, chunkKey: string) => {
      this.gameState.markServerChunk(
        tile.chunkX,
        tile.chunkY,
      );
      this.callbacks.onTileUpdate?.(chunkKey, tile.tiles as unknown as number[]);

      tile.onChange(() => {
        this.callbacks.onTileUpdate?.(chunkKey, tile.tiles as unknown as number[]);
      });
    });

    // Listen for entity additions (mobs)
    state.entities.onAdd((entity: EntityState, entityId: string) => {
      if (entityId.startsWith("mob_")) {
        this.gameState.addMob(entity);
        this.callbacks.onEntityAdd?.(entityId, entity);
      }

      entity.onChange(() => {
        if (entityId.startsWith("mob_")) {
          this.gameState.updateMob(entity);
          this.callbacks.onEntityUpdate?.(entityId, entity);
        }
      });
    });

    // Listen for entity removals
    state.entities.onRemove((_entity: EntityState, entityId: string) => {
      if (entityId.startsWith("mob_")) {
        this.gameState.removeMob(entityId);
        this.callbacks.onEntityRemove?.(entityId);
      }
    });

    // Listen for combat events
    this.room.onMessage("combat_event", (event: CombatEventPayload) => {
      this.callbacks.onCombatEvent?.(event);
    });

    // Listen for mount events
    this.room.onMessage("mount_success", (event: { action: "mount" | "dismount"; mountId: string; speed?: number }) => {
      this.callbacks.onMountSuccess?.(event.action, event.mountId, event.speed);
    });

    this.room.onMessage("mount_error", (event: { error: string }) => {
      this.callbacks.onMountError?.(event.error);
    });

    this.room.onMessage("idle_summary", (summary: IdleSummary) => {
      this.callbacks.onIdleSummary?.(summary);
    });

    this.room.onMessage("idle_claim_result", (result: IdleClaimResult) => {
      this.callbacks.onIdleClaimResult?.(result);
    });

    // Listen for quest updates
    this.room.onMessage("quest_update", (data: any) => {
      this.callbacks.onQuestUpdate?.(data);
    });

    // Listen for craft results
    this.room.onMessage("craft_result", (data: any) => {
      this.callbacks.onCraftResult?.(data);
    });

    // Listen for shop results
    this.room.onMessage("shop_result", (data: any) => {
      this.callbacks.onShopResult?.(data);
    });

    // Listen for trade events
    this.room.onMessage("trade_started", (data: any) => {
      this.callbacks.onTradeStarted?.(data);
    });

    this.room.onMessage("trade_update", (data: any) => {
      this.callbacks.onTradeUpdate?.(data);
    });

    this.room.onMessage("trade_cancelled", (data: any) => {
      this.callbacks.onTradeCancelled?.(data);
    });

    this.room.onMessage("trade_complete", (data: any) => {
      this.callbacks.onTradeComplete?.(data);
    });

    this.room.onMessage("trade_error", (data: { error: string }) => {
      this.callbacks.onTradeError?.(data.error);
    });

    // Listen for title updates
    this.room.onMessage("title_update", (data: any) => {
      this.callbacks.onTitleUpdate?.(data);
    });
  }
}
