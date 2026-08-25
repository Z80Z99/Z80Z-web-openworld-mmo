import { Assets, Texture, Rectangle } from "pixi.js";
import { TileType } from "@mmo/shared";

/**
 * Tiny Town tilemap spritesheet layout:
 * 12 columns x 11 rows, 16px tiles, 0 spacing
 * Total: 132 tiles (indices 0–131)
 *
 * All 132 tiles are indexed at load time. Ground-type mapping and
 * decoration selection live in separate modules; TextureManager is
 * responsible only for slicing the sheet into reusable Texture objects.
 */
const TILEMAP_SHEET = "/assets/tiny-town/Tilemap/tilemap_packed.png";
const CHARACTER_SHEET = "/assets/characters/roguelikeChar_transparent.png";
const BATTLE_SHEET = "/assets/kenney_tiny-battle/Tilemap/tilemap_packed.png";
const TILE_SIZE = 16;
const SPACING = 0;
export const TILEMAP_COLS = 12;
export const TILEMAP_ROWS = 11;
export const TOTAL_ATLAS_TILES = TILEMAP_COLS * TILEMAP_ROWS; // 132

/** Tiny Battle tilemap: 18 cols × 11 rows, 1px spacing */
const BATTLE_COLS = 18;
const BATTLE_SPACING = 1;

/**
 * Map TileType to Tiny Town tilemap index.
 * Grass variants map to ground tiles 0–2; Sand (dirt visual) maps to atlas 25.
 * Everything else uses procedural rendering.
 */
// Ground tiles load from STANDALONE per-tile PNGs in /assets/game-assets/
// (byte-identical to their Tiny Town atlas cells). Individual files have no
// sheet neighbours, so linear sampling can never bleed a neighbouring atlas
// tile's colours into tile edges when the stage lands on subpixel positions.
// Trees and other decorations keep using the full atlas slicing below.
const GROUND_TILE_FILES: Record<number, string> = {
  [TileType.Grass]:         "grass1.png",
  [TileType.GrassVariant1]: "grass2.png",
  [TileType.GrassVariant2]: "grass3.png",
  [TileType.Sand]:          "dirt1.png",
  [TileType.SandVariant1]:  "dirt1.png",
  [TileType.Forest]:         "grass1.png",
  [TileType.ForestVariant1]: "grass2.png",
  [TileType.ForestVariant2]: "grass3.png",
  [TileType.GrassToForest]:  "grass1.png",
  [TileType.ForestToSwamp]:  "grass1.png",
  [TileType.ForestToStone]:  "grass1.png",
  [TileType.GrassToSand]:    "grass1.png",
  [TileType.GravelPath]:     "gravel1.png",
};

/**
 * Tiny Battle water tile indices (18-col grid, 1px spacing):
 *   37 = pure water (main)
 *
 * Concave shore tiles (凹岸 — water on edge, land in center):
 *   18 = 左上凹岸 (top-left)
 *   19 = 正上凹岸 (top-center)
 *   20 = 右上凹岸 (top-right)
 *   36 = 正左凹岸 (left-center)
 *   38 = 正右凹岸 (right-center)
 *   54 = 左下凹岸 (bottom-left)
 *   55 = 正下凹岸 (bottom-center)
 *   56 = 右下凹岸 (bottom-right)
 *
 * Convex shore tiles (凸岸 — land on edge, water in center):
 *   90 = 右下凸岸 (bottom-right)
 *   91 = 左下凸岸 (bottom-left)
 *   92 = 左上凸岸 (top-left)
 *   93 = 右上凸岸 (top-right)
 */
export const WATER_TILES = {
  pure: [0],  // water1.png
  shore: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],  // shore1-8 + convex-shore1-4
} as const;

/** Character sprite indices in Kenney roguelikeChar_transparent.png
 *  918x203 image, 16px tiles, 1px spacing = 54 columns x 12 rows
 *  Each character type is in a separate row, starting at col 0 */
const CHARACTER_SHEET_COLS = 54;
const CHARACTER_INDICES: Record<string, number> = {
  player: 0,       // row 0, col 0
  wolf: 54,        // row 1, col 0
  scorpion: 108,   // row 2, col 0
  skeleton: 162,   // row 3, col 0
  slime: 216,      // row 4, col 0
};

/**
 * TextureManager — loads Kenney Tiny Town tilemap + character sprites.
 *
 * All 132 atlas tiles are sliced and stored for use by the decoration
 * system. Grass TileType textures are also stored for ground rendering.
 */
export class TextureManager {
  private tileTextures = new Map<number, Texture>();
  private atlasTextures = new Map<number, Texture>();
  private characterTextures = new Map<string, Texture>();
  private pureWaterTexture: Texture | null = null;
  private shoreTextures: Texture[] = [];
  private groundEdgeTextures: Texture[] = [];
  private tilemapLoaded = false;
  private charactersLoaded = false;

  async load(): Promise<void> {
    await Promise.all([this.loadTilemap(), this.loadCharacters(), this.loadBattleWater()]);
  }

  private async loadTilemap(): Promise<void> {
    try {
      // Ground tiles: standalone PNGs, nearest-neighbour sampled (pixel art
      // must not blend texels when scaled by the world stage).
      const groundEntries = Object.entries(GROUND_TILE_FILES);
      await Promise.all(
        groundEntries.map(async ([typeStr, file]) => {
          const tex = await Assets.load(`/assets/game-assets/${file}`);
          tex.source.scaleMode = "nearest";
          this.tileTextures.set(parseInt(typeStr), tex);
        }),
      );

      // Decoration atlas: slice all 132 Tiny Town tiles for trees/decor.
      const sheet = await Assets.load(TILEMAP_SHEET);
      sheet.source.scaleMode = "nearest";
      for (let i = 0; i < TOTAL_ATLAS_TILES; i++) {
        const col = i % TILEMAP_COLS;
        const row = Math.floor(i / TILEMAP_COLS);
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const frame = new Rectangle(x, y, TILE_SIZE, TILE_SIZE);
        const tex = new Texture({ source: sheet.source, frame });
        this.atlasTextures.set(i, tex);
      }
      this.tilemapLoaded = true;
    } catch {
      console.warn("[TextureManager] Failed to load Tiny Town tilemap, using procedural fallback");
      this.tilemapLoaded = false;
    }
  }

  private async loadCharacters(): Promise<void> {
    try {
      const sheet = await Assets.load(CHARACTER_SHEET);
      sheet.source.scaleMode = "nearest";
      for (const [key, index] of Object.entries(CHARACTER_INDICES)) {
        const col = index % CHARACTER_SHEET_COLS;
        const row = Math.floor(index / CHARACTER_SHEET_COLS);
        const x = col * (TILE_SIZE + 1); // 1px spacing for characters
        const y = row * (TILE_SIZE + 1);
        const frame = new Rectangle(x, y, TILE_SIZE, TILE_SIZE);
        const tex = new Texture({ source: sheet.source, frame });
        this.characterTextures.set(key, tex);
      }
      this.charactersLoaded = true;
    } catch {
      console.warn("[TextureManager] Failed to load character spritesheet, using procedural fallback");
      this.charactersLoaded = false;
    }
  }

  private async loadBattleWater(): Promise<void> {
    try {
      const waterTex = await Assets.load("/assets/game-assets/water1.png");
      waterTex.source.scaleMode = "nearest";
      this.pureWaterTexture = waterTex;

      const shoreNames = [
        "shore1", "shore2", "shore3", "shore4", "shore5", "shore6", "shore7", "shore8",
        "convex-shore1", "convex-shore2", "convex-shore3", "convex-shore4"
      ];

      for (const name of shoreNames) {
        const shoreTex = await Assets.load(`/assets/game-assets/${name}.png`);
        shoreTex.source.scaleMode = "nearest";
        this.shoreTextures.push(shoreTex);
      }

      const edgeGrassDirtCount = 12;
      for (let i = 1; i <= edgeGrassDirtCount; i++) {
        const edgeTex = await Assets.load(`/assets/game-assets/edge-grass-dirt${i}.png`);
        edgeTex.source.scaleMode = "nearest";
        this.groundEdgeTextures.push(edgeTex);
      }
    } catch (e) {
      console.warn("[TextureManager] Failed to load water tiles:", e);
    }
  }

  isLoaded(): boolean {
    return this.tilemapLoaded || this.charactersLoaded;
  }

  isTilemapLoaded(): boolean {
    return this.tilemapLoaded;
  }

  /** Get a tile texture by TileType. Returns null if not available. */
  getTileTexture(type: number): Texture | null {
    return this.tileTextures.get(type) ?? null;
  }

  /** Get an atlas texture by flat index (0–131). Returns null if not loaded. */
  getAtlasTexture(atlasIndex: number): Texture | null {
    return this.atlasTextures.get(atlasIndex) ?? null;
  }

  /** Whether a given atlas index has a loaded texture. */
  hasAtlasIndex(atlasIndex: number): boolean {
    return this.atlasTextures.has(atlasIndex);
  }

  /** Number of loaded atlas tiles. */
  get atlasCount(): number {
    return this.atlasTextures.size;
  }

  /**
   * Get the source file name for a ground TileType, or null if unmapped.
   * Ground tiles load from standalone PNGs — see GROUND_TILE_FILES.
   */
  getGroundFileForTileType(tileType: number): string | null {
    return GROUND_TILE_FILES[tileType] ?? null;
  }

  /** Get a tree texture by index (0-based into treeTextures array). */
  getTreeTexture(index: number): Texture | null {
    const count = this.atlasTextures.size;
    if (count === 0) return null;
    return this.atlasTextures.get(index % count) ?? null;
  }

  /** Number of available tree textures (legacy — returns atlas count). */
  get treeCount(): number {
    return this.atlasTextures.size;
  }

  /** Get a character texture by type (player, remote, wolf, scorpion, skeleton, slime). */
  getCharacterTexture(type: string): Texture | null {
    return this.characterTextures.get(type) ?? null;
  }

  /** Get pure water texture. */
  getPureWaterTexture(): Texture | null {
    return this.pureWaterTexture;
  }

  // ── Shore texture lookup by name ──────────────────────────────────────

  /**
   * Name → flat-index mapping for the shoreTextures array.
   *   shore1–shore8        → 0–7   (concave, one per direction)
   *   convex-shore1–4      → 8–11  (convex corners)
   */
  private static readonly SHORE_NAME_TO_INDEX: Record<string, number> = {
    shore1: 0, shore2: 1, shore3: 2, shore4: 3,
    shore5: 4, shore6: 5, shore7: 6, shore8: 7,
    "convex-shore1": 8, "convex-shore2": 9,
    "convex-shore3": 10, "convex-shore4": 11,
  };

  /**
   * Get a shore texture by name (e.g. "shore1", "convex-shore3").
   * Returns null if the name is unknown or textures are not loaded.
   */
  getShoreTextureByName(name: string): Texture | null {
    const idx = TextureManager.SHORE_NAME_TO_INDEX[name];
    if (idx === undefined || idx >= this.shoreTextures.length) return null;
    return this.shoreTextures[idx];
  }

  /** Get a shore texture by flat index (0–11). */
  getShoreTexture(index: number): Texture | null {
    if (this.shoreTextures.length === 0) return null;
    return this.shoreTextures[index % this.shoreTextures.length];
  }

  /** Number of loaded shore textures. */
  get shoreCount(): number {
    return this.shoreTextures.length;
  }

  /** Get a ground-edge texture by 1-based index (1–8). Returns null if out of range. */
  getGroundEdgeTexture(index: number): Texture | null {
    if (index < 1 || index > this.groundEdgeTextures.length) return null;
    return this.groundEdgeTextures[index - 1] ?? null;
  }

  destroy(): void {
    for (const tex of this.tileTextures.values()) tex.destroy(true);
    for (const tex of this.atlasTextures.values()) tex.destroy(true);
    for (const tex of this.characterTextures.values()) tex.destroy(true);
    if (this.pureWaterTexture) this.pureWaterTexture.destroy(true);
    for (const tex of this.shoreTextures) tex.destroy(true);
    for (const tex of this.groundEdgeTextures) tex.destroy(true);
    this.tileTextures.clear();
    this.atlasTextures.clear();
    this.characterTextures.clear();
    this.pureWaterTexture = null;
    this.shoreTextures = [];
    this.groundEdgeTextures = [];
    this.tilemapLoaded = false;
    this.charactersLoaded = false;
  }
}

export const textureManager = new TextureManager();
