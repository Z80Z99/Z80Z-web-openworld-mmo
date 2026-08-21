import type Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    token TEXT,
    username TEXT UNIQUE,
    password_hash TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    x REAL,
    y REAL,
    chunk_x INTEGER,
    chunk_y INTEGER,
    inventory TEXT,
    level_xp INTEGER DEFAULT 0,
    mount_id TEXT,
    last_login INTEGER
  );

  CREATE TABLE IF NOT EXISTS tile_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_x INTEGER,
    chunk_y INTEGER,
    tile_x INTEGER,
    tile_y INTEGER,
    tile_type INTEGER,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT,
    quest_id TEXT,
    status TEXT,
    progress TEXT
  );

  CREATE TABLE IF NOT EXISTS crafting_recipes (
    id TEXT PRIMARY KEY,
    name TEXT,
    inputs TEXT,
    output TEXT
  );

  CREATE TABLE IF NOT EXISTS offline_accumulation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT,
    last_logout INTEGER,
    accumulated_resources TEXT
  );

  CREATE TABLE IF NOT EXISTS mounts (
    id TEXT PRIMARY KEY,
    name TEXT,
    speed_multiplier REAL,
    model_path TEXT
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_a TEXT,
    player_b TEXT,
    items_a TEXT,
    items_b TEXT,
    timestamp INTEGER
  );
`;

const CREATE_MIGRATION_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER
  );
`;

export function createSchema(db: Database.Database): void {
  db.exec(CREATE_MIGRATION_TABLE);
  db.exec(CREATE_TABLES);

  db.prepare("INSERT OR IGNORE INTO _migrations (version, applied_at) VALUES (?, ?)").run(
    SCHEMA_VERSION,
    Date.now(),
  );
}

export function getSchemaVersion(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(version) as version FROM _migrations").get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

export { SCHEMA_VERSION };
