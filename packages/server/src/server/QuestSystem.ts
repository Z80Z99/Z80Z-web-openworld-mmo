import type Database from "better-sqlite3";
import {
  getQuestDefinition,
  getStarterQuest,
  type QuestDefinition,
  type QuestStep,
} from "./QuestData.js";

/**
 * Possible states for a quest.
 */
export type QuestStatus = "not_started" | "active" | "completed";

/**
 * Runtime state of a single quest for a player.
 */
export interface QuestProgress {
  questId: string;
  status: QuestStatus;
  /** Per-step progress: stepId → current count. */
  stepProgress: Record<string, number>;
}

/**
 * Notification sent to the client when quest state changes.
 */
export interface QuestUpdate {
  questId: string;
  status: QuestStatus;
  stepProgress: Record<string, number>;
  completed?: boolean;
  nextQuestId?: string;
  xpReward?: number;
  questName?: string;
  questDescription?: string;
  currentStepDescription?: string;
}

/**
 * Server-side quest state manager.
 *
 * Tracks per-player quest progress, evaluates step completion,
 * auto-completes quests when all steps are done, and chains quests.
 */
export class QuestSystem {
  private readonly db: Database.Database;

  /** In-memory cache: playerId → questId → QuestProgress. */
  private playerQuests: Map<string, Map<string, QuestProgress>> = new Map();

  constructor(db: Database.Database) {
    this.db = db;
    this.loadAllQuests();
  }

  /**
   * Load all quest progress from DB into memory.
   */
  private loadAllQuests(): void {
    const rows = this.db
      .prepare("SELECT player_id, quest_id, status, progress FROM quests")
      .all() as { player_id: string; quest_id: string; status: string; progress: string }[];

    for (const row of rows) {
      if (!this.playerQuests.has(row.player_id)) {
        this.playerQuests.set(row.player_id, new Map());
      }
      this.playerQuests.get(row.player_id)!.set(row.quest_id, {
        questId: row.quest_id,
        status: row.status as QuestStatus,
        stepProgress: JSON.parse(row.progress),
      });
    }
  }

  /**
   * Initialize quest state for a new player (start the first quest).
   */
  initPlayerQuests(playerId: string): QuestUpdate | null {
    const existing = this.playerQuests.get(playerId);
    if (existing && existing.size > 0) return null; // Already has quests

    const starter = getStarterQuest();
    return this.startQuest(playerId, starter.id);
  }

  /**
   * Start a quest for a player.
   */
  startQuest(playerId: string, questId: string): QuestUpdate {
    const def = getQuestDefinition(questId);
    if (!def) {
      throw new Error(`Unknown quest: ${questId}`);
    }

    // Initialize step progress
    const stepProgress: Record<string, number> = {};
    for (const step of def.steps) {
      stepProgress[step.id] = 0;
    }

    const progress: QuestProgress = {
      questId,
      status: "active",
      stepProgress,
    };

    // Store in memory
    if (!this.playerQuests.has(playerId)) {
      this.playerQuests.set(playerId, new Map());
    }
    this.playerQuests.get(playerId)!.set(questId, progress);

    // Persist to DB
    this.db
      .prepare(
        "INSERT INTO quests (player_id, quest_id, status, progress) VALUES (?, ?, ?, ?)",
      )
      .run(playerId, questId, "active", JSON.stringify(stepProgress));

    const firstStep = def.steps[0];
    return {
      questId,
      status: "active",
      stepProgress,
      questName: def.name,
      questDescription: def.description,
      currentStepDescription: firstStep?.description,
    };
  }

  /**
   * Get the active quest for a player (the one currently in progress).
   */
  getActiveQuest(playerId: string): QuestProgress | undefined {
    const quests = this.playerQuests.get(playerId);
    if (!quests) return undefined;
    for (const q of quests.values()) {
      if (q.status === "active") return q;
    }
    return undefined;
  }

  /**
   * Get quest definition + progress for display.
   */
  getQuestDisplayInfo(
    playerId: string,
  ): { quest: QuestDefinition; progress: QuestProgress } | undefined {
    const active = this.getActiveQuest(playerId);
    if (!active) return undefined;
    const def = getQuestDefinition(active.questId);
    if (!def) return undefined;
    return { quest: def, progress: active };
  }

  /**
   * Report an event (kill, collect, craft, move) for a player.
   * Returns a QuestUpdate if the quest state changed, null otherwise.
   */
  reportEvent(
    playerId: string,
    eventType: string,
    target: string | undefined,
    amount: number = 1,
  ): QuestUpdate | null {
    const active = this.getActiveQuest(playerId);
    if (!active) return null;

    const def = getQuestDefinition(active.questId);
    if (!def) return null;

    let changed = false;

    // Find matching steps
    for (const step of def.steps) {
      if (this.stepMatchesEvent(step, eventType, target)) {
        const current = active.stepProgress[step.id] ?? 0;
        if (current < step.count) {
          active.stepProgress[step.id] = Math.min(current + amount, step.count);
          changed = true;
        }
      }
    }

    if (!changed) return null;

    // Update DB
    this.db
      .prepare("UPDATE quests SET progress = ? WHERE player_id = ? AND quest_id = ?")
      .run(JSON.stringify(active.stepProgress), playerId, active.questId);

    // Check if all steps complete → auto-complete quest
    const allComplete = def.steps.every(
      (step) => (active.stepProgress[step.id] ?? 0) >= step.count,
    );

    if (allComplete) {
      return this.completeQuest(playerId, active, def);
    }

    // Return progress update
    const currentStep = this.getCurrentStep(def, active);
    return {
      questId: active.questId,
      status: "active",
      stepProgress: { ...active.stepProgress },
      currentStepDescription: currentStep?.description,
    };
  }

  /**
   * Check if a quest step matches an incoming event.
   */
  private stepMatchesEvent(step: QuestStep, eventType: string, target: string | undefined): boolean {
    if (step.type !== eventType) return false;
    if (step.target && step.target !== target) return false;
    return true;
  }

  /**
   * Get the current (first incomplete) step of a quest.
   */
  private getCurrentStep(
    def: QuestDefinition,
    progress: QuestProgress,
  ): QuestStep | undefined {
    for (const step of def.steps) {
      if ((progress.stepProgress[step.id] ?? 0) < step.count) {
        return step;
      }
    }
    return undefined;
  }

  /**
   * Complete a quest: mark as done, award XP, unlock next quest.
   */
  private completeQuest(
    playerId: string,
    progress: QuestProgress,
    def: QuestDefinition,
  ): QuestUpdate {
    progress.status = "completed";

    // Update DB
    this.db
      .prepare("UPDATE quests SET status = ? WHERE player_id = ? AND quest_id = ?")
      .run("completed", playerId, def.id);

    // Award XP to player
    this.db
      .prepare("UPDATE players SET level_xp = level_xp + ? WHERE id = ?")
      .run(def.xpReward, playerId);

    // Start next quest if exists
    let nextQuestId: string | undefined;
    if (def.nextQuestId) {
      const nextUpdate = this.startQuest(playerId, def.nextQuestId);
      nextQuestId = nextUpdate.questId;
    }

    return {
      questId: def.id,
      status: "completed",
      stepProgress: { ...progress.stepProgress },
      completed: true,
      xpReward: def.xpReward,
      nextQuestId,
    };
  }

  /**
   * Get all quest IDs that a player has completed.
   */
  getCompletedQuestIds(playerId: string): string[] {
    const quests = this.playerQuests.get(playerId);
    if (!quests) return [];
    return Array.from(quests.values())
      .filter((q) => q.status === "completed")
      .map((q) => q.questId);
  }

  /**
   * Check if a specific quest has been completed.
   */
  isQuestCompleted(playerId: string, questId: string): boolean {
    const quests = this.playerQuests.get(playerId);
    if (!quests) return false;
    const q = quests.get(questId);
    return q?.status === "completed";
  }
}
