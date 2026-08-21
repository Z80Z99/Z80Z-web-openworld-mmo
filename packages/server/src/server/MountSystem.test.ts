import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MountSystem, MOUNT_TYPES } from "./MountSystem.js";
import { MOVE_SPEED } from "@mmo/shared";
import type { PlayerState } from "@mmo/shared";
import { GameDatabase } from "../db/index.js";

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

describe("MountSystem", () => {
  let db: GameDatabase;
  let mountSystem: MountSystem;

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();
    mountSystem = new MountSystem(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  describe("MOUNT_TYPES", () => {
    it("has all required mount types", () => {
      expect(MOUNT_TYPES.horse).toBeDefined();
      expect(MOUNT_TYPES.wolf).toBeDefined();
      expect(MOUNT_TYPES.eagle).toBeDefined();
      expect(MOUNT_TYPES.turtle).toBeDefined();
    });

    it("has correct speed multipliers", () => {
      expect(MOUNT_TYPES.horse.speedMultiplier).toBe(1.5);
      expect(MOUNT_TYPES.wolf.speedMultiplier).toBe(1.7);
      expect(MOUNT_TYPES.eagle.speedMultiplier).toBe(2.0);
      expect(MOUNT_TYPES.turtle.speedMultiplier).toBe(1.2);
    });

    it("marks eagle as flying", () => {
      expect(MOUNT_TYPES.eagle.isFlying).toBe(true);
      expect(MOUNT_TYPES.horse.isFlying).toBe(false);
    });
  });

  describe("processMountAction", () => {
    it("mounts player with valid mount type", () => {
      const player = makePlayer();
      const result = mountSystem.processMountAction("p1", "horse", "mount", player, false);

      expect(result.success).toBe(true);
      expect(result.mountId).toBe("horse");
      expect(result.speed).toBe(MOVE_SPEED * 1.5);
      expect(player.mountId).toBe("horse");
      expect(player.speed).toBe(MOVE_SPEED * 1.5);
    });

    it("rejects invalid mount type", () => {
      const player = makePlayer();
      const result = mountSystem.processMountAction("p1", "invalid_mount", "mount", player, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid mount type");
      expect(player.mountId).toBe("");
    });

    it("rejects mounting while in combat", () => {
      const player = makePlayer();
      const result = mountSystem.processMountAction("p1", "horse", "mount", player, true);

      expect(result.success).toBe(false);
      expect(result.error).toContain("combat");
      expect(player.mountId).toBe("");
    });

    it("rejects double mounting", () => {
      const player = makePlayer({ mountId: "horse", speed: MOVE_SPEED * 1.5 });
      const result = mountSystem.processMountAction("p1", "wolf", "mount", player, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Already mounted");
      expect(player.mountId).toBe("horse");
    });

    it("dismounts player successfully", () => {
      const player = makePlayer({ mountId: "horse", speed: MOVE_SPEED * 1.5 });
      const result = mountSystem.processMountAction("p1", "horse", "dismount", player, false);

      expect(result.success).toBe(true);
      expect(result.mountId).toBe("horse");
      expect(result.speed).toBe(MOVE_SPEED);
      expect(player.mountId).toBe("");
      expect(player.speed).toBe(MOVE_SPEED);
    });

    it("rejects dismounting when not mounted", () => {
      const player = makePlayer();
      const result = mountSystem.processMountAction("p1", "horse", "dismount", player, false);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not currently mounted");
    });

    it("allows mounting different mount types", () => {
      const player = makePlayer();

      // Mount horse
      const horseResult = mountSystem.processMountAction("p1", "horse", "mount", player, false);
      expect(horseResult.success).toBe(true);
      expect(player.mountId).toBe("horse");

      // Dismount
      mountSystem.processMountAction("p1", "horse", "dismount", player, false);
      expect(player.mountId).toBe("");

      // Mount wolf
      const wolfResult = mountSystem.processMountAction("p1", "wolf", "mount", player, false);
      expect(wolfResult.success).toBe(true);
      expect(player.mountId).toBe("wolf");
      expect(player.speed).toBe(MOVE_SPEED * 1.7);
    });
  });

  describe("speed calculation", () => {
    it("calculates correct speed for each mount type", () => {
      expect(mountSystem.calculateSpeed(MOVE_SPEED, "horse")).toBe(MOVE_SPEED * 1.5);
      expect(mountSystem.calculateSpeed(MOVE_SPEED, "wolf")).toBe(MOVE_SPEED * 1.7);
      expect(mountSystem.calculateSpeed(MOVE_SPEED, "eagle")).toBe(MOVE_SPEED * 2.0);
      expect(mountSystem.calculateSpeed(MOVE_SPEED, "turtle")).toBe(MOVE_SPEED * 1.2);
    });

    it("returns base speed for invalid mount", () => {
      expect(mountSystem.calculateSpeed(MOVE_SPEED, "invalid")).toBe(MOVE_SPEED);
    });

    it("getSpeedMultiplier returns correct value", () => {
      expect(mountSystem.getSpeedMultiplier("horse")).toBe(1.5);
      expect(mountSystem.getSpeedMultiplier("wolf")).toBe(1.7);
      expect(mountSystem.getSpeedMultiplier("invalid")).toBe(1.0);
    });
  });

  describe("player tracking", () => {
    it("tracks mounted players", () => {
      const player = makePlayer();
      mountSystem.processMountAction("p1", "horse", "mount", player, false);

      expect(mountSystem.isPlayerMounted("p1")).toBe(true);
      expect(mountSystem.getPlayerMount("p1")).toBe("horse");
    });

    it("clears tracking on dismount", () => {
      const player = makePlayer({ mountId: "horse", speed: MOVE_SPEED * 1.5 });
      mountSystem.processMountAction("p1", "horse", "dismount", player, false);

      expect(mountSystem.isPlayerMounted("p1")).toBe(false);
      expect(mountSystem.getPlayerMount("p1")).toBeUndefined();
    });

    it("removes player tracking on disconnect", () => {
      const player = makePlayer();
      mountSystem.processMountAction("p1", "horse", "mount", player, false);
      expect(mountSystem.isPlayerMounted("p1")).toBe(true);

      mountSystem.removePlayerMount("p1");
      expect(mountSystem.isPlayerMounted("p1")).toBe(false);
    });
  });

  describe("mount persistence", () => {
    it("restores mount from saved state", () => {
      const player = makePlayer();
      mountSystem.restorePlayerMount("p1", player, "horse");

      expect(player.mountId).toBe("horse");
      expect(player.speed).toBe(MOVE_SPEED * 1.5);
      expect(mountSystem.isPlayerMounted("p1")).toBe(true);
    });

    it("ignores invalid mount ID on restore", () => {
      const player = makePlayer();
      mountSystem.restorePlayerMount("p1", player, "invalid");

      expect(player.mountId).toBe("");
      expect(player.speed).toBe(MOVE_SPEED);
      expect(mountSystem.isPlayerMounted("p1")).toBe(false);
    });

    it("ignores empty mount ID on restore", () => {
      const player = makePlayer();
      mountSystem.restorePlayerMount("p1", player, "");

      expect(player.mountId).toBe("");
      expect(player.speed).toBe(MOVE_SPEED);
    });
  });

  describe("mount ownership", () => {
    it("validates ownership for all mount types", () => {
      expect(mountSystem.validateMountOwnership("player1", "horse")).toBe(true);
      expect(mountSystem.validateMountOwnership("player1", "wolf")).toBe(true);
      expect(mountSystem.validateMountOwnership("player1", "eagle")).toBe(true);
      expect(mountSystem.validateMountOwnership("player1", "turtle")).toBe(true);
    });

    it("rejects unknown mount types", () => {
      expect(mountSystem.validateMountOwnership("player1", "dragon")).toBe(false);
    });
  });

  describe("getMountInfo", () => {
    it("returns mount info for valid mount", () => {
      const info = mountSystem.getMountInfo("horse");
      expect(info).toBeDefined();
      expect(info?.name).toBe("Horse");
      expect(info?.rarity).toBe("common");
    });

    it("returns undefined for invalid mount", () => {
      expect(mountSystem.getMountInfo("invalid")).toBeUndefined();
    });
  });
});
