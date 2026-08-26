import type { GameState } from "../game/GameState.js";

/** Callback for HUD chat submit. */
export type ChatSubmitHandler = (message: string) => void;

/**
 * Minimal DOM-based HUD overlay on top of the PixiJS canvas.
 *
 * - Health bar (top-left)
 * - Player name + level (below health)
 * - Chat input (bottom center, toggle with Enter)
 * - FPS counter (top-right, debug)
 */
export class HUD {
  private readonly container: HTMLElement;
  private healthBar!: HTMLElement;
  private healthFill!: HTMLElement;
  private playerLabel!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private fpsDisplay!: HTMLElement;
  private chatLog!: HTMLElement;
  private chatSubmitHandler: ChatSubmitHandler | null = null;
  private chatVisible = false;
  private readonly maxChatMessages = 50;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 10;
      font-family: monospace; color: #fff;
    `;
    parent.appendChild(this.container);
    this.build();
  }

  /* ── Construction ── */

  private build(): void {
    // Health bar (top-left)
    const healthWrapper = document.createElement("div");
    healthWrapper.style.cssText = "position:absolute; top:12px; left:12px;";
    this.healthBar = document.createElement("div");
    this.healthBar.style.cssText = `
      width: 180px; height: 16px; background: #333; border: 1px solid #555;
      border-radius: 3px; overflow: hidden;
    `;
    this.healthFill = document.createElement("div");
    this.healthFill.style.cssText = `
      width: 100%; height: 100%; background: #2ecc71; transition: width 0.2s;
    `;
    this.healthBar.appendChild(this.healthFill);
    healthWrapper.appendChild(this.healthBar);
    this.container.appendChild(healthWrapper);

    // Player name + level (below health)
    this.playerLabel = document.createElement("div");
    this.playerLabel.style.cssText = `
      position:absolute; top:34px; left:12px; font-size:13px;
      text-shadow: 1px 1px 2px #000;
    `;
    this.playerLabel.textContent = "Lv.1 Player";
    this.container.appendChild(this.playerLabel);

    // FPS counter (top-right)
    this.fpsDisplay = document.createElement("div");
    this.fpsDisplay.style.cssText = `
      position:absolute; top:12px; right:12px; font-size:12px;
      color: #aaa; text-shadow: 1px 1px 2px #000;
    `;
    this.fpsDisplay.textContent = "FPS: 0";
    this.container.appendChild(this.fpsDisplay);

    // Combat controls hint (top-center)
    const combatHint = document.createElement("div");
    combatHint.style.cssText = `
      position:absolute; top:12px; left:50%; transform:translateX(-50%);
      font-size:12px; color:#ddd; text-shadow:1px 1px 2px #000; white-space:nowrap;
    `;
    combatHint.textContent = "点击/Tab 选怪 · 空格 攻击 · Enter 聊天";
    this.container.appendChild(combatHint);

    // Chat input (bottom center, hidden by default)
    const chatWrapper = document.createElement("div");
    chatWrapper.style.cssText = `
      position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
      display:none; pointer-events:auto;
    `;
    this.chatInput = document.createElement("input");
    this.chatInput.type = "text";
    this.chatInput.placeholder = "Type a message...";
    this.chatInput.maxLength = 200;
    this.chatInput.style.cssText = `
      width: 360px; max-width: 80vw; padding: 8px 12px; font-size: 14px;
      background: rgba(0,0,0,0.7); border: 1px solid #555; border-radius: 4px;
      color: #fff; outline: none; font-family: monospace;
    `;
    this.chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const msg = this.chatInput.value.trim();
        if (msg && this.chatSubmitHandler) {
          this.chatSubmitHandler(msg);
        }
        this.chatInput.value = "";
        this.toggleChat(false);
      }
      if (e.key === "Escape") {
        this.toggleChat(false);
      }
    });
    chatWrapper.appendChild(this.chatInput);
    this.container.appendChild(chatWrapper);

    // Chat log (scrollable message area above input)
    const chatLogWrapper = document.createElement("div");
    chatLogWrapper.style.cssText = `
      position:absolute; bottom:48px; left:50%; transform:translateX(-50%);
      width:360px; max-width:80vw; max-height:180px; overflow-y:auto;
      pointer-events:none; font-size:12px;
    `;
    this.chatLog = document.createElement("div");
    this.chatLog.style.cssText = `
      display:flex; flex-direction:column; gap:2px;
    `;
    chatLogWrapper.appendChild(this.chatLog);
    this.container.appendChild(chatLogWrapper);
  }

  /* ── Public API ── */

  /** Update the health bar (0-100). */
  updateHealth(current: number, max: number): void {
    const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    this.healthFill.style.width = `${pct}%`;

    // Color: green > yellow > red
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

  /** Update the FPS counter. */
  updateFPS(fps: number): void {
    this.fpsDisplay.textContent = `FPS: ${Math.round(fps)}`;
  }

  /** Toggle chat input visibility. */
  toggleChat(visible?: boolean): void {
    this.chatVisible = visible ?? !this.chatVisible;
    const chatWrapper = this.chatInput.parentElement!;
    chatWrapper.style.display = this.chatVisible ? "block" : "none";
    if (this.chatVisible) {
      this.chatInput.focus();
    } else {
      this.chatInput.blur();
    }
  }

  /** Whether chat input is currently visible. */
  isChatVisible(): boolean {
    return this.chatVisible;
  }

  /** Append a chat message to the log display. */
  addChatMessage(sender: string, content: string): void {
    const msg = document.createElement("div");
    msg.style.cssText = "color:#ccc; text-shadow:1px 1px 2px #000;";
    msg.textContent = `${sender}: ${content}`;
    this.chatLog.appendChild(msg);

    // Prune old messages
    while (this.chatLog.children.length > this.maxChatMessages) {
      this.chatLog.removeChild(this.chatLog.firstChild!);
    }

    // Auto-scroll to bottom
    this.chatLog.parentElement!.scrollTop = this.chatLog.parentElement!.scrollHeight;
  }

  /** Register a handler for chat message submission. */
  onChatSubmit(handler: ChatSubmitHandler): void {
    this.chatSubmitHandler = handler;
  }

  /** Clean up DOM elements. */
  destroy(): void {
    this.container.remove();
  }
}
