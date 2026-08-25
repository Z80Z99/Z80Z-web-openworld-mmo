export { WorldGenerator } from "./WorldGenerator.js";
export {
  TileType,
  Biome,
  CHUNK_SIZE,
  DEFAULT_CONFIG,
  type Chunk,
  type WorldGenConfig,
} from "./types.js";
export {
  normalise,
  lookupBiome,
  lookupBiomeLayered,
  biomeToTile,
  biomeToVariantTile,
  resolveTile,
  resolveChunkTiles,
  type LayeredBiomeParams,
} from "./biomes.js";
export {
  Direction,
  DIRECTION_NAMES,
  DIRECTION_MASK,
  type ShoreTile,
  type ShoreRule,
  registerShoreRule,
  getShoreRule,
  clearShoreRules,
  getShoreTiles,
  getMaskFromNeighbors,
  getNeighborsFromMask,
  maskToBinary,
  getActiveDirections,
  computeNeighborMask,
} from "./shore-rules.js";
