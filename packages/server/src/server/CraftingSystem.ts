import type Database from "better-sqlite3";
import {
  getRecipeById,
  getAllRecipes,
  type CraftingRecipe,
  type CraftingMaterial,
} from "./CraftingData.js";

/* ── Types ── */

export interface CraftResult {
  success: boolean;
  itemId: string;
  message: string;
  recipeId: string;
}

/* ── CraftingSystem ── */

/**
 * Server-side crafting logic.
 *
 * Validates materials, consumes from inventory, and produces output items.
 * Inventory is stored as JSON in the players table.
 */
export class CraftingSystem {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Attempt to craft an item for a player.
   *
   * 1. Look up the recipe
   * 2. Load the player's inventory
   * 3. Check that all input materials are present in sufficient quantity
   * 4. Consume inputs and add output
   * 5. Persist the updated inventory
   */
  craft(sessionId: string, recipeId: string): CraftResult {
    // 1. Look up recipe
    const recipe = getRecipeById(recipeId);
    if (!recipe) {
      return {
        success: false,
        itemId: "",
        message: `Unknown recipe: ${recipeId}`,
        recipeId,
      };
    }

    // 2. Load inventory
    const inventory = this.loadInventory(sessionId);

    // 3. Check materials
    for (const input of recipe.inputs) {
      const have = inventory.get(input.itemId) ?? 0;
      if (have < input.quantity) {
        return {
          success: false,
          itemId: recipe.output.itemId,
          message: `Not enough ${input.itemId} (need ${input.quantity}, have ${have})`,
          recipeId,
        };
      }
    }

    // 4. Consume inputs
    for (const input of recipe.inputs) {
      const current = inventory.get(input.itemId) ?? 0;
      const next = current - input.quantity;
      if (next <= 0) {
        inventory.delete(input.itemId);
      } else {
        inventory.set(input.itemId, next);
      }
    }

    // 5. Add output
    const currentOutput = inventory.get(recipe.output.itemId) ?? 0;
    inventory.set(recipe.output.itemId, currentOutput + recipe.output.quantity);

    // 6. Persist
    this.saveInventory(sessionId, inventory);

    return {
      success: true,
      itemId: recipe.output.itemId,
      message: `Crafted ${recipe.name}`,
      recipeId,
    };
  }

  /**
   * Check if a player can craft a specific recipe without consuming materials.
   */
  canCraft(sessionId: string, recipeId: string): boolean {
    const recipe = getRecipeById(recipeId);
    if (!recipe) return false;

    const inventory = this.loadInventory(sessionId);
    for (const input of recipe.inputs) {
      const have = inventory.get(input.itemId) ?? 0;
      if (have < input.quantity) return false;
    }
    return true;
  }

  /**
   * Get all recipes with craftability status for a player.
   */
  getAvailableRecipes(
    sessionId: string,
  ): Array<CraftingRecipe & { craftable: boolean }> {
    const inventory = this.loadInventory(sessionId);
    const recipes = getAllRecipes();

    return recipes.map((recipe) => {
      const craftable = recipe.inputs.every((input) => {
        const have = inventory.get(input.itemId) ?? 0;
        return have >= input.quantity;
      });
      return { ...recipe, craftable };
    });
  }

  /**
   * Load a player's inventory from the database.
   * Returns a Map of itemId → quantity.
   */
  private loadInventory(sessionId: string): Map<string, number> {
    const row = this.db
      .prepare("SELECT inventory FROM players WHERE id = ?")
      .get(sessionId) as { inventory: string } | undefined;

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
  private saveInventory(sessionId: string, inventory: Map<string, number>): void {
    const obj: Record<string, number> = {};
    for (const [k, v] of inventory) {
      obj[k] = v;
    }
    this.db
      .prepare("UPDATE players SET inventory = ? WHERE id = ?")
      .run(JSON.stringify(obj), sessionId);
  }
}
