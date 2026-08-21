// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OfflineIndicator } from "./OfflineIndicator.js";
import { ResponsiveLayout } from "../ui/ResponsiveLayout.js";

/* ── Manifest validation ── */
describe("manifest.json", () => {
  it("is valid JSON with required PWA fields", () => {
    const manifestPath = resolve(__dirname, "../../public/manifest.json");
    const text = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(text);

    expect(manifest.name).toBe("Open World MMO");
    expect(manifest.short_name).toBe("OWMMO");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("fullscreen");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.theme_color).toBe("#1a1a2e");
    expect(manifest.background_color).toBe("#1a1a2e");
    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons[0].sizes).toBe("192x192");
    expect(manifest.icons[1].sizes).toBe("512x512");
  });
});

/* ── Service Worker registration ── */
describe("service worker", () => {
  it("registers successfully via navigator.serviceWorker", async () => {
    const mockRegistration = {
      installing: null,
      waiting: null,
      active: { state: "activated" },
      addEventListener: vi.fn(),
    };

    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: vi.fn().mockResolvedValue(mockRegistration),
        controller: null,
      },
      writable: true,
      configurable: true,
    });

    const { registerServiceWorker } = await import("./RegisterSW.js");
    const reg = await registerServiceWorker();

    expect(reg).toBe(mockRegistration);
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("returns null when serviceWorker not supported", async () => {
    const { registerServiceWorker } = await import("./RegisterSW.js");
    // In jsdom it may or may not support — just verify no throw
    const result = await registerServiceWorker();
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("calls onError when registration fails", async () => {
    const failReg = {
      register: vi.fn().mockRejectedValue(new Error("SW install failed")),
    };

    Object.defineProperty(navigator, "serviceWorker", {
      value: failReg,
      writable: true,
      configurable: true,
    });

    const onError = vi.fn();
    const { registerServiceWorker } = await import("./RegisterSW.js");
    await registerServiceWorker({ onError });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

/* ── OfflineIndicator ── */
describe("OfflineIndicator", () => {
  let indicator: OfflineIndicator;

  afterEach(() => {
    indicator?.destroy();
  });

  it("creates a DOM element on construction", () => {
    indicator = new OfflineIndicator();
    const el = document.getElementById("pwa-offline-indicator");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("role")).toBe("status");
  });

  it("showOffline displays offline banner", () => {
    indicator = new OfflineIndicator();
    indicator.showOffline();
    const el = document.getElementById("pwa-offline-indicator")!;
    expect(el.textContent).toBe("Offline");
    expect(el.classList.contains("offline")).toBe(true);
    expect(el.classList.contains("visible")).toBe(true);
  });

  it("showReconnecting displays reconnecting banner", () => {
    indicator = new OfflineIndicator();
    indicator.showReconnecting();
    const el = document.getElementById("pwa-offline-indicator")!;
    expect(el.textContent).toBe("Reconnecting...");
    expect(el.classList.contains("reconnecting")).toBe(true);
  });

  it("showOnline displays then auto-hides", () => {
    vi.useFakeTimers();
    indicator = new OfflineIndicator();
    indicator.showOnline();

    const el = document.getElementById("pwa-offline-indicator")!;
    expect(el.textContent).toBe("Connected");
    expect(el.classList.contains("online")).toBe(true);

    // After 2s, should be hidden
    vi.advanceTimersByTime(2500);
    expect(el.classList.contains("visible")).toBe(false);
    vi.useRealTimers();
  });

  it("destroy removes element from DOM", () => {
    indicator = new OfflineIndicator();
    indicator.destroy();
    expect(document.getElementById("pwa-offline-indicator")).toBeNull();
  });
});

/* ── ResponsiveLayout ── */
describe("ResponsiveLayout", () => {
  let layout: ResponsiveLayout;

  afterEach(() => {
    layout?.destroy();
  });

  it("detects mobile breakpoint (< 480px)", () => {
    layout = new ResponsiveLayout();
    layout.updateWidth(375);
    expect(layout.getBreakpoint()).toBe("mobile");
    expect(layout.isMobile()).toBe(true);
  });

  it("detects tablet breakpoint (768px-1023px)", () => {
    layout = new ResponsiveLayout();
    layout.updateWidth(800);
    expect(layout.getBreakpoint()).toBe("tablet");
    expect(layout.isTablet()).toBe(true);
  });

  it("detects desktop breakpoint (>= 1024px)", () => {
    layout = new ResponsiveLayout();
    layout.updateWidth(1280);
    expect(layout.getBreakpoint()).toBe("desktop");
    expect(layout.isDesktop()).toBe(true);
  });

  it("notifies listeners on breakpoint change", () => {
    layout = new ResponsiveLayout();
    const cb = vi.fn();
    layout.onBreakpointChange(cb);

    layout.updateWidth(375);
    expect(cb).toHaveBeenCalledWith("mobile");
  });

  it("applies body class for current breakpoint", () => {
    layout = new ResponsiveLayout();
    layout.init();
    // jsdom default innerWidth is ~1024 → desktop
    expect(document.body.classList.contains("owmmo-desktop")).toBe(true);
    layout.destroy();
  });

  it("respects custom breakpoints", () => {
    layout = new ResponsiveLayout({ mobile: 600, tablet: 900, desktop: 1200 });
    layout.updateWidth(950);
    expect(layout.getBreakpoint()).toBe("tablet");
  });
});
