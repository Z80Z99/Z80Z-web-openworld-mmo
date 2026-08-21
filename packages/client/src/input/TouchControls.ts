import type { InputVector } from "./InputManager.js";

/** Action button identifiers. */
export type ActionId = "attack" | "interact" | "mount" | "inventory";

/** Callback for action button presses. */
export type ActionHandler = (action: ActionId) => void;

/** Joystick configuration constants. */
const JOYSTICK_RADIUS = 60;
const KNOB_RADIUS = 24;
const DEADZONE_RATIO = 0.1;
const MIN_TOUCH_TARGET = 44;
const UI_OPACITY = 0.7;

/** Tracks a single touch for the joystick. */
interface JoystickTouch {
  identifier: number;
  startX: number;
  startY: number;
}

/**
 * Virtual joystick (bottom-left) + action buttons (bottom-right).
 *
 * Replaces InputManager on mobile devices. Supports simultaneous joystick
 * movement and button presses via per-touch identifier tracking.
 *
 * Coordinate system: returns normalized {dx, dy} matching InputManager.
 */
export class TouchControls {
  private readonly parent: HTMLElement;
  private readonly container: HTMLElement;

  // Joystick DOM
  private joystickBase!: HTMLElement;
  private joystickKnob!: HTMLElement;

  // Joystick state
  private joystickTouch: JoystickTouch | null = null;
  private currentDirection: InputVector = { dx: 0, dy: 0 };

  // Action callbacks
  private actionHandlers: ActionHandler[] = [];

  // Bound event handlers (for cleanup)
  private readonly boundOnTouchStart: (e: TouchEvent) => void;
  private readonly boundOnTouchMove: (e: TouchEvent) => void;
  private readonly boundOnTouchEnd: (e: TouchEvent) => void;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.boundOnTouchStart = this.onTouchStart.bind(this);
    this.boundOnTouchMove = this.onTouchMove.bind(this);
    this.boundOnTouchEnd = this.onTouchEnd.bind(this);

    this.container = document.createElement("div");
    this.container.id = "touch-controls";
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 20;
      font-family: monospace; touch-action: none;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    `;
    parent.appendChild(this.container);

    this.buildJoystick();
    this.buildActionButtons();
    this.attachListeners();
  }

  /* ── Public API ── */

  /** Current normalized direction from the joystick. */
  getDirection(): InputVector {
    return this.currentDirection;
  }

  /** No-op for InputManager compatibility — touch direction updates in real-time. */
  poll(): void {
    // Touch direction is updated on touchmove, no per-frame polling needed
  }

  /** Register a handler for action button presses. */
  onAction(handler: ActionHandler): () => void {
    this.actionHandlers.push(handler);
    return () => {
      this.actionHandlers = this.actionHandlers.filter((h) => h !== handler);
    };
  }

  /** Remove all DOM elements and event listeners. */
  destroy(): void {
    this.detachListeners();
    this.container.remove();
    this.actionHandlers = [];
  }

  /* ── Joystick Construction ── */

  private buildJoystick(): void {
    // Joystick base (semi-transparent circle)
    this.joystickBase = document.createElement("div");
    this.joystickBase.id = "joystick-base";
    this.joystickBase.style.cssText = `
      position: absolute;
      bottom: 60px; left: 24px;
      width: ${JOYSTICK_RADIUS * 2}px; height: ${JOYSTICK_RADIUS * 2}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, ${UI_OPACITY * 0.3});
      border: 2px solid rgba(255, 255, 255, ${UI_OPACITY * 0.5});
      pointer-events: none;
      opacity: 0; transition: opacity 0.15s;
      transform: translate(0, 0);
      /* Center the knob within the base */
    `;
    this.container.appendChild(this.joystickBase);

    // Joystick knob (smaller circle)
    this.joystickKnob = document.createElement("div");
    this.joystickKnob.id = "joystick-knob";
    this.joystickKnob.style.cssText = `
      position: absolute;
      width: ${KNOB_RADIUS * 2}px; height: ${KNOB_RADIUS * 2}px;
      border-radius: 50%;
      background: rgba(255, 255, 255, ${UI_OPACITY * 0.6});
      border: 2px solid rgba(255, 255, 255, ${UI_OPACITY * 0.8});
      pointer-events: none;
      opacity: 0; transition: opacity 0.15s;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
    `;
    this.joystickBase.appendChild(this.joystickKnob);
  }

  /* ── Action Buttons Construction ── */

  private buildActionButtons(): void {
    const buttons: { id: ActionId; label: string; icon: string }[] = [
      { id: "attack", label: "Attack", icon: "\u2694" },   // ⚔ swords
      { id: "interact", label: "Interact", icon: "\u270B" }, // ✋ hand
      { id: "mount", label: "Mount", icon: "\u{1F40E}" },   // 🐎 horse
      { id: "inventory", label: "Bag", icon: "\u{1F392}" },  // 🎒 bag
    ];

    const wrapper = document.createElement("div");
    wrapper.id = "action-buttons";
    wrapper.style.cssText = `
      position: absolute; bottom: 60px; right: 24px;
      display: flex; flex-direction: column; gap: 12px;
      pointer-events: auto;
    `;

    for (const btn of buttons) {
      const el = document.createElement("button");
      el.id = `action-${btn.id}`;
      el.setAttribute("aria-label", btn.label);
      el.style.cssText = `
        width: ${MIN_TOUCH_TARGET}px; height: ${MIN_TOUCH_TARGET}px;
        border-radius: 50%; border: 2px solid rgba(255,255,255,${UI_OPACITY * 0.6});
        background: rgba(255,255,255,${UI_OPACITY * 0.3});
        color: #fff; font-size: 20px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        user-select: none; -webkit-user-select: none;
        touch-action: manipulation;
        transition: background 0.1s;
      `;
      el.textContent = btn.icon;

      // Use touchstart for responsive feel (no 300ms delay)
      el.addEventListener("touchstart", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.style.background = `rgba(255,255,255,${UI_OPACITY * 0.6})`;
        for (const handler of this.actionHandlers) {
          handler(btn.id);
        }
      }, { passive: false });

      el.addEventListener("touchend", (e) => {
        e.preventDefault();
        el.style.background = `rgba(255,255,255,${UI_OPACITY * 0.3})`;
      }, { passive: false });

      wrapper.appendChild(el);
    }

    this.container.appendChild(wrapper);
  }

  /* ── Event Handling ── */

  private attachListeners(): void {
    this.parent.addEventListener("touchstart", this.boundOnTouchStart, { passive: false });
    this.parent.addEventListener("touchmove", this.boundOnTouchMove, { passive: false });
    this.parent.addEventListener("touchend", this.boundOnTouchEnd);
    this.parent.addEventListener("touchcancel", this.boundOnTouchEnd);
  }

  private detachListeners(): void {
    this.parent.removeEventListener("touchstart", this.boundOnTouchStart);
    this.parent.removeEventListener("touchmove", this.boundOnTouchMove);
    this.parent.removeEventListener("touchend", this.boundOnTouchEnd);
    this.parent.removeEventListener("touchcancel", this.boundOnTouchEnd);
  }

  /**
   * Convert a screen-relative touch coordinate to a normalized joystick direction.
   * Returns the direction vector with magnitude clamped to [0, 1].
   */
  static computeDirection(
    touchX: number,
    touchY: number,
    baseX: number,
    baseY: number,
    maxRadius: number,
  ): InputVector {
    const dx = touchX - baseX;
    const dy = touchY - baseY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) return { dx: 0, dy: 0 };

    const clampedDist = Math.min(dist, maxRadius);
    return {
      dx: (dx / dist) * (clampedDist / maxRadius),
      dy: (dy / dist) * (clampedDist / maxRadius),
    };
  }

  /** Check if a direction magnitude is within the deadzone. */
  static isInDeadzone(direction: InputVector, deadzoneRatio: number): boolean {
    const mag = Math.sqrt(direction.dx * direction.dx + direction.dy * direction.dy);
    return mag < deadzoneRatio;
  }

  private onTouchStart(e: TouchEvent): void {
    // Only capture touches in the left half of the screen (joystick zone)
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const screenW = window.innerWidth;
      if (touch.clientX < screenW * 0.5 && this.joystickTouch === null) {
        e.preventDefault();
        this.joystickTouch = {
          identifier: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
        };
        this.positionJoystickBase(touch.clientX, touch.clientY);
        this.showJoystick(true);
        break;
      }
    }
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.joystickTouch) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.joystickTouch.identifier) {
        e.preventDefault();

        const baseRect = this.joystickBase.getBoundingClientRect();
        const baseCx = baseRect.left + baseRect.width / 2;
        const baseCy = baseRect.top + baseRect.height / 2;

        const dir = TouchControls.computeDirection(
          touch.clientX,
          touch.clientY,
          baseCx,
          baseCy,
          JOYSTICK_RADIUS,
        );

        if (TouchControls.isInDeadzone(dir, DEADZONE_RATIO)) {
          this.currentDirection = { dx: 0, dy: 0 };
          this.positionKnob(0, 0);
        } else {
          this.currentDirection = { dx: dir.dx, dy: dir.dy };
          this.positionKnob(dir.dx * JOYSTICK_RADIUS, dir.dy * JOYSTICK_RADIUS);
        }
        break;
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    if (!this.joystickTouch) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === this.joystickTouch.identifier) {
        this.joystickTouch = null;
        this.currentDirection = { dx: 0, dy: 0 };
        this.showJoystick(false);
        this.positionKnob(0, 0);
        break;
      }
    }
  }

  /* ── Visual Helpers ── */

  private positionJoystickBase(x: number, y: number): void {
    // Position centered on the touch point, clamped to screen bounds
    const halfR = JOYSTICK_RADIUS;
    const clampedX = Math.max(halfR, Math.min(window.innerWidth - halfR, x));
    const clampedY = Math.max(halfR, Math.min(window.innerHeight - halfR, y));

    this.joystickBase.style.left = `${clampedX - halfR}px`;
    this.joystickBase.style.bottom = "auto";
    this.joystickBase.style.top = `${clampedY - halfR}px`;
  }

  private positionKnob(dx: number, dy: number): void {
    this.joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private showJoystick(visible: boolean): void {
    const opacity = visible ? "1" : "0";
    this.joystickBase.style.opacity = opacity;
    this.joystickKnob.style.opacity = opacity;
  }
}
