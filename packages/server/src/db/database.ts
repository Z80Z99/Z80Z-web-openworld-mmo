import Database from "better-sqlite3";
import { createSchema } from "./schema.js";
import { runMigrations } from "./migrations.js";

export interface DatabaseOptions {
  /** Path to the SQLite file. Use ":memory:" for tests. */
  path: string;
}

export class GameDatabase {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(options: DatabaseOptions) {
    this.dbPath = options.path;
    this.db = new Database(this.dbPath);
  }

  /** Initialize WAL mode, apply schema and run pending migrations. */
  init(): void {
    this.db.pragma("journal_mode = WAL");
    createSchema(this.db);
    runMigrations(this.db);
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /** Return the raw better-sqlite3 instance for direct queries. */
  getDb(): Database.Database {
    return this.db;
  }
}
