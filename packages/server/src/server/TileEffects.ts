import type { PhysicsEffect } from "./TilePhysics.js";

// ── Effect types ───────────────────────────────────────────────────────────

/** A visual effect to broadcast to clients for rendering. */
export interface VisualEffect {
  /** Unique identifier for this effect instance. */
  id: string;
  /** Effect type determines client-side rendering. */
  type: "splash" | "ember" | "dust" | "glow" | "melt_steam";
  /** World X coordinate of the effect. */
  x: number;
  /** World Y coordinate of the effect. */
  y: number;
  /** Duration in milliseconds. */
  duration: number;
  /** Effect intensity (0-1). */
  intensity: number;
  /** Timestamp when the effect was created (ms). */
  createdAt: number;
  /** Extra metadata for rendering. */
  metadata?: Record<string, unknown>;
}

// ── Effect configuration ───────────────────────────────────────────────────

const EFFECT_CONFIG: Record<
  string,
  { type: VisualEffect["type"]; duration: number; intensity: number }
> = {
  water_flow: { type: "splash", duration: 500, intensity: 0.6 },
  sand_pile: { type: "dust", duration: 400, intensity: 0.5 },
  fire_spread: { type: "ember", duration: 800, intensity: 0.8 },
  fire_burnout: { type: "ember", duration: 1200, intensity: 0.3 },
  lava_flow: { type: "glow", duration: 1500, intensity: 0.9 },
  lava_melt: { type: "melt_steam", duration: 600, intensity: 0.7 },
};

// ── TileEffects ────────────────────────────────────────────────────────────

/**
 * Server-side visual effects manager for physics events.
 *
 * Converts physics effect events into visual effects that can be
 * broadcast to clients for rendering. Effects are server-authoritative.
 */
export class TileEffects {
  private activeEffects: Map<string, VisualEffect> = new Map();
  private effectCounter = 0;

  /**
   * Process a batch of physics effects and return visual effects to broadcast.
   *
   * @param physicsEffects - Effects from TilePhysics.processChanges().
   * @returns              - Visual effects for client rendering.
   */
  processEffects(physicsEffects: PhysicsEffect[]): VisualEffect[] {
    const now = Date.now();
    const visualEffects: VisualEffect[] = [];

    for (const effect of physicsEffects) {
      const config = EFFECT_CONFIG[effect.type];
      if (!config) continue;

      const visualEffect: VisualEffect = {
        id: `fx_${++this.effectCounter}`,
        type: config.type,
        x: effect.x,
        y: effect.y,
        duration: config.duration,
        intensity: config.intensity,
        createdAt: now,
        metadata: effect.data,
      };

      this.activeEffects.set(visualEffect.id, visualEffect);
      visualEffects.push(visualEffect);
    }

    return visualEffects;
  }

  /**
   * Update active effects — remove expired ones.
   * Call this periodically (e.g., every second).
   *
   * @param now - Current timestamp in milliseconds.
   * @returns    - IDs of expired effects (for cleanup).
   */
  tick(now: number): string[] {
    const expired: string[] = [];

    for (const [id, effect] of this.activeEffects) {
      if (now - effect.createdAt > effect.duration) {
        expired.push(id);
        this.activeEffects.delete(id);
      }
    }

    return expired;
  }

  /**
   * Get all currently active effects.
   */
  getActiveEffects(): VisualEffect[] {
    return Array.from(this.activeEffects.values());
  }

  /**
   * Get the count of active effects.
   */
  get activeCount(): number {
    return this.activeEffects.size;
  }

  /**
   * Clear all active effects.
   */
  clear(): void {
    this.activeEffects.clear();
  }
}
