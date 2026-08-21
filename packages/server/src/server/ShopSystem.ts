import type Database from "better-sqlite3";
import {
  getShopById,
  getShopItem,
  getBuyPrice,
  getSellPrice,
  type ShopDefinition,
  type ShopItem,
} from "./ShopData.js";

/* ── Types ── */

export interface ShopResult {
  success: boolean;
  message: string;
  itemId?: string;
  quantity?: number;
  totalCost?: number;
  totalGain?: number;
}

/* ── ShopSystem ── */

/**
 * Server-side NPC shop logic.
 *
 * Players buy items by spending resources, and sell items to gain resources.
 * Inventory is stored as JSON in the players table.
 */
export class ShopSystem {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Buy an item from a shop.
   *
   * 1. Validate shop and item exist
   * 2. Load player inventory
   * 3. Check player has enough resources
   * 4. Deduct resources, add item
   * 5. Persist
   */
  buy(playerId: string, shopId: string, itemId: string, count: number): ShopResult {
    if (count <= 0) {
      return { success: false, message: "Invalid count." };
    }

    const shop = getShopById(shopId);
    if (!shop) {
      return { success: false, message: `Unknown shop: ${shopId}` };
    }

    const item = shop.items.find((i) => i.itemId === itemId);
    if (!item) {
      return { success: false, message: `Item not sold at this shop: ${itemId}` };
    }

    const inventory = this.loadInventory(playerId);
    const buyPrice = getBuyPrice(item);
    const totalCost = buyPrice * count;

    // Check player has enough of the resource
    const have = inventory.get(item.resourceType) ?? 0;
    if (have < totalCost) {
      return {
        success: false,
        message: `Not enough ${item.resourceType} (need ${totalCost}, have ${have})`,
      };
    }

    // Deduct resources
    const remaining = have - totalCost;
    if (remaining <= 0) {
      inventory.delete(item.resourceType);
    } else {
      inventory.set(item.resourceType, remaining);
    }

    // Add purchased item
    const current = inventory.get(item.itemId) ?? 0;
    inventory.set(item.itemId, current + count);

    this.saveInventory(playerId, inventory);

    return {
      success: true,
      message: `Bought ${count} ${item.name} for ${totalCost} ${item.resourceType}`,
      itemId: item.itemId,
      quantity: count,
      totalCost,
    };
  }

  /**
   * Sell an item to a shop.
   *
   * 1. Validate item is a shop item
   * 2. Load player inventory
   * 3. Check player has enough of the item
   * 4. Remove item, add resources
   * 5. Persist
   */
  sell(playerId: string, itemId: string, count: number): ShopResult {
    if (count <= 0) {
      return { success: false, message: "Invalid count." };
    }

    const item = getShopItem(itemId);
    if (!item) {
      return { success: false, message: `Cannot sell: unknown item ${itemId}` };
    }

    const inventory = this.loadInventory(playerId);
    const sellPrice = getSellPrice(item);
    const totalGain = sellPrice * count;

    // Check player has enough of the item
    const have = inventory.get(itemId) ?? 0;
    if (have < count) {
      return {
        success: false,
        message: `Not enough ${item.name} (need ${count}, have ${have})`,
      };
    }

    // Remove item
    const remaining = have - count;
    if (remaining <= 0) {
      inventory.delete(itemId);
    } else {
      inventory.set(itemId, remaining);
    }

    // Add resources
    const currentResources = inventory.get(item.resourceType) ?? 0;
    inventory.set(item.resourceType, currentResources + totalGain);

    this.saveInventory(playerId, inventory);

    return {
      success: true,
      message: `Sold ${count} ${item.name} for ${totalGain} ${item.resourceType}`,
      itemId: item.itemId,
      quantity: count,
      totalGain,
    };
  }

  /**
   * Get a player's inventory as a map.
   */
  getInventory(playerId: string): Map<string, number> {
    return this.loadInventory(playerId);
  }

  /**
   * Load a player's inventory from the database.
   */
  private loadInventory(playerId: string): Map<string, number> {
    const row = this.db
      .prepare("SELECT inventory FROM players WHERE id = ?")
      .get(playerId) as { inventory: string } | undefined;

    if (!row?.inventory) return new Map();

    try {
      const parsed: Record<string, number> = JSON.parse(row.inventory);
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  /**
   * Save a player's inventory to the database.
   */
  private saveInventory(playerId: string, inventory: Map<string, number>): void {
    const obj: Record<string, number> = {};
    for (const [k, v] of inventory) {
      obj[k] = v;
    }
    this.db
      .prepare("UPDATE players SET inventory = ? WHERE id = ?")
      .run(JSON.stringify(obj), playerId);
  }
}
