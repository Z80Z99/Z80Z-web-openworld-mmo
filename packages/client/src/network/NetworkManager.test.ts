import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameState } from "../game/GameState.js";
import { NetworkManager, type NetworkCallbacks } from "./NetworkManager.js";

type MessageHandler = (payload: unknown) => void;

const room = {
  id: "room-1",
  sessionId: "session-1",
  state: {
    players: { onAdd: vi.fn(), onRemove: vi.fn() },
    entities: { onAdd: vi.fn(), onRemove: vi.fn() },
    tiles: { onAdd: vi.fn() },
  },
  onMessage: vi.fn((type: string, handler: MessageHandler) => {
    messageHandlers.set(type, handler);
  }),
  send: vi.fn(),
  leave: vi.fn(),
};

const messageHandlers = new Map<string, MessageHandler>();

vi.mock("colyseus.js", () => ({
  Client: class {
    joinOrCreate = vi.fn(async () => room);
  },
}));

describe("NetworkManager idle contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageHandlers.clear();
  });

  it("registers typed idle callbacks and sends idle_claim", async () => {
    const onSummary = vi.fn();
    const onClaimResult = vi.fn();
    const callbacks: NetworkCallbacks = { onIdleSummary: onSummary, onIdleClaimResult: onClaimResult };
    const network = new NetworkManager("ws://test", new GameState(42), callbacks);

    await network.connect();
    const summary = { hours: 2, resources: { Wood: 4 } };
    const result = { success: true, resources: { Wood: 4 } };
    messageHandlers.get("idle_summary")?.(summary);
    messageHandlers.get("idle_claim_result")?.(result);
    network.sendIdleClaim();

    expect(onSummary).toHaveBeenCalledWith(summary);
    expect(onClaimResult).toHaveBeenCalledWith(result);
    expect(room.send).toHaveBeenCalledWith("idle_claim", { type: "idle_claim" });
  });
});
