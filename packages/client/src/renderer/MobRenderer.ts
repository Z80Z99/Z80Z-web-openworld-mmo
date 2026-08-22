import { Graphics, Container, Text, TextStyle, Sprite } from "pixi.js";
import { TILE_PX } from "./TileRenderer.js";
import { textureManager } from "./TextureManager.js";

/* ── Mob Type Colors (fallback) ── */

const MOB_COLORS: Record<string, number> = {
  wolf: 0x8b6914,
  scorpion: 0xcc7722,
  skeleton: 0xdddddd,
  slime: 0x44cc44,
};

const MOB_SIZE = 16;
const NAME_STYLE = new TextStyle({
  fontSize: 9,
  fill: 0xffffff,
  fontFamily: "monospace",
  stroke: 0x000000,
});

/* ── Mob Data (received from server) ── */

export interface MobData {
  id: string;
  typeId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  isAggro: boolean;
}

/* ── MobRenderer Class ── */

/**
 * Renders mob entities as sprites (or colored circles as fallback).
 * Shows aggro indicator (red glow) when chasing a player.
 */
export class MobRenderer {
  private readonly stage: Container;

  /** Map of mobId → Sprite or Graphics */
  private readonly mobGraphics = new Map<string, Sprite | Graphics>();
  /** Map of mobId → Container (name label group) */
  private readonly mobLabels = new Map<string, Container>();
  /** Map of mobId → Graphics (aggro glow ring) */
  private readonly aggroGlows = new Map<string, Graphics>();

  /** Current mob data received from server. */
  private readonly mobData = new Map<string, MobData>();

  constructor(stage: Container) {
    this.stage = stage;
  }

  /**
   * Update mob state from server data.
   * Call when receiving entity sync updates.
   */
  updateMobState(mobId: string, data: MobData): void {
    this.mobData.set(mobId, data);
  }

  /**
   * Remove a mob from rendering.
   */
  removeMob(mobId: string): void {
    this.mobData.delete(mobId);

    const g = this.mobGraphics.get(mobId);
    if (g) {
      this.stage.removeChild(g);
      g.destroy();
      this.mobGraphics.delete(mobId);
    }

    const label = this.mobLabels.get(mobId);
    if (label) {
      this.stage.removeChild(label);
      label.destroy();
      this.mobLabels.delete(mobId);
    }

    const glow = this.aggroGlows.get(mobId);
    if (glow) {
      this.stage.removeChild(glow);
      glow.destroy();
      this.aggroGlows.delete(mobId);
    }
  }

  /**
   * Call once per frame to sync mob visuals with game state.
   */
  update(viewportBounds: { left: number; right: number; top: number; bottom: number }): void {
    const buffer = 64;

    const visibleLeft = viewportBounds.left - buffer;
    const visibleRight = viewportBounds.right + buffer;
    const visibleTop = viewportBounds.top - buffer;
    const visibleBottom = viewportBounds.bottom + buffer;

    for (const [id, data] of this.mobData) {
      const px = data.x * TILE_PX;
      const py = data.y * TILE_PX;

      // Culling: skip off-screen mobs
      if (px + MOB_SIZE < visibleLeft || px - MOB_SIZE > visibleRight ||
          py + MOB_SIZE < visibleTop || py - MOB_SIZE > visibleBottom) {
        const g = this.mobGraphics.get(id);
        if (g) g.visible = false;
        const l = this.mobLabels.get(id);
        if (l) l.visible = false;
        const glow = this.aggroGlows.get(id);
        if (glow) glow.visible = false;
        continue;
      }

      // Draw mob sprite or circle
      let g = this.mobGraphics.get(id);
      if (!g) {
        if (textureManager.isLoaded()) {
          // Use character sprite for mob type
          const texture = textureManager.getCharacterTexture(data.typeId);
          const sprite = new Sprite(texture);
          sprite.anchor.set(0.5);
          this.stage.addChild(sprite);
          g = sprite;
        } else {
          // Fallback: colored circle
          const color = MOB_COLORS[data.typeId] ?? 0xff00ff;
          const graphics = new Graphics();
          graphics.circle(0, 0, MOB_SIZE / 2);
          graphics.fill(color);
          this.stage.addChild(graphics);
          g = graphics;
        }
        this.mobGraphics.set(id, g);
      }
      g.x = px;
      g.y = py;
      g.visible = true;

      // Draw aggro glow
      let glow = this.aggroGlows.get(id);
      if (data.isAggro) {
        if (!glow) {
          glow = new Graphics();
          glow.circle(0, 0, MOB_SIZE / 2 + 3);
          glow.fill({ color: 0xff0000, alpha: 0.3 });
          this.stage.addChild(glow);
          this.aggroGlows.set(id, glow);
        }
        glow.x = px;
        glow.y = py;
        glow.visible = true;
      } else if (glow) {
        glow.visible = false;
      }

      // Draw name label
      let label = this.mobLabels.get(id);
      if (!label) {
        const text = new Text({
          text: `${data.typeId.charAt(0).toUpperCase() + data.typeId.slice(1)}`,
          style: NAME_STYLE,
        });
        const container = new Container();
        container.addChild(text);
        this.stage.addChild(container);
        this.mobLabels.set(id, container);
        label = container;
      }
      label.x = px;
      label.y = py - MOB_SIZE - 4;
      label.visible = true;
    }

    // Remove entities no longer in state
    for (const [id] of this.mobGraphics) {
      if (!this.mobData.has(id)) {
        this.removeMob(id);
      }
    }
  }

  /**
   * Get mob screen position for damage numbers.
   * Returns pixel coordinates or null if mob not found.
   */
  getMobScreenPosition(mobId: string): { x: number; y: number } | null {
    const data = this.mobData.get(mobId);
    if (!data) return null;
    return {
      x: data.x * TILE_PX,
      y: data.y * TILE_PX,
    };
  }

  /**
   * Check if a mob exists at the given world position.
   * Returns the mobId or null.
   */
  getMobAtPosition(worldX: number, worldY: number, tolerance = 1): string | null {
    for (const [id, data] of this.mobData) {
      const dx = data.x - worldX;
      const dy = data.y - worldY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= tolerance) {
        return id;
      }
    }
    return null;
  }

  /**
   * Destroy all mob graphics.
   */
  destroy(): void {
    for (const [id] of this.mobGraphics) {
      this.removeMob(id);
    }
    this.mobData.clear();
  }
}
