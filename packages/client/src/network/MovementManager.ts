import type { GameState } from "../game/GameState.js";

/**
 * Client-side movement manager handling prediction, server communication,
 * and reconciliation with authoritative server state.
 *
 * Flow per tick:
 *  1. `move()` — apply input locally (prediction) and send target to server.
 *  2. Server validates and updates authoritative position.
 *  3. `reconcile()` — called when server state arrives; snaps or smooth-corrects
 *     if the prediction diverged from the server position.
 *  4. `update()` — smooth visual interpolation each frame.
 */
export class MovementManager {
  private readonly gameState: GameState;
  private readonly sendFn: (x: number, y: number) => void;

  /** Last known authoritative server position. */
  private serverX = 0;
  private serverY = 0;

  /** Interpolation state for smooth correction. */
  private renderX = 0;
  private renderY = 0;
  private isInterpolating = false;

  /** How fast the client corrects toward the server position (tiles/sec). */
  private readonly correctionSpeed: number;

  /**
   * @param gameState - Client-side game state to mutate.
   * @param sendFn    - Function to send movement message to the server.
   * @param correctionSpeed - Speed of smooth correction (default 10 tiles/sec).
   */
  constructor(
    gameState: GameState,
    sendFn: (x: number, y: number) => void,
    correctionSpeed = 10,
  ) {
    this.gameState = gameState;
    this.sendFn = sendFn;
    this.correctionSpeed = correctionSpeed;
  }

  /**
   * Apply movement locally (prediction) and send the resulting position to the server.
   *
   * @param dx    - Normalized direction X (-1, 0, or 1).
   * @param dy    - Normalized direction Y (-1, 0, or 1).
   * @param speed - Movement speed in tiles/sec.
   * @param dt    - Frame delta in seconds.
   */
  move(dx: number, dy: number, speed: number, dt: number): void {
    // 1. Client-side prediction: apply immediately
    this.gameState.predictMove(dx, dy, speed, dt);

    // 2. Send predicted position to server for validation
    const local = this.gameState.localPlayer;
    if (local) {
      this.sendFn(local.x, local.y);
    }
  }

  /**
   * Reconcile local prediction with authoritative server state.
   *
   * Called when the server sends back updated player position via Colyseus sync.
   * If prediction matches within tolerance, no correction needed.
   * If there's a significant mismatch, snap to server position and start
   * smooth interpolation.
   *
   * @param serverX - Authoritative X from server.
   * @param serverY - Authoritative Y from server.
   */
  reconcile(serverX: number, serverY: number): void {
    const local = this.gameState.localPlayer;
    if (!local) return;

    this.serverX = serverX;
    this.serverY = serverY;

    // Calculate prediction error
    const dx = local.x - serverX;
    const dy = local.y - serverY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0.5) {
      // Significant mismatch — snap render position and start interpolation
      this.renderX = local.x;
      this.renderY = local.y;
      this.isInterpolating = true;
    } else {
      // Close enough — directly apply server position
      local.x = serverX;
      local.y = serverY;
      this.renderX = serverX;
      this.renderY = serverY;
      this.isInterpolating = false;
    }
  }

  /**
   * Smooth visual interpolation toward server position.
   * Called each frame to correct small prediction drifts without jarring snaps.
   *
   * @param dt - Frame delta in seconds.
   */
  update(dt: number): void {
    if (!this.isInterpolating) return;

    const local = this.gameState.localPlayer;
    if (!local) return;

    // Interpolate render position toward server position
    const dx = this.serverX - this.renderX;
    const dy = this.serverY - this.renderY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 0.01) {
      // Close enough — snap and stop interpolating
      this.renderX = this.serverX;
      this.renderY = this.serverY;
      local.x = this.serverX;
      local.y = this.serverY;
      this.isInterpolating = false;
      return;
    }

    // Move render position toward server at correctionSpeed
    const maxStep = this.correctionSpeed * dt;
    const step = Math.min(maxStep, distance);
    this.renderX += (dx / distance) * step;
    this.renderY += (dy / distance) * step;

    // Apply interpolated render position
    local.x = this.renderX;
    local.y = this.renderY;
  }

  /** Whether the manager is currently interpolating toward server position. */
  get interpolating(): boolean {
    return this.isInterpolating;
  }

  /** Last known server position. */
  get serverPosition(): { x: number; y: number } {
    return { x: this.serverX, y: this.serverY };
  }
}
