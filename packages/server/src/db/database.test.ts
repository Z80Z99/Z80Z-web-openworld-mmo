import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameDatabase } from "./database.js";

const EXPECTED_TABLES = [
  "accounts",
  "players",
  "tile_edits",
  "quests",
  "crafting_recipes",
  "offline_accumulation",
  "mounts",
  "trades",
  "_migrations",
];

describe("GameDatabase", () => {
  let db: GameDatabase;

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();
  });

  afterEach(() => {
    db.close();
  });

  describe("initialization", () => {
    it("creates all expected tables", () => {
      const raw = db.getDb();
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      for (const expected of EXPECTED_TABLES) {
        expect(tableNames).toContain(expected);
      }
    });

    it("enables WAL journal mode on file-backed database", () => {
      const dir = mkdtempSync(join(tmpdir(), "mmo-db-wal-"));
      const filePath = join(dir, "test.db");
      const fileDb = new GameDatabase({ path: filePath });
      try {
        fileDb.init();
        const mode = fileDb.getDb().pragma("journal_mode", { simple: true });
        expect(mode).toBe("wal");
      } finally {
        fileDb.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("creates migration table with version 1", () => {
      const raw = db.getDb();
      const row = raw.prepare("SELECT version FROM _migrations").get() as
        | { version: number }
        | undefined;
      expect(row?.version).toBe(1);
    });
  });

  describe("player CRUD", () => {
    const playerId = "player-001";
    const accountId = "account-001";

    it("inserts and queries a player", () => {
      const raw = db.getDb();
      raw
        .prepare(
          `INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(playerId, accountId, 100.5, 200.3, 10, 20, '{"gold":50}', 0, null, Date.now());

      const row = raw.prepare("SELECT * FROM players WHERE id = ?").get(playerId) as Record<
        string,
        unknown
      >;
      expect(row.id).toBe(playerId);
      expect(row.account_id).toBe(accountId);
      expect(row.x).toBe(100.5);
      expect(row.y).toBe(200.3);
      expect(row.chunk_x).toBe(10);
      expect(row.chunk_y).toBe(20);
      expect(row.inventory).toBe('{"gold":50}');
      expect(row.level_xp).toBe(0);
    });

    it("updates a player", () => {
      const raw = db.getDb();
      raw
        .prepare(
          `INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(playerId, accountId, 100, 200, 10, 20, "{}", 0, null, Date.now());

      raw.prepare("UPDATE players SET x = ?, y = ?, level_xp = ? WHERE id = ?").run(
        300,
        400,
        500,
        playerId,
      );

      const row = raw.prepare("SELECT * FROM players WHERE id = ?").get(playerId) as Record<
        string,
        unknown
      >;
      expect(row.x).toBe(300);
      expect(row.y).toBe(400);
      expect(row.level_xp).toBe(500);
    });

    it("deletes a player and returns null on query", () => {
      const raw = db.getDb();
      raw
        .prepare(
          `INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(playerId, accountId, 0, 0, 0, 0, "{}", 0, null, Date.now());

      raw.prepare("DELETE FROM players WHERE id = ?").run(playerId);

      const row = raw.prepare("SELECT * FROM players WHERE id = ?").get(playerId);
      expect(row).toBeUndefined();
    });
  });

  describe("account CRUD", () => {
    const accountId = "acc-001";

    it("inserts and queries an account", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO accounts (id, token, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(accountId, "tok-abc", "testuser", "hash123", Date.now());

      const row = raw.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId) as Record<
        string,
        unknown
      >;
      expect(row.username).toBe("testuser");
      expect(row.token).toBe("tok-abc");
    });

    it("enforces unique username", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO accounts (id, token, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run("a1", "t1", "uniqueuser", "h1", Date.now());

      expect(() => {
        raw
          .prepare(
            "INSERT INTO accounts (id, token, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("a2", "t2", "uniqueuser", "h2", Date.now());
      }).toThrow();
    });
  });

  describe("tile_edits", () => {
    it("inserts and queries tile edits", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO tile_edits (chunk_x, chunk_y, tile_x, tile_y, tile_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(0, 0, 5, 5, 3, Date.now());

      const rows = raw.prepare("SELECT * FROM tile_edits WHERE chunk_x = 0").all();
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).tile_type).toBe(3);
    });
  });

  describe("quests", () => {
    it("inserts and queries quests", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO quests (player_id, quest_id, status, progress) VALUES (?, ?, ?, ?)",
        )
        .run("p1", "quest-slay-dragon", "active", '{"kills":0}');

      const row = raw.prepare("SELECT * FROM quests WHERE player_id = ?").get("p1") as Record<
        string,
        unknown
      >;
      expect(row.quest_id).toBe("quest-slay-dragon");
      expect(row.status).toBe("active");
    });
  });

  describe("crafting_recipes", () => {
    it("inserts and queries recipes", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO crafting_recipes (id, name, inputs, output) VALUES (?, ?, ?, ?)",
        )
        .run("recipe-iron-sword", "Iron Sword", '[{"item":"iron_ingot","count":3}]', '{"item":"iron_sword","count":1}');

      const row = raw
        .prepare("SELECT * FROM crafting_recipes WHERE id = ?")
        .get("recipe-iron-sword") as Record<string, unknown>;
      expect(row.name).toBe("Iron Sword");
    });
  });

  describe("offline_accumulation", () => {
    it("inserts and queries offline data", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
        )
        .run("p1", Date.now(), '{"wood":10,"stone":5}');

      const rows = raw
        .prepare("SELECT * FROM offline_accumulation WHERE player_id = ?")
        .all("p1") as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0].accumulated_resources).toBe('{"wood":10,"stone":5}');
    });
  });

  describe("mounts", () => {
    it("inserts and queries mounts", () => {
      const raw = db.getDb();
      raw
        .prepare("INSERT INTO mounts (id, name, speed_multiplier, model_path) VALUES (?, ?, ?, ?)")
        .run("mount-horse", "Horse", 1.5, "models/horse.glb");

      const row = raw.prepare("SELECT * FROM mounts WHERE id = ?").get("mount-horse") as Record<
        string,
        unknown
      >;
      expect(row.name).toBe("Horse");
      expect(row.speed_multiplier).toBe(1.5);
    });
  });

  describe("trades", () => {
    it("inserts and queries trades", () => {
      const raw = db.getDb();
      raw
        .prepare(
          "INSERT INTO trades (player_a, player_b, items_a, items_b, timestamp) VALUES (?, ?, ?, ?, ?)",
        )
        .run("p1", "p2", '[{"item":"sword"}]', '[{"item":"shield"}]', Date.now());

      const rows = raw.prepare("SELECT * FROM trades WHERE player_a = ?").all("p1") as Record<
        string,
        unknown
      >[];
      expect(rows).toHaveLength(1);
      expect(rows[0].player_b).toBe("p2");
    });
  });
});
