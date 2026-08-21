import type Database from "better-sqlite3";
import { MOVE_SPEED } from "@mmo/shared";
import type { PlayerState } from "@mmo/shared";

/* ── Mount Type Definitions ── */

export interface MountType {
  id: string;
  name: string;
  speedMultiplier: number;
  rarity: "common" | "uncommon" | "rare" | "legendary";
  isFlying: boolean;
}

/** All mount types available in the game. */
export const MOUNT_TYPES: Record<string, MountType> = {
  horse: {
    id: "horse",
    name: "Horse",
    speedMultiplier: 1.5,
    rarity: "common",
    isFlying: false,
  },
  wolf: {
    id: "wolf",
    name: "Wolf",
    speedMultiplier: 1.7,
    rarity: "rare",
    isFlying: false,
  },
  eagle: {
    id: "eagle",
    name: "Eagle",
    speedMultiplier: 2.0,
    rarity: "legendary",
    isFlying: true,
  },
  turtle: {
    id: "turtle",
    name: "Turtle",
    speedMultiplier: 1.2,
    rarity: "common",
    isFlying: false,
  },
};

/* ── Mount Result Types ── */

export interface MountResult {
  success: boolean;
  error?: string;
  mountId?: string;
  speed?: number;
}

/* ── MountSystem Class ── */

/**
 * Server-side mount system.
 *
 * Handles mount/dismount actions, speed calculation, ownership validation,
 * and combat state checks.
 */
export class MountSystem {
  private readonly db: Database.Database;
  private readonly playerMounts = new Map<string, string>(); // sessionId → mountId

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Process a mount action request.
   *
   * @param sessionId - The player's session ID.
   * @param mountId   - The mount type ID to mount/dismount.
   * @param action    - 'mount' or 'dismount'.
   * @param player    - The player's current state.
   * @param isInCombat - Whether the player is currently in combat.
   * @returns         - MountResult with success status and updated speed.
   */
  processMountAction(
    sessionId: string,
    mountId: string,
    action: "mount" | "dismount",
    player: PlayerState,
    isInCombat: boolean,
  ): MountResult {
    // Validate mount type exists
    const mountType = MOUNT_TYPES[mountId];
    if (!mountId || !mountType) {
      return { success: false, error: "Invalid mount type." };
    }

    if (action === "dismount") {
      return this.handleDismount(sessionId, player);
    }

    // Check if already mounted
    if (player.mountId) {
      return { success: false, error: "Already mounted. Dismount first." };
    }

    // Cannot mount while in combat
    if (isInCombat) {
      return { success: false, error: "Cannot mount while in combat." };
    }

    // Validate ownership
    if (!this.validateMountOwnership(player.name, mountId)) {
      return { success: false, error: "You do not own this mount." };
    }

    // Apply mount
    player.mountId = mountId;
    player.speed = MOVE_SPEED * mountType.speedMultiplier;
    this.playerMounts.set(sessionId, mountId);

    return {
      success: true,
      mountId,
      speed: player.speed,
    };
  }

  /**
   * Handle dismounting.
   */
  private handleDismount(sessionId: string, player: PlayerState): MountResult {
    if (!player.mountId) {
      return { success: false, error: "Not currently mounted." };
    }

    const previousMount = player.mountId;
    player.mountId = "";
    player.speed = MOVE_SPEED;
    this.playerMounts.delete(sessionId);

    return {
      success: true,
      mountId: previousMount,
      speed: player.speed,
    };
  }

  /**
   * Validate that a player owns a specific mount.
   * For now, all players own all mounts (simplified for MVP).
   */
  validateMountOwnership(playerId: string, mountId: string): boolean {
    // MVP: All players can use any mount type
    // In production, check mounts table for ownership
    return mountId in MOUNT_TYPES;
  }

  /**
   * Get the speed multiplier for a mount type.
   */
  getSpeedMultiplier(mountId: string): number {
    return MOUNT_TYPES[mountId]?.speedMultiplier ?? 1.0;
  }

  /**
   * Get mount info by ID.
   */
  getMountInfo(mountId: string): MountType | undefined {
    return MOUNT_TYPES[mountId];
  }

  /**
   * Calculate effective speed for a player.
   */
  calculateSpeed(baseSpeed: number, mountId: string): number {
    const mountType = MOUNT_TYPES[mountId];
    if (!mountType) return baseSpeed;
    return baseSpeed * mountType.speedMultiplier;
  }

  /**
   * Check if a player is mounted.
   */
  isPlayerMounted(sessionId: string): boolean {
    return this.playerMounts.has(sessionId);
  }

  /**
   * Get the mount ID for a player.
   */
  getPlayerMount(sessionId: string): string | undefined {
    return this.playerMounts.get(sessionId);
  }

  /**
   * Remove player mount tracking (call on disconnect).
   */
  removePlayerMount(sessionId: string): void {
    this.playerMounts.delete(sessionId);
  }

  /**
   * Restore player mount from database (call on rejoin).
   */
  restorePlayerMount(sessionId: string, player: PlayerState, mountId: string): void {
    if (mountId && mountId in MOUNT_TYPES) {
      player.mountId = mountId;
      player.speed = MOVE_SPEED * MOUNT_TYPES[mountId].speedMultiplier;
      this.playerMounts.set(sessionId, mountId);
    }
  }
}
