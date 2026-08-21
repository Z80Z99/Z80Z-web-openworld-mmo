import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GameDatabase } from "../db/index.js";
import { TitleSystem } from "./TitleSystem.js";
import {
  TITLE_PROGRESSION,
  getTitleForLevel,
  getNewTitleOnLevelUp,
} from "./TitleData.js";
import { PlayerState } from "@mmo/shared";

describe("TitleData", () => {
  it("has 6 title tiers", () => {
    expect(TITLE_PROGRESSION).toHaveLength(6);
  });

  it("titles are in ascending level order", () => {
    for (let i = 1; i < TITLE_PROGRESSION.length; i++) {
      expect(TITLE_PROGRESSION[i].minLevel).toBeGreaterThan(
        TITLE_PROGRESSION[i - 1].minLevel,
      );
    }
  });

  describe("getTitleForLevel", () => {
    it("returns Newcomer for level 1", () => {
      expect(getTitleForLevel(1)).toBe("Newcomer");
    });

    it("returns Newcomer for level 4", () => {
      expect(getTitleForLevel(4)).toBe("Newcomer");
    });

    it("returns Adventurer for level 5", () => {
      expect(getTitleForLevel(5)).toBe("Adventurer");
    });

    it("returns Explorer for level 10", () => {
      expect(getTitleForLevel(10)).toBe("Explorer");
    });

    it("returns Veteran for level 20", () => {
      expect(getTitleForLevel(20)).toBe("Veteran");
    });

    it("returns Hero for level 30", () => {
      expect(getTitleForLevel(30)).toBe("Hero");
    });

    it("returns Legend for level 50", () => {
      expect(getTitleForLevel(50)).toBe("Legend");
    });

    it("returns Legend for level 100", () => {
      expect(getTitleForLevel(100)).toBe("Legend");
    });

    it("returns empty string for level 0", () => {
      expect(getTitleForLevel(0)).toBe("");
    });
  });

  describe("getNewTitleOnLevelUp", () => {
    it("detects title change at threshold", () => {
      const result = getNewTitleOnLevelUp(4, 5);
      expect(result).toBe("Adventurer");
    });

    it("returns null when no title change", () => {
      const result = getNewTitleOnLevelUp(5, 6);
      expect(result).toBeNull();
    });

    it("detects title change from level 1 to 10", () => {
      // Level 10 unlocks Explorer
      const result = getNewTitleOnLevelUp(1, 10);
      expect(result).toBe("Explorer");
    });

    it("returns null for same level", () => {
      const result = getNewTitleOnLevelUp(5, 5);
      expect(result).toBeNull();
    });

    it("handles multiple threshold crossing (1→20)", () => {
      // Crosses Adventurer (5), Explorer (10), and Veteran (20)
      const result = getNewTitleOnLevelUp(1, 20);
      expect(result).toBe("Veteran");
    });
  });
});

describe("TitleSystem", () => {
  let db: GameDatabase;
  let titleSystem: TitleSystem;

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();
    titleSystem = new TitleSystem();
  });

  afterEach(() => {
    db.close();
  });

  function createPlayer(level: number, title = ""): PlayerState {
    const player = new PlayerState();
    player.level = level;
    player.title = title;
    return player;
  }

  describe("checkLevelUp", () => {
    it("updates title when level crosses threshold", () => {
      const player = createPlayer(5, "Newcomer");
      const result = titleSystem.checkLevelUp(player, 4, 5);

      expect(result).not.toBeNull();
      expect(result!.oldTitle).toBe("Newcomer");
      expect(result!.newTitle).toBe("Adventurer");
      expect(player.title).toBe("Adventurer");
    });

    it("returns null when no title change", () => {
      const player = createPlayer(7, "Adventurer");
      const result = titleSystem.checkLevelUp(player, 5, 6);

      expect(result).toBeNull();
      expect(player.title).toBe("Adventurer");
    });

    it("handles level 1→5 transition", () => {
      const player = createPlayer(5, "Newcomer");
      const result = titleSystem.checkLevelUp(player, 1, 5);

      expect(result!.newTitle).toBe("Adventurer");
    });

    it("handles level 29→30 transition", () => {
      const player = createPlayer(30, "Veteran");
      const result = titleSystem.checkLevelUp(player, 29, 30);

      expect(result!.newTitle).toBe("Hero");
    });
  });

  describe("syncTitle", () => {
    it("sets title based on current level", () => {
      const player = createPlayer(10);
      titleSystem.syncTitle(player);
      expect(player.title).toBe("Explorer");
    });

    it("sets empty title for level 0", () => {
      const player = createPlayer(0);
      titleSystem.syncTitle(player);
      expect(player.title).toBe("");
    });

    it("sets Legend for high level", () => {
      const player = createPlayer(50);
      titleSystem.syncTitle(player);
      expect(player.title).toBe("Legend");
    });
  });
});
