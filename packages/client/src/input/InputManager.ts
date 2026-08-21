/** Normalized directional input vector. */
export interface InputVector {
  dx: number;
  dy: number;
}

/** Callback signature for input events. */
export type InputListener = (input: InputVector) => void;

/**
 * Unified keyboard + touch input abstraction.
 *
 * Keyboard: WASD / Arrow keys → normalized {dx, dy}.
 * Touch: virtual 3×3 grid → normalized {dx, dy}.
 *
 * Emits per-frame input to registered listeners.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private listeners: InputListener[] = [];

  /** Touch state. */
  private touchStartX = 0;
  private touchStartY = 0;
  private touchActive = false;
  private readonly TOUCH_THRESHOLD = 20;

  constructor(private readonly target: HTMLElement = document.body) {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);

    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("touchstart", this.onTouchStart, { passive: false });
    target.addEventListener("touchmove", this.onTouchMove, { passive: false });
    target.addEventListener("touchend", this.onTouchEnd);
  }

  /** Register a listener that receives input each frame. */
  onInput(listener: InputListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Call once per frame (e.g. from the game loop) to emit aggregated input. */
  poll(): void {
    const input = this.getDirection();
    if (input.dx !== 0 || input.dy !== 0) {
      for (const listener of this.listeners) {
        listener(input);
      }
    }
  }

  /** Compute the current normalized direction from keyboard + touch. */
  getDirection(): InputVector {
    let dx = 0;
    let dy = 0;

    // Keyboard
    if (this.keys.has("w") || this.keys.has("arrowup")) dy -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) dy += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) dx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) dx += 1;

    // Normalize diagonal
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.SQRT2;
      dx *= inv;
      dy *= inv;
    }

    return { dx, dy };
  }

  /** Check if a specific key is currently held. */
  isKeyHeld(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  /* ── Private: Keyboard ── */

  private onKeyDown(e: KeyboardEvent): void {
    this.keys.add(e.key.toLowerCase());
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key.toLowerCase());
  }

  /* ── Private: Touch ── */

  private onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchActive = true;
  }

  private onTouchMove(e: TouchEvent): void {
    if (!this.touchActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= this.TOUCH_THRESHOLD) {
      // Normalize direction
      const nx = dx / dist;
      const ny = dy / dist;

      for (const listener of this.listeners) {
        listener({ dx: nx, dy: ny });
      }
    }
  }

  private onTouchEnd(): void {
    this.touchActive = false;
  }

  /** Remove all event listeners (cleanup). */
  destroy(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("touchstart", this.onTouchStart);
    this.target.removeEventListener("touchmove", this.onTouchMove);
    this.target.removeEventListener("touchend", this.onTouchEnd);
    this.listeners = [];
  }
}
