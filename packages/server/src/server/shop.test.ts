import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GameDatabase } from "../db/index.js";
import { ShopSystem } from "./ShopSystem.js";
import {
  SHOPS,
  getShopById,
  getShopItem,
  getBuyPrice,
  getSellPrice,
} from "./ShopData.js";

describe("ShopData", () => {
  it("has 4 shops", () => {
    expect(SHOPS).toHaveLength(4);
  });

  it("each shop has a unique id", () => {
    const ids = SHOPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each shop has 3 items", () => {
    for (const shop of SHOPS) {
      expect(shop.items).toHaveLength(3);
    }
  });

  it("getShopById returns correct shop", () => {
    const shop = getShopById("forest_shop");
    expect(shop).toBeDefined();
    expect(shop!.name).toBe("Forest Shop");
    expect(shop!.items[0].name).toBe("Wooden Sword");
  });

  it("getShopById returns undefined for unknown ID", () => {
    expect(getShopById("nonexistent")).toBeUndefined();
  });

  it("getShopItem finds items across all shops", () => {
    const item = getShopItem("wooden_sword");
    expect(item).toBeDefined();
    expect(item!.name).toBe("Wooden Sword");
    expect(item!.resourceType).toBe("Wood");
  });

  it("getShopItem returns undefined for unknown item", () => {
    expect(getShopItem("nonexistent_item")).toBeUndefined();
  });

  it("buy price is 2x base value", () => {
    const item = getShopItem("wooden_sword")!;
    expect(getBuyPrice(item)).toBe(10); // 5 * 2
  });

  it("sell price is floor of 0.5x base value", () => {
    const item = getShopItem("wooden_sword")!;
    expect(getSellPrice(item)).toBe(2); // floor(5 * 0.5) = 2
  });

  it("sell price handles odd base values", () => {
    const item = getShopItem("torch")!;
    expect(getSellPrice(item)).toBe(1); // floor(2 * 0.5) = 1
  });
});

describe("ShopSystem", () => {
  let db: GameDatabase;
  let shopSystem: ShopSystem;
  const playerId = "test-player-1";

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();

    // Insert a test player with some resources
    db.getDb()
      .prepare(
        `INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        playerId,
        "acc-1",
        0,
        0,
        0,
        0,
        JSON.stringify({ Wood: 50, Stone: 30, Sand: 20, Herb: 10 }),
        0,
        null,
        Date.now(),
      );

    shopSystem = new ShopSystem(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  describe("buy", () => {
    it("buys an item and deducts resources", () => {
      const result = shopSystem.buy(playerId, "forest_shop", "wooden_sword", 1);
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("wooden_sword");
      expect(result.quantity).toBe(1);
      expect(result.totalCost).toBe(10); // 5 * 2

      // Check inventory updated
      const inv = shopSystem.getInventory(playerId);
      expect(inv.get("Wood")).toBe(40); // 50 - 10
      expect(inv.get("wooden_sword")).toBe(1);
    });

    it("buys multiple items", () => {
      const result = shopSystem.buy(playerId, "forest_shop", "torch", 3);
      expect(result.success).toBe(true);
      expect(result.totalCost).toBe(12); // (2 * 2) * 3

      const inv = shopSystem.getInventory(playerId);
      expect(inv.get("Wood")).toBe(38); // 50 - 12
      expect(inv.get("torch")).toBe(3);
    });

    it("rejects when insufficient funds", () => {
      const result = shopSystem.buy(playerId, "desert_shop", "sand_armor", 5);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Not enough Sand");
    });

    it("rejects unknown shop", () => {
      const result = shopSystem.buy(playerId, "nonexistent_shop", "wooden_sword", 1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown shop");
    });

    it("rejects item not sold at shop", () => {
      const result = shopSystem.buy(playerId, "forest_shop", "sand_armor", 1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not sold at this shop");
    });

    it("rejects zero count", () => {
      const result = shopSystem.buy(playerId, "forest_shop", "wooden_sword", 0);
      expect(result.success).toBe(false);
    });

    it("rejects negative count", () => {
      const result = shopSystem.buy(playerId, "forest_shop", "wooden_sword", -1);
      expect(result.success).toBe(false);
    });
  });

  describe("sell", () => {
    it("sells an item and gains resources", () => {
      // First buy something
      shopSystem.buy(playerId, "forest_shop", "wooden_sword", 1);

      // Then sell it
      const result = shopSystem.sell(playerId, "wooden_sword", 1);
      expect(result.success).toBe(true);
      expect(result.totalGain).toBe(2); // floor(5 * 0.5)

      const inv = shopSystem.getInventory(playerId);
      expect(inv.get("wooden_sword")).toBeUndefined(); // sold all
      expect(inv.get("Wood")).toBe(42); // 50 - 10 (buy) + 2 (sell) = 42
    });

    it("sells multiple items", () => {
      shopSystem.buy(playerId, "forest_shop", "torch", 3);
      const result = shopSystem.sell(playerId, "torch", 2);
      expect(result.success).toBe(true);
      expect(result.totalGain).toBe(2); // floor(2 * 0.5) * 2 = 1 * 2

      const inv = shopSystem.getInventory(playerId);
      expect(inv.get("torch")).toBe(1);
    });

    it("rejects when player doesn't have the item", () => {
      const result = shopSystem.sell(playerId, "wooden_sword", 1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Not enough");
    });

    it("rejects unknown item", () => {
      const result = shopSystem.sell(playerId, "nonexistent_item", 1);
      expect(result.success).toBe(false);
      expect(result.message).toContain("unknown item");
    });

    it("rejects zero count", () => {
      const result = shopSystem.sell(playerId, "wooden_sword", 0);
      expect(result.success).toBe(false);
    });
  });

  describe("getInventory", () => {
    it("returns player inventory", () => {
      const inv = shopSystem.getInventory(playerId);
      expect(inv.get("Wood")).toBe(50);
      expect(inv.get("Stone")).toBe(30);
    });

    it("returns empty map for unknown player", () => {
      const inv = shopSystem.getInventory("unknown");
      expect(inv.size).toBe(0);
    });
  });
});
