/**
 * CraftingUI — DOM overlay for crafting menu.
 *
 * Displays a grid of available recipes with:
 *  - Recipe name and output item
 *  - Required materials with counts
 *  - Craft button (disabled if missing materials)
 *  - Search/filter by name
 *  - Crafting feedback animation
 */

/* ── Types ── */

export interface RecipeDisplayData {
  id: string;
  name: string;
  description: string;
  inputs: Array<{ itemId: string; quantity: number }>;
  output: { itemId: string; quantity: number };
  craftable: boolean;
}

/* ── Constants ── */

const ITEM_ICONS: Record<string, string> = {
  Wood: "\u{1F332}",
  Stone: "\u{1FAA8}",
  Herb: "\u{1F33F}",
  Berry: "\u{1FAD0}",
  Leather: "\u{1F9F6}",
  Iron: "\u2699\uFE0F",
  Coal: "\u2B1B",
  "Wooden Sword": "\u{1F5E1}\uFE0F",
  "Stone Axe": "\u{1FA93}",
  "Healing Potion": "\u{1F48A}",
  "Leather Armor": "\u{1F6E1}\uFE0F",
  "Iron Pickaxe": "\u26CF\uFE0F",
  Torch: "\u{1F525}",
  Campfire: "\u{1F525}",
};

/* ── CraftingUI Class ── */

export class CraftingUI {
  private readonly container: HTMLElement;
  private readonly header: HTMLElement;
  private readonly body: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly recipeGrid: HTMLElement;
  private readonly feedbackEl: HTMLElement;

  private recipes: RecipeDisplayData[] = [];
  private filterText = "";
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private onCraft: ((recipeId: string) => void) | null = null;
  private visible = false;

  constructor(parent: HTMLElement) {
    // Main container
    this.container = document.createElement("div");
    this.container.id = "crafting-ui";
    this.container.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 500px; max-height: 80vh; background: rgba(10, 10, 10, 0.95);
      border: 2px solid #666; border-radius: 8px; font-family: monospace;
      color: #fff; z-index: 30; display: none; flex-direction: column;
      pointer-events: auto; user-select: none;
    `;
    parent.appendChild(this.container);

    // Header
    this.header = document.createElement("div");
    this.header.style.cssText = `
      padding: 10px 16px; border-bottom: 1px solid #444;
      display: flex; justify-content: space-between; align-items: center;
    `;
    this.container.appendChild(this.header);

    const title = document.createElement("span");
    title.textContent = "\u{1F528} Crafting";
    title.style.cssText = "font-size: 14px; font-weight: bold; color: #f1c40f;";
    this.header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "\u2715";
    closeBtn.style.cssText = `
      background: none; border: none; color: #999; font-size: 16px;
      cursor: pointer; padding: 0 4px;
    `;
    closeBtn.addEventListener("click", () => this.hide());
    this.header.appendChild(closeBtn);

    // Search bar
    const searchWrapper = document.createElement("div");
    searchWrapper.style.cssText = "padding: 8px 16px; border-bottom: 1px solid #333;";
    this.container.appendChild(searchWrapper);

    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Search recipes...";
    this.searchInput.style.cssText = `
      width: 100%; padding: 6px 10px; background: #1a1a1a; border: 1px solid #444;
      border-radius: 4px; color: #fff; font-family: monospace; font-size: 12px;
      outline: none; box-sizing: border-box;
    `;
    this.searchInput.addEventListener("input", () => {
      this.filterText = this.searchInput.value.toLowerCase();
      this.renderRecipes();
    });
    searchWrapper.appendChild(this.searchInput);

    // Recipe grid (scrollable)
    this.body = document.createElement("div");
    this.body.style.cssText = `
      padding: 8px 16px; overflow-y: auto; max-height: 50vh;
    `;
    this.container.appendChild(this.body);

    this.recipeGrid = document.createElement("div");
    this.recipeGrid.style.cssText = "display: grid; gap: 8px;";
    this.body.appendChild(this.recipeGrid);

    // Feedback toast
    this.feedbackEl = document.createElement("div");
    this.feedbackEl.style.cssText = `
      position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
      padding: 8px 16px; border-radius: 4px; font-size: 12px;
      opacity: 0; transition: opacity 0.3s; pointer-events: none;
      white-space: nowrap;
    `;
    this.container.appendChild(this.feedbackEl);

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.visible) this.hide();
    });
  }

  /**
   * Register a callback for when the player clicks "Craft".
   */
  setCraftHandler(handler: (recipeId: string) => void): void {
    this.onCraft = handler;
  }

  /**
   * Update the recipe list and re-render.
   */
  setRecipes(recipes: RecipeDisplayData[]): void {
    this.recipes = recipes;
    this.renderRecipes();
  }

  /**
   * Show feedback after a craft attempt.
   */
  showFeedback(success: boolean, message: string): void {
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);

    this.feedbackEl.textContent = message;
    this.feedbackEl.style.background = success ? "rgba(46,204,113,0.9)" : "rgba(231,76,60,0.9)";
    this.feedbackEl.style.color = "#fff";
    this.feedbackEl.style.opacity = "1";

    this.feedbackTimeout = setTimeout(() => {
      this.feedbackEl.style.opacity = "0";
    }, 2000);
  }

  /** Show the crafting menu. */
  show(): void {
    this.visible = true;
    this.container.style.display = "flex";
    this.searchInput.value = "";
    this.filterText = "";
    this.renderRecipes();
  }

  /** Hide the crafting menu. */
  hide(): void {
    this.visible = false;
    this.container.style.display = "none";
  }

  /** Toggle visibility. */
  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Clean up DOM elements. */
  destroy(): void {
    if (this.feedbackTimeout) clearTimeout(this.feedbackTimeout);
    this.container.remove();
  }

  /* ── Private ── */

  private renderRecipes(): void {
    this.recipeGrid.innerHTML = "";

    const filtered = this.recipes.filter((r) =>
      r.name.toLowerCase().includes(this.filterText),
    );

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No recipes found.";
      empty.style.cssText = "text-align: center; color: #666; padding: 20px; font-size: 12px;";
      this.recipeGrid.appendChild(empty);
      return;
    }

    for (const recipe of filtered) {
      this.recipeGrid.appendChild(this.createRecipeCard(recipe));
    }
  }

  private createRecipeCard(recipe: RecipeDisplayData): HTMLElement {
    const card = document.createElement("div");
    card.style.cssText = `
      background: ${recipe.craftable ? "rgba(46,204,113,0.1)" : "rgba(60,60,60,0.3)"};
      border: 1px solid ${recipe.craftable ? "#2ecc71" : "#444"};
      border-radius: 6px; padding: 10px 12px;
    `;

    // Name + description
    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;";

    const nameEl = document.createElement("span");
    nameEl.textContent = recipe.name;
    nameEl.style.cssText = "font-size: 13px; font-weight: bold; color: #fff;";
    nameRow.appendChild(nameEl);

    const outputLabel = document.createElement("span");
    const outIcon = ITEM_ICONS[recipe.output.itemId] ?? "\u{1F4E6}";
    outputLabel.textContent = `${outIcon} x${recipe.output.quantity}`;
    outputLabel.style.cssText = "font-size: 11px; color: #aaa;";
    nameRow.appendChild(outputLabel);

    card.appendChild(nameRow);

    // Description
    const descEl = document.createElement("div");
    descEl.textContent = recipe.description;
    descEl.style.cssText = "font-size: 11px; color: #888; margin-bottom: 6px;";
    card.appendChild(descEl);

    // Inputs row
    const inputsRow = document.createElement("div");
    inputsRow.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;";

    for (const input of recipe.inputs) {
      const chip = document.createElement("span");
      const icon = ITEM_ICONS[input.itemId] ?? "\u{1F4E6}";
      chip.textContent = `${icon} ${input.itemId} x${input.quantity}`;
      chip.style.cssText = `
        background: rgba(255,255,255,0.08); padding: 2px 8px;
        border-radius: 3px; font-size: 11px; color: #ccc;
      `;
      inputsRow.appendChild(chip);
    }

    card.appendChild(inputsRow);

    // Craft button
    const btn = document.createElement("button");
    btn.textContent = recipe.craftable ? "\u{1F528} Craft" : "Missing materials";
    btn.style.cssText = `
      width: 100%; padding: 6px; border: none; border-radius: 4px;
      font-family: monospace; font-size: 12px; cursor: ${recipe.craftable ? "pointer" : "not-allowed"};
      background: ${recipe.craftable ? "#27ae60" : "#555"};
      color: ${recipe.craftable ? "#fff" : "#999"};
    `;

    if (recipe.craftable) {
      btn.addEventListener("click", () => {
        this.onCraft?.(recipe.id);
      });
    }

    card.appendChild(btn);

    return card;
  }
}
