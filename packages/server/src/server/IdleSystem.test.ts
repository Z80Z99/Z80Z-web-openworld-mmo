import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE, OFFLINE_CAP_HOURS, TileType, WorldGenerator } from "@mmo/shared";
import { createSchema } from "../db/schema.js";
import { IdleSystem } from "./IdleSystem.js";

const PLAYER_ID = "idle-player";
const NOW = new Date("2026-08-21T12:00:00.000Z");
const MS_PER_HOUR = 60 * 60 * 1000;

function createChunk(tile: TileType) {
  return {
    cx: 0,
    cy: 0,
    tiles: Array.from({ length: CHUNK_SIZE }, () =>
      Array.from({ length: CHUNK_SIZE }, () => tile),
    ),
  };
}

describe("IdleSystem", () => {
  let db: Database.Database;
  let worldGen: WorldGenerator;
  let idleSystem: IdleSystem;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    db.prepare("INSERT INTO players (id, inventory) VALUES (?, ?)").run(
      PLAYER_ID,
      JSON.stringify({ Wood: 3 }),
    );
    worldGen = new WorldGenerator(42);
    idleSystem = new IdleSystem(db, worldGen);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("returns no reward when the player was offline for less than one minute", () => {
    // Given
    db.prepare(
      "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
    ).run(PLAYER_ID, NOW.getTime() - 59_000, "{}");

    // When
    const result = idleSystem.calculateIdleRewards(PLAYER_ID, 0, 0);

    // Then
    expect(result).toBeNull();
  });

  it.each([
    [TileType.Forest, "Wood", 4],
    [TileType.Grass, "Herb", 2],
    [TileType.Sand, "Sand", 2],
    [TileType.Stone, "Stone", 2],
  ])("applies the configured biome rate for tile %s", (tile, resource, amount) => {
    // Given
    vi.spyOn(worldGen, "generateChunk").mockReturnValue(createChunk(tile));
    db.prepare(
      "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
    ).run(PLAYER_ID, NOW.getTime() - 2 * MS_PER_HOUR, "{}");

    // When
    const result = idleSystem.calculateIdleRewards(PLAYER_ID, 0, 0);

    // Then
    expect(result).toEqual({ hours: 2, resources: { [resource]: amount } });
  });

  it("caps accumulated rewards at 24 hours", () => {
    // Given
    vi.spyOn(worldGen, "generateChunk").mockReturnValue(createChunk(TileType.Forest));
    db.prepare(
      "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
    ).run(PLAYER_ID, NOW.getTime() - 48 * MS_PER_HOUR, "{}");

    // When
    const result = idleSystem.calculateIdleRewards(PLAYER_ID, 0, 0);

    // Then
    expect(result).toEqual({
      hours: OFFLINE_CAP_HOURS,
      resources: { Wood: OFFLINE_CAP_HOURS * 2 },
    });
  });

  it("adds accumulated resources to the existing inventory", () => {
    // Given
    db.prepare(
      "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
    ).run(PLAYER_ID, NOW.getTime() - MS_PER_HOUR, JSON.stringify({ Wood: 4, Herb: 2 }));

    // When
    const result = idleSystem.claimRewards(PLAYER_ID);

    // Then
    const row = db.prepare("SELECT inventory FROM players WHERE id = ?").get(PLAYER_ID);
    expect(result).toEqual({ success: true, resources: { Wood: 4, Herb: 2 } });
    expect(row).toEqual({ inventory: JSON.stringify({ Wood: 7, Herb: 2 }) });
  });

  it("prevents a second claim from adding the same resources", () => {
    // Given
    db.prepare(
      "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
    ).run(PLAYER_ID, NOW.getTime() - MS_PER_HOUR, JSON.stringify({ Wood: 4 }));
    idleSystem.claimRewards(PLAYER_ID);

    // When
    const result = idleSystem.claimRewards(PLAYER_ID);

    // Then
    const row = db.prepare("SELECT inventory FROM players WHERE id = ?").get(PLAYER_ID);
    expect(result).toEqual({ success: false, resources: {} });
    expect(row).toEqual({ inventory: JSON.stringify({ Wood: 7 }) });
  });

  it.each(["", "{}", "null", "[]", "not-json", JSON.stringify({ Wood: "4" })])(
    "rejects malformed or empty accumulated resources: %s",
    (accumulatedResources) => {
      // Given
      db.prepare(
        "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
      ).run(PLAYER_ID, NOW.getTime() - MS_PER_HOUR, accumulatedResources);

      // When
      const result = idleSystem.claimRewards(PLAYER_ID);

      // Then
      expect(result).toEqual({ success: false, resources: {} });
    },
  );

  it("rolls back the inventory update when clearing accumulation fails", () => {
    // Given
    db.prepare(
      "INSERT INTO offline_accumulation (player_id, last_logout, accumulated_resources) VALUES (?, ?, ?)",
    ).run(PLAYER_ID, NOW.getTime() - MS_PER_HOUR, JSON.stringify({ Wood: 4 }));
    db.exec(`
      CREATE TRIGGER reject_idle_clear BEFORE DELETE ON offline_accumulation
      BEGIN SELECT RAISE(ABORT, 'clear failed'); END;
    `);

    // When / Then
    expect(() => idleSystem.claimRewards(PLAYER_ID)).toThrow("clear failed");
    const row = db.prepare("SELECT inventory FROM players WHERE id = ?").get(PLAYER_ID);
    expect(row).toEqual({ inventory: JSON.stringify({ Wood: 3 }) });
  });
});
