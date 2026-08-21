/**
 * TradeUI — DOM overlay for the player-to-player trade window.
 *
 * Renders:
 *  - Modal overlay with both players' item panels
 *  - Add/remove item controls
 *  - Confirm and Cancel buttons
 *  - Trade status indicator
 */

/* ── Types ── */

export type TradeStatus = "pending" | "reviewing" | "executing" | "complete" | "cancelled";

export interface TradeItem {
  id: string;
  quantity: number;
}

export interface TradeUIData {
  tradeId: string;
  playerName: string;
  otherPlayerName: string;
  myItems: TradeItem[];
  theirItems: TradeItem[];
  myConfirmed: boolean;
  theirConfirmed: boolean;
  status: TradeStatus;
}

/* ── Callbacks ── */

export type TradeItemHandler = (tradeId: string, itemId: string, count: number) => void;
export type TradeConfirmHandler = (tradeId: string) => void;
export type TradeCancelHandler = (tradeId: string) => void;

/* ── TradeUI Class ── */

export class TradeUI {
  private readonly container: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly modal: HTMLElement;
  private myItemsPanel!: HTMLElement;
  private theirItemsPanel!: HTMLElement;
  private statusIndicator!: HTMLElement;
  private confirmButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;

  private tradeData: TradeUIData | null = null;
  private myConfirmed = false;

  private addItemHandler: TradeItemHandler | null = null;
  private removeItemHandler: TradeItemHandler | null = null;
  private confirmHandler: TradeConfirmHandler | null = null;
  private cancelHandler: TradeCancelHandler | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 25;
      font-family: monospace; color: #fff; display: none;
    `;
    parent.appendChild(this.container);

    this.backdrop = document.createElement("div");
    this.backdrop.style.cssText = `
      position: absolute; inset: 0; background: rgba(0,0,0,0.6);
      pointer-events: auto; cursor: pointer;
    `;
    this.backdrop.addEventListener("click", () => this.cancel());
    this.container.appendChild(this.backdrop);

    this.modal = document.createElement("div");
    this.modal.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 600px; max-width: 90vw; background: #1a1a2e; border: 2px solid #555;
      border-radius: 8px; padding: 20px; pointer-events: auto;
    `;
    this.container.appendChild(this.modal);

    this.build();
  }

  /* ── Construction ── */

  private build(): void {
    // Title
    const title = document.createElement("div");
    title.style.cssText = `
      font-size: 18px; font-weight: bold; text-align: center;
      margin-bottom: 16px; color: #e0e0e0;
    `;
    title.textContent = "Trade";
    this.modal.appendChild(title);

    // Status indicator
    this.statusIndicator = document.createElement("div");
    this.statusIndicator.style.cssText = `
      text-align: center; font-size: 12px; color: #aaa;
      margin-bottom: 12px; padding: 4px 8px; background: #111;
      border-radius: 4px; display: inline-block;
      margin-left: 50%; transform: translateX(-50%);
    `;
    this.statusIndicator.textContent = "Pending";
    this.modal.appendChild(this.statusIndicator);

    // Trade panels container
    const panels = document.createElement("div");
    panels.style.cssText = `
      display: flex; gap: 16px; margin-bottom: 16px;
    `;

    // My items panel
    this.myItemsPanel = this.createItemsPanel("Your Items");
    panels.appendChild(this.myItemsPanel);

    // Divider
    const divider = document.createElement("div");
    divider.style.cssText = `
      width: 2px; background: #444; align-self: stretch;
    `;
    panels.appendChild(divider);

    // Their items panel
    this.theirItemsPanel = this.createItemsPanel("Their Items");
    panels.appendChild(this.theirItemsPanel);

    this.modal.appendChild(panels);

    // Buttons
    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = `
      display: flex; justify-content: center; gap: 12px;
    `;

    this.confirmButton = document.createElement("button");
    this.confirmButton.textContent = "Confirm";
    this.confirmButton.style.cssText = `
      padding: 8px 24px; font-size: 14px; font-family: monospace;
      background: #2ecc71; color: #fff; border: none; border-radius: 4px;
      cursor: pointer; transition: background 0.2s;
    `;
    this.confirmButton.addEventListener("click", () => this.confirm());
    buttonRow.appendChild(this.confirmButton);

    this.cancelButton = document.createElement("button");
    this.cancelButton.textContent = "Cancel";
    this.cancelButton.style.cssText = `
      padding: 8px 24px; font-size: 14px; font-family: monospace;
      background: #e74c3c; color: #fff; border: none; border-radius: 4px;
      cursor: pointer; transition: background 0.2s;
    `;
    this.cancelButton.addEventListener("click", () => this.cancel());
    buttonRow.appendChild(this.cancelButton);

    this.modal.appendChild(buttonRow);
  }

  private createItemsPanel(label: string): HTMLElement {
    const panel = document.createElement("div");
    panel.style.cssText = `
      flex: 1; background: #111; border-radius: 4px; padding: 12px;
      min-height: 150px;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      font-size: 14px; font-weight: bold; margin-bottom: 8px;
      color: #ccc; border-bottom: 1px solid #333; padding-bottom: 4px;
    `;
    header.textContent = label;
    panel.appendChild(header);

    const itemsList = document.createElement("div");
    itemsList.className = "trade-items-list";
    itemsList.style.cssText = `
      display: flex; flex-direction: column; gap: 4px;
    `;
    panel.appendChild(itemsList);

    return panel;
  }

  /* ── Public API ── */

  /**
   * Show the trade window with current trade data.
   */
  show(data: TradeUIData): void {
    this.tradeData = data;
    this.myConfirmed = data.myConfirmed;
    this.container.style.display = "block";
    this.update(data);
  }

  /**
   * Hide the trade window.
   */
  hide(): void {
    this.container.style.display = "none";
    this.tradeData = null;
    this.myConfirmed = false;
  }

  /**
   * Update the trade display with new data.
   */
  update(data: TradeUIData): void {
    this.tradeData = data;
    this.myConfirmed = data.myConfirmed;

    // Update title
    const title = this.modal.querySelector("div:first-child");
    if (title) {
      title.textContent = `Trade with ${data.otherPlayerName}`;
    }

    // Update status
    this.updateStatus(data.status, data.myConfirmed, data.theirConfirmed);

    // Update item panels
    this.updateItemsPanel(this.myItemsPanel, data.myItems, true);
    this.updateItemsPanel(this.theirItemsPanel, data.theirItems, false);

    // Update buttons
    this.updateButtons(data);
  }

  /**
   * Register handler for adding items.
   */
  onAddItem(handler: TradeItemHandler): void {
    this.addItemHandler = handler;
  }

  /**
   * Register handler for removing items.
   */
  onRemoveItem(handler: TradeItemHandler): void {
    this.removeItemHandler = handler;
  }

  /**
   * Register handler for confirming trade.
   */
  onConfirm(handler: TradeConfirmHandler): void {
    this.confirmHandler = handler;
  }

  /**
   * Register handler for cancelling trade.
   */
  onCancel(handler: TradeCancelHandler): void {
    this.cancelHandler = handler;
  }

  /**
   * Whether the trade window is visible.
   */
  isVisible(): boolean {
    return this.container.style.display !== "none";
  }

  /**
   * Clean up DOM elements.
   */
  destroy(): void {
    this.container.remove();
  }

  /* ── Private ── */

  private updateStatus(status: TradeStatus, myConfirmed: boolean, theirConfirmed: boolean): void {
    let text = "";
    let color = "#aaa";

    switch (status) {
      case "pending":
        text = "Adding items...";
        color = "#f1c40f";
        break;
      case "reviewing":
        text = "Reviewing trade...";
        color = "#3498db";
        break;
      case "executing":
        text = "Executing trade...";
        color = "#9b59b6";
        break;
      case "complete":
        text = "Trade complete!";
        color = "#2ecc71";
        break;
      case "cancelled":
        text = "Trade cancelled.";
        color = "#e74c3c";
        break;
    }

    if (status === "pending" && (myConfirmed || theirConfirmed)) {
      const confirmedCount = (myConfirmed ? 1 : 0) + (theirConfirmed ? 1 : 0);
      text = `Waiting for other player... (${confirmedCount}/2 confirmed)`;
      color = "#3498db";
    }

    this.statusIndicator.textContent = text;
    this.statusIndicator.style.color = color;
  }

  private updateItemsPanel(panel: HTMLElement, items: TradeItem[], isMySide: boolean): void {
    const itemsList = panel.querySelector(".trade-items-list");
    if (!itemsList) return;

    itemsList.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = `
        color: #666; font-size: 12px; text-align: center;
        padding: 20px 0; font-style: italic;
      `;
      empty.textContent = "No items added";
      itemsList.appendChild(empty);
      return;
    }

    for (const item of items) {
      const itemRow = document.createElement("div");
      itemRow.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        padding: 4px 8px; background: #222; border-radius: 3px;
      `;

      const nameSpan = document.createElement("span");
      nameSpan.style.cssText = "font-size: 12px; color: #ddd;";
      nameSpan.textContent = item.id;
      itemRow.appendChild(nameSpan);

      const countSpan = document.createElement("span");
      countSpan.style.cssText = "font-size: 12px; color: #aaa;";
      countSpan.textContent = `x${item.quantity}`;
      itemRow.appendChild(countSpan);

      if (isMySide && !this.myConfirmed) {
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "×";
        removeBtn.style.cssText = `
          background: none; border: none; color: #e74c3c; cursor: pointer;
          font-size: 14px; padding: 0 4px; margin-left: 8px;
        `;
        removeBtn.addEventListener("click", () => {
          if (this.tradeData && this.removeItemHandler) {
            this.removeItemHandler(this.tradeData.tradeId, item.id, item.quantity);
          }
        });
        itemRow.appendChild(removeBtn);
      }

      itemsList.appendChild(itemRow);
    }
  }

  private updateButtons(data: TradeUIData): void {
    const canConfirm = data.status === "pending" && !this.myConfirmed && data.myItems.length > 0;
    this.confirmButton.disabled = !canConfirm;
    this.confirmButton.style.opacity = canConfirm ? "1" : "0.5";
    this.confirmButton.style.cursor = canConfirm ? "pointer" : "not-allowed";

    if (this.myConfirmed) {
      this.confirmButton.textContent = "Confirmed ✓";
      this.confirmButton.style.background = "#555";
    } else {
      this.confirmButton.textContent = "Confirm";
      this.confirmButton.style.background = "#2ecc71";
    }

    const canCancel = data.status === "pending" || data.status === "reviewing";
    this.cancelButton.disabled = !canCancel;
    this.cancelButton.style.opacity = canCancel ? "1" : "0.5";
    this.cancelButton.style.cursor = canCancel ? "pointer" : "not-allowed";
  }

  private confirm(): void {
    if (!this.tradeData || this.myConfirmed) return;
    if (this.confirmHandler) {
      this.confirmHandler(this.tradeData.tradeId);
    }
  }

  private cancel(): void {
    if (!this.tradeData) return;
    if (this.cancelHandler) {
      this.cancelHandler(this.tradeData.tradeId);
    }
    this.hide();
  }
}
