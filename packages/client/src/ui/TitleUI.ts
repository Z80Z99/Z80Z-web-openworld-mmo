/**
 * TitleUI — DOM overlay for player title display.
 *
 * Renders:
 *  - Title displayed below player name in HUD
 *  - Title change notification on level up (toast)
 */

/* ── Types ── */

export interface TitleUIData {
  title: string;
  level: number;
}

/* ── Constants ── */

const TOAST_DURATION_MS = 3000;

/* ── TitleUI Class ── */

export class TitleUI {
  private readonly container: HTMLElement;
  private titleEl!: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "title-ui";
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 11;
      font-family: monospace; color: #fff;
    `;
    parent.appendChild(this.container);
    this.build();
  }

  /* ── Construction ── */

  private build(): void {
    // Title label (positioned below the HUD player name area)
    this.titleEl = document.createElement("div");
    this.titleEl.id = "player-title";
    this.titleEl.style.cssText = `
      position: absolute; top: 52px; left: 12px;
      font-size: 11px; color: #f39c12;
      text-shadow: 1px 1px 2px #000;
    `;
    this.titleEl.textContent = "";
    this.container.appendChild(this.titleEl);
  }

  /* ── Public API ── */

  /**
   * Update the displayed title.
   */
  update(data: TitleUIData): void {
    if (data.title) {
      this.titleEl.textContent = data.title;
      this.titleEl.style.display = "block";
    } else {
      this.titleEl.textContent = "";
      this.titleEl.style.display = "none";
    }
  }

  /**
   * Show a toast notification when a new title is unlocked.
   */
  showTitleUnlock(newTitle: string, oldTitle: string): void {
    // Remove existing toast
    this.removeToast();

    const toast = document.createElement("div");
    toast.style.cssText = `
      position: absolute; top: 80px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; background: rgba(0,0,0,0.85);
      border: 1px solid #f39c12; border-radius: 6px;
      font-size: 13px; color: #f39c12; text-align: center;
      animation: toast-in 0.3s ease-out;
      white-space: nowrap;
    `;

    const label = document.createElement("div");
    label.style.cssText = "font-size: 10px; color: #aaa; margin-bottom: 4px;";
    label.textContent = "New Title Unlocked!";
    toast.appendChild(label);

    const titleText = document.createElement("div");
    titleText.style.cssText = "font-size: 15px; font-weight: bold;";
    titleText.textContent = newTitle;
    toast.appendChild(titleText);

    this.container.appendChild(toast);
    this.toastEl = toast;

    // Auto-dismiss
    this.toastTimeout = setTimeout(() => this.removeToast(), TOAST_DURATION_MS);
  }

  /**
   * Clean up DOM elements.
   */
  destroy(): void {
    this.removeToast();
    this.container.remove();
  }

  /* ── Private ── */

  private removeToast(): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    if (this.toastEl) {
      this.toastEl.remove();
      this.toastEl = null;
    }
  }
}
