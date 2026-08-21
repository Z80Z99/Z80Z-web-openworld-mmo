/**
 * Crafting recipe definitions.
 *
 * Each recipe maps input materials to a single output item.
 */

export interface CraftingMaterial {
  itemId: string;
  quantity: number;
}

export interface CraftingRecipe {
  id: string;
  name: string;
  description: string;
  inputs: CraftingMaterial[];
  output: CraftingMaterial;
}

/**
 * All crafting recipes in the game.
 */
export const CRAFTING_RECIPES: readonly CraftingRecipe[] = [
  {
    id: "wooden_sword",
    name: "Wooden Sword",
    description: "A basic sword carved from wood.",
    inputs: [{ itemId: "Wood", quantity: 3 }],
    output: { itemId: "Wooden Sword", quantity: 1 },
  },
  {
    id: "stone_axe",
    name: "Stone Axe",
    description: "A sturdy axe with a stone head.",
    inputs: [
      { itemId: "Wood", quantity: 2 },
      { itemId: "Stone", quantity: 2 },
    ],
    output: { itemId: "Stone Axe", quantity: 1 },
  },
  {
    id: "healing_potion",
    name: "Healing Potion",
    description: "Restores health when consumed.",
    inputs: [
      { itemId: "Herb", quantity: 1 },
      { itemId: "Berry", quantity: 1 },
    ],
    output: { itemId: "Healing Potion", quantity: 1 },
  },
  {
    id: "leather_armor",
    name: "Leather Armor",
    description: "Lightweight armor made from leather.",
    inputs: [{ itemId: "Leather", quantity: 3 }],
    output: { itemId: "Leather Armor", quantity: 1 },
  },
  {
    id: "iron_pickaxe",
    name: "Iron Pickaxe",
    description: "A durable pickaxe for mining.",
    inputs: [
      { itemId: "Wood", quantity: 2 },
      { itemId: "Iron", quantity: 3 },
    ],
    output: { itemId: "Iron Pickaxe", quantity: 1 },
  },
  {
    id: "torch",
    name: "Torch",
    description: "Lights up the darkness.",
    inputs: [
      { itemId: "Wood", quantity: 1 },
      { itemId: "Coal", quantity: 1 },
    ],
    output: { itemId: "Torch", quantity: 1 },
  },
  {
    id: "campfire",
    name: "Campfire",
    description: "A warm fire for resting and cooking.",
    inputs: [
      { itemId: "Wood", quantity: 3 },
      { itemId: "Stone", quantity: 1 },
    ],
    output: { itemId: "Campfire", quantity: 1 },
  },
] as const;

/** Map for O(1) lookup by recipe ID. */
const RECIPE_MAP = new Map<string, CraftingRecipe>(
  CRAFTING_RECIPES.map((r) => [r.id, r]),
);

/**
 * Get a crafting recipe by ID.
 */
export function getRecipeById(recipeId: string): CraftingRecipe | undefined {
  return RECIPE_MAP.get(recipeId);
}

/**
 * Get all available recipes.
 */
export function getAllRecipes(): readonly CraftingRecipe[] {
  return CRAFTING_RECIPES;
}
