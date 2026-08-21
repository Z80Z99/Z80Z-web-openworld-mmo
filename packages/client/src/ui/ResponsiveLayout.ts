export type Breakpoint = "mobile" | "tablet" | "desktop";

export interface BreakpointConfig {
  mobile: number;
  tablet: number;
  desktop: number;
}

const DEFAULT_BREAKPOINTS: BreakpointConfig = {
  mobile: 480,
  tablet: 768,
  desktop: 1024,
};

const RESPONSIVE_STYLES = `
  /* Mobile first (default) */
  #game-container {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
  #game-container canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }
  .hud-container {
    width: 100%;
    font-size: 14px;
  }
  .inventory-sidebar {
    display: none;
  }
  .mobile-controls {
    display: flex;
  }

  /* Tablet: 768px+ */
  @media (min-width: 768px) {
    .hud-container {
      font-size: 16px;
    }
    .mobile-controls {
      display: flex;
    }
  }

  /* Desktop: 1024px+ */
  @media (min-width: 1024px) {
    .hud-container {
      font-size: 18px;
    }
    .inventory-sidebar {
      display: block;
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 280px;
      background: rgba(26, 26, 46, 0.9);
      border-left: 1px solid rgba(233, 69, 96, 0.3);
    }
    .mobile-controls {
      display: none;
    }
  }
`;

export class ResponsiveLayout {
  private breakpoints: BreakpointConfig;
  private currentBreakpoint: Breakpoint;
  private listeners: Array<(bp: Breakpoint) => void> = [];
  private styleElement: HTMLStyleElement | null = null;

  constructor(breakpoints: Partial<BreakpointConfig> = {}) {
    this.breakpoints = { ...DEFAULT_BREAKPOINTS, ...breakpoints };
    this.currentBreakpoint = this.calculateBreakpoint(
      typeof window !== "undefined" ? window.innerWidth : this.breakpoints.desktop,
    );
  }

  init(): void {
    if (typeof window === "undefined") return;

    this.injectStyles();
    this.applyBodyClass();

    window.addEventListener("resize", this.handleResize);
  }

  destroy(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("resize", this.handleResize);
    this.styleElement?.remove();
  }

  getBreakpoint(): Breakpoint {
    return this.currentBreakpoint;
  }

  isMobile(): boolean {
    return this.currentBreakpoint === "mobile";
  }

  isTablet(): boolean {
    return this.currentBreakpoint === "tablet";
  }

  isDesktop(): boolean {
    return this.currentBreakpoint === "desktop";
  }

  onBreakpointChange(callback: (bp: Breakpoint) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /** Update breakpoint from an explicit width (useful for testing). */
  updateWidth(width: number): void {
    const bp = this.calculateBreakpoint(width);
    if (bp !== this.currentBreakpoint) {
      this.currentBreakpoint = bp;
      this.applyBodyClass();
      this.listeners.forEach((l) => l(bp));
    }
  }

  private calculateBreakpoint(width: number): Breakpoint {
    if (width >= this.breakpoints.desktop) return "desktop";
    if (width >= this.breakpoints.tablet) return "tablet";
    return "mobile";
  }

  private handleResize = (): void => {
    const bp = this.calculateBreakpoint(window.innerWidth);
    if (bp !== this.currentBreakpoint) {
      this.currentBreakpoint = bp;
      this.applyBodyClass();
      this.listeners.forEach((l) => l(bp));
    }
  };

  private applyBodyClass(): void {
    if (typeof document === "undefined") return;
    const body = document.body;
    body.classList.remove("owmmo-mobile", "owmmo-tablet", "owmmo-desktop");
    body.classList.add(`owmmo-${this.currentBreakpoint}`);
  }

  private injectStyles(): void {
    if (typeof document === "undefined") return;
    this.styleElement = document.createElement("style");
    this.styleElement.textContent = RESPONSIVE_STYLES;
    document.head.appendChild(this.styleElement);
  }
}
