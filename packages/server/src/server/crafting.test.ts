import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GameDatabase } from "../db/index.js";
import { CraftingSystem } from "./CraftingSystem.js";
import {
  CRAFTING_RECIPES,
  getRecipeById,
  getAllRecipes,
} from "./CraftingData.js";

/* ── CraftingData tests ── */

describe("CraftingData", () => {
  it("has 7 recipes", () => {
    expect(CRAFTING_RECIPES).toHaveLength(7);
  });

  it("each recipe has a unique ID", () => {
    const ids = CRAFTING_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getRecipeById returns correct recipe", () => {
    const recipe = getRecipeById("wooden_sword");
    expect(recipe).toBeDefined();
    expect(recipe!.name).toBe("Wooden Sword");
    expect(recipe!.inputs).toHaveLength(1);
    expect(recipe!.inputs[0].itemId).toBe("Wood");
    expect(recipe!.inputs[0].quantity).toBe(3);
    expect(recipe!.output.itemId).toBe("Wooden Sword");
    expect(recipe!.output.quantity).toBe(1);
  });

  it("getRecipeById returns undefined for unknown ID", () => {
    expect(getRecipeById("nonexistent")).toBeUndefined();
  });

  it("getAllRecipes returns all recipes", () => {
    const all = getAllRecipes();
    expect(all).toHaveLength(7);
  });

  it("Stone Axe requires 2 Wood + 2 Stone", () => {
    const recipe = getRecipeById("stone_axe");
    expect(recipe).toBeDefined();
    expect(recipe!.inputs).toHaveLength(2);
    expect(recipe!.inputs).toEqual(
      expect.arrayContaining([
        { itemId: "Wood", quantity: 2 },
        { itemId: "Stone", quantity: 2 },
      ]),
    );
  });

  it("Healing Potion requires 1 Herb + 1 Berry", () => {
    const recipe = getRecipeById("healing_potion");
    expect(recipe).toBeDefined();
    expect(recipe!.inputs).toHaveLength(2);
    expect(recipe!.inputs).toEqual(
      expect.arrayContaining([
        { itemId: "Herb", quantity: 1 },
        { itemId: "Berry", quantity: 1 },
      ]),
    );
  });

  it("Leather Armor requires 3 Leather", () => {
    const recipe = getRecipeById("leather_armor");
    expect(recipe).toBeDefined();
    expect(recipe!.inputs).toHaveLength(1);
    expect(recipe!.inputs[0]).toEqual({ itemId: "Leather", quantity: 3 });
  });

  it("Iron Pickaxe requires 2 Wood + 3 Iron", () => {
    const recipe = getRecipeById("iron_pickaxe");
    expect(recipe).toBeDefined();
    expect(recipe!.inputs).toHaveLength(2);
    expect(recipe!.inputs).toEqual(
      expect.arrayContaining([
        { itemId: "Wood", quantity: 2 },
        { itemId: "Iron", quantity: 3 },
      ]),
    );
  });

  it("Torch requires 1 Wood + 1 Coal", () => {
    const recipe = getRecipeById("torch");
    expect(recipe).toBeDefined();
    expect(recipe!.inputs).toHaveLength(2);
    expect(recipe!.inputs).toEqual(
      expect.arrayContaining([
        { itemId: "Wood", quantity: 1 },
        { itemId: "Coal", quantity: 1 },
      ]),
    );
  });

  it("Campfire requires 3 Wood + 1 Stone", () => {
    const recipe = getRecipeById("campfire");
    expect(recipe).toBeDefined();
    expect(recipe!.inputs).toHaveLength(2);
    expect(recipe!.inputs).toEqual(
      expect.arrayContaining([
        { itemId: "Wood", quantity: 3 },
        { itemId: "Stone", quantity: 1 },
      ]),
    );
  });
});

/* ── CraftingSystem tests ── */

describe("CraftingSystem", () => {
  let db: GameDatabase;
  let craftingSystem: CraftingSystem;
  const playerId = "test-crafter-1";

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();

    // Insert a test player with a known inventory
    const inventory = JSON.stringify({
      Wood: 10,
      Stone: 5,
      Herb: 3,
      Berry: 4,
      Leather: 6,
      Iron: 5,
      Coal: 2,
    });

    db.getDb()
      .prepare(
        `INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(playerId, "acc-craft", 0, 0, 0, 0, inventory, 0, null, Date.now());

    craftingSystem = new CraftingSystem(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  describe("craft", () => {
    it("crafts Wooden Sword with sufficient materials", () => {
      const result = craftingSystem.craft(playerId, "wooden_sword");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Wooden Sword");
      expect(result.message).toContain("Wooden Sword");
    });

    it("rejects craft with insufficient materials", () => {
      // Player has 0 Gold
      const result = craftingSystem.craft(playerId, "wooden_sword");
      expect(result.success).toBe(true); // Has enough Wood

      // Now try again - should fail (only 7 Wood left, need 3)
      const result2 = craftingSystem.craft(playerId, "wooden_sword");
      expect(result2.success).toBe(true); // 7 >= 3, still works

      // Third time - 4 Wood left, still enough
      const result3 = craftingSystem.craft(playerId, "wooden_sword");
      expect(result3.success).toBe(true);

      // Fourth time - only 1 Wood left, not enough
      const result4 = craftingSystem.craft(playerId, "wooden_sword");
      expect(result4.success).toBe(false);
      expect(result4.message).toContain("Not enough");
    });

    it("rejects unknown recipe", () => {
      const result = craftingSystem.craft(playerId, "nonexistent_recipe");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown recipe");
    });

    it("consumes materials and adds output", () => {
      craftingSystem.craft(playerId, "wooden_sword");

      // Check inventory via direct DB query
      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      // Wood: 10 - 3 = 7
      expect(inv.Wood).toBe(7);
      // Wooden Sword: 0 + 1 = 1
      expect(inv["Wooden Sword"]).toBe(1);
    });

    it("crafts Stone Axe (multi-input recipe)", () => {
      const result = craftingSystem.craft(playerId, "stone_axe");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Stone Axe");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Wood).toBe(8); // 10 - 2
      expect(inv.Stone).toBe(3); // 5 - 2
      expect(inv["Stone Axe"]).toBe(1);
    });

    it("crafts Healing Potion", () => {
      const result = craftingSystem.craft(playerId, "healing_potion");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Healing Potion");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Herb).toBe(2); // 3 - 1
      expect(inv.Berry).toBe(3); // 4 - 1
      expect(inv["Healing Potion"]).toBe(1);
    });

    it("crafts Leather Armor", () => {
      const result = craftingSystem.craft(playerId, "leather_armor");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Leather Armor");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Leather).toBe(3); // 6 - 3
      expect(inv["Leather Armor"]).toBe(1);
    });

    it("crafts Iron Pickaxe", () => {
      const result = craftingSystem.craft(playerId, "iron_pickaxe");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Iron Pickaxe");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Wood).toBe(8); // 10 - 2
      expect(inv.Iron).toBe(2); // 5 - 3
      expect(inv["Iron Pickaxe"]).toBe(1);
    });

    it("crafts Torch", () => {
      const result = craftingSystem.craft(playerId, "torch");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Torch");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Wood).toBe(9); // 10 - 1
      expect(inv.Coal).toBe(1); // 2 - 1
      expect(inv.Torch).toBe(1);
    });

    it("crafts Campfire", () => {
      const result = craftingSystem.craft(playerId, "campfire");
      expect(result.success).toBe(true);
      expect(result.itemId).toBe("Campfire");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Wood).toBe(7); // 10 - 3
      expect(inv.Stone).toBe(4); // 5 - 1
      expect(inv.Campfire).toBe(1);
    });

    it("stacks crafted items in inventory", () => {
      craftingSystem.craft(playerId, "torch");
      craftingSystem.craft(playerId, "torch");

      const row = db.getDb()
        .prepare("SELECT inventory FROM players WHERE id = ?")
        .get(playerId) as { inventory: string };
      const inv: Record<string, number> = JSON.parse(row.inventory);

      expect(inv.Torch).toBe(2);
      expect(inv.Wood).toBe(8); // 10 - 1 - 1
      expect(inv.Coal).toBeUndefined(); // 2 - 1 - 1 = 0, deleted from inventory
    });
  });

  describe("canCraft", () => {
    it("returns true when materials are sufficient", () => {
      expect(craftingSystem.canCraft(playerId, "wooden_sword")).toBe(true);
    });

    it("returns false when materials are insufficient", () => {
      craftingSystem.craft(playerId, "wooden_sword"); // -3 Wood
      craftingSystem.craft(playerId, "wooden_sword"); // -3 Wood
      craftingSystem.craft(playerId, "wooden_sword"); // -3 Wood (only 1 left)
      expect(craftingSystem.canCraft(playerId, "wooden_sword")).toBe(false);
    });

    it("returns false for unknown recipe", () => {
      expect(craftingSystem.canCraft(playerId, "unknown")).toBe(false);
    });
  });

  describe("getAvailableRecipes", () => {
    it("returns all recipes with craftable flag", () => {
      const recipes = craftingSystem.getAvailableRecipes(playerId);
      expect(recipes).toHaveLength(7);

      // All should be craftable with starting inventory
      for (const recipe of recipes) {
        expect(recipe.craftable).toBe(true);
      }
    });

    it("marks recipes as non-craftable when materials run out", () => {
      // Consume all Iron (5 total)
      craftingSystem.craft(playerId, "iron_pickaxe"); // -3 Iron
      craftingSystem.craft(playerId, "iron_pickaxe"); // fails (only 2 left)

      // Need to actually consume more. Use another recipe or manually set
      // Actually with 5 Iron, we can craft 1 iron_pickaxe (needs 3) → 2 left
      // Then iron_pickaxe fails. So iron_pickaxe should be non-craftable now.
      const recipes = craftingSystem.getAvailableRecipes(playerId);
      const ironPickaxe = recipes.find((r) => r.id === "iron_pickaxe");
      expect(ironPickaxe).toBeDefined();
      expect(ironPickaxe!.craftable).toBe(false);
    });
  });
});
