import { describe, it, expect, vi, beforeEach } from "vitest";
import { MovementManager } from "./MovementManager.js";
import { GameState } from "../game/GameState.js";
import { MOVE_SPEED } from "@mmo/shared";

/** Create a mock PlayerState for testing. */
function mockPlayerState(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as any;
}

describe("MovementManager", () => {
  let gameState: GameState;
  let sendFn: ReturnType<typeof vi.fn>;
  let manager: MovementManager;

  beforeEach(() => {
    gameState = new GameState(42);
    gameState.setLocalPlayer("p1", mockPlayerState({ x: 10, y: 10 }));
    sendFn = vi.fn();
    manager = new MovementManager(gameState, sendFn);
  });

  describe("move", () => {
    it("applies prediction locally immediately", () => {
      const initialX = gameState.localPlayer!.x;
      const initialY = gameState.localPlayer!.y;

      manager.move(1, 0, MOVE_SPEED, 0.25); // move right for 0.25s

      expect(gameState.localPlayer!.x).toBeGreaterThan(initialX);
      expect(gameState.localPlayer!.y).toBe(initialY);
    });

    it("sends predicted position to server", () => {
      manager.move(1, 0, MOVE_SPEED, 0.25);

      expect(sendFn).toHaveBeenCalledTimes(1);
      const [x, y] = sendFn.mock.calls[0];
      expect(typeof x).toBe("number");
      expect(typeof y).toBe("number");
      // Sent position should match predicted position
      expect(x).toBeCloseTo(gameState.localPlayer!.x, 5);
      expect(y).toBeCloseTo(gameState.localPlayer!.y, 5);
    });

    it("handles diagonal movement", () => {
      manager.move(1, 1, MOVE_SPEED, 0.25);

      expect(gameState.localPlayer!.x).toBeGreaterThan(10);
      expect(gameState.localPlayer!.y).toBeGreaterThan(10);
    });

    it("does nothing when local player is null", () => {
      gameState.localPlayer = null;
      manager.move(1, 0, MOVE_SPEED, 0.25);
      expect(sendFn).not.toHaveBeenCalled();
    });
  });

  describe("reconcile", () => {
    it("does nothing when local player is null", () => {
      gameState.localPlayer = null;
      manager.reconcile(5, 5);
      // Should not throw
    });

    it("accepts matching server position without correction", () => {
      // Predict first to move away from origin
      manager.move(1, 0, MOVE_SPEED, 0.25);
      const predictedX = gameState.localPlayer!.x;

      // Server confirms the predicted position
      manager.reconcile(predictedX, 10);

      // Position should be set to server position
      expect(gameState.localPlayer!.x).toBeCloseTo(predictedX, 4);
      expect(manager.interpolating).toBe(false);
    });

    it("detects prediction mismatch and starts interpolation", () => {
      // Predict movement
      manager.move(1, 0, MOVE_SPEED, 0.25);
      const predictedX = gameState.localPlayer!.x;

      // Server says position is different (e.g., server rejected movement)
      manager.reconcile(10, 10); // back to original

      // Should start interpolating
      expect(manager.interpolating).toBe(true);
    });

    it("snaps on large mismatch", () => {
      // Move far from server position
      gameState.localPlayer!.x = 100;
      gameState.localPlayer!.y = 100;

      // Server says position is (0, 0)
      manager.reconcile(0, 0);

      // Should be interpolating (mismatch > 0.5)
      expect(manager.interpolating).toBe(true);
    });
  });

  describe("update", () => {
    it("interpolates toward server position over time", () => {
      // Set up mismatch
      gameState.localPlayer!.x = 20;
      gameState.localPlayer!.y = 10;
      manager.reconcile(10, 10);

      expect(manager.interpolating).toBe(true);

      // Run several frames of interpolation
      for (let i = 0; i < 50; i++) {
        manager.update(0.016); // ~60fps
      }

      // Should have moved toward server position
      expect(gameState.localPlayer!.x).toBeLessThan(20);
      expect(gameState.localPlayer!.x).toBeGreaterThan(10);
    });

    it("completes interpolation when close enough", () => {
      // Small mismatch
      gameState.localPlayer!.x = 10.1;
      gameState.localPlayer!.y = 10;
      manager.reconcile(10, 10);

      // Run interpolation for a while
      for (let i = 0; i < 100; i++) {
        manager.update(0.016);
      }

      // Should have completed
      expect(manager.interpolating).toBe(false);
      expect(gameState.localPlayer!.x).toBeCloseTo(10, 4);
      expect(gameState.localPlayer!.y).toBeCloseTo(10, 4);
    });

    it("does nothing when not interpolating", () => {
      const x = gameState.localPlayer!.x;
      const y = gameState.localPlayer!.y;

      manager.update(0.016);

      expect(gameState.localPlayer!.x).toBe(x);
      expect(gameState.localPlayer!.y).toBe(y);
    });
  });

  describe("serverPosition", () => {
    it("returns last known server position", () => {
      manager.reconcile(42, 42);
      expect(manager.serverPosition).toEqual({ x: 42, y: 42 });
    });

    it("defaults to (0,0)", () => {
      expect(manager.serverPosition).toEqual({ x: 0, y: 0 });
    });
  });

  describe("integration: predict + reconcile cycle", () => {
    it("prediction applies locally, reconciliation corrects on mismatch", () => {
      // 1. Client predicts movement
      manager.move(1, 0, MOVE_SPEED, 0.25);
      const predictedX = gameState.localPlayer!.x;
      expect(predictedX).toBeGreaterThan(10);

      // 2. Server validates and returns corrected position (e.g., terrain blocked)
      manager.reconcile(10, 10);

      // 3. Should start correcting
      expect(manager.interpolating).toBe(true);

      // 4. After interpolation, position approaches server position
      for (let i = 0; i < 200; i++) {
        manager.update(0.016);
      }
      expect(gameState.localPlayer!.x).toBeCloseTo(10, 1);
    });

    it("multiple move calls accumulate prediction", () => {
      manager.move(1, 0, MOVE_SPEED, 0.1);
      const x1 = gameState.localPlayer!.x;

      manager.move(1, 0, MOVE_SPEED, 0.1);
      const x2 = gameState.localPlayer!.x;

      expect(x2).toBeGreaterThan(x1);
    });
  });
});
