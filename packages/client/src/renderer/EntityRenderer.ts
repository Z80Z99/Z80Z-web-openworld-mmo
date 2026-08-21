import { Graphics, Container, Text, TextStyle } from "pixi.js";
import type { GameState, RemotePlayer } from "../game/GameState.js";
import { TILE_PX } from "./TileRenderer.js";

const PLAYER_SIZE = 12;
const PLAYER_COLOR = 0x3498db;   // blue for local player
const REMOTE_COLOR = 0xe74c3c;   // red for remote players

const NAME_STYLE = new TextStyle({
  fontSize: 10,
  fill: 0xffffff,
  fontFamily: "monospace",
});

/**
 * Renders player entities as colored circles with name labels.
 *
 * Only players whose world position falls within the viewport + buffer
 * are drawn each frame (culling).
 */
export class EntityRenderer {
  private readonly stage: Container;
  private readonly gameState: GameState;

  /** Map of playerId → Graphics (the circle) */
  private readonly entities = new Map<string, Graphics>();
  /** Map of playerId → Container (the name label group) */
  private readonly labels = new Map<string, Container>();

  constructor(stage: Container, gameState: GameState) {
    this.stage = stage;
    this.gameState = gameState;
  }

  /** Call once per frame to sync entity visuals with game state. */
  update(viewportBounds: { left: number; right: number; top: number; bottom: number }): void {
    const buffer = 64; // px buffer around viewport

    const visibleLeft = viewportBounds.left - buffer;
    const visibleRight = viewportBounds.right + buffer;
    const visibleTop = viewportBounds.top - buffer;
    const visibleBottom = viewportBounds.bottom + buffer;

    // Local player
    const local = this.gameState.localPlayer;
    if (local) {
      this.drawEntity(
        local.id,
        local.x * TILE_PX,
        local.y * TILE_PX,
        local.name,
        PLAYER_COLOR,
        visibleLeft,
        visibleRight,
        visibleTop,
        visibleBottom,
      );
    }

    // Remote players
    for (const [id, player] of this.gameState.remotePlayers) {
      this.drawEntity(
        id,
        player.x * TILE_PX,
        player.y * TILE_PX,
        player.name,
        REMOTE_COLOR,
        visibleLeft,
        visibleRight,
        visibleTop,
        visibleBottom,
      );
    }

    // Remove entities no longer in state
    const allIds = new Set([
      ...(local ? [local.id] : []),
      ...this.gameState.remotePlayers.keys(),
    ]);
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

  /** Destroy all entity graphics. */
  destroy(): void {
    for (const [, g] of this.entities) {
      this.stage.removeChild(g);
      g.destroy();
    }
    for (const [, l] of this.labels) {
      this.stage.removeChild(l);
      l.destroy();
    }
    this.entities.clear();
    this.labels.clear();
  }

  /* ── Private ── */

  private drawEntity(
    id: string,
    px: number,
    py: number,
    name: string,
    color: number,
    vLeft: number,
    vRight: number,
    vTop: number,
    vBottom: number,
  ): void {
    // Culling: skip off-screen entities
    if (px + PLAYER_SIZE < vLeft || px - PLAYER_SIZE > vRight ||
        py + PLAYER_SIZE < vTop || py - PLAYER_SIZE > vBottom) {
      const g = this.entities.get(id);
      if (g) g.visible = false;
      const l = this.labels.get(id);
      if (l) l.visible = false;
      return;
    }

    // Circle
    let g = this.entities.get(id);
    if (!g) {
      g = new Graphics();
      g.circle(0, 0, PLAYER_SIZE / 2);
      g.fill(color);
      this.stage.addChild(g);
      this.entities.set(id, g);
    }
    g.x = px;
    g.y = py;
    g.visible = true;

    // Name label
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
