/**
 * ShopUI — DOM overlay for NPC shop interaction.
 *
 * Renders:
 *  - Shop dialog with NPC name
 *  - Buy/Sell tabs
 *  - Item grid with names, descriptions, prices
 *  - Player inventory display
 *  - Buy/sell quantity controls
 */

/* ── Types ── */

export interface ShopItemData {
  itemId: string;
  name: string;
  description: string;
  buyPrice: number;
  sellPrice: number;
  resourceType: string;
}

export interface ShopUIData {
  shopId: string;
  shopName: string;
  items: ShopItemData[];
  playerInventory: Record<string, number>;
}

export type ShopBuyHandler = (shopId: string, itemId: string, count: number) => void;
export type ShopSellHandler = (itemId: string, count: number) => void;

/* ── Constants ── */

const SHOP_WIDTH = 420;
const SHOP_HEIGHT = 380;

/* ── ShopUI Class ── */

export class ShopUI {
  private readonly container: HTMLElement;
  private panel!: HTMLElement;
  private tabBuy!: HTMLElement;
  private tabSell!: HTMLElement;
  private gridContainer!: HTMLElement;
  private inventoryLabel!: HTMLElement;
  private messageEl!: HTMLElement;

  private currentData: ShopUIData | null = null;
  private activeTab: "buy" | "sell" = "buy";
  private buyHandler: ShopBuyHandler | null = null;
  private sellHandler: ShopSellHandler | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "shop-ui";
    this.container.style.cssText = `
      position: absolute; inset: 0; z-index: 50;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.5); pointer-events: auto;
    `;
    this.container.addEventListener("click", (e) => {
      if (e.target === this.container) this.hide();
    });
    parent.appendChild(this.container);
    this.build();
  }

  /* ── Construction ── */

  private build(): void {
    this.panel = document.createElement("div");
    this.panel.style.cssText = `
      width: ${SHOP_WIDTH}px; max-height: ${SHOP_HEIGHT}px;
      background: rgba(15,12,8,0.95); border: 2px solid #8b7355;
      border-radius: 8px; font-family: monospace; color: #fff;
      display: flex; flex-direction: column; overflow: hidden;
    `;
    this.container.appendChild(this.panel);

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 10px 14px; border-bottom: 1px solid #555;
      display: flex; justify-content: space-between; align-items: center;
    `;
    const title = document.createElement("div");
    title.id = "shop-title";
    title.style.cssText = "font-size: 14px; font-weight: bold; color: #f1c40f;";
    title.textContent = "Shop";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
      background: none; border: none; color: #aaa; font-size: 16px;
      cursor: pointer; padding: 2px 6px;
    `;
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    // Tabs
    const tabRow = document.createElement("div");
    tabRow.style.cssText = "display: flex; border-bottom: 1px solid #444;";

    this.tabBuy = this.createTab("Buy", "buy");
    this.tabSell = this.createTab("Sell", "sell");
    tabRow.appendChild(this.tabBuy);
    tabRow.appendChild(this.tabSell);
    this.panel.appendChild(tabRow);

    // Inventory label
    this.inventoryLabel = document.createElement("div");
    this.inventoryLabel.style.cssText = `
      padding: 6px 14px; font-size: 11px; color: #aaa;
      border-bottom: 1px solid #333;
    `;
    this.inventoryLabel.textContent = "Your Resources:";
    this.panel.appendChild(this.inventoryLabel);

    // Grid container (scrollable)
    this.gridContainer = document.createElement("div");
    this.gridContainer.style.cssText = `
      flex: 1; overflow-y: auto; padding: 8px 14px;
    `;
    this.panel.appendChild(this.gridContainer);

    // Message area
    this.messageEl = document.createElement("div");
    this.messageEl.style.cssText = `
      padding: 6px 14px; font-size: 11px; min-height: 20px;
      border-top: 1px solid #333; color: #ccc;
    `;
    this.panel.appendChild(this.messageEl);
  }

  private createTab(label: string, tab: "buy" | "sell"): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = `
      flex: 1; padding: 8px; text-align: center; cursor: pointer;
      font-size: 12px; font-weight: bold; color: #888;
      border-bottom: 2px solid transparent; transition: all 0.15s;
    `;
    el.textContent = label;
    el.addEventListener("click", () => this.switchTab(tab));

    if (tab === "buy") {
      el.style.color = "#f1c40f";
      el.style.borderBottomColor = "#f1c40f";
    }

    return el;
  }

  /* ── Public API ── */

  /** Show the shop with data. */
  show(data: ShopUIData): void {
    this.currentData = data;
    this.container.style.display = "flex";
    this.activeTab = "buy";
    this.updateTabs();
    this.render();
  }

  /** Hide the shop. */
  hide(): void {
    this.container.style.display = "none";
    this.currentData = null;
  }

  /** Show a feedback message (success/error). */
  showMessage(text: string, isError = false): void {
    this.messageEl.textContent = text;
    this.messageEl.style.color = isError ? "#e74c3c" : "#2ecc71";
  }

  /** Register a buy handler. */
  onBuy(handler: ShopBuyHandler): void {
    this.buyHandler = handler;
  }

  /** Register a sell handler. */
  onSell(handler: ShopSellHandler): void {
    this.sellHandler = handler;
  }

  /** Clean up DOM elements. */
  destroy(): void {
    this.container.remove();
  }

  /* ── Private ── */

  private switchTab(tab: "buy" | "sell"): void {
    this.activeTab = tab;
    this.updateTabs();
    this.render();
  }

  private updateTabs(): void {
    if (this.activeTab === "buy") {
      this.tabBuy.style.color = "#f1c40f";
      this.tabBuy.style.borderBottomColor = "#f1c40f";
      this.tabSell.style.color = "#888";
      this.tabSell.style.borderBottomColor = "transparent";
    } else {
      this.tabSell.style.color = "#f1c40f";
      this.tabSell.style.borderBottomColor = "#f1c40f";
      this.tabBuy.style.color = "#888";
      this.tabBuy.style.borderBottomColor = "transparent";
    }
  }

  private render(): void {
    if (!this.currentData) return;

    this.gridContainer.innerHTML = "";

    const titleEl = this.panel.querySelector("#shop-title") as HTMLElement;
    titleEl.textContent = this.currentData.shopName;

    // Update inventory display
    this.updateInventoryLabel();

    if (this.activeTab === "buy") {
      this.renderBuyTab();
    } else {
      this.renderSellTab();
    }
  }

  private updateInventoryLabel(): void {
    if (!this.currentData) return;
    const inv = this.currentData.playerInventory;
    const resources = Object.entries(inv)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => `${id}: ${qty}`)
      .join("  |  ");
    this.inventoryLabel.textContent = resources || "Your Resources: (empty)";
  }

  private renderBuyTab(): void {
    if (!this.currentData) return;

    for (const item of this.currentData.items) {
      const row = this.createItemRow(item, "buy");
      this.gridContainer.appendChild(row);
    }
  }

  private renderSellTab(): void {
    if (!this.currentData) return;

    const inv = this.currentData.playerInventory;
    const sellableItems = this.currentData.items.filter(
      (item) => (inv[item.itemId] ?? 0) > 0,
    );

    if (sellableItems.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding: 12px; color: #888; font-size: 12px; text-align: center;";
      empty.textContent = "No items to sell";
      this.gridContainer.appendChild(empty);
      return;
    }

    for (const item of sellableItems) {
      const row = this.createItemRow(item, "sell");
      this.gridContainer.appendChild(row);
    }
  }

  private createItemRow(item: ShopItemData, mode: "buy" | "sell"): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px; margin-bottom: 4px; background: rgba(255,255,255,0.04);
      border: 1px solid #333; border-radius: 4px; transition: background 0.15s;
    `;
    row.addEventListener("mouseenter", () => { row.style.background = "rgba(255,255,255,0.08)"; });
    row.addEventListener("mouseleave", () => { row.style.background = "rgba(255,255,255,0.04)"; });

    // Info
    const info = document.createElement("div");
    info.style.cssText = "flex: 1; min-width: 0;";

    const nameEl = document.createElement("div");
    nameEl.style.cssText = "font-size: 12px; font-weight: bold; color: #ddd;";
    nameEl.textContent = item.name;
    info.appendChild(nameEl);

    const descEl = document.createElement("div");
    descEl.style.cssText = "font-size: 10px; color: #999; margin-top: 2px;";
    descEl.textContent = item.description;
    info.appendChild(descEl);

    const priceEl = document.createElement("div");
    priceEl.style.cssText = "font-size: 10px; margin-top: 4px;";
    if (mode === "buy") {
      priceEl.textContent = `Cost: ${item.buyPrice} ${item.resourceType}`;
      priceEl.style.color = item.buyPrice > 0 ? "#e74c3c" : "#2ecc71";
    } else {
      priceEl.textContent = `Gains: ${item.sellPrice} ${item.resourceType}`;
      priceEl.style.color = "#2ecc71";
    }
    info.appendChild(priceEl);

    row.appendChild(info);

    // Controls
    const controls = document.createElement("div");
    controls.style.cssText = "display: flex; align-items: center; gap: 6px; margin-left: 12px;";

    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = "99";
    qtyInput.value = "1";
    qtyInput.style.cssText = `
      width: 40px; padding: 4px; font-size: 11px; text-align: center;
      background: #222; border: 1px solid #555; border-radius: 3px;
      color: #fff; font-family: monospace;
    `;
    controls.appendChild(qtyInput);

    const btn = document.createElement("button");
    btn.style.cssText = `
      padding: 4px 10px; font-size: 11px; font-weight: bold;
      border: 1px solid #555; border-radius: 3px; cursor: pointer;
      font-family: monospace;
    `;
    if (mode === "buy") {
      btn.textContent = "Buy";
      btn.style.background = "#2d5016";
      btn.style.color = "#2ecc71";
      btn.style.borderColor = "#2ecc71";
    } else {
      btn.textContent = "Sell";
      btn.style.background = "#501616";
      btn.style.color = "#e74c3c";
      btn.style.borderColor = "#e74c3c";
    }

    btn.addEventListener("click", () => {
      const count = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      if (mode === "buy" && this.buyHandler && this.currentData) {
        this.buyHandler(this.currentData.shopId, item.itemId, count);
      } else if (mode === "sell" && this.sellHandler) {
        this.sellHandler(item.itemId, count);
      }
    });

    controls.appendChild(btn);
    row.appendChild(controls);

    return row;
  }
}
