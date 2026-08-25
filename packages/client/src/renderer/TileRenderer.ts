import { Graphics, Container, Sprite, Texture } from "pixi.js";
import { TileType, CHUNK_SIZE, DEFAULT_SEED, getShoreTiles, computeNeighborMask, getGroundEdgeTiles, isGrassFamilyTile, isSandFamilyTile } from "@mmo/shared";
import type { Chunk } from "@mmo/shared";
import type { Camera } from "./Camera.js";
import { textureManager } from "./TextureManager.js";
import {
  selectDecorationWithOffset,
  selectOneTileTree,
  selectTwoTileTree,
} from "./DecorationRegistry.js";
import {
  tileHash,
  tileColor,
  findAnimatedTiles,
  type AnimatedTile,
} from "./TileAnimations.js";

// ── Constants ───────────────────────────────────────────────────────────────

export const TILE_PX = 16;
const VARIATION_SEED = DEFAULT_SEED;

// ── Color Palettes ──────────────────────────────────────────────────────────

const BASE_COLORS: Record<number, number> = {
  [TileType.Grass]:          0x5a8f4a,
  [TileType.Water]:          0x3b7dd8,
  [TileType.Sand]:           0xe8d5a3,
  [TileType.Stone]:          0x8c8c8c,
  [TileType.Forest]:         0x2d6b1e,
  [TileType.Snow]:           0xe8edf2,
  [TileType.DeepWater]:      0x1e5ba8,
  [TileType.Swamp]:          0x5a6e3a,
  [TileType.Ice]:            0xc8dfe8,

  [TileType.ShoreSand]:      0xbfae8a,
  [TileType.ShoreGrass]:     0x6a9f5a,
  [TileType.ShoreForest]:    0x3d7828,
  [TileType.ShoreSwamp]:     0x6a7e4a,
  [TileType.ShoreSnow]:      0xd0dde5,
  [TileType.ShoreStone]:     0x7a7a7a,

  [TileType.GrassToSand]:    0x8a9f7a,
  [TileType.GrassToForest]:  0x4a7f3a,
  [TileType.GrassToSwamp]:   0x6a8f5a,
  [TileType.GrassToStone]:   0x7a9080,
  [TileType.GrassToSnow]:    0x8aa8c0,
  [TileType.SandToStone]:    0xa09a80,
  [TileType.ForestToSwamp]:  0x4d6e2e,
  [TileType.ForestToStone]:  0x607050,
  [TileType.SwampToStone]:   0x6e7e50,
  [TileType.StoneToSnow]:    0xa0b0c0,
  [TileType.SnowToIce]:      0xc0d5e5,

  [TileType.GrassVariant1]:     0x528a42,
  [TileType.GrassVariant2]:     0x629852,
  [TileType.ForestVariant1]:    0x25651a,
  [TileType.ForestVariant2]:    0x357028,
  [TileType.StoneVariant1]:     0x858585,
  [TileType.StoneVariant2]:     0x959595,
  [TileType.SandVariant1]:      0xe0cd9a,
  [TileType.SnowVariant1]:      0xe0e5ec,
  [TileType.SwampVariant1]:     0x526832,
  [TileType.WaterVariant1]:     0x3575d0,
  [TileType.WaterVariant2]:     0x4085e0,
  [TileType.DeepWaterVariant1]: 0x1852a0,

  // GravelPath: muted grey-tan bridging grass green (0x5a8f4a) and sand warm
  // (0xe8d5a3) — 0xB8A98C sits in the same value range as SandToStone (0xa09a80)
  // but slightly cooler/less saturated to read as compacted gravel.
  [TileType.GravelPath]:     0xb8a98c,
};

// ── Decoration Palette ──────────────────────────────────────────────────────

const DECO = {
  grassBladeLight: 0x7ab860,
  grassBladeDark:  0x4a7a38,
  grassFlower1:    0xf0e050,
  grassFlower2:    0xe86070,
  grassFlower3:    0xb070d0,

  trunk:       0x6b4226,
  trunkDark:   0x4a2e1a,
  canopyLight: 0x3a8028,
  canopyDark:  0x1e5a10,
  canopyTop:   0x4a9038,

  pebbleLight: 0xd8c890,
  pebbleDark:  0xc0b078,
  shell:       0xf0e8d8,

  crackDark:   0x606060,
  crackLight:  0xa0a0a0,
  moss:        0x506830,

  sparkle:     0xffffff,
  sparkleBlue: 0xd0e8f8,
  snowDrift:   0xd8e0e8,

  bubble:      0x809860,
  mushRoom:    0xc06030,
  reed:        0x607830,

  waveLight:   0x60a0e8,
  waveDark:    0x2860a0,

  iceCrack:    0xa0c8e0,
  iceGlint:    0xf0f8ff,

  shoreFoam:   0xe8e0d0,
  shoreWet:    0x708898,
};

// ── Tile Category Helpers ───────────────────────────────────────────────────

function isWaterType(t: number): boolean {
  return t === TileType.Water || t === TileType.DeepWater ||
    t === TileType.WaterVariant1 || t === TileType.WaterVariant2 ||
    t === TileType.DeepWaterVariant1;
}

function isShoreType(t: number): boolean {
  return t >= TileType.ShoreSand && t <= TileType.ShoreStone;
}

function isForestType(t: number): boolean {
  return t === TileType.Forest || t === TileType.ForestVariant1 ||
    t === TileType.ForestVariant2 || t === TileType.ShoreForest ||
    t === TileType.GrassToForest || t === TileType.ForestToSwamp ||
    t === TileType.ForestToStone;
}

function isSandType(t: number): boolean {
  return t === TileType.Sand || t === TileType.SandVariant1 ||
    t === TileType.ShoreSand || t === TileType.GrassToSand ||
    t === TileType.SandToStone;
}

function isStoneType(t: number): boolean {
  return t === TileType.Stone || t === TileType.StoneVariant1 ||
    t === TileType.StoneVariant2 || t === TileType.ShoreStone ||
    t === TileType.GrassToStone || t === TileType.SandToStone ||
    t === TileType.ForestToStone || t === TileType.SwampToStone ||
    t === TileType.StoneToSnow;
}

function isSnowType(t: number): boolean {
  return t === TileType.Snow || t === TileType.SnowVariant1 ||
    t === TileType.ShoreSnow || t === TileType.GrassToSnow ||
    t === TileType.StoneToSnow || t === TileType.SnowToIce;
}

function isSwampType(t: number): boolean {
  return t === TileType.Swamp || t === TileType.SwampVariant1 ||
    t === TileType.ShoreSwamp || t === TileType.GrassToSwamp ||
    t === TileType.ForestToSwamp || t === TileType.SwampToStone;
}

function isIceType(t: number): boolean {
  return t === TileType.Ice || t === TileType.SnowToIce;
}

function isGrassType(t: number): boolean {
  return t === TileType.Grass || t === TileType.GrassVariant1 ||
    t === TileType.GrassVariant2 || t === TileType.ShoreGrass ||
    t === TileType.GrassToSand || t === TileType.GrassToForest ||
    t === TileType.GrassToSwamp || t === TileType.GrassToStone ||
    t === TileType.GrassToSnow;
}

// ── Decoration Drawing ──────────────────────────────────────────────────────

function px(g: Graphics, x: number, y: number, color: number, w = 1, h = 1): void {
  g.rect(x, y, w, h);
  g.fill(color);
}

/** Procedural forest tree (fallback when spritesheet unavailable). */
function drawForestDecoration(g: Graphics, lx: number, ly: number, wx: number, wy: number): void {
  const ox = lx * TILE_PX;
  const oy = ly * TILE_PX;
  const h1 = tileHash(wx, wy, VARIATION_SEED);
  const h2 = tileHash(wx, wy, VARIATION_SEED + 1);
  const tx = ox + 5 + (h2 * 4) | 0;
  const ty = oy + 7;
  px(g, tx, ty, DECO.trunk, 2, 5);
  px(g, tx, ty, DECO.trunkDark, 1, 5);
  px(g, tx - 2, ty - 4, DECO.canopyDark, 6, 2);
  px(g, tx - 3, ty - 2, DECO.canopyDark, 8, 3);
  px(g, tx - 2, ty + 1, DECO.canopyLight, 6, 1);
  px(g, tx - 1, ty - 3, DECO.canopyTop, 3, 1);
}

function drawDecorations(g: Graphics, tileType: number, lx: number, ly: number, wx: number, wy: number): void {
  const ox = lx * TILE_PX;
  const oy = ly * TILE_PX;

  const h1 = tileHash(wx, wy, VARIATION_SEED);
  const h2 = tileHash(wx, wy, VARIATION_SEED + 1);
  const h3 = tileHash(wx, wy, VARIATION_SEED + 2);
  const h4 = tileHash(wx, wy, VARIATION_SEED + 3);

  // ── Forest: no tree decorations (disabled) ────────────────────────
  return;

  // ── Grass ────────────────────────────────────────────────────────────────
  if (isGrassType(tileType)) {
    if (h1 > 0.35) {
      const bx = ox + 2 + (h1 * 10) | 0;
      const by = oy + 4 + (h2 * 8) | 0;
      const col = h3 > 0.5 ? DECO.grassBladeLight : DECO.grassBladeDark;
      px(g, bx, by, col);
      px(g, bx, by - 1, col);
      if (h2 > 0.6) px(g, bx + 1, by - 1, col);
    }
    if (h2 > 0.88) {
      const fx = ox + 4 + (h3 * 8) | 0;
      const fy = oy + 3 + (h4 * 6) | 0;
      const fCol = h1 > 0.7 ? DECO.grassFlower1 : h1 > 0.4 ? DECO.grassFlower2 : DECO.grassFlower3;
      px(g, fx, fy, fCol);
      px(g, fx - 1, fy + 1, DECO.grassBladeDark);
      px(g, fx + 1, fy + 1, DECO.grassBladeDark);
    }
    return;
  }

  // ── Sand ─────────────────────────────────────────────────────────────────
  if (isSandType(tileType)) {
    if (h1 > 0.6) {
      const sx = ox + 2 + (h2 * 12) | 0;
      const sy = oy + 3 + (h3 * 10) | 0;
      px(g, sx, sy, h4 > 0.5 ? DECO.pebbleLight : DECO.pebbleDark, 2, 1);
    }
    if (h2 > 0.93) {
      const sx = ox + 6 + (h3 * 4) | 0;
      const sy = oy + 5 + (h4 * 6) | 0;
      px(g, sx, sy, DECO.shell, 2, 1);
      px(g, sx + 1, sy - 1, DECO.shell, 1, 1);
    }
    return;
  }

  // ── Stone ────────────────────────────────────────────────────────────────
  if (isStoneType(tileType)) {
    if (h1 > 0.5) {
      const cx = ox + 2 + (h2 * 10) | 0;
      const cy = oy + 3 + (h3 * 8) | 0;
      const len = 2 + (h4 * 3) | 0;
      for (let i = 0; i < len; i++) {
        px(g, cx + i, cy + ((i % 2) ? 1 : 0), DECO.crackDark);
      }
    }
    if (h3 > 0.88) {
      const mx = ox + (h4 * 12) | 0;
      const my = oy + (h1 * 12) | 0;
      px(g, mx, my, DECO.moss, 2, 1);
      px(g, mx + 1, my + 1, DECO.moss);
    }
    return;
  }

  // ── Snow ─────────────────────────────────────────────────────────────────
  if (isSnowType(tileType)) {
    if (h1 > 0.6) {
      const sx = ox + 3 + (h2 * 10) | 0;
      const sy = oy + 2 + (h3 * 10) | 0;
      px(g, sx, sy, h4 > 0.5 ? DECO.sparkle : DECO.sparkleBlue);
    }
    if (h2 > 0.9) {
      const dx = ox + (h3 * 8) | 0;
      const dy = oy + 10 + (h4 * 4) | 0;
      px(g, dx, dy, DECO.snowDrift, 3, 1);
    }
    return;
  }

  // ── Swamp ────────────────────────────────────────────────────────────────
  if (isSwampType(tileType)) {
    if (h1 > 0.7) {
      const bx = ox + 4 + (h2 * 8) | 0;
      const by = oy + 5 + (h3 * 6) | 0;
      px(g, bx, by, DECO.bubble, 2, 1);
      px(g, bx, by - 1, DECO.bubble);
    }
    if (h3 > 0.9) {
      const mx = ox + 6 + (h4 * 4) | 0;
      const my = oy + 6 + (h1 * 4) | 0;
      px(g, mx, my, DECO.mushRoom, 2, 1);
      px(g, mx, my - 1, DECO.mushRoom, 3, 1);
      px(g, mx + 1, my + 1, DECO.reed);
    }
    if (h4 > 0.82) {
      const rx = ox + 3 + (h1 * 10) | 0;
      const ry = oy + 2;
      px(g, rx, ry, DECO.reed, 1, 6);
      if (h2 > 0.5) px(g, rx + 1, ry + 1, DECO.reed, 1, 4);
    }
    return;
  }

  // ── Ice ──────────────────────────────────────────────────────────────────
  if (isIceType(tileType)) {
    if (h1 > 0.55) {
      const cx = ox + 1 + (h2 * 12) | 0;
      const cy = oy + 2 + (h3 * 10) | 0;
      for (let i = 0; i < 3; i++) {
        px(g, cx + i, cy + ((i % 2) ? 1 : 0), DECO.iceCrack);
      }
    }
    if (h3 > 0.85) {
      const gx = ox + 4 + (h4 * 8) | 0;
      const gy = oy + 3 + (h1 * 8) | 0;
      px(g, gx, gy, DECO.iceGlint);
    }
    return;
  }

  // ── Gravel path: scattered pebbles (no trees — paths are cleared) ────────
  if (tileType === TileType.GravelPath) {
    if (h1 > 0.55) {
      const px1 = ox + 2 + (h2 * 12) | 0;
      const py1 = oy + 3 + (h3 * 10) | 0;
      px(g, px1, py1, h4 > 0.5 ? DECO.pebbleLight : DECO.pebbleDark, 2, 1);
    }
    if (h3 > 0.85) {
      const px2 = ox + 6 + (h4 * 6) | 0;
      const py2 = oy + 7 + (h1 * 4) | 0;
      px(g, px2, py2, DECO.pebbleDark, 1, 1);
    }
    return;
  }

  // ── Shore ────────────────────────────────────────────────────────────────
  if (isShoreType(tileType)) {
    if (h1 > 0.4) {
      const fy = oy + 1;
      const fx = ox + (h2 * 8) | 0;
      const fLen = 3 + (h3 * 5) | 0;
      px(g, fx, fy, DECO.shoreFoam, fLen, 1);
    }
    if (h4 > 0.6) {
      px(g, ox + 2, oy + 13, DECO.shoreWet, 4, 1);
    }
    return;
  }

  // ── Water (static wave lines — shimmer is animated separately) ───────────
  if (isWaterType(tileType)) {
    if (h1 > 0.65) {
      const wx2 = ox + 1 + (h2 * 10) | 0;
      const wy2 = oy + 4 + (h3 * 8) | 0;
      px(g, wx2, wy2, h4 > 0.5 ? DECO.waveLight : DECO.waveDark, 3, 1);
    }
    return;
  }
}

// ── Chunk Render State ──────────────────────────────────────────────────────

interface ChunkRenderState {
  base: Container;
  deco: Graphics;
  water: Container;
  animatedTiles: AnimatedTile[];
  decoSprites: Sprite[];
  waterSprites: Sprite[];
}

// ── TileRenderer ────────────────────────────────────────────────────────────

/** Callback to query any tile in the world by world coordinates. */
export type WorldTileQuery = (wx: number, wy: number) => TileType | null;

export class TileRenderer {
  private readonly stage: Container;
  private readonly camera: Camera;
  private readonly chunks = new Map<string, ChunkRenderState>();
  private getWorldTileAt: WorldTileQuery = () => null;

  constructor(stage: Container, camera: Camera) {
    this.stage = stage;
    this.camera = camera;
  }

  /** Set the cross-chunk tile lookup function (must be called before renderChunk). */
  setWorldTileQuery(fn: WorldTileQuery): void {
    this.getWorldTileAt = fn;
  }

  renderChunk(chunk: Chunk): void {
    const key = `${chunk.cx},${chunk.cy}`;
    if (this.chunks.has(key)) return;

    const chunkPx = CHUNK_SIZE * TILE_PX;
    const base = new Container();
    const deco = new Graphics();
    const water = new Container();

    const animatedTiles = findAnimatedTiles(chunk.tiles);
    const animatedSet = new Set(animatedTiles.map((t) => t.ly * CHUNK_SIZE + t.lx));
    const atlasCount = textureManager.atlasCount;

    // ── Layer 1: base ground ──────────────────────────────────────────────
    const baseG = new Graphics();
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileType = chunk.tiles[ly]?.[lx];
        if (tileType === undefined) continue;
        if (animatedSet.has(ly * CHUNK_SIZE + lx)) continue;

        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const pxPos = lx * TILE_PX;
        const py = ly * TILE_PX;

        // Try spritesheet tile first (grass/sand — other terrain is procedural)
        const tex = textureManager.getTileTexture(tileType);
        if (tex) {
          const sprite = new Sprite(tex);
          sprite.x = pxPos;
          sprite.y = py;
          base.addChild(sprite);

          // Deterministic ground-edge overlay: sand tiles fringed toward grass-family
          // neighbors via the shared 8-neighbor bitmask (cross-chunk aware).
          if (isSandFamilyTile(tileType)) {
            const mask = computeNeighborMask(wx, wy, (x, y) => {
              const t = this.getWorldTileAt(x, y);
              return t !== null && isGrassFamilyTile(t);
            });
            for (const edge of getGroundEdgeTiles(mask)) {
              const edgeTex = textureManager.getGroundEdgeTexture(edge.index);
              if (edgeTex) {
                const overlay = new Sprite(edgeTex);
                overlay.x = pxPos;
                overlay.y = py;
                base.addChild(overlay);
              }
            }
          }

          continue;
        }

        // Fallback: procedural color
        const baseColor = BASE_COLORS[tileType] ?? 0xff00ff;
        const color = tileColor(tileType, baseColor, wx, wy, VARIATION_SEED);
        baseG.rect(pxPos, py, TILE_PX, TILE_PX);
        baseG.fill(color);
      }
    }
    base.addChild(baseG);

    // ── Layer 2: unified decorations ──────────────────────────────────────
    // Collect both procedural details (flat Graphics) and atlas sprites
    // that need Y-sorting for correct overlap.
    // Pass 1: two-tile trees (canopy + trunk pairs for forest terrain)
    // Pass 2: one-tile trees (27/28 for forest terrain)
    // Pass 3: all other decorations (non-tree atlas + procedural)
    const decoSprites: Sprite[] = [];
    /** Set of (ly * CHUNK_SIZE + lx) keys for cells already consumed by a tree canopy */
    const consumedCanopy = new Set<number>();
    /** Set of (ly * CHUNK_SIZE + lx) keys for cells that already have an atlas tree placed */
    const treePlaced = new Set<number>();

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileType = chunk.tiles[ly]?.[lx];
        if (tileType === undefined) continue;
        if (animatedSet.has(ly * CHUNK_SIZE + lx)) continue;
        if (!isForestType(tileType)) continue;

        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;

        // ── Pass 1: two-tile tree ────────────────────────────────────────
        if (ly > 0) {
          const twoTile = selectTwoTileTree(wx, wy, VARIATION_SEED, atlasCount);
          if (twoTile !== null) {
            const canopyLy = ly - 1;
            const canopyKey = canopyLy * CHUNK_SIZE + lx;

            if (!consumedCanopy.has(canopyKey)) {
              const canopyTex = textureManager.getAtlasTexture(twoTile.canopy);
              const trunkTex = textureManager.getAtlasTexture(twoTile.trunk);
              if (canopyTex && trunkTex) {
                const trunkSprite = new Sprite(trunkTex);
                trunkSprite.x = lx * TILE_PX;
                trunkSprite.y = ly * TILE_PX;
                decoSprites.push(trunkSprite);

                const canopySprite = new Sprite(canopyTex);
                canopySprite.x = lx * TILE_PX;
                canopySprite.y = canopyLy * TILE_PX;
                decoSprites.push(canopySprite);

                consumedCanopy.add(canopyKey);
                treePlaced.add(ly * CHUNK_SIZE + lx);
                continue;
              }
            }
          }
        }

        // ── Pass 2: one-tile tree (27 or 28) ────────────────────────────
        const oneTile = selectOneTileTree(wx, wy, VARIATION_SEED, atlasCount);
        if (oneTile !== null) {
          const tex = textureManager.getAtlasTexture(oneTile);
          if (tex) {
            const sprite = new Sprite(tex);
            sprite.x = lx * TILE_PX;
            sprite.y = ly * TILE_PX;
            decoSprites.push(sprite);
            treePlaced.add(ly * CHUNK_SIZE + lx);
            continue;
          }
        }
      }
    }

    // ── Pass 3: non-tree decorations ─────────────────────────────────────
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileType = chunk.tiles[ly]?.[lx];
        if (tileType === undefined) continue;
        if (animatedSet.has(ly * CHUNK_SIZE + lx)) continue;

        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;

        // For forest tiles, only draw procedural fallback if no atlas tree was placed
        if (isForestType(tileType)) {
          if (treePlaced.has(ly * CHUNK_SIZE + lx)) continue;
          // Procedural forest fallback
          drawDecorations(deco, tileType, lx, ly, wx, wy);
          continue;
        }

        // Try atlas decoration first
        const atlasDeco = selectDecorationWithOffset(
          tileType, wx, wy, VARIATION_SEED, atlasCount,
        );

        if (atlasDeco !== null) {
          const tex = textureManager.getAtlasTexture(atlasDeco.atlasIndex);
          if (tex) {
            const sprite = new Sprite(tex);
            sprite.x = lx * TILE_PX + atlasDeco.xOffset;
            sprite.y = ly * TILE_PX + atlasDeco.yOffset;
            decoSprites.push(sprite);
            continue;
          }
          // Atlas texture not loaded — fall through to procedural
        }

        // Procedural fallback: draw small details to flat Graphics
        drawDecorations(deco, tileType, lx, ly, wx, wy);
      }
    }

    base.addChild(deco);

    // Sort atlas decoration sprites by world Y (bottom edge), then X for stability
    decoSprites.sort((a, b) => {
      const dy = a.y - b.y;
      if (dy !== 0) return dy;
      return a.x - b.x;
    });
    for (const s of decoSprites) base.addChild(s);

    // ── Layer 3: animated water sprites ──────────────────────────────────
    // Shore tiles are selected deterministically via 8-neighbor bitmask
    // using the same getShoreTiles() rule system as the shore-debug tool.
    const waterSprites: Sprite[] = [];
    const getTile = this.getWorldTileAt;

    for (const { lx, ly, tileType } of animatedTiles) {
      const wx = chunk.cx * CHUNK_SIZE + lx;
      const wy = chunk.cy * CHUNK_SIZE + ly;

      // Compute 8-neighbor bitmask (cross-chunk aware via getWorldTileAt)
      const mask = computeNeighborMask(wx, wy, (x, y) => {
        const t = getTile(x, y);
        return t !== null && !isWaterType(t);
      });

      let tex: Texture | null = null;
      if (mask !== 0) {
        // This water tile has at least one land neighbor → draw shore tiles
        const shoreTiles = getShoreTiles(mask);
        // Composite: draw base water first, then overlay each shore texture
        // (same approach as shore-debug preview-renderer: draw all layers on top)
        tex = textureManager.getPureWaterTexture();
        if (tex) {
          const s = new Sprite(tex);
          s.x = lx * TILE_PX;
          s.y = ly * TILE_PX;
          water.addChild(s);
          waterSprites.push(s);
        }
        // Overlay shore textures deterministically
        for (const st of shoreTiles) {
          const shoreName = st.type === 'concave'
            ? `shore${st.index}`
            : `convex-shore${st.index}`;
          const shoreTex = textureManager.getShoreTextureByName(shoreName);
          if (shoreTex) {
            const s = new Sprite(shoreTex);
            s.x = lx * TILE_PX;
            s.y = ly * TILE_PX;
            water.addChild(s);
            waterSprites.push(s);
          }
        }
        continue;
      }

      // Deep water — no land neighbors at all
      tex = textureManager.getPureWaterTexture();
      if (tex) {
        const s = new Sprite(tex);
        s.x = lx * TILE_PX;
        s.y = ly * TILE_PX;
        water.addChild(s);
        waterSprites.push(s);
      } else {
        const wg = new Graphics();
        wg.rect(lx * TILE_PX, ly * TILE_PX, TILE_PX, TILE_PX);
        wg.fill(BASE_COLORS[tileType] ?? 0x3b7dd8);
        water.addChild(wg);
      }
    }

    base.x = chunk.cx * chunkPx;
    base.y = chunk.cy * chunkPx;
    water.x = base.x;
    water.y = base.y;
    this.stage.addChild(base);
    this.stage.addChild(water);

    this.chunks.set(key, { base, deco, water, animatedTiles, decoSprites, waterSprites });
  }

  removeChunk(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    const state = this.chunks.get(key);
    if (state) {
      this.stage.removeChild(state.base);
      this.stage.removeChild(state.water);
      state.base.destroy({ children: true });
      state.water.destroy({ children: true });
      this.chunks.delete(key);
    }
  }

  pruneChunks(visibleChunks: Set<string>): void {
    for (const [key, state] of this.chunks) {
      if (!visibleChunks.has(key)) {
        this.stage.removeChild(state.base);
        this.stage.removeChild(state.water);
        state.base.destroy({ children: true });
        state.water.destroy({ children: true });
        this.chunks.delete(key);
      }
    }
  }

  update(_time: number): void {
    // Shore textures are now deterministic (bitmask-based), no animation needed.
    // Water shimmer is handled by TileAnimations waterShimmer() in the base layer.
    // This method is kept for API compatibility but is now a no-op for shore logic.
  }

  getRenderedKeys(): Set<string> {
    return new Set(this.chunks.keys());
  }

  get renderedCount(): number {
    return this.chunks.size;
  }

  destroy(): void {
    for (const [, state] of this.chunks) {
      this.stage.removeChild(state.base);
      this.stage.removeChild(state.water);
      state.base.destroy({ children: true });
      state.water.destroy({ children: true });
    }
    this.chunks.clear();
  }

}
