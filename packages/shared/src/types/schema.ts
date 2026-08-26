import { Schema, type, filterChildren, MapSchema, ArraySchema } from "@colyseus/schema";
import { CHUNK_SIZE, AOI_CHUNK_RADIUS } from "./constants.js";

export class PlayerState extends Schema {
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("int32") chunkX: number = 0;
  @type("int32") chunkY: number = 0;
  @type("int32") health: number = 100;
  @type("int32") maxHealth: number = 100;
  @type("float32") speed: number = 4;
  @type("string") name: string = "";
  @type("int32") level: number = 1;
  @type("int32") xp: number = 0;
  @type("int32") xpToNextLevel: number = 100;
  @type("string") title: string = "";
  @type("string") mountId: string = "";
}

export class EntityState extends Schema {
  @type("string") id: string = "";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("string") type: string = "";
  @type("int32") health: number = 0;
  @type("string") ownerId: string = "";
}

export class TileState extends Schema {
  @type("int32") chunkX: number = 0;
  @type("int32") chunkY: number = 0;
  @type(["number"]) tiles: ArraySchema<number> = new ArraySchema<number>();
}

function isVisibleChunk(
  sessionId: string,
  chunkX: number,
  chunkY: number,
  root: RoomState,
): boolean {
  const player = root.players.get(sessionId);
  if (!player) return false;

  return (
    Math.abs(player.chunkX - chunkX) <= AOI_CHUNK_RADIUS &&
    Math.abs(player.chunkY - chunkY) <= AOI_CHUNK_RADIUS
  );
}

export class RoomState extends Schema {
  @filterChildren<RoomState, string, PlayerState, RoomState>((client, key, player, root) =>
    key === client.sessionId ||
    isVisibleChunk(client.sessionId, player.chunkX, player.chunkY, root),
  )
  @type({ map: PlayerState }) players: MapSchema<PlayerState> =
    new MapSchema<PlayerState>();
  @filterChildren<RoomState, string, EntityState, RoomState>((client, _key, entity, root) =>
    isVisibleChunk(
      client.sessionId,
      Math.floor(entity.x / CHUNK_SIZE),
      Math.floor(entity.y / CHUNK_SIZE),
      root,
    ),
  )
  @type({ map: EntityState }) entities: MapSchema<EntityState> =
    new MapSchema<EntityState>();
  @filterChildren<RoomState, string, TileState, RoomState>(() => false)
  @type({ map: TileState }) tiles: MapSchema<TileState> =
    new MapSchema<TileState>();
}
