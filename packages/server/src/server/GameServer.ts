import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameDatabase } from "../db/index.js";
import { GameRoom } from "./GameRoom.js";
import { DEFAULT_SEED } from "@mmo/shared";

const DEFAULT_PORT = 2567;

export interface GameServerOptions {
  /** Port to listen on. Defaults to COLYSEUS_PORT env or 2567. */
  port?: number;
  /** Path to SQLite database file. Use ":memory:" for tests. */
  dbPath?: string;
  /** World generation seed. */
  seed?: number;
  /** Whether to greet on startup. */
  greet?: boolean;
}

/**
 * Creates and configures the Colyseus game server.
 *
 * Usage:
 * ```ts
 * const gameServer = createGameServer({ port: 2567 });
 * await gameServer.listen();
 * ```
 */
export function createGameServer(options: GameServerOptions = {}): {
  server: Server;
  db: GameDatabase;
  port: number;
  listen: () => Promise<void>;
  shutdown: () => Promise<void>;
} {
  const port = options.port ?? (parseInt(process.env.COLYSEUS_PORT ?? "", 10) || DEFAULT_PORT);
  const dbPath = options.dbPath ?? ":memory:";
  const seed = options.seed ?? DEFAULT_SEED;

  // Initialize database
  const db = new GameDatabase({ path: dbPath });
  db.init();

  // Create Colyseus server
  const server = new Server({
    transport: new WebSocketTransport(),
    greet: options.greet ?? true,
  });

  // Define the game room with default options
  server.define(GameRoom, { db: db.getDb(), seed });

  /**
   * Listen on the configured port.
   */
  const listen = async (): Promise<void> => {
    await server.listen(port);
  };

  /**
   * Gracefully shut down the server and close the database.
   */
  const shutdown = async (): Promise<void> => {
    await server.gracefullyShutdown(true);
    db.close();
  };

  return { server, db, port, listen, shutdown };
}

/**
 * Start the server when run directly (not imported as a module).
 */
async function main(): Promise<void> {
  const { listen } = createGameServer();
  await listen();
}

// Only run main if this file is executed directly as an ESM entry point
const isDirectRun =
  process.argv.length > 1 &&
  (process.argv[1]?.endsWith("GameServer.js") || process.argv[1]?.endsWith("GameServer.ts"));

if (isDirectRun) {
  main().catch(console.error);
}
