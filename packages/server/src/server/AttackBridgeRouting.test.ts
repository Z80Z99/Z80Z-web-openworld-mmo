import { describe, it, expect, beforeEach } from "vitest";
import type { WorldHealthWriter, CombatStatsProvider, BattleParticipant } from "@mmo/shared";
import { CombatManager } from "./CombatManager";
import { BattleManager } from "./BattleManager";
import { BattleCombatBridge } from "./BattleCombatBridge";

/* ── Helpers ── */

function makePlayerParticipant(id: string, combatPower = 10): BattleParticipant {
  return {
    id,
    position: { x: 0, y: 0 },
    combatPower,
    personality: "aggressive",
    state: "ACTIVE",
  };
}

function makeEnemyParticipant(id: string, combatPower = 8): BattleParticipant {
  return {
    id,
    position: { x: 1, y: 0 },
    combatPower,
    personality: "cautious",
    state: "ACTIVE",
  };
}

function makeStatsProvider(stats: Record<string, { attack: number; defense: number; level: number }>): CombatStatsProvider {
  return {
    getStats: (id) => stats[id],
  };
}

/** In-memory WorldHealthWriter for tests. */
function makeWorldHp(initial: Record<string, { currentHp: number; maxHp: number }>): WorldHealthWriter {
  const hp = new Map(Object.entries(initial));
  return {
    getHp: (id) => hp.get(id),
    setHp: (id, value) => {
      const entry = hp.get(id);
      if (entry) entry.currentHp = Math.max(0, Math.min(value, entry.maxHp));
    },
    isAlive: (id) => {
      const entry = hp.get(id);
      return entry !== undefined && entry.currentHp > 0;
    },
  };
}

/* ── Tests ── */

describe("Phase 3E-3: Attack Bridge Routing", () => {
  let combatManager: CombatManager;
  let battleManager: BattleManager;
  let worldHp: WorldHealthWriter;
  let bridge: BattleCombatBridge;

  beforeEach(() => {
    combatManager = new CombatManager();
    battleManager = new BattleManager();
    worldHp = makeWorldHp({
      "player-1": { currentHp: 100, maxHp: 100 },
      "mob-1": { currentHp: 80, maxHp: 80 },
      "player-2": { currentHp: 100, maxHp: 100 },
      "mob-2": { currentHp: 80, maxHp: 80 },
      "player-3": { currentHp: 100, maxHp: 100 },
      "mob-3": { currentHp: 80, maxHp: 80 },
      "player-4": { currentHp: 100, maxHp: 100 },
      "mob-4": { currentHp: 80, maxHp: 80 },
      "player-5": { currentHp: 100, maxHp: 100 },
      "mob-5": { currentHp: 80, maxHp: 80 },
    });
    bridge = new BattleCombatBridge(battleManager, combatManager, worldHp);
  });

  it("E3E-013: applyCombatAction fails gracefully when no battle exists", () => {
    const result = bridge.applyCombatAction(
      "nonexistent-battle",
      "player-1",
      "mob-1",
      makeStatsProvider({
        "player-1": { attack: 10, defense: 5, level: 1 },
      }),
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("BATTLE_NOT_FOUND");
    }
  });

  it("E3E-014: applyCombatAction succeeds when battle + combat session exist", () => {
    // Create battle via bridge.beginEncounter to establish mapping
    battleManager.createBattle("battle-1", makePlayerParticipant("player-1"), makeEnemyParticipant("mob-1"));

    const beginResult = bridge.beginEncounter("battle-1", {
      getHp: (id) => worldHp.getHp(id),
    });
    expect("session" in beginResult).toBe(true);

    const stats = makeStatsProvider({
      "player-1": { attack: 10, defense: 5, level: 1 },
      "mob-1": { attack: 8, defense: 3, level: 1 },
    });

    const result = bridge.applyCombatAction("battle-1", "player-1", "mob-1", stats);
    expect("damage" in result).toBe(true);
    if ("damage" in result) {
      expect(result.damage.attackerId).toBe("player-1");
      expect(result.damage.targetId).toBe("mob-1");
      expect(result.damage.damage).toBeGreaterThan(0);
      expect(result.damage.remainingHp).toBeLessThan(80);
    }
  });

  it("E3E-015: applyCombatAction fails when no combat session for battle", () => {
    // Create battle but NO combat session
    battleManager.createBattle("battle-2", makePlayerParticipant("player-2"), makeEnemyParticipant("mob-2"));

    const result = bridge.applyCombatAction(
      "battle-2",
      "player-2",
      "mob-2",
      makeStatsProvider({
        "player-2": { attack: 10, defense: 5, level: 1 },
      }),
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBe("BATTLE_NOT_FOUND");
    }
  });

  it("E3E-016: hasActiveCombat returns false when no combat session", () => {
    battleManager.createBattle("battle-3", makePlayerParticipant("player-3"), makeEnemyParticipant("mob-3"));
    expect(bridge.hasActiveCombat("battle-3")).toBe(false);
  });

  it("E3E-017: hasActiveCombat returns true when combat session exists", () => {
    battleManager.createBattle("battle-4", makePlayerParticipant("player-4"), makeEnemyParticipant("mob-4"));

    const beginResult = bridge.beginEncounter("battle-4", {
      getHp: (id) => worldHp.getHp(id),
    });
    expect("session" in beginResult).toBe(true);

    expect(bridge.hasActiveCombat("battle-4")).toBe(true);
  });

  it("E3E-018: No double damage — single applyCombatAction call applies damage once", () => {
    battleManager.createBattle("battle-5", makePlayerParticipant("player-5"), makeEnemyParticipant("mob-5"));

    const beginResult = bridge.beginEncounter("battle-5", {
      getHp: (id) => worldHp.getHp(id),
    });
    expect("session" in beginResult).toBe(true);

    const stats = makeStatsProvider({
      "player-5": { attack: 10, defense: 5, level: 1 },
      "mob-5": { attack: 8, defense: 3, level: 1 },
    });

    // First attack
    const result1 = bridge.applyCombatAction("battle-5", "player-5", "mob-5", stats);
    expect("damage" in result1).toBe(true);
    let mobHp = 80;
    if ("damage" in result1) {
      mobHp = result1.damage.remainingHp;
    }

    // The mob's HP in worldHp should now reflect the first hit
    const mobHpAfterFirst = worldHp.getHp("mob-5");
    expect(mobHpAfterFirst?.currentHp).toBe(mobHp);

    // Advance turn back to player-5 for second attack
    const combatId5 = bridge.getCombatId("battle-5")!;
    combatManager.advanceTurn(combatId5);

    // Second attack — HP should decrease further
    const result2 = bridge.applyCombatAction("battle-5", "player-5", "mob-5", stats);
    expect("damage" in result2).toBe(true);
    if ("damage" in result2) {
      expect(result2.damage.remainingHp).toBeLessThan(mobHp);
    }
  });
});
