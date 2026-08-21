const INDICATOR_STYLES = `
  #pwa-offline-indicator {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10000;
    padding: 8px 16px;
    text-align: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 600;
    transform: translateY(-100%);
    transition: transform 0.3s ease;
    pointer-events: none;
  }
  #pwa-offline-indicator.visible {
    transform: translateY(0);
  }
  #pwa-offline-indicator.offline {
    background: #e94560;
    color: white;
  }
  #pwa-offline-indicator.reconnecting {
    background: #f0a500;
    color: #1a1a2e;
  }
  #pwa-offline-indicator.online {
    background: #00c853;
    color: #1a1a2e;
  }
`;

export class OfflineIndicator {
  private element: HTMLDivElement;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.id = "pwa-offline-indicator";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");

    const style = document.createElement("style");
    style.textContent = INDICATOR_STYLES;
    document.head.appendChild(style);
    document.body.appendChild(this.element);

    window.addEventListener("online", () => this.showReconnecting());
    window.addEventListener("offline", () => this.showOffline());

    // Initial state
    if (!navigator.onLine) {
      this.showOffline();
    }
  }

  showOffline(): void {
    this.clearHideTimeout();
    this.element.textContent = "Offline";
    this.element.className = "offline visible";
  }

  showReconnecting(): void {
    this.clearHideTimeout();
    this.element.textContent = "Reconnecting...";
    this.element.className = "reconnecting visible";
  }

  showOnline(): void {
    this.clearHideTimeout();
    this.element.textContent = "Connected";
    this.element.className = "online visible";
    this.hideTimeout = setTimeout(() => this.hide(), 2000);
  }

  hide(): void {
    this.element.classList.remove("visible");
  }

  private clearHideTimeout(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  destroy(): void {
    this.clearHideTimeout();
    this.element.remove();
  }
}
