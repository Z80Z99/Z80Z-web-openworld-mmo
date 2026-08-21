import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GameDatabase } from "../db/index.js";
import { QuestSystem } from "./QuestSystem.js";
import { TUTORIAL_QUESTS, getQuestDefinition, getStarterQuest } from "./QuestData.js";

describe("QuestData", () => {
  it("has 5 tutorial quests", () => {
    expect(TUTORIAL_QUESTS).toHaveLength(5);
  });

  it("first quest is the starter", () => {
    const starter = getStarterQuest();
    expect(starter.id).toBe("tutorial_welcome");
    expect(starter.isStarter).toBe(true);
  });

  it("each quest chains to the next", () => {
    for (let i = 0; i < TUTORIAL_QUESTS.length - 1; i++) {
      const quest = TUTORIAL_QUESTS[i];
      expect(quest.nextQuestId).toBe(TUTORIAL_QUESTS[i + 1].id);
    }
    // Last quest has no next
    expect(TUTORIAL_QUESTS[TUTORIAL_QUESTS.length - 1].nextQuestId).toBeUndefined();
  });

  it("getQuestDefinition returns correct quest", () => {
    const quest = getQuestDefinition("tutorial_gathering");
    expect(quest).toBeDefined();
    expect(quest!.name).toBe("Gathering");
    expect(quest!.steps[0].type).toBe("collect");
  });

  it("getQuestDefinition returns undefined for unknown ID", () => {
    expect(getQuestDefinition("nonexistent")).toBeUndefined();
  });

  it("each quest has XP reward", () => {
    for (const quest of TUTORIAL_QUESTS) {
      expect(quest.xpReward).toBeGreaterThan(0);
    }
  });
});

describe("QuestSystem", () => {
  let db: GameDatabase;
  let questSystem: QuestSystem;
  const playerId = "test-player-1";

  beforeEach(() => {
    db = new GameDatabase({ path: ":memory:" });
    db.init();

    // Insert a test player
    db.getDb()
      .prepare(
        `INSERT INTO players (id, account_id, x, y, chunk_x, chunk_y, inventory, level_xp, mount_id, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(playerId, "acc-1", 0, 0, 0, 0, "{}", 0, null, Date.now());

    questSystem = new QuestSystem(db.getDb());
  });

  afterEach(() => {
    db.close();
  });

  describe("initPlayerQuests", () => {
    it("starts the first quest for a new player", () => {
      const update = questSystem.initPlayerQuests(playerId);
      expect(update).not.toBeNull();
      expect(update!.questId).toBe("tutorial_welcome");
      expect(update!.status).toBe("active");
      expect(update!.questName).toBe("Welcome");
    });

    it("does nothing for a player who already has quests", () => {
      questSystem.initPlayerQuests(playerId);
      const update2 = questSystem.initPlayerQuests(playerId);
      expect(update2).toBeNull();
    });
  });

  describe("quest progression", () => {
    it("start → report event → progress updates", () => {
      questSystem.initPlayerQuests(playerId);

      // Report moving to the village
      const update = questSystem.reportEvent(playerId, "move_to", undefined, 1);
      expect(update).not.toBeNull();
      expect(update!.questId).toBe("tutorial_welcome");
      expect(update!.stepProgress.move_to_village).toBe(1);
      expect(update!.completed).toBe(true);
    });

    it("progress is persisted in DB", () => {
      questSystem.initPlayerQuests(playerId);

      // Start and partially progress
      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      // Reload from DB
      const freshSystem = new QuestSystem(db.getDb());
      const active = freshSystem.getActiveQuest(playerId);
      expect(active).toBeDefined();
      expect(active!.questId).toBe("tutorial_first_steps"); // Moved to next quest
    });
  });

  describe("quest chain", () => {
    it("completing quest 1 unlocks quest 2", () => {
      questSystem.initPlayerQuests(playerId);

      // Complete Welcome quest (move_to)
      const update = questSystem.reportEvent(playerId, "move_to", undefined, 1);
      expect(update!.completed).toBe(true);
      expect(update!.nextQuestId).toBe("tutorial_first_steps");

      // Should now be on quest 2
      const active = questSystem.getActiveQuest(playerId);
      expect(active).toBeDefined();
      expect(active!.questId).toBe("tutorial_first_steps");
    });

    it("can progress through entire chain", () => {
      questSystem.initPlayerQuests(playerId);

      // Quest 1: Welcome - move_to
      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      // Quest 2: First Steps - kill Slime
      questSystem.reportEvent(playerId, "kill", "Slime", 1);

      // Quest 3: Gathering - collect 3 Wood
      questSystem.reportEvent(playerId, "collect", "Wood", 1);
      questSystem.reportEvent(playerId, "collect", "Wood", 1);
      questSystem.reportEvent(playerId, "collect", "Wood", 1);

      // Quest 4: Crafting - craft Wooden Sword
      questSystem.reportEvent(playerId, "craft", "Wooden Sword", 1);

      // Quest 5: Adventure - kill Wolf
      questSystem.reportEvent(playerId, "kill", "Wolf", 1);

      // All quests should be completed
      expect(questSystem.isQuestCompleted(playerId, "tutorial_welcome")).toBe(true);
      expect(questSystem.isQuestCompleted(playerId, "tutorial_first_steps")).toBe(true);
      expect(questSystem.isQuestCompleted(playerId, "tutorial_gathering")).toBe(true);
      expect(questSystem.isQuestCompleted(playerId, "tutorial_crafting")).toBe(true);
      expect(questSystem.isQuestCompleted(playerId, "tutorial_adventure")).toBe(true);

      // No active quest remaining
      expect(questSystem.getActiveQuest(playerId)).toBeUndefined();
    });
  });

  describe("auto-completion", () => {
    it("multi-count step completes when count reached", () => {
      questSystem.initPlayerQuests(playerId);

      // Complete quest 1
      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      // Now on quest 2: kill 1 Slime
      const killUpdate = questSystem.reportEvent(playerId, "kill", "Slime", 1);
      expect(killUpdate!.completed).toBe(true);

      // Now on quest 3: collect 3 Wood
      questSystem.reportEvent(playerId, "collect", "Wood", 1);
      const mid = questSystem.reportEvent(playerId, "collect", "Wood", 1);
      expect(mid!.completed).toBeUndefined();
      expect(mid!.stepProgress.collect_wood).toBe(2);

      const final = questSystem.reportEvent(playerId, "collect", "Wood", 1);
      expect(final!.completed).toBe(true);
      expect(final!.stepProgress.collect_wood).toBe(3);
    });

    it("over-counting does not exceed target", () => {
      questSystem.initPlayerQuests(playerId);

      // Complete quest 1
      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      // Now on quest 3 (after completing quest 2)
      questSystem.reportEvent(playerId, "kill", "Slime", 1);

      // Collect Wood - sending exactly 3 triggers auto-complete
      questSystem.reportEvent(playerId, "collect", "Wood", 3);

      // Verify completed quest has capped progress
      const completedIds = questSystem.getCompletedQuestIds(playerId);
      expect(completedIds).toContain("tutorial_gathering");
    });
  });

  describe("event filtering", () => {
    it("ignores events that don't match current step", () => {
      questSystem.initPlayerQuests(playerId);

      // Current quest is move_to, killing a mob should not progress
      const update = questSystem.reportEvent(playerId, "kill", "Slime", 1);
      expect(update).toBeNull();
    });

    it("ignores events with wrong target", () => {
      questSystem.initPlayerQuests(playerId);

      // Complete quest 1
      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      // Quest 2 wants Slime, not Wolf
      const update = questSystem.reportEvent(playerId, "kill", "Wolf", 1);
      expect(update).toBeNull();
    });
  });

  describe("XP rewards", () => {
    it("awards XP on quest completion", () => {
      questSystem.initPlayerQuests(playerId);

      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      const row = db.getDb()
        .prepare("SELECT level_xp FROM players WHERE id = ?")
        .get(playerId) as { level_xp: number };
      expect(row.level_xp).toBe(10); // tutorial_welcome XP reward
    });

    it("accumulates XP across quests", () => {
      questSystem.initPlayerQuests(playerId);

      questSystem.reportEvent(playerId, "move_to", undefined, 1);
      questSystem.reportEvent(playerId, "kill", "Slime", 1);

      const row = db.getDb()
        .prepare("SELECT level_xp FROM players WHERE id = ?")
        .get(playerId) as { level_xp: number };
      expect(row.level_xp).toBe(30); // 10 + 20
    });
  });

  describe("getCompletedQuestIds", () => {
    it("returns completed quest IDs", () => {
      questSystem.initPlayerQuests(playerId);
      questSystem.reportEvent(playerId, "move_to", undefined, 1);

      const completed = questSystem.getCompletedQuestIds(playerId);
      expect(completed).toContain("tutorial_welcome");
      expect(completed).toHaveLength(1);
    });
  });

  describe("getQuestDisplayInfo", () => {
    it("returns quest definition and progress", () => {
      questSystem.initPlayerQuests(playerId);
      const info = questSystem.getQuestDisplayInfo(playerId);
      expect(info).toBeDefined();
      expect(info!.quest.id).toBe("tutorial_welcome");
      expect(info!.progress.status).toBe("active");
    });

    it("returns undefined when no active quest", () => {
      expect(questSystem.getQuestDisplayInfo("nonexistent")).toBeUndefined();
    });
  });
});
