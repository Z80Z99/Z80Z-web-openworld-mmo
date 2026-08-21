export const CLIENT_VERSION = "0.0.1" as const;

// Re-export public API
export {
  Camera, TileRenderer, TILE_PX, EntityRenderer,
  ChunkManager, MobRenderer,
  tileHash, varyColor, tileColor, waterShimmer, isAnimatedTile, findAnimatedTiles,
} from "./renderer/index.js";
export type {
  ChunkData, ChunkRequestHandler, ViewBounds, ChunkUpdateResult, AnimatedTile,
  MobData,
} from "./renderer/index.js";
export { NetworkManager } from "./network/index.js";
export type { IdleClaimResult, IdleSummary, NetworkCallbacks } from "./network/index.js";
export { InputManager } from "./input/index.js";
export { TouchControls } from "./input/index.js";
export type { InputVector, InputListener, ActionId, ActionHandler } from "./input/index.js";
export { GameState } from "./game/index.js";
export type { LocalPlayer, RemotePlayer, MobState, CombatEvent } from "./game/index.js";
export { HUD, CombatUI, IdleUI, MobileUI } from "./ui/index.js";
export type {
  ChatSubmitHandler,
  DamageNumber,
  IdleClaimHandler,
  IdleUIData,
  MobHealthBar,
  ChatToggleHandler,
} from "./ui/index.js";
