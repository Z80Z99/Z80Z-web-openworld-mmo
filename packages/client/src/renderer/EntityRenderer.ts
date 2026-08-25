import { Graphics, Container, Text, TextStyle, Sprite } from "pixi.js";
import type { GameState } from "../game/GameState.js";
import { textureManager } from "./TextureManager.js";
import { TILE_PX } from "./TileRenderer.js";

const PLAYER_SIZE = 12;
const PLAYER_COLOR = 0x3498db;
const REMOTE_COLOR = 0xe74c3c;

const NAME_STYLE = new TextStyle({
  fontSize: 10,
  fill: 0xffffff,
  fontFamily: "monospace",
});

function drawPixelHumanoid(g: Graphics, color: number): void {
  const [r, g2, b] = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
  const dark = (Math.max(0, r - 40) << 16) | (Math.max(0, g2 - 40) << 8) | Math.max(0, b - 40);
  const light = (Math.min(255, r + 30) << 16) | (Math.min(255, g2 + 30) << 8) | Math.min(255, b + 30);

  // Head
  g.circle(0, -3, 3);
  g.fill(light);
  // Body
  g.rect(-3, 0, 6, 5);
  g.fill(color);
  // Belt
  g.rect(-3, 4, 6, 1);
  g.fill(dark);
  // Legs
  g.rect(-3, 5, 2, 3);
  g.fill(dark);
  g.rect(1, 5, 2, 3);
  g.fill(dark);
  // Arms
  g.rect(-5, 0, 2, 4);
  g.fill(color);
  g.rect(3, 0, 2, 4);
  g.fill(color);
}

export class EntityRenderer {
  private readonly stage: Container;
  private readonly gameState: GameState;
  private readonly entities = new Map<string, Graphics | Sprite>();
  private readonly labels = new Map<string, Container>();

  constructor(stage: Container, gameState: GameState) {
    this.stage = stage;
    this.gameState = gameState;
  }

  update(viewportBounds: { left: number; right: number; top: number; bottom: number }): void {
    const buffer = 64;
    const visibleLeft = viewportBounds.left - buffer;
    const visibleRight = viewportBounds.right + buffer;
    const visibleTop = viewportBounds.top - buffer;
    const visibleBottom = viewportBounds.bottom + buffer;

    const local = this.gameState.localPlayer;
    if (local) {
      this.drawEntity(local.id, local.x * TILE_PX, local.y * TILE_PX, local.name, "player", visibleLeft, visibleRight, visibleTop, visibleBottom);
    }

    for (const [id, player] of this.gameState.remotePlayers) {
      this.drawEntity(id, player.x * TILE_PX, player.y * TILE_PX, player.name, "remote", visibleLeft, visibleRight, visibleTop, visibleBottom);
    }

    const allIds = new Set([...(local ? [local.id] : []), ...this.gameState.remotePlayers.keys()]);
    for (const [id, g] of this.entities) {
      if (!allIds.has(id)) {
        this.stage.removeChild(g);
        g.destroy();
        this.entities.delete(id);
      }
      const label = this.labels.get(id);
      if (label && !allIds.has(id)) {
        this.stage.removeChild(label);
        label.destroy();
        this.labels.delete(id);
      }
    }
  }

  destroy(): void {
    for (const [, g] of this.entities) { this.stage.removeChild(g); g.destroy(); }
    for (const [, l] of this.labels) { this.stage.removeChild(l); l.destroy(); }
    this.entities.clear();
    this.labels.clear();
  }

  private drawEntity(id: string, px: number, py: number, name: string, characterType: string, vLeft: number, vRight: number, vTop: number, vBottom: number): void {
    if (px + PLAYER_SIZE < vLeft || px - PLAYER_SIZE > vRight || py + PLAYER_SIZE < vTop || py - PLAYER_SIZE > vBottom) {
      const g = this.entities.get(id);
      if (g) g.visible = false;
      const l = this.labels.get(id);
      if (l) l.visible = false;
      return;
    }

    let entity = this.entities.get(id);
    if (!entity) {
      // Try Kenney character sprite first, fall back to procedural
      const tex = textureManager.getCharacterTexture(characterType);
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5, 0.5);
        sprite.scale.set(2); // 16px → 32px
        this.stage.addChild(sprite);
        this.entities.set(id, sprite);
        entity = sprite;
      } else {
        const g = new Graphics();
        const color = characterType === "player" ? PLAYER_COLOR : REMOTE_COLOR;
        drawPixelHumanoid(g, color);
        this.stage.addChild(g);
        this.entities.set(id, g);
        entity = g;
      }
    }
    entity.x = px;
    entity.y = py;
    entity.visible = true;

    let label = this.labels.get(id);
    if (!label) {
      const text = new Text({ text: name, style: NAME_STYLE });
      const container = new Container();
      container.addChild(text);
      this.stage.addChild(container);
      this.labels.set(id, container);
      label = container;
    }
    label.x = px;
    label.y = py - PLAYER_SIZE - 4;
    label.visible = true;
  }
}
