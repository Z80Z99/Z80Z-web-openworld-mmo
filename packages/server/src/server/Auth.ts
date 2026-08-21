import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";

const SALT_ROUNDS = 10;

export interface AuthResult {
  success: boolean;
  accountId?: string;
  playerId?: string;
  token?: string;
  error?: string;
}

/**
 * Handles guest registration, login, and guest-to-account upgrades.
 *
 * All operations are backed by the `accounts` and `players` tables
 * in the existing SQLite database.
 */
export class Auth {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Register a new guest account (or upgrade an existing guest).
   *
   * Flow:
   *  1. Client sends `guestToken` (generated client-side on first connect).
   *  2. Server hashes `password` and stores the account.
   *  3. If `guestToken` already has an account, the password is upgraded.
   *
   * Returns the newly created account and player IDs.
   */
  async register(
    guestToken: string,
    username: string,
    password: string,
  ): Promise<AuthResult> {
    if (!username || username.length < 3 || username.length > 24) {
      return { success: false, error: "Username must be 3-24 characters." };
    }
    if (!password || password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters." };
    }

    const existingAccount = this.db
      .prepare("SELECT id FROM accounts WHERE token = ?")
      .get(guestToken) as { id: string } | undefined;

    if (existingAccount) {
      return this.upgradeGuest(existingAccount.id, username, password);
    }

    const existingUsername = this.db
      .prepare("SELECT id FROM accounts WHERE username = ?")
      .get(username) as { id: string } | undefined;

    if (existingUsername) {
      return { success: false, error: "Username already taken." };
    }

    const accountId = uuidv4();
    const playerId = uuidv4();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const now = Date.now();

    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO accounts (id, token, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(accountId, guestToken, username, passwordHash, now);

      this.db
        .prepare(
          "INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(playerId, accountId, 0, 0, 0, 0, "{}", 0, null, now);
    })();

    return { success: true, accountId, playerId, token: guestToken };
  }

  /**
   * Login with username + password.
   */
  async login(username: string, password: string): Promise<AuthResult> {
    if (!username || !password) {
      return { success: false, error: "Username and password required." };
    }

    const account = this.db
      .prepare("SELECT id, token, password_hash FROM accounts WHERE username = ?")
      .get(username) as { id: string; token: string; password_hash: string } | undefined;

    if (!account) {
      return { success: false, error: "Invalid username or password." };
    }

    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) {
      return { success: false, error: "Invalid username or password." };
    }

    const player = this.db
      .prepare("SELECT id FROM players WHERE account_id = ?")
      .get(account.id) as { id: string } | undefined;

    return {
      success: true,
      accountId: account.id,
      playerId: player?.id,
      token: account.token,
    };
  }

  /**
   * Upgrade an existing guest account with a username and password.
   */
  private async upgradeGuest(
    accountId: string,
    username: string,
    password: string,
  ): Promise<AuthResult> {
    const existingUsername = this.db
      .prepare("SELECT id FROM accounts WHERE username = ? AND id != ?")
      .get(username, accountId) as { id: string } | undefined;

    if (existingUsername) {
      return { success: false, error: "Username already taken." };
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    this.db
      .prepare("UPDATE accounts SET username = ?, password_hash = ? WHERE id = ?")
      .run(username, passwordHash, accountId);

    const player = this.db
      .prepare("SELECT id FROM players WHERE account_id = ?")
      .get(accountId) as { id: string } | undefined;

    return {
      success: true,
      accountId,
      playerId: player?.id,
    };
  }

  /**
   * Look up an account by its guest token (for auto-login on reconnect).
   */
  getByToken(guestToken: string): AuthResult {
    const account = this.db
      .prepare("SELECT id FROM accounts WHERE token = ?")
      .get(guestToken) as { id: string } | undefined;

    if (!account) {
      return { success: false, error: "Account not found." };
    }

    const player = this.db
      .prepare("SELECT id FROM players WHERE account_id = ?")
      .get(account.id) as { id: string } | undefined;

    return {
      success: true,
      accountId: account.id,
      playerId: player?.id,
    };
  }
}
