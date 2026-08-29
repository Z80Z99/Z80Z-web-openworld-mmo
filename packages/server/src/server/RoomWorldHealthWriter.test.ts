import { describe, it, expect } from "vitest";
import { RoomWorldHealthWriter } from "./RoomWorldHealthWriter.js";

/* ═══════════════════════════════════════════════════════
 * RoomWorldHealthWriter — Phase 3G-2 mob HP authority
 * PBA-013/014: MobInstance.currentHp is the authority;
 * EntityState.health is a sync mirror; players unchanged.
 * ═══════════════════════════════════════════════════════ */

function makeRoom() {
  return {
    state: {
      players: new Map<string, { health: number; maxHealth: number }>(),
      entities: new Map<string, { health: number; maxHealth: number }>(),
    },
  } as unknown as {
    state: {
      players: Map<string, { health: number; maxHealth: number }>;
      entities: Map<string, { health: number; maxHealth: number }>;
    };
  };
}

describe("RoomWorldHealthWriter (Phase 3G-2)", () => {
  it("PBA-013: getHp reads MobInstance.currentHp (authority), not the stale entity mirror", () => {
    const room = makeRoom();
    // Stale/different mirror value — the entity lags behind the authoritative mob HP
    room.state.entities.set("mob-1", { health: 999, maxHealth: 100 });
    const mobStore = new Map<string, { currentHp: number; maxHp: number }>([
      ["mob-1", { currentHp: 50, maxHp: 100 }],
    ]);
    const writer = new RoomWorldHealthWriter(room, (id) => mobStore.get(id));

    expect(writer.getHp("mob-1")).toEqual({ currentHp: 50, maxHp: 100 });
  });

  it("PBA-014: setHp writes MobInstance.currentHp and keeps the entity mirror in sync", () => {
    const room = makeRoom();
    room.state.entities.set("mob-1", { health: 50, maxHealth: 100 });
    const mobStore = new Map<string, { currentHp: number; maxHp: number }>([
      ["mob-1", { currentHp: 50, maxHp: 100 }],
    ]);
    const writer = new RoomWorldHealthWriter(room, (id) => mobStore.get(id));

    writer.setHp("mob-1", 30);
    expect(mobStore.get("mob-1")!.currentHp).toBe(30); // authority written
    expect(room.state.entities.get("mob-1")!.health).toBe(30); // mirror synced
    expect(mobStore.get("mob-1")!.currentHp).toBe(
      room.state.entities.get("mob-1")!.health,
    );
  });

  it("player HP stays on player.health (unchanged behavior)", () => {
    const room = makeRoom();
    room.state.players.set("player-1", { health: 80, maxHealth: 100 });
    const writer = new RoomWorldHealthWriter(room);

    writer.setHp("player-1", 60);
    expect(room.state.players.get("player-1")!.health).toBe(60);
    expect(writer.getHp("player-1")).toEqual({ currentHp: 60, maxHp: 100 });
  });

  it("setHp clamps to [0, maxHp]", () => {
    const room = makeRoom();
    room.state.players.set("player-1", { health: 80, maxHealth: 100 });
    const mobStore = new Map<string, { currentHp: number; maxHp: number }>([
      ["mob-1", { currentHp: 50, maxHp: 100 }],
    ]);
    const writer = new RoomWorldHealthWriter(room, (id) => mobStore.get(id));

    writer.setHp("player-1", 999);
    expect(room.state.players.get("player-1")!.health).toBe(100);
    writer.setHp("mob-1", -5);
    expect(mobStore.get("mob-1")!.currentHp).toBe(0);
  });

  it("falls back to the entity mirror when no getMob provider is given", () => {
    const room = makeRoom();
    room.state.entities.set("mob-2", { health: 20, maxHealth: 50 });
    const writer = new RoomWorldHealthWriter(room); // no provider → backward compatible

    expect(writer.getHp("mob-2")).toEqual({ currentHp: 20, maxHp: 50 });
    writer.setHp("mob-2", 15);
    expect(room.state.entities.get("mob-2")!.health).toBe(15);
  });

  it("isAlive reflects the authoritative value", () => {
    const room = makeRoom();
    const mobStore = new Map<string, { currentHp: number; maxHp: number }>([
      ["mob-1", { currentHp: 0, maxHp: 100 }],
    ]);
    const writer = new RoomWorldHealthWriter(room, (id) => mobStore.get(id));

    expect(writer.isAlive("mob-1")).toBe(false);
    writer.setHp("mob-1", 40);
    expect(writer.isAlive("mob-1")).toBe(true);
  });
});
