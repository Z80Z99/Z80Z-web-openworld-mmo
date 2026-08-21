import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSchema } from "../db/schema.js";
import { TradeSystem, type TradeSession } from "./TradeSystem.js";

/* ── Helpers ── */

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  createSchema(db);
  return db;
}

function createInventory(items: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(items));
}

/* ── TradeSystem Tests ── */

describe("TradeSystem", () => {
  let db: Database.Database;
  let tradeSystem: TradeSystem;

  beforeEach(() => {
    db = createTestDb();
    tradeSystem = new TradeSystem(db);
  });

  describe("createTrade", () => {
    it("creates a trade between two players", () => {
      const result = tradeSystem.createTrade(
        "player_a",
        "player_b",
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      );

      expect(result.success).toBe(true);
    });

    it("rejects self-trading", () => {
      const result = tradeSystem.createTrade(
        "player_a",
        "player_a",
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot trade with yourself.");
    });

    it("rejects if player is already in a trade", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });

      const result = tradeSystem.createTrade(
        "player_a",
        "player_c",
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("You are already in a trade.");
    });

    it("rejects if target is already in a trade", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });

      const result = tradeSystem.createTrade(
        "player_c",
        "player_b",
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Target player is already in a trade.");
    });

    it("rejects if players are too far apart", () => {
      const result = tradeSystem.createTrade(
        "player_a",
        "player_b",
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Target player is too far away.");
    });

    it("allows trade at exactly TRADE_RANGE distance", () => {
      const result = tradeSystem.createTrade(
        "player_a",
        "player_b",
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      );

      expect(result.success).toBe(true);
    });
  });

  describe("addItem", () => {
    it("adds an item to the trade", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1, shield: 2 });
      const result = tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);

      expect(result.success).toBe(true);
    });

    it("rejects adding items to non-existent trade", () => {
      const inventory = createInventory({ sword: 1 });
      const result = tradeSystem.addItem("fake_trade", "player_a", "sword", 1, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Trade not found.");
    });

    it("rejects adding items after confirming", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);
      tradeSystem.confirmTrade(trade.id, "player_a", inventory);

      const result = tradeSystem.addItem(trade.id, "player_a", "shield", 1, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot modify items after confirming.");
    });

    it("rejects if player has insufficient items", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      const result = tradeSystem.addItem(trade.id, "player_a", "sword", 2, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Insufficient items.");
    });

    it("rejects invalid item count", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      const result = tradeSystem.addItem(trade.id, "player_a", "sword", 0, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid item count.");
    });

    it("allows stacking same item", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 3 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);
      const result = tradeSystem.addItem(trade.id, "player_a", "sword", 2, inventory);

      expect(result.success).toBe(true);
      const items = tradeSystem.getTradeItems(trade.id, "player_a");
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(3);
    });

    it("rejects exceeding MAX_TRADE_ITEMS", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryItems: Record<string, number> = {};
      for (let i = 0; i < 11; i++) {
        inventoryItems[`item_${i}`] = 1;
      }
      const inventory = createInventory(inventoryItems);

      for (let i = 0; i < 10; i++) {
        tradeSystem.addItem(trade.id, "player_a", `item_${i}`, 1, inventory);
      }

      const result = tradeSystem.addItem(trade.id, "player_a", "item_10", 1, inventory);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Maximum");
    });
  });

  describe("removeItem", () => {
    it("removes an item from the trade", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);

      const result = tradeSystem.removeItem(trade.id, "player_a", "sword");

      expect(result.success).toBe(true);
      const items = tradeSystem.getTradeItems(trade.id, "player_a");
      expect(items).toHaveLength(0);
    });

    it("rejects removing non-existent item", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const result = tradeSystem.removeItem(trade.id, "player_a", "sword");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Item not in trade.");
    });

    it("rejects removing after confirming", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);
      tradeSystem.confirmTrade(trade.id, "player_a", inventory);

      const result = tradeSystem.removeItem(trade.id, "player_a", "sword");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot modify items after confirming.");
    });
  });

  describe("confirmTrade", () => {
    it("confirms a player's side of the trade", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);

      const result = tradeSystem.confirmTrade(trade.id, "player_a", inventory);

      expect(result.success).toBe(true);
      expect(trade.confirmedBy.has("player_a")).toBe(true);
    });

    it("rejects confirming with empty items", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      const result = tradeSystem.confirmTrade(trade.id, "player_a", inventory);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Add items before confirming.");
    });

    it("rejects confirming with insufficient inventory", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);

      // Change inventory to have fewer items
      const lowInventory = createInventory({ sword: 0 });
      const result = tradeSystem.confirmTrade(trade.id, "player_a", lowInventory);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient");
    });

    it("sets status to executing when both confirm", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1 });
      const inventoryB = createInventory({ shield: 1 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);

      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);
      tradeSystem.confirmTrade(trade.id, "player_b", inventoryB);

      expect(trade.status).toBe("executing");
    });
  });

  describe("cancelTrade", () => {
    it("cancels a trade", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const result = tradeSystem.cancelTrade(trade.id, "player_a");

      expect(result.success).toBe(true);
      expect(trade.status).toBe("cancelled");
    });

    it("cleans up player trade mappings", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      tradeSystem.cancelTrade(trade.id, "player_a");

      expect(tradeSystem.getPlayerTrade("player_a")).toBeUndefined();
      expect(tradeSystem.getPlayerTrade("player_b")).toBeUndefined();
    });

    it("allows creating new trade after cancel", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      tradeSystem.cancelTrade(trade.id, "player_a");

      const result = tradeSystem.createTrade("player_a", "player_c", { x: 0, y: 0 }, { x: 1, y: 0 });

      expect(result.success).toBe(true);
    });
  });

  describe("executeTrade", () => {
    it("swaps items between players", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1, potion: 3 });
      const inventoryB = createInventory({ shield: 2 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);

      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);
      tradeSystem.confirmTrade(trade.id, "player_b", inventoryB);

      const result = tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

      expect(result.success).toBe(true);
      expect(inventoryA.get("sword")).toBeUndefined();
      expect(inventoryA.get("shield")).toBe(1);
      expect(inventoryB.get("sword")).toBe(1);
      expect(inventoryB.get("shield")).toBe(1);
    });

    it("saves trade to database", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1 });
      const inventoryB = createInventory({ shield: 1 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);

      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);
      tradeSystem.confirmTrade(trade.id, "player_b", inventoryB);

      tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

      const row = db.prepare("SELECT * FROM trades WHERE player_a = ?").get("player_a");
      expect(row).toBeDefined();
    });

    it("fails if player A has insufficient items", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1 });
      const inventoryB = createInventory({ shield: 1 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);

      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);
      tradeSystem.confirmTrade(trade.id, "player_b", inventoryB);

      // Drain player A's inventory before execution
      inventoryA.set("sword", 0);

      const result = tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

      expect(result.success).toBe(false);
      expect(trade.status).toBe("cancelled");
    });

    it("fails if player B has insufficient items", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1 });
      const inventoryB = createInventory({ shield: 1 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);

      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);
      tradeSystem.confirmTrade(trade.id, "player_b", inventoryB);

      // Drain player B's inventory before execution
      inventoryB.set("shield", 0);

      const result = tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

      expect(result.success).toBe(false);
      expect(trade.status).toBe("cancelled");
    });

    it("rejects execution if not both confirmed", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1 });
      const inventoryB = createInventory({ shield: 1 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);

      // Only player A confirms
      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);

      const result = tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

      expect(result.success).toBe(false);
      expect(trade.status).toBe("pending");
    });

    it("handles trade with multiple items", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventoryA = createInventory({ sword: 1, potion: 5, gold: 10 });
      const inventoryB = createInventory({ shield: 2, ring: 1 });

      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventoryA);
      tradeSystem.addItem(trade.id, "player_a", "potion", 3, inventoryA);
      tradeSystem.addItem(trade.id, "player_b", "shield", 1, inventoryB);
      tradeSystem.addItem(trade.id, "player_b", "ring", 1, inventoryB);

      tradeSystem.confirmTrade(trade.id, "player_a", inventoryA);
      tradeSystem.confirmTrade(trade.id, "player_b", inventoryB);

      const result = tradeSystem.executeTrade(trade.id, inventoryA, inventoryB);

      expect(result.success).toBe(true);
      expect(inventoryA.get("sword")).toBeUndefined();
      expect(inventoryA.get("potion")).toBe(2);
      expect(inventoryA.get("shield")).toBe(1);
      expect(inventoryA.get("ring")).toBe(1);
      expect(inventoryB.get("sword")).toBe(1);
      expect(inventoryB.get("potion")).toBe(3);
      expect(inventoryB.get("shield")).toBe(1);
      expect(inventoryB.get("ring")).toBeUndefined();
    });
  });

  describe("getTradeItems", () => {
    it("returns items for a player", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      const inventory = createInventory({ sword: 1, shield: 1 });
      tradeSystem.addItem(trade.id, "player_a", "sword", 1, inventory);
      tradeSystem.addItem(trade.id, "player_a", "shield", 1, inventory);

      const items = tradeSystem.getTradeItems(trade.id, "player_a");

      expect(items).toHaveLength(2);
      expect(items).toContainEqual({ id: "sword", quantity: 1 });
      expect(items).toContainEqual({ id: "shield", quantity: 1 });
    });

    it("returns empty array for non-existent trade", () => {
      const items = tradeSystem.getTradeItems("fake_trade", "player_a");
      expect(items).toHaveLength(0);
    });
  });

  describe("cleanupExpiredTrades", () => {
    it("cancels expired trades", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });
      const trade = tradeSystem.getPlayerTrade("player_a")!;

      // Manually set creation time to past
      (trade as any).createdAt = Date.now() - 120_000;

      const expired = tradeSystem.cleanupExpiredTrades();

      expect(expired).toHaveLength(1);
      expect(expired[0]).toBe(trade.id);
      expect(trade.status).toBe("cancelled");
    });

    it("does not cancel active trades", () => {
      tradeSystem.createTrade("player_a", "player_b", { x: 0, y: 0 }, { x: 1, y: 0 });

      const expired = tradeSystem.cleanupExpiredTrades();

      expect(expired).toHaveLength(0);
    });
  });
});
