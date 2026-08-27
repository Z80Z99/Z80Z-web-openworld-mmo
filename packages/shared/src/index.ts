export const SHARED_VERSION = "0.0.1" as const;

// Re-export all types, schemas, and constants
export {
  PlayerState,
  EntityState,
  TileState,
  RoomState,
} from "./types/schema.js";

export type {
  Item,
  ChatMessage,
  TradeRequest,
  TradeConfirm,
  AuthRegister,
  AuthLogin,
  CraftRequest,
  MountAction,
  AttackMessage,
  EncounterActionMessage,
  CombatEventPayload,
  ClientMessage,
} from "./types/messages.js";

export {
  TICK_RATE,
  AOI_CHUNK_RADIUS,
  CHUNK_SIZE,
  MOVE_SPEED,
  OFFLINE_CAP_HOURS,
  MAX_TRADE_ITEMS,
  MAX_CRAFT_INPUTS,
  DEFAULT_SEED,
} from "./types/constants.js";

// World generation
export {
  WorldGenerator,
  TileType,
  Biome,
  DEFAULT_CONFIG,
  normalise,
  lookupBiome,
  lookupBiomeLayered,
  biomeToTile,
  biomeToVariantTile,
  Direction,
  DIRECTION_NAMES,
  DIRECTION_MASK,
  registerShoreRule,
  getShoreRule,
  clearShoreRules,
  getShoreTiles,
  getMaskFromNeighbors,
  getNeighborsFromMask,
  maskToBinary,
  getActiveDirections,
  computeNeighborMask,
  isGrassFamilyTile,
  isSandFamilyTile,
  getGroundEdgeTiles,
  invert180,
  getCoastalInnerTiles,
  hash01,
  getAnchorPoint,
  segmentExists,
  isPathTileAt,
  applyGravelPaths,
  DEFAULT_PATH_CONFIG,
} from "./world-gen/index.js";

export type { Chunk, WorldGenConfig, LayeredBiomeParams, ShoreTile, ShoreRule, GroundEdgeTile, PathLatticeConfig } from "./world-gen/index.js";

// Dynamic Battle Area (Phase 0 rule layer — standalone, not yet wired into production combat)
export * from "./battle/index.js";
