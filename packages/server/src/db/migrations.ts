import type Database from "better-sqlite3";

interface Migration {
  version: number;
  up: string;
}

const migrations: Migration[] = [
  // Future migrations go here, ordered by version number.
  // Example:
  // { version: 2, up: `ALTER TABLE players ADD COLUMN new_field TEXT;` },
];

export function runMigrations(db: Database.Database): void {
  const applied = db
    .prepare("SELECT version FROM _migrations ORDER BY version")
    .all() as { version: number }[];
  const appliedVersions = new Set(applied.map((r) => r.version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    db.transaction(() => {
      db.exec(migration.up);
      db.prepare("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now(),
      );
    })();
  }
}

export function getLatestMigrationVersion(): number {
  if (migrations.length === 0) return 0;
  return Math.max(...migrations.map((m) => m.version));
}
