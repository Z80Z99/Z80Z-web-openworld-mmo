/**
 * Tutorial overlay for guiding new players.
 *
 * Shows contextual hints based on the current quest step:
 * - Move quest: arrow pointing to destination
 * - Kill quest: highlight nearest mob
 * - Collect quest: highlight resource tiles
 *
 * Dismissible after 5 seconds or on player interaction.
 */
export type OverlayType = "arrow" | "highlight" | "hint";

export interface OverlayConfig {
  type: OverlayType;
  message: string;
  /** Screen coordinates for arrow/highlight (optional, updated per frame). */
  targetX?: number;
  targetY?: number;
  /** Radius for highlight effect. */
  highlightRadius?: number;
}

export class TutorialOverlay {
  private readonly container: HTMLElement;
  private arrowEl!: HTMLElement;
  private messageEl!: HTMLElement;
  private highlightEl!: HTMLElement;
  private dismissTimeout: ReturnType<typeof setTimeout> | null = null;
  private visible = false;

  /** Callback when overlay is dismissed. */
  private onDismiss: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "tutorial-overlay";
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 30;
      font-family: monospace; color: #fff;
    `;
    parent.appendChild(this.container);
    this.build();
  }

  private build(): void {
    // Arrow element (CSS triangle pointing to target)
    this.arrowEl = document.createElement("div");
    this.arrowEl.id = "tutorial-arrow";
    this.arrowEl.style.cssText = `
      position: absolute; display: none; pointer-events: none;
      width: 0; height: 0;
      border-left: 12px solid transparent;
      border-right: 12px solid transparent;
      border-bottom: 20px solid #f1c40f;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
      transition: left 0.3s, top 0.3s;
    `;
    this.container.appendChild(this.arrowEl);

    // Highlight circle (pulsing border)
    this.highlightEl = document.createElement("div");
    this.highlightEl.id = "tutorial-highlight";
    this.highlightEl.style.cssText = `
      position: absolute; display: none; pointer-events: none;
      border: 3px solid #f1c40f; border-radius: 50%;
      box-shadow: 0 0 15px rgba(241,196,15,0.5);
      animation: tutorial-pulse 1.5s ease-in-out infinite;
    `;
    this.container.appendChild(this.highlightEl);

    // Inject pulse animation
    if (!document.getElementById("tutorial-styles")) {
      const style = document.createElement("style");
      style.id = "tutorial-styles";
      style.textContent = `
        @keyframes tutorial-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.05); }
        }
      `;
      document.head.appendChild(style);
    }

    // Message banner (bottom-center)
    this.messageEl = document.createElement("div");
    this.messageEl.id = "tutorial-message";
    this.messageEl.style.cssText = `
      position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; background: rgba(0,0,0,0.85); border: 1px solid #f1c40f;
      border-radius: 6px; font-size: 14px; text-align: center;
      pointer-events: auto; cursor: pointer; max-width: 400px;
      transition: opacity 0.3s; display: none;
    `;
    this.messageEl.addEventListener("click", () => this.dismiss());
    this.container.appendChild(this.messageEl);

    // Dismiss button
    const dismissBtn = document.createElement("div");
    dismissBtn.style.cssText = `
      position: absolute; top: 8px; right: 8px; cursor: pointer;
      font-size: 16px; color: #999; pointer-events: auto;
    `;
    dismissBtn.textContent = "✕";
    dismissBtn.addEventListener("click", () => this.dismiss());
    this.messageEl.appendChild(dismissBtn);
  }

  /**
   * Show the overlay with a specific configuration.
   */
  show(config: OverlayConfig): void {
    this.visible = true;
    this.container.style.display = "block";

    // Set message
    this.messageEl.innerHTML = "";
    const msgSpan = document.createElement("span");
    msgSpan.textContent = config.message;
    this.messageEl.appendChild(msgSpan);

    // Re-add dismiss button
    const dismissBtn = document.createElement("div");
    dismissBtn.style.cssText = `
      position: absolute; top: 8px; right: 8px; cursor: pointer;
      font-size: 16px; color: #999; pointer-events: auto;
    `;
    dismissBtn.textContent = "✕";
    dismissBtn.addEventListener("click", () => this.dismiss());
    this.messageEl.appendChild(dismissBtn);

    // Show type-specific elements
    this.arrowEl.style.display = config.type === "arrow" ? "block" : "none";
    this.highlightEl.style.display = config.type === "highlight" ? "block" : "none";

    // Auto-dismiss after 5 seconds
    if (this.dismissTimeout) clearTimeout(this.dismissTimeout);
    this.dismissTimeout = setTimeout(() => this.dismiss(), 5000);
  }

  /**
   * Update the arrow/highlight position (called per frame).
   */
  updatePosition(screenX: number, screenY: number): void {
    if (!this.visible) return;

    if (this.arrowEl.style.display !== "none") {
      this.arrowEl.style.left = `${screenX - 12}px`;
      this.arrowEl.style.top = `${screenY - 30}px`;
    }

    if (this.highlightEl.style.display !== "none") {
      const size = 60;
      this.highlightEl.style.left = `${screenX - size / 2}px`;
      this.highlightEl.style.top = `${screenY - size / 2}px`;
      this.highlightEl.style.width = `${size}px`;
      this.highlightEl.style.height = `${size}px`;
    }
  }

  /**
   * Dismiss the overlay.
   */
  dismiss(): void {
    if (!this.visible) return;
    this.visible = false;
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }
    this.container.style.display = "none";
    this.onDismiss?.();
  }

  /** Register a dismiss callback. */
  onDismissed(handler: () => void): void {
    this.onDismiss = handler;
  }

  /** Whether the overlay is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Clean up DOM elements. */
  destroy(): void {
    if (this.dismissTimeout) clearTimeout(this.dismissTimeout);
    this.container.remove();
  }
}
