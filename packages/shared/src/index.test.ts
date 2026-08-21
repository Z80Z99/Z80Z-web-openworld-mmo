import { describe, it, expect } from "vitest";
import {
  SHARED_VERSION,
  PlayerState,
  RoomState,
  TICK_RATE,
} from "./index.js";

describe("shared", () => {
  it("exports version", () => {
    expect(SHARED_VERSION).toBe("0.0.1");
  });

  it("re-exports PlayerState from types", () => {
    const p = new PlayerState();
    expect(p.health).toBe(100);
  });

  it("re-exports RoomState from types", () => {
    const r = new RoomState();
    expect(r.players.size).toBe(0);
  });

  it("re-exports constants", () => {
    expect(TICK_RATE).toBe(20);
  });
});
