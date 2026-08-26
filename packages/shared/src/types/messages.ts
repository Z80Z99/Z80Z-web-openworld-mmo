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

/**
 * Unified server→client combat event payload.
 * `type` is one of: damage_dealt | mob_killed | player_damaged | player_died |
 * xp_gained | loot_dropped | player_respawn | level_up | mob_respawn
 */
export interface CombatEventPayload {
  type: string;
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
  | AttackMessage;
