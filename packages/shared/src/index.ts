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
} from "./types/constants.js";

// World generation
export {
  WorldGenerator,
  TileType,
  Biome,
  DEFAULT_CONFIG,
  normalise,
  lookupBiome,
  biomeToTile,
  resolveTile,
} from "./world-gen/index.js";

export type { Chunk, WorldGenConfig } from "./world-gen/index.js";
