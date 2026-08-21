/* ── Types ── */

export interface IdleUIData {
  readonly hours: number;
  readonly resources: Readonly<Record<string, number>>;
}

export type IdleClaimHandler = () => void;

/* ── Constants ── */

const RESOURCE_ICONS: Record<string, string> = {
  Wood: "\u{1FAB5}",   // 🪵
  Herb: "\u{1F33F}",   // 🌿
  Sand: "\u{1F3DC}\uFE0F", // 🏜️
  Stone: "\u{1FAA8}",  // 🪨
};

/* ── IdleUI Class ── */

/**
 * DOM overlay shown on login when the player has offline idle rewards.
 *
 * Displays a "Welcome back!" modal with accumulated resources, total
 * offline time, and a Claim button. Auto-dismisses after 30 seconds
 * (triggering an auto-claim).
 */
export class IdleUI {
  private readonly container: HTMLElement;
  private panel!: HTMLElement;
  private claimHandler: IdleClaimHandler | null = null;
  private dismissTimeout: ReturnType<typeof setTimeout> | null = null;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "idle-ui";
    this.container.style.cssText = `
      position: absolute; inset: 0; z-index: 60;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.6); pointer-events: auto;
    `;
    parent.appendChild(this.container);
    this.build();
  }

  /* ── Construction ── */

  private build(): void {
    this.panel = document.createElement("div");
    this.panel.style.cssText = `
      width: 320px; padding: 24px;
      background: rgba(15,12,8,0.95); border: 2px solid #f1c40f;
      border-radius: 12px; font-family: monospace; color: #fff;
      text-align: center;
    `;
    this.container.appendChild(this.panel);
  }

  /* ── Public API ── */

  /** Show the idle reward modal with data. */
  show(data: IdleUIData): void {
    this.visible = true;
    this.panel.innerHTML = "";

    // Title
    const title = document.createElement("div");
    title.style.cssText =
      "font-size: 18px; font-weight: bold; color: #f1c40f; margin-bottom: 12px;";
    title.textContent = "Welcome back!";
    this.panel.appendChild(title);

    // Offline time
    const timeEl = document.createElement("div");
    timeEl.style.cssText = "font-size: 12px; color: #aaa; margin-bottom: 16px;";
    const hrs = Math.round(data.hours * 10) / 10;
    timeEl.textContent = `You were offline for ${hrs} hour${hrs !== 1 ? "s" : ""}`;
    this.panel.appendChild(timeEl);

    // Resources list
    const resourceList = document.createElement("div");
    resourceList.style.cssText = "margin-bottom: 16px;";
    for (const [resource, amount] of Object.entries(data.resources)) {
      if (amount <= 0) continue;
      const row = document.createElement("div");
      row.style.cssText = `
        display: flex; align-items: center; justify-content: center;
        gap: 8px; padding: 6px 0; font-size: 14px;
      `;
      const icon = document.createElement("span");
      icon.textContent = RESOURCE_ICONS[resource] ?? "\u{1F4E6}"; // 📦 fallback
      const label = document.createElement("span");
      label.textContent = `${amount} ${resource}`;
      label.style.color = "#2ecc71";
      row.appendChild(icon);
      row.appendChild(label);
      resourceList.appendChild(row);
    }
    this.panel.appendChild(resourceList);

    // Claim button
    const btn = document.createElement("button");
    btn.textContent = "Claim Rewards";
    btn.style.cssText = `
      padding: 10px 24px; font-size: 14px; font-weight: bold;
      background: #2d5016; color: #2ecc71; border: 2px solid #2ecc71;
      border-radius: 6px; cursor: pointer; font-family: monospace;
      transition: background 0.15s;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#3a6b1e";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#2d5016";
    });
    btn.addEventListener("click", () => this.claim());
    this.panel.appendChild(btn);

    this.container.style.display = "flex";

    // Auto-dismiss after 30 seconds (auto-claims)
    if (this.dismissTimeout) clearTimeout(this.dismissTimeout);
    this.dismissTimeout = setTimeout(() => this.claim(), 30_000);
  }

  /** Hide the modal. */
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }
    this.container.style.display = "none";
  }

  /** Trigger claim (hide + fire handler). */
  claim(): void {
    if (!this.visible) return;
    this.hide();
    this.claimHandler?.();
  }

  /** Register a claim callback. */
  onClaim(handler: IdleClaimHandler): void {
    this.claimHandler = handler;
  }

  /** Whether the modal is currently visible. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Clean up DOM elements. */
  destroy(): void {
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }
    this.visible = false;
    this.container.remove();
  }
}
