/**
 * Client-side quest tracker UI.
 *
 * Displays the active quest in the top-right corner with:
 * - Quest name
 * - Current step description
 * - Progress bar (e.g., "2/3 Wood collected")
 * - Click to expand/collapse
 */
export interface QuestUIData {
  questId: string;
  questName: string;
  stepDescription: string;
  progressCurrent: number;
  progressTotal: number;
  completed?: boolean;
  xpReward?: number;
}

export class QuestUI {
  private readonly container: HTMLElement;
  private header!: HTMLElement;
  private body!: HTMLElement;
  private stepText!: HTMLElement;
  private progressBar!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressLabel!: HTMLElement;
  private collapsed = false;
  private completionTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.id = "quest-tracker";
    this.container.style.cssText = `
      position: absolute; top: 12px; right: 12px; z-index: 20;
      width: 240px; background: rgba(0,0,0,0.8); border: 1px solid #555;
      border-radius: 6px; font-family: monospace; color: #fff;
      pointer-events: auto; user-select: none;
    `;
    parent.appendChild(this.container);
    this.build();
  }

  private build(): void {
    // Header (clickable to collapse/expand)
    this.header = document.createElement("div");
    this.header.style.cssText = `
      padding: 8px 12px; cursor: pointer; display: flex;
      justify-content: space-between; align-items: center;
      border-bottom: 1px solid #444;
    `;
    this.header.addEventListener("click", () => this.toggle());
    this.container.appendChild(this.header);

    const headerLabel = document.createElement("span");
    headerLabel.textContent = "Quest";
    headerLabel.style.cssText = "font-weight: bold; font-size: 12px; color: #f1c40f;";
    this.header.appendChild(headerLabel);

    const collapseIcon = document.createElement("span");
    collapseIcon.textContent = "▼";
    collapseIcon.style.cssText = "font-size: 10px; transition: transform 0.2s;";
    collapseIcon.id = "quest-collapse-icon";
    this.header.appendChild(collapseIcon);

    // Body
    this.body = document.createElement("div");
    this.body.style.cssText = "padding: 8px 12px;";
    this.container.appendChild(this.body);

    // Quest name
    const nameEl = document.createElement("div");
    nameEl.id = "quest-name";
    nameEl.style.cssText = "font-size: 13px; font-weight: bold; margin-bottom: 4px;";
    nameEl.textContent = "No active quest";
    this.body.appendChild(nameEl);

    // Step description
    this.stepText = document.createElement("div");
    this.stepText.id = "quest-step";
    this.stepText.style.cssText = "font-size: 11px; color: #ccc; margin-bottom: 6px;";
    this.stepText.textContent = "";
    this.body.appendChild(this.stepText);

    // Progress bar container
    const progressOuter = document.createElement("div");
    progressOuter.style.cssText = `
      width: 100%; height: 8px; background: #333; border-radius: 4px;
      overflow: hidden; margin-bottom: 4px;
    `;
    this.progressBar = progressOuter;

    this.progressFill = document.createElement("div");
    this.progressFill.style.cssText = `
      width: 0%; height: 100%; background: #2ecc71; transition: width 0.3s;
    `;
    progressOuter.appendChild(this.progressFill);
    this.body.appendChild(progressOuter);

    // Progress label
    this.progressLabel = document.createElement("div");
    this.progressLabel.id = "quest-progress-label";
    this.progressLabel.style.cssText = "font-size: 10px; color: #999;";
    this.progressLabel.textContent = "";
    this.body.appendChild(this.progressLabel);
  }

  /**
   * Update the quest tracker with new data.
   */
  update(data: QuestUIData): void {
    const nameEl = this.body.querySelector("#quest-name") as HTMLElement;
    if (data.completed) {
      nameEl.textContent = `✓ ${data.questName}`;
      nameEl.style.color = "#2ecc71";
      this.stepText.textContent = `Completed! +${data.xpReward ?? 0} XP`;
      this.progressFill.style.width = "100%";
      this.progressFill.style.background = "#2ecc71";
      this.progressLabel.textContent = "Done";

      // Auto-hide after 5 seconds
      if (this.completionTimeout) clearTimeout(this.completionTimeout);
      this.completionTimeout = setTimeout(() => this.hide(), 5000);
      return;
    }

    nameEl.textContent = data.questName;
    nameEl.style.color = "#f1c40f";
    this.stepText.textContent = data.stepDescription;

    // Progress
    const pct =
      data.progressTotal > 0
        ? Math.min(100, (data.progressCurrent / data.progressTotal) * 100)
        : 0;
    this.progressFill.style.width = `${pct}%`;
    this.progressLabel.textContent = `${data.progressCurrent}/${data.progressTotal}`;

    this.show();
  }

  /** Toggle collapsed state. */
  toggle(): void {
    this.collapsed = !this.collapsed;
    this.body.style.display = this.collapsed ? "none" : "block";
    const icon = this.header.querySelector("#quest-collapse-icon") as HTMLElement;
    if (icon) {
      icon.textContent = this.collapsed ? "▶" : "▼";
    }
  }

  /** Show the quest tracker. */
  show(): void {
    this.container.style.display = "block";
  }

  /** Hide the quest tracker. */
  hide(): void {
    this.container.style.display = "none";
  }

  /** Clean up DOM elements. */
  destroy(): void {
    if (this.completionTimeout) clearTimeout(this.completionTimeout);
    this.container.remove();
  }
}
