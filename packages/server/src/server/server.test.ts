import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Auth } from "./Auth.js";
import { AOIManager } from "./AOI.js";
import { GameDatabase } from "../db/index.js";
import { WorldGenerator, AOI_CHUNK_RADIUS, CHUNK_SIZE } from "@mmo/shared";
import { GAME_ROOM_CAPACITY } from "./GameRoom.js";

describe("GameRoom", () => {
  it("caps each room at 100 clients for bounded state replication", () => {
    expect(GAME_ROOM_CAPACITY).toBe(100);
  });
});

describe("Auth", () => {
  let db: GameDatabase;
  let auth: Auth;

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();
    auth = new Auth(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  describe("register", () => {
    it("registers a new guest account", async () => {
      const result = await auth.register("guest-token-1", "testuser", "password123");
      expect(result.success).toBe(true);
      expect(result.accountId).toBeDefined();
      expect(result.playerId).toBeDefined();
      expect(result.token).toBe("guest-token-1");
    });

    it("rejects short username", async () => {
      const result = await auth.register("token", "ab", "password123");
      expect(result.success).toBe(false);
      expect(result.error).toContain("3-24 characters");
    });

    it("rejects short password", async () => {
      const result = await auth.register("token", "testuser", "12345");
      expect(result.success).toBe(false);
      expect(result.error).toContain("6 characters");
    });

    it("rejects duplicate username", async () => {
      await auth.register("token1", "takenuser", "password123");
      const result = await auth.register("token2", "takenuser", "password456");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already taken");
    });
  });

  describe("login", () => {
    it("logs in with valid credentials", async () => {
      await auth.register("token1", "myuser", "mypassword");
      const result = await auth.login("myuser", "mypassword");
      expect(result.success).toBe(true);
      expect(result.accountId).toBeDefined();
      expect(result.playerId).toBeDefined();
    });

    it("rejects wrong password", async () => {
      await auth.register("token1", "myuser", "mypassword");
      const result = await auth.login("myuser", "wrongpassword");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid");
    });

    it("rejects non-existent user", async () => {
      const result = await auth.login("nobody", "password");
      expect(result.success).toBe(false);
    });
  });

  describe("getByToken", () => {
    it("finds account by token", async () => {
      await auth.register("my-guest-token", "tokenuser", "password123");
      const result = auth.getByToken("my-guest-token");
      expect(result.success).toBe(true);
      expect(result.accountId).toBeDefined();
    });

    it("returns failure for unknown token", () => {
      const result = auth.getByToken("unknown-token");
      expect(result.success).toBe(false);
    });
  });
});

describe("AOIManager", () => {
  let worldGen: WorldGenerator;
  let aoi: AOIManager;

  beforeEach(() => {
    worldGen = new WorldGenerator(42);
    aoi = new AOIManager(worldGen);
  });

  describe("addPlayer", () => {
    it("returns initial visible chunks", () => {
      const chunks = aoi.addPlayer("p1", 0, 0);
      // 7x7 radius = 15x15 = 225 chunks
      expect(chunks.length).toBe((AOI_CHUNK_RADIUS * 2 + 1) ** 2);
    });
  });

  describe("movePlayer", () => {
    it("returns null if player hasn't moved chunk", () => {
      aoi.addPlayer("p1", 0, 0);
      const result = aoi.movePlayer("p1", 0, 0);
      expect(result).toBeNull();
    });

    it("returns entered/exited chunks on chunk change", () => {
      aoi.addPlayer("p1", 0, 0);
      const result = aoi.movePlayer("p1", 1, 0);
      expect(result).not.toBeNull();
      expect(result!.entered.length).toBeGreaterThan(0);
      expect(result!.exited.length).toBeGreaterThan(0);
    });

    it("recalculates visible chunks correctly", () => {
      aoi.addPlayer("p1", 0, 0);
      aoi.movePlayer("p1", 1, 0);
      const visible = aoi.getVisibleChunks("p1");
      // Should see chunks around (1, 0)
      expect(visible).toContainEqual({ cx: 1, cy: 0 });
      expect(visible).toContainEqual({ cx: 1 + AOI_CHUNK_RADIUS, cy: 0 });
    });
  });

  describe("removePlayer", () => {
    it("removes player from tracking", () => {
      aoi.addPlayer("p1", 0, 0);
      aoi.removePlayer("p1");
      const chunks = aoi.getVisibleChunks("p1");
      expect(chunks).toHaveLength(0);
    });
  });

  describe("getPlayersWhoCanSeeChunk", () => {
    it("returns players who can see a specific chunk", () => {
      aoi.addPlayer("p1", 0, 0);
      aoi.addPlayer("p2", 1, 0);

      const players = aoi.getPlayersWhoCanSeeChunk(0, 0);
      expect(players).toContain("p1");
      // p2 might or might not see (0,0) depending on distance
    });

    it("returns empty for chunk nobody can see", () => {
      aoi.addPlayer("p1", 0, 0);
      const players = aoi.getPlayersWhoCanSeeChunk(100, 100);
      expect(players).toHaveLength(0);
    });
  });

  describe("canPlayerSeeChunk", () => {
    it("returns true for visible chunks", () => {
      aoi.addPlayer("p1", 5, 5);
      expect(aoi.canPlayerSeeChunk("p1", 5, 5)).toBe(true);
      expect(aoi.canPlayerSeeChunk("p1", 5 + AOI_CHUNK_RADIUS, 5)).toBe(true);
    });

    it("returns false for distant chunks", () => {
      aoi.addPlayer("p1", 0, 0);
      expect(aoi.canPlayerSeeChunk("p1", 100, 100)).toBe(false);
    });
  });

  describe("worldToChunk", () => {
    it("converts world position to chunk coordinates", () => {
      expect(AOIManager.worldToChunk(0, 0)).toEqual({ cx: 0, cy: 0 });
      expect(AOIManager.worldToChunk(31, 31)).toEqual({ cx: 0, cy: 0 });
      expect(AOIManager.worldToChunk(32, 32)).toEqual({ cx: 1, cy: 1 });
      expect(AOIManager.worldToChunk(-1, -1)).toEqual({ cx: -1, cy: -1 });
    });
  });

  describe("generateChunkTiles", () => {
    it("generates CHUNK_SIZE * CHUNK_SIZE tiles", () => {
      const tiles = aoi.generateChunkTiles(0, 0);
      expect(tiles.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    });

    it("generates deterministic tiles for same coordinates", () => {
      const tiles1 = aoi.generateChunkTiles(5, 5);
      const tiles2 = aoi.generateChunkTiles(5, 5);
      expect(tiles1).toEqual(tiles2);
    });

    it("generates different tiles for different coordinates", () => {
      const tiles1 = aoi.generateChunkTiles(0, 0);
      const tiles2 = aoi.generateChunkTiles(100, 100);
      // Very unlikely to be identical with noise-based generation
      expect(tiles1).not.toEqual(tiles2);
    });
  });
});
