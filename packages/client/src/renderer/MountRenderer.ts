import { Graphics, Container } from "pixi.js";
import { TILE_PX } from "./TileRenderer.js";

/* ── Mount Type Colors ── */

const MOUNT_COLORS: Record<string, number> = {
  horse: 0x8b4513,   // brown
  wolf: 0x808080,     // gray
  eagle: 0xffffff,    // white
  turtle: 0x228b22,   // green
};

const MOUNT_SIZE = 8; // 0.7x of player size (12 * 0.7 ≈ 8)

/* ── Mount Data ── */

export interface MountRenderData {
  mountId: string;
  x: number;
  y: number;
}

/* ── MountRenderer Class ── */

/**
 * Renders mount visuals as colored circles below players.
 *
 * - Different color per mount type (horse=brown, wolf=gray, eagle=white, turtle=green)
 * - Mount follows player movement
 * - Scale: smaller than player (0.7x)
 */
export class MountRenderer {
  private readonly stage: Container;

  /** Map of playerId → Graphics (the mount circle) */
  private readonly mountGraphics = new Map<string, Graphics>();

  /** Current mount data for all players. */
  private readonly mountData = new Map<string, MountRenderData>();

  constructor(stage: Container) {
    this.stage = stage;
  }

  /**
   * Update mount state for a player.
   * Call when receiving player state updates with mountId.
   */
  updatePlayerMount(playerId: string, mountId: string, x: number, y: number): void {
    if (!mountId) {
      // Player dismounted — remove graphics
      this.removeMount(playerId);
      return;
    }

    this.mountData.set(playerId, { mountId, x, y });
  }

  /**
   * Remove a player's mount from rendering.
   */
  removeMount(playerId: string): void {
    this.mountData.delete(playerId);

    const g = this.mountGraphics.get(playerId);
    if (g) {
      this.stage.removeChild(g);
      g.destroy();
      this.mountGraphics.delete(playerId);
    }
  }

  /**
   * Call once per frame to sync mount visuals with game state.
   */
  update(viewportBounds: { left: number; right: number; top: number; bottom: number }): void {
    const buffer = 64;

    const visibleLeft = viewportBounds.left - buffer;
    const visibleRight = viewportBounds.right + buffer;
    const visibleTop = viewportBounds.top - buffer;
    const visibleBottom = viewportBounds.bottom + buffer;

    for (const [playerId, data] of this.mountData) {
      const px = data.x * TILE_PX;
      const py = data.y * TILE_PX;

      // Position mount below player
      const mountPx = px;
      const mountPy = py + MOUNT_SIZE + 4;

      // Culling: skip off-screen mounts
      if (mountPx + MOUNT_SIZE < visibleLeft || mountPx - MOUNT_SIZE > visibleRight ||
          mountPy + MOUNT_SIZE < visibleTop || mountPy - MOUNT_SIZE > visibleBottom) {
        const g = this.mountGraphics.get(playerId);
        if (g) g.visible = false;
        continue;
      }

      // Draw mount circle
      let g = this.mountGraphics.get(playerId);
      if (!g) {
        g = new Graphics();
        const color = MOUNT_COLORS[data.mountId] ?? 0xff00ff;
        g.circle(0, 0, MOUNT_SIZE / 2);
        g.fill(color);
        this.stage.addChild(g);
        this.mountGraphics.set(playerId, g);
      }
      g.x = mountPx;
      g.y = mountPy;
      g.visible = true;
    }

    // Remove mounts no longer in state
    for (const [playerId] of this.mountGraphics) {
      if (!this.mountData.has(playerId)) {
        this.removeMount(playerId);
      }
    }
  }

  /**
   * Update mount position (called when player moves).
   */
  updateMountPosition(playerId: string, x: number, y: number): void {
    const mount = this.mountData.get(playerId);
    if (mount) {
      mount.x = x;
      mount.y = y;
    }
  }

  /**
   * Destroy all mount graphics.
   */
  destroy(): void {
    for (const [playerId] of this.mountGraphics) {
      this.removeMount(playerId);
    }
    this.mountData.clear();
  }
}
