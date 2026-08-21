/**
 * Quest step types that define what the player must do.
 */
export type QuestStepType = "move_to" | "kill" | "collect" | "craft" | "talk_to";

/**
 * A single step within a quest.
 */
export interface QuestStep {
  /** Unique step identifier (e.g., "move_to_village"). */
  id: string;
  /** Type of action required. */
  type: QuestStepType;
  /** Target entity or item for kill/collect/craft steps. */
  target?: string;
  /** Number of times this step must be completed (default: 1). */
  count: number;
  /** Human-readable description shown to the player. */
  description: string;
  /** Coordinates for move_to steps. */
  targetX?: number;
  targetY?: number;
}

/**
 * Complete quest definition.
 */
export interface QuestDefinition {
  /** Unique quest identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Flavor text / quest description. */
  description: string;
  /** Ordered list of steps to complete. */
  steps: QuestStep[];
  /** XP reward on completion. */
  xpReward: number;
  /** ID of the quest that unlocks after this one (chain). */
  nextQuestId?: string;
  /** Whether this is the first quest in the chain. */
  isStarter: boolean;
}

/**
 * Tutorial quest chain — 5 sequential quests guiding new players.
 */
export const TUTORIAL_QUESTS: readonly QuestDefinition[] = [
  {
    id: "tutorial_welcome",
    name: "Welcome",
    description:
      "Welcome to the world! Move to the marked location to get started.",
    steps: [
      {
        id: "move_to_village",
        type: "move_to",
        count: 1,
        description: "Move to the village (5 tiles away)",
        targetX: 5,
        targetY: 0,
      },
    ],
    xpReward: 10,
    nextQuestId: "tutorial_first_steps",
    isStarter: true,
  },
  {
    id: "tutorial_first_steps",
    name: "First Steps",
    description: "Prove your bravery by attacking a Slime.",
    steps: [
      {
        id: "kill_slime",
        type: "kill",
        target: "Slime",
        count: 1,
        description: "Attack a Slime",
      },
    ],
    xpReward: 20,
    nextQuestId: "tutorial_gathering",
    isStarter: false,
  },
  {
    id: "tutorial_gathering",
    name: "Gathering",
    description: "Collect Wood from forest tiles to prepare for crafting.",
    steps: [
      {
        id: "collect_wood",
        type: "collect",
        target: "Wood",
        count: 3,
        description: "Collect 3 Wood",
      },
    ],
    xpReward: 30,
    nextQuestId: "tutorial_crafting",
    isStarter: false,
  },
  {
    id: "tutorial_crafting",
    name: "Crafting",
    description: "Use your gathered materials to craft a Wooden Sword.",
    steps: [
      {
        id: "craft_wooden_sword",
        type: "craft",
        target: "Wooden Sword",
        count: 1,
        description: "Craft a Wooden Sword",
      },
    ],
    xpReward: 40,
    nextQuestId: "tutorial_adventure",
    isStarter: false,
  },
  {
    id: "tutorial_adventure",
    name: "Adventure",
    description: "You're ready for a real challenge! Defeat a Wolf.",
    steps: [
      {
        id: "kill_wolf",
        type: "kill",
        target: "Wolf",
        count: 1,
        description: "Defeat a Wolf",
      },
    ],
    xpReward: 50,
    isStarter: false,
  },
] as const;

/** Map for O(1) lookup by quest ID. */
const QUEST_MAP = new Map<string, QuestDefinition>(
  TUTORIAL_QUESTS.map((q) => [q.id, q]),
);

/**
 * Get a quest definition by ID.
 */
export function getQuestDefinition(questId: string): QuestDefinition | undefined {
  return QUEST_MAP.get(questId);
}

/**
 * Get the first quest in the tutorial chain.
 */
export function getStarterQuest(): QuestDefinition {
  const starter = TUTORIAL_QUESTS.find((q) => q.isStarter);
  if (!starter) throw new Error("No starter quest defined");
  return starter;
}
