/**
 * MountUI — DOM overlay for mount information.
 *
 * Renders:
 *  - Mount icon in HUD (bottom-left)
 *  - Mount name + speed bonus display
 *  - Dismount button (right-click on icon)
 */

/* ── Types ── */

export interface MountData {
  mountId: string;
  name: string;
  speedMultiplier: number;
  rarity: "common" | "uncommon" | "rare" | "legendary";
}

/** Callback for mount actions. */
export type MountActionHandler = (action: "mount" | "dismount", mountId: string) => void;

/* ── Constants ── */

const RARITY_COLORS: Record<string, string> = {
  common: "#aaaaaa",
  uncommon: "#2ecc71",
  rare: "#3498db",
  legendary: "#f39c12",
};

const MOUNT_ICONS: Record<string, string> = {
  horse: "🐴",
  wolf: "🐺",
  eagle: "🦅",
  turtle: "🐢",
};

/* ── MountUI Class ── */

/**
 * DOM-based mount UI overlay.
 *
 * Shows mount indicator in bottom-left corner with:
 * - Mount icon (emoji)
 * - Mount name and speed bonus
 * - Right-click to dismount
 */
export class MountUI {
  private readonly container: HTMLElement;
  private mountIndicator: HTMLElement | null = null;
  private mountIcon: HTMLElement | null = null;
  private mountLabel: HTMLElement | null = null;
  private mountSpeedBonus: HTMLElement | null = null;

  private currentMount: MountData | null = null;
  private mountActionHandler: MountActionHandler | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 12;
      font-family: monospace; color: #fff;
    `;
    parent.appendChild(this.container);
  }

  /* ── Public API ── */

  /**
   * Show mount indicator when player mounts up.
   */
  showMount(mount: MountData): void {
    this.currentMount = mount;
    this.buildMountIndicator();
  }

  /**
   * Hide mount indicator when player dismounts.
   */
  hideMount(): void {
    this.currentMount = null;
    if (this.mountIndicator) {
      this.mountIndicator.remove();
      this.mountIndicator = null;
      this.mountIcon = null;
      this.mountLabel = null;
      this.mountSpeedBonus = null;
    }
  }

  /**
   * Register handler for mount actions (mount/dismount).
   */
  onMountAction(handler: MountActionHandler): void {
    this.mountActionHandler = handler;
  }

  /**
   * Clean up DOM elements.
   */
  destroy(): void {
    this.hideMount();
    this.container.remove();
  }

  /* ── Private ── */

  private buildMountIndicator(): void {
    // Remove existing indicator
    if (this.mountIndicator) {
      this.mountIndicator.remove();
    }

    if (!this.currentMount) return;

    const mount = this.currentMount;

    // Create mount indicator container
    this.mountIndicator = document.createElement("div");
    this.mountIndicator.style.cssText = `
      position: absolute; bottom: 12px; left: 12px;
      pointer-events: auto; cursor: pointer;
      background: rgba(0,0,0,0.7); border: 1px solid ${RARITY_COLORS[mount.rarity]};
      border-radius: 6px; padding: 8px 12px;
      display: flex; align-items: center; gap: 8px;
      transition: transform 0.2s, box-shadow 0.2s;
    `;

    // Hover effect
    this.mountIndicator.addEventListener("mouseenter", () => {
      if (this.mountIndicator) {
        this.mountIndicator.style.transform = "scale(1.05)";
        this.mountIndicator.style.boxShadow = `0 0 12px ${RARITY_COLORS[mount.rarity]}`;
      }
    });

    this.mountIndicator.addEventListener("mouseleave", () => {
      if (this.mountIndicator) {
        this.mountIndicator.style.transform = "scale(1)";
        this.mountIndicator.style.boxShadow = "none";
      }
    });

    // Right-click to dismount
    this.mountIndicator.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.mountActionHandler && this.currentMount) {
        this.mountActionHandler("dismount", this.currentMount.mountId);
      }
    });

    // Mount icon (emoji)
    this.mountIcon = document.createElement("span");
    this.mountIcon.style.cssText = "font-size: 20px;";
    this.mountIcon.textContent = MOUNT_ICONS[mount.mountId] ?? "🐎";
    this.mountIndicator.appendChild(this.mountIcon);

    // Mount info wrapper
    const infoWrapper = document.createElement("div");
    infoWrapper.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

    // Mount name
    this.mountLabel = document.createElement("div");
    this.mountLabel.style.cssText = `
      font-size: 12px; font-weight: bold;
      color: ${RARITY_COLORS[mount.rarity]};
    `;
    this.mountLabel.textContent = mount.name;
    infoWrapper.appendChild(this.mountLabel);

    // Speed bonus
    this.mountSpeedBonus = document.createElement("div");
    this.mountSpeedBonus.style.cssText = "font-size: 10px; color: #aaa;";
    const speedPercent = Math.round((mount.speedMultiplier - 1) * 100);
    this.mountSpeedBonus.textContent = `+${speedPercent}% Speed`;
    infoWrapper.appendChild(this.mountSpeedBonus);

    this.mountIndicator.appendChild(infoWrapper);

    // Add to container
    this.container.appendChild(this.mountIndicator);
  }
}
