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

/** Union of all client-to-server message types */
export type ClientMessage =
  | ChatMessage
  | TradeRequest
  | TradeConfirm
  | AuthRegister
  | AuthLogin
  | CraftRequest
  | MountAction;
