import { Graphics, Container, Text, TextStyle, Sprite } from "pixi.js";
import { TILE_PX } from "./TileRenderer.js";
import { textureManager } from "./TextureManager.js";

const MOB_COLORS: Record<string, number> = {
  wolf: 0x8b6914,
  scorpion: 0xcc7722,
  skeleton: 0xdddddd,
  slime: 0x44cc44,
};

const MOB_SIZE = 14;
const NAME_STYLE = new TextStyle({ fontSize: 9, fill: 0xffffff, fontFamily: "monospace", stroke: 0x000000 });

export interface MobData {
  id: string;
  typeId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  isAggro: boolean;
}

function drawMob(g: Graphics, typeId: string, color: number): void {
  const [r, g2, b] = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  const dark = (Math.max(0, r - 40) << 16) | (Math.max(0, g2 - 40) << 8) | Math.max(0, b - 40);
  const light = (Math.min(255, r + 40) << 16) | (Math.min(255, g2 + 40) << 8) | Math.min(255, b + 40);

  switch (typeId) {
    case "wolf": {
      // Body
      g.rect(-5, -2, 10, 5);
      g.fill(color);
      // Head
      g.rect(-7, -3, 3, 4);
      g.fill(light);
      // Legs
      g.rect(-4, 3, 2, 4);
      g.fill(dark);
      g.rect(2, 3, 2, 4);
      g.fill(dark);
      // Eye
      g.rect(-7, -3, 1, 1);
      g.fill(0x000000);
      // Tail
      g.rect(5, -3, 2, 2);
      g.fill(dark);
      break;
    }
    case "scorpion": {
      // Body
      g.circle(0, 0, 4);
      g.fill(color);
      // Tail
      g.rect(0, -6, 2, 4);
      g.fill(dark);
      g.rect(-1, -7, 4, 2);
      g.fill(dark);
      // Stinger
      g.rect(1, -8, 1, 2);
      g.fill(0xff0000);
      // Claws
      g.rect(-6, -1, 3, 2);
      g.fill(light);
      g.rect(3, -1, 3, 2);
      g.fill(light);
      // Legs
      for (let i = -1; i <= 1; i++) {
        g.rect(-3, 2 + i * 2, 2, 2);
        g.fill(dark);
        g.rect(1, 2 + i * 2, 2, 2);
        g.fill(dark);
      }
      break;
    }
    case "skeleton": {
      // Skull
      g.circle(0, -4, 3);
      g.fill(color);
      // Eye sockets
      g.rect(-2, -5, 1, 1);
      g.fill(0x000000);
      g.rect(1, -5, 1, 1);
      g.fill(0x000000);
      // Spine
      g.rect(-1, -1, 2, 5);
      g.fill(color);
      // Ribs
      g.rect(-3, 0, 6, 1);
      g.fill(light);
      g.rect(-2, 2, 4, 1);
      g.fill(light);
      // Legs
      g.rect(-2, 4, 1, 4);
      g.fill(dark);
      g.rect(1, 4, 1, 4);
      g.fill(dark);
      break;
    }
    case "slime": {
      // Blob body
      g.circle(0, 0, 5);
      g.fill(color);
      // Highlight
      g.circle(-1, -2, 2);
      g.fill(light);
      // Eyes
      g.rect(-2, -1, 1, 2);
      g.fill(0x000000);
      g.rect(1, -1, 1, 2);
      g.fill(0x000000);
      break;
    }
    default: {
      // Generic blob
      g.circle(0, 0, 5);
      g.fill(color);
      g.circle(-1, -1, 2);
      g.fill(light);
      break;
    }
  }
}

export class MobRenderer {
  private readonly stage: Container;
  private readonly mobGraphics = new Map<string, Graphics | Sprite>();
  private readonly mobLabels = new Map<string, Container>();
  private readonly aggroGlows = new Map<string, Graphics>();
  private readonly mobData = new Map<string, MobData>();

  constructor(stage: Container) {
    this.stage = stage;
  }

  updateMobState(mobId: string, data: MobData): void { this.mobData.set(mobId, data); }

  removeMob(mobId: string): void {
    this.mobData.delete(mobId);
    const g = this.mobGraphics.get(mobId);
    if (g) { this.stage.removeChild(g); g.destroy(); this.mobGraphics.delete(mobId); }
    const label = this.mobLabels.get(mobId);
    if (label) { this.stage.removeChild(label); label.destroy(); this.mobLabels.delete(mobId); }
    const glow = this.aggroGlows.get(mobId);
    if (glow) { this.stage.removeChild(glow); glow.destroy(); this.aggroGlows.delete(mobId); }
  }

  update(viewportBounds: { left: number; right: number; top: number; bottom: number }): void {
    const buffer = 64;
    const vL = viewportBounds.left - buffer, vR = viewportBounds.right + buffer;
    const vT = viewportBounds.top - buffer, vB = viewportBounds.bottom + buffer;

    for (const [id, data] of this.mobData) {
      const px = data.x * TILE_PX, py = data.y * TILE_PX;
      if (px + MOB_SIZE < vL || px - MOB_SIZE > vR || py + MOB_SIZE < vT || py - MOB_SIZE > vB) {
        const g = this.mobGraphics.get(id); if (g) g.visible = false;
        const l = this.mobLabels.get(id); if (l) l.visible = false;
        const glow = this.aggroGlows.get(id); if (glow) glow.visible = false;
        continue;
      }

      let entity = this.mobGraphics.get(id);
      if (!entity) {
        // Try Kenney sprite first, fall back to procedural
        const tex = textureManager.getCharacterTexture(data.typeId);
        if (tex) {
          const sprite = new Sprite(tex);
          sprite.anchor.set(0.5, 0.5);
          sprite.scale.set(2); // 16px → 32px
          this.stage.addChild(sprite);
          this.mobGraphics.set(id, sprite);
          entity = sprite;
        } else {
          const color = MOB_COLORS[data.typeId] ?? 0xff00ff;
          const g = new Graphics();
          drawMob(g, data.typeId, color);
          this.stage.addChild(g);
          this.mobGraphics.set(id, g);
          entity = g;
        }
      }
      entity.x = px; entity.y = py; entity.visible = true;

      let glow = this.aggroGlows.get(id);
      if (data.isAggro) {
        if (!glow) {
          glow = new Graphics();
          glow.circle(0, 0, MOB_SIZE / 2 + 3);
          glow.fill({ color: 0xff0000, alpha: 0.3 });
          this.stage.addChild(glow);
          this.aggroGlows.set(id, glow);
        }
        glow.x = px; glow.y = py; glow.visible = true;
      } else if (glow) { glow.visible = false; }

      let label = this.mobLabels.get(id);
      if (!label) {
        const text = new Text({ text: data.typeId.charAt(0).toUpperCase() + data.typeId.slice(1), style: NAME_STYLE });
        const container = new Container();
        container.addChild(text);
        this.stage.addChild(container);
        this.mobLabels.set(id, container);
        label = container;
      }
      label.x = px; label.y = py - MOB_SIZE - 4; label.visible = true;
    }

    for (const [id] of this.mobGraphics) {
      if (!this.mobData.has(id)) this.removeMob(id);
    }
  }

  getMobScreenPosition(mobId: string): { x: number; y: number } | null {
    const data = this.mobData.get(mobId);
    if (!data) return null;
    return { x: data.x * TILE_PX, y: data.y * TILE_PX };
  }

  getMobAtPosition(worldX: number, worldY: number, tolerance = 1): string | null {
    for (const [id, data] of this.mobData) {
      const dx = data.x - worldX, dy = data.y - worldY;
      if (Math.sqrt(dx * dx + dy * dy) <= tolerance) return id;
    }
    return null;
  }

  destroy(): void {
    for (const [id] of this.mobGraphics) this.removeMob(id);
    this.mobData.clear();
  }
}
