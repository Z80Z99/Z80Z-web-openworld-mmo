/** Item used in trades and crafts */
export interface Item {
  id: string;
  quantity: number;
}

export interface ChatMessage {
  type: "chat";
  content: string;
}

export interface TradeRequest {
  type: "trade_request";
  targetId: string;
}

export interface TradeConfirm {
  type: "trade_confirm";
  tradeId: string;
  items: Item[];
}

export interface AuthRegister {
  type: "auth_register";
  guestToken: string;
  username: string;
  password: string;
}

export interface AuthLogin {
  type: "auth_login";
  username: string;
  password: string;
}

export interface CraftRequest {
  type: "craft_request";
  recipeId: string;
}

export interface MountAction {
  type: "mount_action";
  mountId: string;
  action: "mount" | "dismount";
}

/** Player attacks a mob */
export interface AttackMessage {
  type: "attack";
  targetId: string;
}

/** Player performs an encounter action (turn-based combat) */
export interface EncounterActionMessage {
  type: "encounter_action";
  action: "attack" | "defend" | "flee";
  /** Explicit target for multi-enemy encounters. Falls back to auto-derivation when absent or invalid. */
  targetId?: string;
}

/** All combat event type names the server currently emits. */
export type CombatEventType =
  | "damage_dealt"
  | "mob_killed"
  | "player_damaged"
  | "player_died"
  | "xp_gained"
  | "loot_dropped"
  | "player_respawn"
  | "level_up"
  | "mob_respawn"
  | "encounter_started"
  | "defend"
  | "encounter_fled"
  | "encounter_timeout";

/**
 * Unified server→client combat event payload.
 * `type` is one of the CombatEventType literals; fields are optional
 * because each event variant carries a different subset.
 */
export interface CombatEventPayload {
  type: CombatEventType;
  sourceId: string;
  targetId: string;
  damage?: number;
  xp?: number;
  loot?: string[];
  currentHp?: number;
  maxHp?: number;
  mobType?: string;
  level?: number;
  attack?: number;
  defense?: number;
  /** encounter_started: the mob involved. */
  mobId?: string;
  mobHp?: number;
  mobMaxHp?: number;
  playerHp?: number;
  playerMaxHp?: number;
  /** Terminal encounter events (victory/fled/player_died/timeout). */
  reason?: string;
  /** Current encounter round. */
  round?: number;
}

/** Union of all client-to-server message types */
export type ClientMessage =
  | ChatMessage
  | TradeRequest
  | TradeConfirm
  | AuthRegister
  | AuthLogin
  | CraftRequest
  | MountAction
  | AttackMessage
  | EncounterActionMessage;
