/** Callback for mobile chat toggle. */
export type ChatToggleHandler = () => void;

/** Constants for mobile HUD sizing. */
const UI_OPACITY = 0.7;
const MIN_TOUCH_TARGET = 44;

/**
 * Mobile-optimized HUD layout.
 *
 * Provides a responsive overlay for touch devices:
 * - Full-width health bar at top
 * - Level + player name below health bar
 * - Minimap placeholder (top-right)
 * - Chat toggle button (bottom-center)
 * - All elements respect safe area insets and scale with viewport
 */
export class MobileUI {
  private readonly container: HTMLElement;
  private healthFill!: HTMLElement;
  private healthText!: HTMLElement;
  private playerLabel!: HTMLElement;
  private minimapPlaceholder!: HTMLElement;
  private chatToggleBtn!: HTMLElement;
  private chatToggleHandler: ChatToggleHandler | null = null;
  private chatOpen = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "mobile-ui";
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 15;
      font-family: monospace; color: #fff;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    `;
    parent.appendChild(this.container);
    this.build();
  }

  /* ── Construction ── */

  private build(): void {
    this.buildHealthBar();
    this.buildPlayerLabel();
    this.buildMinimap();
    this.buildChatToggle();
  }

  private buildHealthBar(): void {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:absolute; top:8px; left:0; right:0; padding:0 12px;";

    const bar = document.createElement("div");
    bar.style.cssText = `
      width: 100%; height: 20px; background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.3); border-radius: 4px;
      overflow: hidden; position: relative;
    `;

    this.healthFill = document.createElement("div");
    this.healthFill.style.cssText = `
      width: 100%; height: 100%; background: #2ecc71;
      transition: width 0.2s;
    `;
    bar.appendChild(this.healthFill);

    this.healthText = document.createElement("div");
    this.healthText.style.cssText = `
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: center; font-size: 12px; text-shadow: 1px 1px 2px #000;
    `;
    this.healthText.textContent = "100 / 100";
    bar.appendChild(this.healthText);

    wrapper.appendChild(bar);
    this.container.appendChild(wrapper);
  }

  private buildPlayerLabel(): void {
    this.playerLabel = document.createElement("div");
    this.playerLabel.style.cssText = `
      position: absolute; top: 36px; left: 12px;
      font-size: 14px; text-shadow: 1px 1px 2px #000;
    `;
    this.playerLabel.textContent = "Lv.1 Player";
    this.container.appendChild(this.playerLabel);
  }

  private buildMinimap(): void {
    this.minimapPlaceholder = document.createElement("div");
    this.minimapPlaceholder.style.cssText = `
      position: absolute; top: 8px; right: 12px;
      width: 80px; height: 80px;
      background: rgba(0,0,0,${UI_OPACITY * 0.5});
      border: 1px solid rgba(255,255,255,${UI_OPACITY * 0.5});
      border-radius: 4px; display: flex; align-items: center;
      justify-content: center; font-size: 10px; color: rgba(255,255,255,0.5);
    `;
    this.minimapPlaceholder.textContent = "MAP";
    this.container.appendChild(this.minimapPlaceholder);
  }

  private buildChatToggle(): void {
    this.chatToggleBtn = document.createElement("button");
    this.chatToggleBtn.id = "mobile-chat-toggle";
    this.chatToggleBtn.setAttribute("aria-label", "Toggle chat");
    this.chatToggleBtn.style.cssText = `
      position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
      width: ${MIN_TOUCH_TARGET}px; height: ${MIN_TOUCH_TARGET}px;
      border-radius: 50%; border: 2px solid rgba(255,255,255,${UI_OPACITY * 0.5});
      background: rgba(255,255,255,${UI_OPACITY * 0.3});
      color: #fff; font-size: 18px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto; user-select: none; -webkit-user-select: none;
      touch-action: manipulation;
    `;
    this.chatToggleBtn.textContent = "\u{1F4AC}"; // 💬
    this.chatToggleBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.chatOpen = !this.chatOpen;
      if (this.chatToggleHandler) {
        this.chatToggleHandler();
      }
    }, { passive: false });

    this.container.appendChild(this.chatToggleBtn);
  }

  /* ── Public API ── */

  /** Update health bar display. */
  updateHealth(current: number, max: number): void {
    const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    this.healthFill.style.width = `${pct}%`;
    this.healthText.textContent = `${Math.round(current)} / ${Math.round(max)}`;

    if (pct > 60) {
      this.healthFill.style.background = "#2ecc71";
    } else if (pct > 30) {
      this.healthFill.style.background = "#f1c40f";
    } else {
      this.healthFill.style.background = "#e74c3c";
    }
  }

  /** Update player name and level. */
  updatePlayerInfo(name: string, level: number): void {
    this.playerLabel.textContent = `Lv.${level} ${name || "Unknown"}`;
  }

  /** Register a handler for chat toggle. */
  onChatToggle(handler: ChatToggleHandler): void {
    this.chatToggleHandler = handler;
  }

  /** Clean up DOM elements. */
  destroy(): void {
    this.container.remove();
  }
}
