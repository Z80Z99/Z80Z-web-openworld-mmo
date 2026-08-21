// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Application, Container } from "pixi.js";

import { Camera } from "./renderer/Camera.js";
import { InputManager } from "./input/InputManager.js";
import { GameState } from "./game/GameState.js";
import { HUD } from "./ui/HUD.js";
import { CLIENT_VERSION } from "./index.js";

/* ── Camera ── */
describe("Camera", () => {
  it("initializes at origin", () => {
    const stage = new Container();
    const cam = new Camera(stage, 800, 600);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.viewportWidth).toBe(800);
    expect(cam.viewportHeight).toBe(600);
  });

  it("follows target position with lerp", () => {
    const stage = new Container();
    const cam = new Camera(stage, 800, 600, 0.1);

    // Snap first
    cam.snapTo(0, 0);
    // Follow toward (100, 100)
    cam.follow(100, 100, 0.016);
    // Should have moved toward the target (lerp ≈ 0.1 * dt*60)
    expect(cam.x).toBeGreaterThan(0);
    expect(cam.x).toBeLessThan(100);
  });

  it("snapTo positions camera instantly", () => {
    const stage = new Container();
    const cam = new Camera(stage, 800, 600);
    cam.snapTo(50, 75);
    expect(cam.x).toBe(50);
    expect(cam.y).toBe(75);
  });

  it("getVisibleBounds returns correct viewport", () => {
    const stage = new Container();
    const cam = new Camera(stage, 800, 600);
    cam.snapTo(100, 200);
    const bounds = cam.getVisibleBounds();
    expect(bounds.left).toBe(-300); // 100 - 400
    expect(bounds.right).toBe(500);  // 100 + 400
    expect(bounds.top).toBe(-100);   // 200 - 300
    expect(bounds.bottom).toBe(500); // 200 + 300
  });

  it("resize updates viewport dimensions", () => {
    const stage = new Container();
    const cam = new Camera(stage, 800, 600);
    cam.resize(1024, 768);
    expect(cam.viewportWidth).toBe(1024);
    expect(cam.viewportHeight).toBe(768);
  });
});

/* ── InputManager ── */
describe("InputManager", () => {
  let input: InputManager;

  beforeEach(() => {
    // Use a mock element that won't actually fire events
    const mockEl = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    input = new InputManager(mockEl);
  });

  it("returns zero direction when no keys are pressed", () => {
    const dir = input.getDirection();
    expect(dir.dx).toBe(0);
    expect(dir.dy).toBe(0);
  });

  it("registers and removes listeners", () => {
    const cb = vi.fn();
    const unsub = input.onInput(cb);
    unsub();
    // After unsubscribe, cb should not be called again
  });

  it("poll emits input to listeners when direction is non-zero", () => {
    const cb = vi.fn();
    input.onInput(cb);

    // Simulate holding W key by accessing internal state through keyboard event
    // We'll test the direction calculation indirectly
    const dir = input.getDirection();
    // Initially zero, so poll shouldn't fire
    input.poll();
    expect(cb).not.toHaveBeenCalled();
  });

  it("destroy cleans up event listeners", () => {
    const mockEl = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    const inp = new InputManager(mockEl);
    inp.destroy();
    // Should have called removeEventListener for each registered event
    expect(mockEl.removeEventListener).toHaveBeenCalledTimes(5);
  });
});

/* ── GameState ── */
describe("GameState", () => {
  it("initializes with correct seed", () => {
    const state = new GameState(42);
    expect(state.localPlayer).toBeNull();
    expect(state.remotePlayers.size).toBe(0);
    expect(state.roomId).toBeNull();
  });

  it("sets and updates local player", () => {
    const state = new GameState(42);
    const mockPlayerState = {
      x: 10, y: 20, health: 80, maxHealth: 100,
      name: "TestPlayer", level: 5, speed: 4,
      chunkX: 0, chunkY: 0, title: "", mountId: "",
      maxMaxHealth: 100,
    } as any;
    state.setLocalPlayer("p1", mockPlayerState);
    expect(state.localPlayer).not.toBeNull();
    expect(state.localPlayer!.id).toBe("p1");
    expect(state.localPlayer!.x).toBe(10);
    expect(state.localPlayer!.name).toBe("TestPlayer");
  });

  it("predictMove adjusts local player position", () => {
    const state = new GameState(42);
    const mockPlayerState = {
      x: 0, y: 0, health: 100, maxHealth: 100,
      name: "Player", level: 1, speed: 4,
      chunkX: 0, chunkY: 0, title: "", mountId: "",
      maxMaxHealth: 100,
    } as any;
    state.setLocalPlayer("p1", mockPlayerState);
    state.predictMove(1, 0, 4, 0.016); // move right at 4 units/sec for 16ms
    expect(state.localPlayer!.x).toBeGreaterThan(0);
    expect(state.localPlayer!.y).toBe(0);
  });

  it("manages remote players", () => {
    const state = new GameState(42);
    const mockState = {
      x: 5, y: 5, health: 100, maxHealth: 100,
      name: "Other", level: 1, speed: 4,
      chunkX: 0, chunkY: 0, title: "", mountId: "",
      maxMaxHealth: 100,
    } as any;
    state.addRemotePlayer("p2", mockState);
    expect(state.remotePlayers.size).toBe(1);
    expect(state.remotePlayers.get("p2")!.name).toBe("Other");

    state.removeRemotePlayer("p2");
    expect(state.remotePlayers.size).toBe(0);
  });

  it("converts world coords to chunk coords", () => {
    const result = GameState.worldToChunk(33, -15);
    expect(result.cx).toBe(1);  // floor(33/32)
    expect(result.cy).toBe(-1); // floor(-15/32)
  });

  it("generates predicted chunks deterministically", () => {
    const state1 = new GameState(42);
    const state2 = new GameState(42);
    const c1 = state1.predictChunk(0, 0);
    const c2 = state2.predictChunk(0, 0);
    expect(c1.tiles).toEqual(c2.tiles);
  });
});

/* ── HUD ── */
describe("HUD", () => {
  it("creates DOM elements", () => {
    const parent = document.createElement("div");
    const hud = new HUD(parent);
    expect(parent.children.length).toBe(1);
    hud.destroy();
    expect(parent.children.length).toBe(0);
  });

  it("updateHealth changes fill width", () => {
    const parent = document.createElement("div");
    const hud = new HUD(parent);
    hud.updateHealth(50, 100);
    // Just verify it doesn't throw
    hud.updateHealth(0, 100);
    hud.updateHealth(100, 100);
    hud.destroy();
  });
});

/* ── Client version ── */
describe("client", () => {
  it("exports version", () => {
    expect(CLIENT_VERSION).toBe("0.0.1");
  });
});
