import type Database from "better-sqlite3";
import { MAX_TRADE_ITEMS } from "@mmo/shared";
import type { Item } from "@mmo/shared";

/* ── Types ── */

export type TradeStatus = "pending" | "reviewing" | "executing" | "complete" | "cancelled";

export interface TradeSession {
  id: string;
  playerA: string;
  playerB: string;
  itemsA: Map<string, number>;
  itemsB: Map<string, number>;
  confirmedBy: Set<string>;
  status: TradeStatus;
  createdAt: number;
}

export interface TradeResult {
  success: boolean;
  error?: string;
}

/* ── Constants ── */

const TRADE_RANGE = 5;
const TRADE_TIMEOUT_MS = 60_000;

/* ── TradeSystem Class ── */

export class TradeSystem {
  private readonly db: Database.Database;
  private readonly activeTrades = new Map<string, TradeSession>();
  private readonly playerTrades = new Map<string, string>();

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new trade session between two players.
   */
  createTrade(
    playerA: string,
    playerB: string,
    playerAPos: { x: number; y: number },
    playerBPos: { x: number; y: number },
  ): TradeResult {
    if (playerA === playerB) {
      return { success: false, error: "Cannot trade with yourself." };
    }

    if (this.playerTrades.has(playerA)) {
      return { success: false, error: "You are already in a trade." };
    }

    if (this.playerTrades.has(playerB)) {
      return { success: false, error: "Target player is already in a trade." };
    }

    const dx = playerAPos.x - playerBPos.x;
    const dy = playerAPos.y - playerBPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > TRADE_RANGE) {
      return { success: false, error: "Target player is too far away." };
    }

    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const trade: TradeSession = {
      id: tradeId,
      playerA,
      playerB,
      itemsA: new Map(),
      itemsB: new Map(),
      confirmedBy: new Set(),
      status: "pending",
      createdAt: Date.now(),
    };

    this.activeTrades.set(tradeId, trade);
    this.playerTrades.set(playerA, tradeId);
    this.playerTrades.set(playerB, tradeId);

    return { success: true };
  }

  /**
   * Add an item to a player's trade offer.
   */
  addItem(
    tradeId: string,
    playerId: string,
    itemId: string,
    count: number,
    inventory: Map<string, number>,
  ): TradeResult {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return { success: false, error: "Trade not found." };
    }

    if (trade.status !== "pending") {
      return { success: false, error: "Trade is no longer accepting items." };
    }

    if (playerId !== trade.playerA && playerId !== trade.playerB) {
      return { success: false, error: "You are not part of this trade." };
    }

    if (trade.confirmedBy.has(playerId)) {
      return { success: false, error: "Cannot modify items after confirming." };
    }

    if (count <= 0) {
      return { success: false, error: "Invalid item count." };
    }

    const available = inventory.get(itemId) ?? 0;
    if (available < count) {
      return { success: false, error: "Insufficient items." };
    }

    const items = playerId === trade.playerA ? trade.itemsA : trade.itemsB;
    const currentCount = items.get(itemId) ?? 0;
    if (currentCount + count > available) {
      return { success: false, error: "Insufficient items." };
    }

    const totalItems = this.countTradeItems(items);
    if (totalItems + count > MAX_TRADE_ITEMS && currentCount === 0) {
      return { success: false, error: `Maximum ${MAX_TRADE_ITEMS} items per trade.` };
    }

    items.set(itemId, currentCount + count);
    return { success: true };
  }

  /**
   * Remove an item from a player's trade offer.
   */
  removeItem(
    tradeId: string,
    playerId: string,
    itemId: string,
  ): TradeResult {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return { success: false, error: "Trade not found." };
    }

    if (trade.status !== "pending") {
      return { success: false, error: "Trade is no longer accepting changes." };
    }

    if (playerId !== trade.playerA && playerId !== trade.playerB) {
      return { success: false, error: "You are not part of this trade." };
    }

    if (trade.confirmedBy.has(playerId)) {
      return { success: false, error: "Cannot modify items after confirming." };
    }

    const items = playerId === trade.playerA ? trade.itemsA : trade.itemsB;
    if (!items.has(itemId)) {
      return { success: false, error: "Item not in trade." };
    }

    items.delete(itemId);
    return { success: true };
  }

  /**
   * Confirm a player's side of the trade.
   */
  confirmTrade(
    tradeId: string,
    playerId: string,
    inventory: Map<string, number>,
  ): TradeResult {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return { success: false, error: "Trade not found." };
    }

    if (trade.status !== "pending") {
      return { success: false, error: "Trade is no longer accepting confirmations." };
    }

    if (playerId !== trade.playerA && playerId !== trade.playerB) {
      return { success: false, error: "You are not part of this trade." };
    }

    const items = playerId === trade.playerA ? trade.itemsA : trade.itemsB;
    if (items.size === 0) {
      return { success: false, error: "Add items before confirming." };
    }

    for (const [itemId, count] of items) {
      const available = inventory.get(itemId) ?? 0;
      if (available < count) {
        return { success: false, error: `Insufficient ${itemId}.` };
      }
    }

    trade.confirmedBy.add(playerId);

    if (trade.confirmedBy.size === 2) {
      trade.status = "executing";
    }

    return { success: true };
  }

  /**
   * Cancel a trade.
   */
  cancelTrade(tradeId: string, playerId: string): TradeResult {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return { success: false, error: "Trade not found." };
    }

    if (playerId !== trade.playerA && playerId !== trade.playerB) {
      return { success: false, error: "You are not part of this trade." };
    }

    trade.status = "cancelled";
    this.cleanupTrade(trade);
    return { success: true };
  }

  /**
   * Execute the trade atomically. Both succeed or both fail.
   */
  executeTrade(
    tradeId: string,
    inventoryA: Map<string, number>,
    inventoryB: Map<string, number>,
  ): TradeResult {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return { success: false, error: "Trade not found." };
    }

    if (trade.status !== "executing") {
      return { success: false, error: "Trade is not ready to execute." };
    }

    for (const [itemId, count] of trade.itemsA) {
      const available = inventoryA.get(itemId) ?? 0;
      if (available < count) {
        trade.status = "cancelled";
        this.cleanupTrade(trade);
        return { success: false, error: `Player A has insufficient ${itemId}.` };
      }
    }

    for (const [itemId, count] of trade.itemsB) {
      const available = inventoryB.get(itemId) ?? 0;
      if (available < count) {
        trade.status = "cancelled";
        this.cleanupTrade(trade);
        return { success: false, error: `Player B has insufficient ${itemId}.` };
      }
    }

    for (const [itemId, count] of trade.itemsA) {
      const currentA = inventoryA.get(itemId) ?? 0;
      inventoryA.set(itemId, currentA - count);
      if (inventoryA.get(itemId) === 0) inventoryA.delete(itemId);

      const currentB = inventoryB.get(itemId) ?? 0;
      inventoryB.set(itemId, currentB + count);
    }

    for (const [itemId, count] of trade.itemsB) {
      const currentB = inventoryB.get(itemId) ?? 0;
      inventoryB.set(itemId, currentB - count);
      if (inventoryB.get(itemId) === 0) inventoryB.delete(itemId);

      const currentA = inventoryA.get(itemId) ?? 0;
      inventoryA.set(itemId, currentA + count);
    }

    this.db
      .prepare(
        "INSERT INTO trades (player_a, player_b, items_a, items_b, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        trade.playerA,
        trade.playerB,
        JSON.stringify(Object.fromEntries(trade.itemsA)),
        JSON.stringify(Object.fromEntries(trade.itemsB)),
        Date.now(),
      );

    trade.status = "complete";
    this.cleanupTrade(trade);
    return { success: true };
  }

  /**
   * Get a trade session by ID.
   */
  getTrade(tradeId: string): TradeSession | undefined {
    return this.activeTrades.get(tradeId);
  }

  /**
   * Get the active trade for a player.
   */
  getPlayerTrade(playerId: string): TradeSession | undefined {
    const tradeId = this.playerTrades.get(playerId);
    if (!tradeId) return undefined;
    return this.activeTrades.get(tradeId);
  }

  /**
   * Clean up expired trades.
   */
  cleanupExpiredTrades(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [tradeId, trade] of this.activeTrades) {
      if (now - trade.createdAt > TRADE_TIMEOUT_MS) {
        trade.status = "cancelled";
        expired.push(tradeId);
        this.cleanupTrade(trade);
      }
    }

    return expired;
  }

  /**
   * Get items from a trade as an array.
   */
  getTradeItems(tradeId: string, playerId: string): Item[] {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) return [];

    const items = playerId === trade.playerA ? trade.itemsA : trade.itemsB;
    return Array.from(items.entries()).map(([id, quantity]) => ({ id, quantity }));
  }

  /* ── Private ── */

  private countTradeItems(items: Map<string, number>): number {
    let total = 0;
    for (const count of items.values()) {
      total += count;
    }
    return total;
  }

  private cleanupTrade(trade: TradeSession): void {
    this.activeTrades.delete(trade.id);
    if (this.playerTrades.get(trade.playerA) === trade.id) {
      this.playerTrades.delete(trade.playerA);
    }
    if (this.playerTrades.get(trade.playerB) === trade.id) {
      this.playerTrades.delete(trade.playerB);
    }
  }
}
