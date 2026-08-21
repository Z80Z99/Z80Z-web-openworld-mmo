import { describe, it, expect } from "vitest";
import {
  PlayerState,
  EntityState,
  TileState,
  RoomState,
} from "./schema.js";
import {
  TICK_RATE,
  AOI_CHUNK_RADIUS,
  CHUNK_SIZE,
  MOVE_SPEED,
  OFFLINE_CAP_HOURS,
  MAX_TRADE_ITEMS,
  MAX_CRAFT_INPUTS,
} from "./constants.js";
import type {
  ChatMessage,
  TradeRequest,
  TradeConfirm,
  AuthRegister,
  AuthLogin,
  CraftRequest,
  MountAction,
  ClientMessage,
  Item,
} from "./messages.js";

describe("Colyseus schema types", () => {
  it("instantiates PlayerState with defaults", () => {
    const player = new PlayerState();
    expect(player.x).toBe(0);
    expect(player.y).toBe(0);
    expect(player.chunkX).toBe(0);
    expect(player.chunkY).toBe(0);
    expect(player.health).toBe(100);
    expect(player.maxHealth).toBe(100);
    expect(player.speed).toBe(4);
    expect(player.name).toBe("");
    expect(player.level).toBe(1);
    expect(player.title).toBe("");
    expect(player.mountId).toBe("");
  });

  it("instantiates EntityState with defaults", () => {
    const entity = new EntityState();
    expect(entity.id).toBe("");
    expect(entity.x).toBe(0);
    expect(entity.y).toBe(0);
    expect(entity.type).toBe("");
    expect(entity.health).toBe(0);
    expect(entity.ownerId).toBe("");
  });

  it("instantiates TileState with defaults", () => {
    const tile = new TileState();
    expect(tile.chunkX).toBe(0);
    expect(tile.chunkY).toBe(0);
    expect(tile.tiles.length).toBe(0);
  });

  it("instantiates RoomState with empty collections", () => {
    const room = new RoomState();
    expect(room.players.size).toBe(0);
    expect(room.entities.size).toBe(0);
    expect(room.tiles.size).toBe(0);
  });

  it("RoomState supports player add/remove via MapSchema", () => {
    const room = new RoomState();
    const player = new PlayerState();
    player.name = "TestPlayer";
    player.x = 10;
    player.y = 20;

    room.players.set("session1", player);
    expect(room.players.size).toBe(1);
    expect(room.players.get("session1")?.name).toBe("TestPlayer");

    room.players.delete("session1");
    expect(room.players.size).toBe(0);
  });

  it("RoomState supports entity operations", () => {
    const room = new RoomState();
    const entity = new EntityState();
    entity.id = "npc_1";
    entity.type = "npc";
    entity.health = 50;

    room.entities.set("npc_1", entity);
    expect(room.entities.size).toBe(1);

    const retrieved = room.entities.get("npc_1");
    expect(retrieved?.type).toBe("npc");
    expect(retrieved?.health).toBe(50);
  });

  it("TileState supports tile array operations", () => {
    const tile = new TileState();
    tile.chunkX = 1;
    tile.chunkY = 2;
    tile.tiles.push(1, 2, 3, 4);

    expect(tile.tiles.length).toBe(4);
    expect(tile.tiles[0]).toBe(1);
  });
});

describe("Game constants", () => {
  it("TICK_RATE is 20 Hz", () => {
    expect(TICK_RATE).toBe(20);
  });

  it("AOI_CHUNK_RADIUS matches the client's two-chunk render radius", () => {
    expect(AOI_CHUNK_RADIUS).toBe(2);
  });

  it("CHUNK_SIZE is 32", () => {
    expect(CHUNK_SIZE).toBe(32);
  });

  it("MOVE_SPEED is 4", () => {
    expect(MOVE_SPEED).toBe(4);
  });

  it("OFFLINE_CAP_HOURS is 24", () => {
    expect(OFFLINE_CAP_HOURS).toBe(24);
  });

  it("MAX_TRADE_ITEMS is 10", () => {
    expect(MAX_TRADE_ITEMS).toBe(10);
  });

  it("MAX_CRAFT_INPUTS is 3", () => {
    expect(MAX_CRAFT_INPUTS).toBe(3);
  });
});

describe("Message types compile", () => {
  it("ChatMessage type compiles", () => {
    const msg: ChatMessage = { type: "chat", content: "hello" };
    expect(msg.type).toBe("chat");
    expect(msg.content).toBe("hello");
  });

  it("TradeRequest type compiles", () => {
    const msg: TradeRequest = { type: "trade_request", targetId: "p1" };
    expect(msg.type).toBe("trade_request");
  });

  it("TradeConfirm type compiles", () => {
    const item: Item = { id: "sword", quantity: 1 };
    const msg: TradeConfirm = {
      type: "trade_confirm",
      tradeId: "t1",
      items: [item],
    };
    expect(msg.items.length).toBe(1);
  });

  it("AuthRegister type compiles", () => {
    const msg: AuthRegister = {
      type: "auth_register",
      guestToken: "g1",
      username: "player1",
      password: "pass",
    };
    expect(msg.type).toBe("auth_register");
  });

  it("AuthLogin type compiles", () => {
    const msg: AuthLogin = {
      type: "auth_login",
      username: "player1",
      password: "pass",
    };
    expect(msg.type).toBe("auth_login");
  });

  it("CraftRequest type compiles", () => {
    const msg: CraftRequest = { type: "craft_request", recipeId: "r1" };
    expect(msg.type).toBe("craft_request");
  });

  it("MountAction type compiles", () => {
    const mount: MountAction = {
      type: "mount_action",
      mountId: "horse1",
      action: "mount",
    };
    const dismount: MountAction = {
      type: "mount_action",
      mountId: "horse1",
      action: "dismount",
    };
    expect(mount.action).toBe("mount");
    expect(dismount.action).toBe("dismount");
  });
});
