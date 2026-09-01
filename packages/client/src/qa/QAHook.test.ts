// @vitest-environment jsdom
/**
 * Phase 4A.7: QA Hook Tests (QA-001..QA-006)
 *
 * Validates the DEV-only window.__QA__ hook used for browser combat
 * acceptance testing:
 * - QA-001: DEV environment exposes window.__QA__
 * - QA-002: getWorldSnapshot returns player coordinates
 * - QA-003: getWorldSnapshot returns mob coordinates
 * - QA-004: return value is a snapshot, not a mutable GameState reference
 * - QA-005: no setters exist on the hook
 * - QA-006: production build does not expose __QA__
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { GameState } from "../game/GameState.js";
import { installQAHook, type QASnapshot, type QAHook } from "./QAHook.js";

/** Minimal PlayerState for setLocalPlayer. */
function makePlayerState(x: number, y: number) {
  return {
    x,
    y,
    health: 100,
    maxHealth: 100,
    name: "TestHero",
    level: 3,
    speed: 4,
    chunkX: 0,
    chunkY: 0,
    title: "",
    mountId: "",
    maxMaxHealth: 100,
    xp: 0,
    xpToNextLevel: 100,
  };
}

/** Create a GameState with known local player + 2 mobs. */
function makeGameState(): GameState {
  const gs = new GameState(42);
  gs.setLocalPlayer(
    "player-1",
    makePlayerState(10, 20) as unknown as Parameters<GameState["setLocalPlayer"]>[1],
  );
  gs.mobs.set("mob-1", {
    id: "mob-1",
    typeId: "slime",
    x: 5,
    y: 8,
    health: 30,
    maxHealth: 50,
    isAggro: false,
  });
  gs.mobs.set("mob-2", {
    id: "mob-2",
    typeId: "goblin",
    x: 12,
    y: 15,
    health: 40,
    maxHealth: 60,
    isAggro: true,
  });
  return gs;
}

/** Type-safe access to import.meta.env.DEV for toggling in tests. */
function setDevMode(value: boolean): void {
  (import.meta as unknown as { env: { DEV: boolean } }).env.DEV = value;
}

describe("QA Hook (window.__QA__)", () => {
  beforeEach(() => {
    setDevMode(true);
    delete (window as unknown as Record<string, unknown>).__QA__;
  });

  afterEach(() => {
    setDevMode(true);
    delete (window as unknown as Record<string, unknown>).__QA__;
  });

  it("QA-001: DEV environment exposes window.__QA__", () => {
    setDevMode(true);
    installQAHook(makeGameState());
    const hook = (window as unknown as { __QA__?: QAHook }).__QA__;
    expect(hook).toBeDefined();
    expect(typeof hook?.getWorldSnapshot).toBe("function");
  });

  it("QA-002: getWorldSnapshot returns player coordinates", () => {
    setDevMode(true);
    installQAHook(makeGameState());
    const snapshot = (window as unknown as { __QA__?: QAHook }).__QA__!.getWorldSnapshot();
    expect(snapshot.localPlayer).toEqual({ x: 10, y: 20 });
  });

  it("QA-003: getWorldSnapshot returns mob coordinates", () => {
    setDevMode(true);
    installQAHook(makeGameState());
    const snapshot = (window as unknown as { __QA__?: QAHook }).__QA__!.getWorldSnapshot();
    expect(snapshot.mobs).toHaveLength(2);
    expect(snapshot.mobs).toEqual(
      expect.arrayContaining([
        { id: "mob-1", x: 5, y: 8 },
        { id: "mob-2", x: 12, y: 15 },
      ]),
    );
  });

  it("QA-004: snapshot is frozen, not a mutable GameState reference", () => {
    setDevMode(true);
    installQAHook(makeGameState());
    const snapshot = (window as unknown as { __QA__?: QAHook }).__QA__!.getWorldSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.localPlayer!)).toBe(true);
    expect(Object.isFrozen(snapshot.mobs)).toBe(true);

    // Mutating a frozen snapshot throws in strict mode.
    expect(() => {
      (snapshot as { localPlayer: { x: number; y: number } | null }).localPlayer = {
        x: 999,
        y: 999,
      };
    }).toThrow();

    // Deep mutation of a frozen nested object also throws.
    expect(() => {
      (snapshot.localPlayer as { x: number }).x = 999;
    }).toThrow();
  });

  it("QA-005: no setters exist on __QA__", () => {
    setDevMode(true);
    installQAHook(makeGameState());
    const hook = (window as unknown as { __QA__?: QAHook }).__QA__!;
    const ownProps = Object.getOwnPropertyNames(hook);
    expect(ownProps).toEqual(["getWorldSnapshot"]);
    expect(typeof hook.getWorldSnapshot).toBe("function");
    // getWorldSnapshot must be a plain function, not a setter pair.
    const descriptor = Object.getOwnPropertyDescriptor(hook, "getWorldSnapshot");
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.set).toBeUndefined();
  });

  it("QA-006: production build does not expose __QA__", () => {
    // Vitest inlines import.meta.env.DEV at transform time, so runtime toggling
    // is not reliable here. The authoritative check is a REAL production build:
    //   - static guard must exist in source
    //   - the window assignment must come AFTER the guard (inside the DEV block)
    //   - `vite build` output must NOT contain "__QA__" (verified in Task 6)
    const srcPath = path.resolve(__dirname, "QAHook.ts");
    const src = fs.readFileSync(srcPath, "utf-8");

    const guardIdx = src.indexOf("if (!import.meta.env.DEV) return;");
    const assignIdx = src.indexOf("__QA__ = hook");
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    expect(assignIdx).toBeGreaterThan(guardIdx);
  });

  it("QA-007: snapshot reflects only {x,y} fields (no health/level/aggro leak)", () => {
    setDevMode(true);
    installQAHook(makeGameState());
    const snapshot = (window as unknown as { __QA__?: QAHook }).__QA__!.getWorldSnapshot() as QASnapshot;

    expect(snapshot.localPlayer).toEqual({ x: 10, y: 20 });
    expect(Object.keys(snapshot.localPlayer!)).toEqual(["x", "y"]);
    for (const mob of snapshot.mobs) {
      expect(Object.keys(mob)).toEqual(["id", "x", "y"]);
    }
  });
});
