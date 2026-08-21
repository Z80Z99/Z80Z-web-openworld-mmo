/**
 * NPC shop definitions per biome.
 *
 * Each shop sells items themed to its biome. Prices are in resources:
 * - baseValue = listed resource cost
 * - buyPrice  = 2 × baseValue
 * - sellPrice = floor(0.5 × baseValue)
 */

import { Biome } from "@mmo/shared";

export interface ShopItem {
  readonly itemId: string;
  readonly name: string;
  readonly description: string;
  /** Resource cost as the base value for price calculation. */
  readonly baseValue: number;
  /** Which resource is used for this item (e.g., "Wood", "Stone"). */
  readonly resourceType: string;
}

export interface ShopDefinition {
  readonly id: string;
  readonly name: string;
  readonly biome: Biome;
  readonly items: readonly ShopItem[];
}

export const SHOPS: readonly ShopDefinition[] = [
  {
    id: "forest_shop",
    name: "Forest Shop",
    biome: Biome.Forest,
    items: [
      { itemId: "wooden_sword", name: "Wooden Sword", description: "A basic sword carved from wood.", baseValue: 5, resourceType: "Wood" },
      { itemId: "torch", name: "Torch", description: "Lights up the darkness.", baseValue: 2, resourceType: "Wood" },
      { itemId: "rope", name: "Rope", description: "A sturdy vine rope.", baseValue: 3, resourceType: "Vine" },
    ],
  },
  {
    id: "desert_shop",
    name: "Desert Shop",
    biome: Biome.Desert,
    items: [
      { itemId: "sand_armor", name: "Sand Armor", description: "Light armor made from hardened sand.", baseValue: 10, resourceType: "Sand" },
      { itemId: "water_flask", name: "Water Flask", description: "Carries precious water.", baseValue: 5, resourceType: "Water" },
      { itemId: "compass", name: "Compass", description: "Points toward the nearest landmark.", baseValue: 3, resourceType: "Stone" },
    ],
  },
  {
    id: "mountain_shop",
    name: "Mountain Shop",
    biome: Biome.Mountains,
    items: [
      { itemId: "iron_pickaxe", name: "Iron Pickaxe", description: "A durable pickaxe for mining.", baseValue: 8, resourceType: "Stone" },
      { itemId: "helmet", name: "Helmet", description: "Protects your head.", baseValue: 5, resourceType: "Stone" },
      { itemId: "shield", name: "Shield", description: "Blocks incoming attacks.", baseValue: 6, resourceType: "Stone" },
    ],
  },
  {
    id: "plains_shop",
    name: "Plains Shop",
    biome: Biome.Plains,
    items: [
      { itemId: "healing_potion", name: "Healing Potion", description: "Restores health when consumed.", baseValue: 3, resourceType: "Herb" },
      { itemId: "bread", name: "Bread", description: "Freshly baked bread.", baseValue: 2, resourceType: "Wheat" },
      { itemId: "map", name: "Map", description: "Reveals nearby terrain.", baseValue: 5, resourceType: "Paper" },
    ],
  },
] as const;

const SHOP_MAP = new Map<string, ShopDefinition>(SHOPS.map((s) => [s.id, s]));
const ITEM_MAP = new Map<string, ShopItem>();
for (const shop of SHOPS) {
  for (const item of shop.items) {
    ITEM_MAP.set(item.itemId, { ...item });
  }
}

/** Get a shop definition by ID. */
export function getShopById(shopId: string): ShopDefinition | undefined {
  return SHOP_MAP.get(shopId);
}

/** Get all shops. */
export function getAllShops(): readonly ShopDefinition[] {
  return SHOPS;
}

/** Get a shop item by its item ID (across all shops). */
export function getShopItem(itemId: string): ShopItem | undefined {
  return ITEM_MAP.get(itemId);
}

/** Calculate the buy price for a shop item (2× baseValue). */
export function getBuyPrice(item: ShopItem): number {
  return item.baseValue * 2;
}

/** Calculate the sell price for a shop item (floor of 0.5× baseValue). */
export function getSellPrice(item: ShopItem): number {
  return Math.floor(item.baseValue * 0.5);
}
