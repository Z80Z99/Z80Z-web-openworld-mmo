import { Assets, Texture, Rectangle } from "pixi.js";
import { TileType } from "@mmo/shared";

/** Tile size in pixels (Kenney packs use 16x16). */
const TILE_SIZE = 16;
/** Spacing between tiles in spritesheet (1px). */
const TILE_SPACING = 1;

/**
 * Maps game TileType values to tile indices in Kenney Tiny Town tileset.
 * Tileset layout: 12 columns × 11 rows (132 tiles total).
 * Index 0 = top-left, counting left→right, top→bottom.
 */
const TILE_TYPE_TO_INDEX: Record<number, number> = {
  [TileType.Grass]: 0,       // grass tile
  [TileType.Water]: 27,      // water tile
  [TileType.Sand]: 12,       // sand/dirt tile
  [TileType.Stone]: 36,      // stone tile
  [TileType.Forest]: 3,      // tree/forest tile
  [TileType.Snow]: 54,       // snow tile
  [TileType.DeepWater]: 28,  // deep water tile
  [TileType.Swamp]: 15,      // swamp/mud tile
  [TileType.Ice]: 55,        // ice tile
};

/**
 * Character sprite indices in Kenney Roguelike Characters spritesheet.
 * The spritesheet contains multiple 16x16 characters arranged in a grid.
 */
const CHARACTER_INDICES = {
  player: 0,      // first character (blue/magenta)
  remote: 4,      // different colored character
  wolf: 12,       // wolf-like creature
  scorpion: 16,   // scorpion-like creature
  skeleton: 20,   // skeleton
  slime: 24,      // slime
};

/**
 * Manages loading and caching of game textures from spritesheets.
 * Handles slicing Kenney-format spritesheets (16x16, 1px spacing).
 */
export class TextureManager {
  private tileTextures = new Map<number, Texture>();
  private characterTextures = new Map<string, Texture>();
  private loaded = false;

  /** Load all game textures from asset files. */
  async load(): Promise<void> {
    if (this.loaded) return;

    // Load tileset
    const tilesetTexture = await Assets.load("/assets/tiles/tilemap_packed.png");
    this.sliceTileset(tilesetTexture);

    // Load character spritesheet
    const charTexture = await Assets.load("/assets/characters/roguelikeChar_transparent.png");
    this.sliceCharacters(charTexture);

    this.loaded = true;
  }

  /** Get texture for a tile type. Falls back to magenta if missing. */
  getTileTexture(type: number): Texture {
    return this.tileTextures.get(type) ?? this.tileTextures.get(0)!;
  }

  /** Get texture for a character/mob type. */
  getCharacterTexture(type: string): Texture {
    return this.characterTextures.get(type) ?? this.characterTextures.get("player")!;
  }

  /** Check if textures are loaded. */
  isLoaded(): boolean {
    return this.loaded;
  }

  /* ── Private ── */

  /** Slice tileset spritesheet into individual tile textures. */
  private sliceTileset(sheet: Texture): void {
    const source = sheet.source;
    const cols = 12;
    // const rows = 11;

    for (const [typeStr, index] of Object.entries(TILE_TYPE_TO_INDEX)) {
      const type = Number(typeStr);
      const col = index % cols;
      const row = Math.floor(index / cols);

      const x = col * (TILE_SIZE + TILE_SPACING);
      const y = row * (TILE_SIZE + TILE_SPACING);

      const frame = new Rectangle(x, y, TILE_SIZE, TILE_SIZE);
      const texture = new Texture({ source, frame });
      this.tileTextures.set(type, texture);
    }
  }

  /** Slice character spritesheet into individual character textures. */
  private sliceCharacters(sheet: Texture): void {
    const source = sheet.source;
    const cols = 8; // roguelike chars are 8 per row

    for (const [name, index] of Object.entries(CHARACTER_INDICES)) {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const x = col * (TILE_SIZE + TILE_SPACING);
      const y = row * (TILE_SIZE + TILE_SPACING);

      const frame = new Rectangle(x, y, TILE_SIZE, TILE_SIZE);
      const texture = new Texture({ source, frame });
      this.characterTextures.set(name, texture);
    }
  }
}

/** Singleton texture manager. */
export const textureManager = new TextureManager();
