import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChunkManager } from "./ChunkManager.js";
import { CHUNK_SIZE } from "@mmo/shared";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a trivial tile grid (all grass). */
function makeTiles(): number[][] {
  return Array.from({ length: CHUNK_SIZE }, () =>
    Array(CHUNK_SIZE).fill(0),
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ChunkManager", () => {
  let handler: ReturnType<typeof vi.fn>;
  let mgr: ChunkManager;

  beforeEach(() => {
    handler = vi.fn();
    mgr = new ChunkManager(handler);
  });

  /* ── Loading ── */

  it("requests chunks within load radius on update", () => {
    mgr.update(0, 0);
    // With loadRadius=4, (0,0) should request chunks in a diamond-ish area.
    // At minimum, (0,0) itself should be requested.
    expect(handler).toHaveBeenCalled();
    const requested: string[] = handler.mock.calls.map(
      (call: unknown[]) => `${call[0]},${call[1]}`,
    );
    expect(requested).toContain("0,0");
  });

  it("does not re-request already loaded chunks", () => {
    mgr.addChunk(0, 0, makeTiles());
    handler.mockClear();
    mgr.update(0, 0);
    // (0,0) is cached → should NOT be requested
    const requested: string[] = handler.mock.calls.map(
      (call: unknown[]) => `${call[0]},${call[1]}`,
    );
    expect(requested).not.toContain("0,0");
  });

  it("does not re-request chunks already in the request pipeline", () => {
    // First update queues (0,0)
    mgr.update(0, 0);
    handler.mockClear();
    // Second update at same position should skip (0,0)
    mgr.update(0, 0);
    const requested: string[] = handler.mock.calls.map(
      (call: unknown[]) => `${call[0]},${call[1]}`,
    );
    expect(requested).not.toContain("0,0");
  });

  it("addChunk makes the chunk retrievable", () => {
    const tiles = makeTiles();
    mgr.addChunk(1, -2, tiles);
    expect(mgr.hasChunk(1, -2)).toBe(true);
    const chunk = mgr.getChunk(1, -2);
    expect(chunk).toBeDefined();
    expect(chunk!.cx).toBe(1);
    expect(chunk!.cy).toBe(-2);
    expect(chunk!.tiles).toBe(tiles);
  });

  it("returns undefined for missing chunks", () => {
    expect(mgr.getChunk(99, 99)).toBeUndefined();
    expect(mgr.hasChunk(99, 99)).toBe(false);
  });

  it("reports correct size", () => {
    expect(mgr.size).toBe(0);
    mgr.addChunk(0, 0, makeTiles());
    mgr.addChunk(1, 0, makeTiles());
    expect(mgr.size).toBe(2);
  });

  /* ── Unloading ── */

  it("unloads chunks beyond the unload radius", () => {
    // Load at origin, then move far away
    mgr.addChunk(0, 0, makeTiles());
    expect(mgr.hasChunk(0, 0)).toBe(true);

    mgr.update(20, 20);
    expect(mgr.hasChunk(0, 0)).toBe(false);
  });

  it("keeps chunks within the unload radius", () => {
    mgr.addChunk(3, 0, makeTiles());
    mgr.update(0, 0); // distance to (3,0) ≈ 3 < unloadRadius(5)
    expect(mgr.hasChunk(3, 0)).toBe(true);
  });

  it("reports unloaded keys in the result", () => {
    mgr.addChunk(0, 0, makeTiles());
    const result = mgr.update(20, 20);
    expect(result.unloaded).toContain("0,0");
  });

  /* ── Priority ordering ── */

  it("requests closer chunks first (priority ordering)", () => {
    // Move to a new position so many chunks are requested
    mgr.update(10, 10);
    const requested = handler.mock.calls.map(
      (call: unknown[]) => ({ cx: call[0] as number, cy: call[1] as number }),
    );

    // The closest chunk to (10,10) is (10,10) itself
    expect(requested[0]).toEqual({ cx: 10, cy: 10 });

    // Distances should be non-decreasing
    for (let i = 1; i < requested.length; i++) {
      const dPrev = Math.sqrt(
        (requested[i - 1].cx - 10) ** 2 + (requested[i - 1].cy - 10) ** 2,
      );
      const dCurr = Math.sqrt(
        (requested[i].cx - 10) ** 2 + (requested[i].cy - 10) ** 2,
      );
      expect(dCurr).toBeGreaterThanOrEqual(dPrev - 0.001); // floating point tolerance
    }
  });

  /* ── Viewport query ── */

  it("getChunksForViewport returns overlapping chunks", () => {
    mgr.addChunk(0, 0, makeTiles());
    mgr.addChunk(1, 0, makeTiles());
    mgr.addChunk(5, 5, makeTiles()); // far away

    const CHUNK_PX = CHUNK_SIZE * 16;
    const result = mgr.getChunksForViewport({
      left: 0,
      right: CHUNK_PX * 2,
      top: 0,
      bottom: CHUNK_PX,
    });

    const keys = result.map((c) => `${c.cx},${c.cy}`);
    expect(keys).toContain("0,0");
    expect(keys).toContain("1,0");
    // (5,5) is outside viewport + 1-chunk buffer
    expect(keys).not.toContain("5,5");
  });

  it("getChunksForViewport includes 1-chunk buffer", () => {
    mgr.addChunk(2, 0, makeTiles());
    mgr.addChunk(3, 0, makeTiles());

    const CHUNK_PX = CHUNK_SIZE * 16;
    // Viewport covers 0 to ~1023px (chunks 0-1).
    // With 1-chunk buffer (512px pad), padded range = -512 to 1535.
    // floor(1535/512) = 2, so chunk cx=2 is within buffer, cx=3 is not.
    const result = mgr.getChunksForViewport({
      left: 0,
      right: CHUNK_PX * 2 - 1,
      top: 0,
      bottom: CHUNK_PX - 1,
    });

    const keys = result.map((c) => `${c.cx},${c.cy}`);
    expect(keys).toContain("2,0"); // just outside viewport but within 1-chunk buffer
    expect(keys).not.toContain("3,0"); // outside viewport + buffer
  });

  /* ── Negative coordinates ── */

  it("handles negative chunk coordinates", () => {
    const tiles = makeTiles();
    mgr.addChunk(-3, -5, tiles);
    expect(mgr.hasChunk(-3, -5)).toBe(true);
    const chunk = mgr.getChunk(-3, -5);
    expect(chunk!.cx).toBe(-3);
    expect(chunk!.cy).toBe(-5);
  });

  it("requests negative coordinate chunks when player is at negative coords", () => {
    mgr.update(-10, -10);
    const requested: string[] = handler.mock.calls.map(
      (call: unknown[]) => `${call[0]},${call[1]}`,
    );
    expect(requested).toContain("-10,-10");
  });

  /* ── keys() ── */

  it("keys() returns all cached chunk keys", () => {
    mgr.addChunk(0, 0, makeTiles());
    mgr.addChunk(1, 1, makeTiles());
    const keys = mgr.keys();
    expect(keys).toContain("0,0");
    expect(keys).toContain("1,1");
    expect(keys.length).toBe(2);
  });

  /* ── Request deduplication ── */

  it("deduplicates requests across multiple updates at the same position", () => {
    mgr.update(5, 5);
    const count1 = handler.mock.calls.length;
    mgr.update(5, 5);
    const count2 = handler.mock.calls.length;
    // No new requests for the same position
    expect(count2).toBe(count1);
  });
});
