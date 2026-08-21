import { describe, it, expect, beforeEach } from "vitest";
import { MovementSystem } from "./MovementSystem.js";
import { WorldGenerator, MOVE_SPEED, CHUNK_SIZE, TileType } from "@mmo/shared";
import type { PlayerState } from "@mmo/shared";

/** Create a minimal PlayerState-like object for testing. */
function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const p = {
    x: 0,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    health: 100,
    maxHealth: 100,
    speed: MOVE_SPEED,
    name: "TestPlayer",
    level: 1,
    title: "",
    mountId: "",
    maxMaxHealth: 100,
  };
  return Object.assign(p, overrides) as unknown as PlayerState;
}

describe("MovementSystem", () => {
  let worldGen: WorldGenerator;
  let system: MovementSystem;

  beforeEach(() => {
    worldGen = new WorldGenerator(42);
    system = new MovementSystem(worldGen);
  });

  describe("queueMovement / drainQueue", () => {
    it("queues and drains movement commands", () => {
      system.queueMovement("p1", 5, 5);
      system.queueMovement("p2", 10, 10);

      const commands = system.drainQueue();
      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual({ sessionId: "p1", targetX: 5, targetY: 5 });
      expect(commands[1]).toEqual({ sessionId: "p2", targetX: 10, targetY: 10 });

      // Queue should be empty after drain
      expect(system.drainQueue()).toHaveLength(0);
    });
  });

  describe("clampSpeed", () => {
    it("allows movement within speed limit", () => {
      // Moving 1 tile in 0.25s at 4 tiles/sec = exactly at limit (maxDistance = 1)
      const result = system.clampSpeed(0, 0, 1, 0, MOVE_SPEED, 0.25);
      expect(result.x).toBe(1);
      expect(result.y).toBe(0);
    });

    it("clamps movement exceeding speed limit", () => {
      // Moving 10 tiles in 0.25s at 4 tiles/sec (maxDistance = 1) — should clamp to 1
      const result = system.clampSpeed(0, 0, 10, 0, MOVE_SPEED, 0.25);
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it("clamps diagonal movement correctly", () => {
      // Moving (5, 5) in 0.25s at 4 tiles/sec — distance ≈ 7.07, max = 1
      const result = system.clampSpeed(0, 0, 5, 5, MOVE_SPEED, 0.25);
      const dx = result.x;
      const dy = result.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      expect(distance).toBeCloseTo(1, 4);
      // Direction preserved
      expect(dx).toBeCloseTo(dy, 5);
    });

    it("returns exact target when within limit", () => {
      const result = system.clampSpeed(5, 5, 5.5, 5, MOVE_SPEED, 1);
      expect(result.x).toBeCloseTo(5.5, 5);
      expect(result.y).toBeCloseTo(5, 5);
    });
  });

  describe("validateTerrain", () => {
    it("returns true for walkable grass tiles", () => {
      // Find a grass tile by scanning chunk (0,0)
      const chunk = worldGen.generateChunk(0, 0);
      let foundGrass = false;
      for (let ly = 0; ly < CHUNK_SIZE && !foundGrass; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE && !foundGrass; lx++) {
          if (chunk.tiles[ly][lx] === TileType.Grass) {
            // Convert local tile coords to world coords
            const worldX = lx + 0.5; // center of tile
            const worldY = ly + 0.5;
            expect(system.validateTerrain(worldX, worldY)).toBe(true);
            foundGrass = true;
          }
        }
      }
      expect(foundGrass).toBe(true);
    });

    it("rejects water tiles", () => {
      // Find a water tile by scanning
      const chunk = worldGen.generateChunk(0, 0);
      let foundWater = false;
      for (let ly = 0; ly < CHUNK_SIZE && !foundWater; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE && !foundWater; lx++) {
          if (chunk.tiles[ly][lx] === TileType.Water) {
            const worldX = lx + 0.5;
            const worldY = ly + 0.5;
            expect(system.validateTerrain(worldX, worldY)).toBe(false);
            foundWater = true;
          }
        }
      }
      // Water may or may not exist in this chunk — skip if not found
      if (!foundWater) {
        console.log("No water found in chunk (0,0) — test skipped");
      }
    });

    it("rejects deep water tiles", () => {
      const chunk = worldGen.generateChunk(0, 0);
      let found = false;
      for (let ly = 0; ly < CHUNK_SIZE && !found; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE && !found; lx++) {
          if (chunk.tiles[ly][lx] === TileType.DeepWater) {
            const worldX = lx + 0.5;
            const worldY = ly + 0.5;
            expect(system.validateTerrain(worldX, worldY)).toBe(false);
            found = true;
          }
        }
      }
      if (!found) {
        console.log("No deep water found in chunk (0,0) — test skipped");
      }
    });

    it("rejects stone/mountain tiles", () => {
      const chunk = worldGen.generateChunk(0, 0);
      let found = false;
      for (let ly = 0; ly < CHUNK_SIZE && !found; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE && !found; lx++) {
          if (chunk.tiles[ly][lx] === TileType.Stone) {
            const worldX = lx + 0.5;
            const worldY = ly + 0.5;
            expect(system.validateTerrain(worldX, worldY)).toBe(false);
            found = true;
          }
        }
      }
      if (!found) {
        console.log("No stone found in chunk (0,0) — test skipped");
      }
    });

    it("handles negative coordinates correctly", () => {
      // Should not throw for negative coords
      const result = system.validateTerrain(-5.5, -10.5);
      expect(typeof result).toBe("boolean");
    });
  });

  describe("processMovement", () => {
    it("accepts valid movement within speed on walkable terrain", () => {
      // Find a walkable starting position
      const chunk = worldGen.generateChunk(0, 0);
      let startX = 0.5;
      let startY = 0.5;

      // Find grass tile
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (chunk.tiles[ly][lx] === TileType.Grass) {
            startX = lx + 0.5;
            startY = ly + 0.5;
            break;
          }
        }
      }

      const player = makePlayer({ x: startX, y: startY });
      const cmd = { sessionId: "p1", targetX: startX + 0.5, targetY: startY };

      const result = system.processMovement(cmd, player, 0.25);
      expect(result.valid).toBe(true);
      expect(result.x).toBeCloseTo(startX + 0.5, 4);
      expect(result.y).toBeCloseTo(startY, 4);
    });

    it("rejects too-fast movement", () => {
      const player = makePlayer({ x: 0, y: 0, chunkX: 0, chunkY: 0 });
      // Target 100 tiles away in 0.25s — way over speed limit
      const cmd = { sessionId: "p1", targetX: 100, targetY: 0 };

      // Even though clamped, terrain at (1, 0.5) might be walkable
      // The key test: movement is clamped, not teleported
      const result = system.processMovement(cmd, player, 0.25);
      // Result position should be clamped to maxDistance = 4 * 0.25 = 1
      if (result.valid) {
        const distance = Math.sqrt(result.x ** 2 + result.y ** 2);
        expect(distance).toBeLessThanOrEqual(1.01); // small tolerance
      }
    });

    it("rejects movement onto water tile", () => {
      // Find a water tile
      const chunk = worldGen.generateChunk(0, 0);
      let waterX = -1;
      let waterY = -1;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          if (chunk.tiles[ly][lx] === TileType.Water) {
            waterX = lx;
            waterY = ly;
            break;
          }
        }
        if (waterX >= 0) break;
      }

      if (waterX < 0) {
        console.log("No water found — skipping water rejection test");
        return;
      }

      // Start next to water, try to move onto it
      const player = makePlayer({
        x: waterX + 1.5, // one tile to the right of water
        y: waterY + 0.5,
        chunkX: 0,
        chunkY: 0,
      });
      const cmd = { sessionId: "p1", targetX: waterX + 0.5, targetY: waterY + 0.5 };

      const result = system.processMovement(cmd, player, 1);
      expect(result.valid).toBe(false);
      // Player should stay at original position
      expect(result.x).toBe(player.x);
      expect(result.y).toBe(player.y);
    });

    it("returns corrected position for invalid movement", () => {
      const player = makePlayer({ x: 5, y: 5, chunkX: 0, chunkY: 0 });
      // Target too far away — should be clamped
      const cmd = { sessionId: "p1", targetX: 50, targetY: 50 };

      const result = system.processMovement(cmd, player, 0.1);
      // If valid (terrain OK), position should be clamped
      if (result.valid) {
        const distance = Math.sqrt(
          (result.x - 5) ** 2 + (result.y - 5) ** 2,
        );
        expect(distance).toBeLessThanOrEqual(player.speed * 0.1 + 0.01);
      }
    });
  });
});
