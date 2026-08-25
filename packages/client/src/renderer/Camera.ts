import { Container } from "pixi.js";

/** Smooth viewport camera that follows a target position. */
export class Camera {
  /** Current camera center in world space. */
  public x = 0;
  public y = 0;

  /** Lerp factor per frame (0 = no follow, 1 = instant snap). */
  private readonly lerpFactor: number;

  /** Viewport dimensions (set to canvas size). */
  public viewportWidth: number;
  public viewportHeight: number;

  /** The container whose position mirrors the camera offset. */
  private readonly stage: Container;

  constructor(
    stage: Container,
    viewportWidth: number,
    viewportHeight: number,
    lerpFactor = 0.1,
  ) {
    this.stage = stage;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.lerpFactor = lerpFactor;
  }

  /** Resize viewport to match new canvas dimensions. */
  resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /**
   * Update camera position to smoothly follow a target.
   * @param targetX - world X of the target (e.g. player)
   * @param targetY - world Y of the target
   * @param dt - delta time in seconds (0.016 for 60fps)
   */
  follow(targetX: number, targetY: number, dt: number): void {
    // Scale lerp by dt so movement is framerate-independent
    const t = 1 - Math.pow(1 - this.lerpFactor, dt * 60);
    this.x += (targetX - this.x) * t;
    this.y += (targetY - this.y) * t;

    this.applyStageOffset();
  }

  /** Snap camera immediately (no lerp). */
  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.applyStageOffset();
  }

  /**
   * Mirror the camera offset into the stage position, snapped to whole
   * screen pixels AFTER scaling. Pixel-art tiles must never land on
   * subpixel positions — fractional offsets cause bilinear shimmering and
   * visible seams between adjacent tiles while the map is moving.
   */
  private applyStageOffset(): void {
    const s = this.stage.scale.x || 1;
    this.stage.x = Math.round((-this.x + this.viewportWidth / 2) * s) / s;
    this.stage.y = Math.round((-this.y + this.viewportHeight / 2) * s) / s;
  }

  /** Returns the world-space bounds of the visible viewport. */
  getVisibleBounds(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } {
    return {
      left: this.x - this.viewportWidth / 2,
      right: this.x + this.viewportWidth / 2,
      top: this.y - this.viewportHeight / 2,
      bottom: this.y + this.viewportHeight / 2,
    };
  }
}
