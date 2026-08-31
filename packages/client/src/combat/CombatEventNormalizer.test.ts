import { describe, it, expect } from "vitest";
import { normalizeCombatEvent } from "./CombatEventNormalizer";

describe("Legacy Protocol Cleanup — Event Type Removal", () => {
  it("LPC-018: encounter_timeout normalizes to null", () => {
    const result = normalizeCombatEvent({
      type: "encounter_timeout",
      sourceId: "p1",
      targetId: "mob1",
    });
    expect(result).toBeNull();
  });

  it("LPC-019: defend normalizes to null", () => {
    const result = normalizeCombatEvent({
      type: "defend",
      sourceId: "p1",
      targetId: "mob1",
    });
    expect(result).toBeNull();
  });

  it("LPC-020: mob_respawn normalizes to null", () => {
    const result = normalizeCombatEvent({
      type: "mob_respawn",
      sourceId: "p1",
      targetId: "mob1",
    });
    expect(result).toBeNull();
  });
});
