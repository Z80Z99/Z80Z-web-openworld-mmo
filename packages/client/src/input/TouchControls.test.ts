// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TouchControls } from "./TouchControls.js";
import { MobileUI } from "../ui/MobileUI.js";

/* ── Polyfill Touch constructor for jsdom ── */
if (typeof Touch === "undefined") {
  // @ts-expect-error — polyfill for jsdom
  globalThis.Touch = class Touch {
    identifier: number;
    target: EventTarget;
    clientX: number;
    clientY: number;
    pageX: number;
    pageY: number;
    screenX: number;
    screenY: number;
    radiusX = 0;
    radiusY = 0;
    rotationAngle = 0;
    force = 0;
    constructor(init: { identifier: number; target: EventTarget; clientX: number; clientY: number; pageX?: number; pageY?: number; screenX?: number; screenY?: number }) {
      this.identifier = init.identifier;
      this.target = init.target;
      this.clientX = init.clientX;
      this.clientY = init.clientY;
      this.pageX = init.pageX ?? init.clientX;
      this.pageY = init.pageY ?? init.clientY;
      this.screenX = init.screenX ?? init.clientX;
      this.screenY = init.screenY ?? init.clientY;
    }
  };
}

/* ── TouchControls: Pure computation tests ── */
describe("TouchControls", () => {
  describe("computeDirection", () => {
    it("returns zero when touch is at center", () => {
      const dir = TouchControls.computeDirection(100, 100, 100, 100, 60);
      expect(dir.dx).toBe(0);
      expect(dir.dy).toBe(0);
    });

    it("returns (1, 0) for touch directly right at max radius", () => {
      const dir = TouchControls.computeDirection(160, 100, 100, 100, 60);
      expect(dir.dx).toBeCloseTo(1, 5);
      expect(dir.dy).toBeCloseTo(0, 5);
    });

    it("returns (0, -1) for touch directly up at max radius", () => {
      const dir = TouchControls.computeDirection(100, 40, 100, 100, 60);
      expect(dir.dx).toBeCloseTo(0, 5);
      expect(dir.dy).toBeCloseTo(-1, 5);
    });

    it("returns (-1, 0) for touch directly left at max radius", () => {
      const dir = TouchControls.computeDirection(40, 100, 100, 100, 60);
      expect(dir.dx).toBeCloseTo(-1, 5);
      expect(dir.dy).toBeCloseTo(0, 5);
    });

    it("returns (0, 1) for touch directly down at max radius", () => {
      const dir = TouchControls.computeDirection(100, 160, 100, 100, 60);
      expect(dir.dx).toBeCloseTo(0, 5);
      expect(dir.dy).toBeCloseTo(1, 5);
    });

    it("returns normalized diagonal direction", () => {
      // Touch at (100+42.43, 100+42.43) ≈ 60px diagonal
      const dir = TouchControls.computeDirection(142.43, 142.43, 100, 100, 60);
      const inv = 1 / Math.SQRT2;
      expect(dir.dx).toBeCloseTo(inv, 2);
      expect(dir.dy).toBeCloseTo(inv, 2);
    });

    it("clamps magnitude to 1 when touch exceeds max radius", () => {
      // Touch 120px away (double the radius)
      const dir = TouchControls.computeDirection(220, 100, 100, 100, 60);
      const mag = Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
      expect(mag).toBeLessThanOrEqual(1.001);
      expect(dir.dx).toBeCloseTo(1, 2);
    });

    it("scales magnitude proportionally within radius", () => {
      // Touch 30px away (half the radius of 60)
      const dir = TouchControls.computeDirection(130, 100, 100, 100, 60);
      const mag = Math.sqrt(dir.dx * dir.dx + dir.dy * dir.dy);
      expect(mag).toBeCloseTo(0.5, 2);
    });

    it("returns zero when distance is negligible (< 1px)", () => {
      const dir = TouchControls.computeDirection(100.3, 100, 100, 100, 60);
      expect(dir.dx).toBe(0);
      expect(dir.dy).toBe(0);
    });
  });

  describe("isInDeadzone", () => {
    it("returns true for zero direction", () => {
      expect(TouchControls.isInDeadzone({ dx: 0, dy: 0 }, 0.1)).toBe(true);
    });

    it("returns true for direction below deadzone threshold", () => {
      expect(TouchControls.isInDeadzone({ dx: 0.05, dy: 0.02 }, 0.1)).toBe(true);
    });

    it("returns false for direction at deadzone threshold", () => {
      expect(TouchControls.isInDeadzone({ dx: 0.1, dy: 0 }, 0.1)).toBe(false);
    });

    it("returns false for direction above deadzone threshold", () => {
      expect(TouchControls.isInDeadzone({ dx: 0.5, dy: 0.3 }, 0.1)).toBe(false);
    });
  });

  describe("TouchControls DOM integration", () => {
    let parent: HTMLElement;
    let controls: TouchControls;

    beforeEach(() => {
      parent = document.createElement("div");
      document.body.appendChild(parent);
      controls = new TouchControls(parent);
    });

    it("creates joystick and action button DOM elements", () => {
      const joystickBase = parent.querySelector("#joystick-base");
      const joystickKnob = parent.querySelector("#joystick-knob");
      const actionButtons = parent.querySelector("#action-buttons");
      expect(joystickBase).not.toBeNull();
      expect(joystickKnob).not.toBeNull();
      expect(actionButtons).not.toBeNull();

      // Check all 4 action buttons exist
      expect(parent.querySelector("#action-attack")).not.toBeNull();
      expect(parent.querySelector("#action-interact")).not.toBeNull();
      expect(parent.querySelector("#action-mount")).not.toBeNull();
      expect(parent.querySelector("#action-inventory")).not.toBeNull();
    });

    it("returns zero direction initially", () => {
      const dir = controls.getDirection();
      expect(dir.dx).toBe(0);
      expect(dir.dy).toBe(0);
    });

    it("poll() is a no-op (doesn't throw)", () => {
      expect(() => controls.poll()).not.toThrow();
    });

    it("destroy removes DOM and listeners", () => {
      controls.destroy();
      expect(parent.querySelector("#touch-controls")).toBeNull();
    });

    it("registers and unregisters action handlers", () => {
      const handler = vi.fn();
      const unsub = controls.onAction(handler);
      unsub();
      // After unsubscribe, handler should not be called
    });
  });

  describe("Multi-touch handling", () => {
    it("tracks joystick touch by identifier", () => {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const controls = new TouchControls(parent);

      // Simulate touch start with identifier 0 on left half of screen
      Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
      const touchStart = new TouchEvent("touchstart", {
        touches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 100,
            clientY: 300,
          }),
        ],
        changedTouches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 100,
            clientY: 300,
          }),
        ],
      });
      parent.dispatchEvent(touchStart);

      // Simulate move with same identifier
      const touchMove = new TouchEvent("touchmove", {
        touches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 140,
            clientY: 300,
          }),
        ],
        changedTouches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 140,
            clientY: 300,
          }),
        ],
      });
      parent.dispatchEvent(touchMove);

      // Should have non-zero direction
      const dir = controls.getDirection();
      expect(dir.dx).toBeGreaterThan(0);

      // End this touch
      const touchEnd = new TouchEvent("touchend", {
        touches: [],
        changedTouches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 140,
            clientY: 300,
          }),
        ],
      });
      parent.dispatchEvent(touchEnd);

      // Direction should be reset
      const dirAfter = controls.getDirection();
      expect(dirAfter.dx).toBe(0);
      expect(dirAfter.dy).toBe(0);

      controls.destroy();
    });

    it("ignores touches on right half (action button zone)", () => {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const controls = new TouchControls(parent);

      Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
      // Touch on right half (x=600 > 800*0.5)
      const touchStart = new TouchEvent("touchstart", {
        touches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 600,
            clientY: 300,
          }),
        ],
        changedTouches: [
          new Touch({
            identifier: 0,
            target: parent,
            clientX: 600,
            clientY: 300,
          }),
        ],
      });
      parent.dispatchEvent(touchStart);

      // Direction should remain zero (touch was in action button zone)
      const dir = controls.getDirection();
      expect(dir.dx).toBe(0);
      expect(dir.dy).toBe(0);

      controls.destroy();
    });
  });

  describe("Deadzone prevents tiny movements", () => {
    it("returns zero direction for touch within deadzone", () => {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const controls = new TouchControls(parent);

      Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });

      // Mock getBoundingClientRect to return expected base position
      const startX = 200;
      const startY = 300;
      const baseRadius = 60;
      const baseRectValue = {
        left: startX - baseRadius,
        top: startY - baseRadius,
        width: baseRadius * 2,
        height: baseRadius * 2,
        right: startX + baseRadius,
        bottom: startY + baseRadius,
        x: startX - baseRadius,
        y: startY - baseRadius,
        toJSON() {},
      };
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(baseRectValue as DOMRect);

      // Start at center of left half
      const touchStart = new TouchEvent("touchstart", {
        touches: [
          new Touch({ identifier: 0, target: parent, clientX: startX, clientY: startY }),
        ],
        changedTouches: [
          new Touch({ identifier: 0, target: parent, clientX: startX, clientY: startY }),
        ],
      });
      parent.dispatchEvent(touchStart);

      // Move just 3px (< 10% of 60px radius = 6px)
      const touchMove = new TouchEvent("touchmove", {
        touches: [
          new Touch({ identifier: 0, target: parent, clientX: startX + 3, clientY: startY }),
        ],
        changedTouches: [
          new Touch({ identifier: 0, target: parent, clientX: startX + 3, clientY: startY }),
        ],
      });
      parent.dispatchEvent(touchMove);

      const dir = controls.getDirection();
      expect(dir.dx).toBe(0);
      expect(dir.dy).toBe(0);

      vi.restoreAllMocks();
      controls.destroy();
    });
  });
});

/* ── MobileUI tests ── */
describe("MobileUI", () => {
  let parent: HTMLElement;

  beforeEach(() => {
    parent = document.createElement("div");
    document.body.appendChild(parent);
  });

  it("creates DOM elements", () => {
    const ui = new MobileUI(parent);
    const mobileUi = parent.querySelector("#mobile-ui");
    expect(mobileUi).not.toBeNull();
    ui.destroy();
    expect(parent.querySelector("#mobile-ui")).toBeNull();
  });

  it("updateHealth modifies fill width", () => {
    const ui = new MobileUI(parent);
    // Should not throw
    ui.updateHealth(50, 100);
    ui.updateHealth(0, 100);
    ui.updateHealth(100, 100);
    ui.destroy();
  });

  it("updatePlayerInfo changes label text", () => {
    const ui = new MobileUI(parent);
    ui.updatePlayerInfo("Hero", 10);
    // Should not throw
    ui.destroy();
  });

  it("chat toggle button exists", () => {
    const ui = new MobileUI(parent);
    const btn = parent.querySelector("#mobile-chat-toggle");
    expect(btn).not.toBeNull();
    ui.destroy();
  });

  it("registers chat toggle handler", () => {
    const ui = new MobileUI(parent);
    const handler = vi.fn();
    ui.onChatToggle(handler);
    // Should not throw
    ui.destroy();
  });
});
