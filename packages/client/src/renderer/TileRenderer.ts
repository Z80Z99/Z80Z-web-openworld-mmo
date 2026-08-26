import { Graphics, Container, Sprite, Texture } from "pixi.js";
import { TileType, CHUNK_SIZE, DEFAULT_SEED, getShoreTiles, computeNeighborMask, getGroundEdgeTiles, getCoastalInnerTiles, isGrassFamilyTile, isSandFamilyTile } from "@mmo/shared";
import type { Chunk } from "@mmo/shared";
import type { Camera } from "./Camera.js";
import { textureManager } from "./TextureManager.js";
import {
  selectDecorationWithOffset,
  selectOneTileTree,
  selectTwoTileTree,
} from "./DecorationRegistry.js";
import {
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

// ── Tile Category Helpers ───────────────────────────────────────────────────

function isWaterType(t: number): boolean {
  return t === TileType.Water || t === TileType.DeepWater ||
    t === TileType.WaterVariant1 || t === TileType.WaterVariant2 ||
    t === TileType.DeepWaterVariant1;
}

function isForestType(t: number): boolean {
  return t === TileType.Forest || t === TileType.ForestVariant1 ||
    t === TileType.ForestVariant2 || t === TileType.ShoreForest ||
    t === TileType.GrassToForest || t === TileType.ForestToSwamp ||
    t === TileType.ForestToStone;
}

// ── Chunk Render State ──────────────────────────────────────────────────────────────────

interface ChunkRenderState {
  base: Container;
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
          const placedEdgeIndices = new Set<number>();
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
                placedEdgeIndices.add(edge.index);
              }
            }
          }

          // Coastal inner transition (land side): land tiles bordering water
          // get a sand/dirt blend overlay reusing the same ground-edge assets.
          // Sand centers fringe toward the water; grass centers turn sand-looking
          // with the band inland. Same-index sprites are pixel-identical, so a
          // tile never stacks the same texture twice.
          if (isGrassFamilyTile(tileType) || isSandFamilyTile(tileType)) {
            const waterMask = computeNeighborMask(wx, wy, (x, y) => {
              const t = this.getWorldTileAt(x, y);
              return t !== null && isWaterType(t);
            });
            if (waterMask !== 0) {
              for (const edge of getCoastalInnerTiles(tileType, waterMask)) {
                if (placedEdgeIndices.has(edge.index)) continue;
                const edgeTex = textureManager.getGroundEdgeTexture(edge.index);
                if (edgeTex) {
                  const overlay = new Sprite(edgeTex);
                  overlay.x = pxPos;
                  overlay.y = py;
                  base.addChild(overlay);
                  placedEdgeIndices.add(edge.index);
                }
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
    // Collect atlas sprites that need Y-sorting for correct overlap.
    // Pass 1: two-tile trees (canopy + trunk pairs for forest terrain)
    // Pass 2: one-tile trees (27/28 for forest terrain)
    // Pass 3: all other non-tree atlas decorations
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

    // ── Pass 3: non-tree atlas decorations ───────────────────────────────
    // Forest tiles are skipped: trees were placed in Passes 1–2 via
    // selectTwoTileTree/selectOneTileTree (the atlas tree system).
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const tileType = chunk.tiles[ly]?.[lx];
        if (tileType === undefined) continue;
        if (animatedSet.has(ly * CHUNK_SIZE + lx)) continue;
        if (isForestType(tileType)) continue;

        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;

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
          }
        }
      }
    }

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

    this.chunks.set(key, { base, water, animatedTiles, decoSprites, waterSprites });
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
