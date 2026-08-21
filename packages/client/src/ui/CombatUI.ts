/**
 * CombatUI — DOM overlay for combat information.
 *
 * Renders:
 *  - Player health bar (top-left, extends existing HUD)
 *  - Damage numbers floating up from hit positions
 *  - Mob health bar when a mob is targeted
 *  - XP bar at bottom of screen
 */

/* ── Types ── */

export interface DamageNumber {
  id: string;
  text: string;
  x: number;
  y: number;
  isHeal: boolean;
  createdAt: number;
}

export interface MobHealthBar {
  mobId: string;
  name: string;
  currentHp: number;
  maxHp: number;
  x: number;
  y: number;
}

/* ── Constants ── */

const DAMAGE_NUMBER_LIFETIME_MS = 1500;
const DAMAGE_NUMBER_FLOAT_SPEED = 50; // pixels per second
const XP_BAR_HEIGHT = 6;
const MOB_HP_BAR_WIDTH = 60;
const MOB_HP_BAR_HEIGHT = 6;

/* ── CombatUI Class ── */

export class CombatUI {
  private readonly container: HTMLElement;

  /** Active damage numbers. */
  private readonly damageNumbers: DamageNumber[] = [];
  private readonly damageElements = new Map<string, HTMLElement>();

  /** Currently displayed mob health bar. */
  private mobHealthBar: HTMLElement | null = null;
  private mobHealthFill: HTMLElement | null = null;
  private mobNameLabel: HTMLElement | null = null;

  /** XP bar elements. */
  private xpBar: HTMLElement | null = null;
  private xpFill: HTMLElement | null = null;
  private xpLabel: HTMLElement | null = null;

  /** Current XP state. */
  private currentXp = 0;
  private xpToNextLevel = 100;
  private playerLevel = 1;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; inset: 0; pointer-events: none; z-index: 15;
      font-family: monospace; color: #fff;
    `;
    parent.appendChild(this.container);

    this.buildXpBar();
    this.buildMobHealthBar();
  }

  /* ── Construction ── */

  private buildXpBar(): void {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
      width: 300px; text-align: center;
    `;

    // XP bar background
    this.xpBar = document.createElement("div");
    this.xpBar.style.cssText = `
      width: 100%; height: ${XP_BAR_HEIGHT}px; background: #333;
      border: 1px solid #555; border-radius: 2px; overflow: hidden;
    `;

    this.xpFill = document.createElement("div");
    this.xpFill.style.cssText = `
      width: 0%; height: 100%; background: #9b59b6; transition: width 0.3s;
    `;
    this.xpBar.appendChild(this.xpFill);
    wrapper.appendChild(this.xpBar);

    // XP label
    this.xpLabel = document.createElement("div");
    this.xpLabel.style.cssText = `
      font-size: 10px; color: #bbb; margin-top: 2px;
      text-shadow: 1px 1px 2px #000;
    `;
    this.xpLabel.textContent = "XP: 0 / 100";
    wrapper.appendChild(this.xpLabel);

    this.container.appendChild(wrapper);
  }

  private buildMobHealthBar(): void {
    // Mob health bar — positioned above the mob via updateMobHealthBar()
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      position: absolute; display: none; text-align: center;
    `;

    this.mobNameLabel = document.createElement("div");
    this.mobNameLabel.style.cssText = `
      font-size: 10px; color: #e74c3c; margin-bottom: 2px;
      text-shadow: 1px 1px 2px #000; white-space: nowrap;
    `;
    wrapper.appendChild(this.mobNameLabel);

    this.mobHealthBar = document.createElement("div");
    this.mobHealthBar.style.cssText = `
      width: ${MOB_HP_BAR_WIDTH}px; height: ${MOB_HP_BAR_HEIGHT}px;
      background: #333; border: 1px solid #555; border-radius: 2px; overflow: hidden;
      margin: 0 auto;
    `;

    this.mobHealthFill = document.createElement("div");
    this.mobHealthFill.style.cssText = `
      width: 100%; height: 100%; background: #e74c3c; transition: width 0.2s;
    `;
    this.mobHealthBar.appendChild(this.mobHealthFill);
    wrapper.appendChild(this.mobHealthBar);

    this.container.appendChild(wrapper);
  }

  /* ── Public API ── */

  /**
   * Spawn a floating damage number at the given screen position.
   */
  addDamageNumber(
    id: string,
    text: string,
    screenX: number,
    screenY: number,
    isHeal = false,
  ): void {
    const number: DamageNumber = {
      id,
      text,
      x: screenX,
      y: screenY,
      isHeal,
      createdAt: Date.now(),
    };
    this.damageNumbers.push(number);

    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `
      position: absolute; font-size: 14px; font-weight: bold;
      color: ${isHeal ? "#2ecc71" : "#e74c3c"};
      text-shadow: 1px 1px 2px #000, -1px -1px 2px #000;
      pointer-events: none; transition: opacity 0.3s;
      left: ${screenX}px; top: ${screenY}px;
      transform: translateX(-50%);
    `;
    this.container.appendChild(el);
    this.damageElements.set(id, el);
  }

  /**
   * Update the mob health bar display.
   * Pass null to hide it.
   */
  updateMobHealthBar(data: MobHealthBar | null): void {
    if (!this.mobHealthBar || !this.mobHealthFill || !this.mobNameLabel) return;

    if (!data) {
      this.mobHealthBar.parentElement!.style.display = "none";
      return;
    }

    this.mobHealthBar.parentElement!.style.display = "block";
    this.mobNameLabel.textContent = `${data.name} (Lv.${Math.ceil(data.maxHp / 20)})`;

    const pct = data.maxHp > 0 ? (data.currentHp / data.maxHp) * 100 : 0;
    this.mobHealthFill.style.width = `${pct}%`;

    // Position above the mob
    this.mobHealthBar.parentElement!.style.left = `${data.x - MOB_HP_BAR_WIDTH / 2}px`;
    this.mobHealthBar.parentElement!.style.top = `${data.y - 30}px`;
  }

  /**
   * Update XP display.
   */
  updateXp(xp: number, xpToNext: number, level: number): void {
    this.currentXp = xp;
    this.xpToNextLevel = xpToNext;
    this.playerLevel = level;

    if (this.xpFill) {
      const pct = xpToNext > 0 ? Math.min(100, (xp / xpToNext) * 100) : 0;
      this.xpFill.style.width = `${pct}%`;
    }
    if (this.xpLabel) {
      this.xpLabel.textContent = `Lv.${level} — XP: ${xp} / ${xpToNext}`;
    }
  }

  /**
   * Call once per frame to update damage number animations.
   * Returns IDs of expired numbers to remove.
   */
  update(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const num = this.damageNumbers[i];
      const elapsed = now - num.createdAt;

      if (elapsed >= DAMAGE_NUMBER_LIFETIME_MS) {
        // Remove expired
        const el = this.damageElements.get(num.id);
        if (el) {
          el.remove();
          this.damageElements.delete(num.id);
        }
        this.damageNumbers.splice(i, 1);
        expired.push(num.id);
        continue;
      }

      // Float upward
      const el = this.damageElements.get(num.id);
      if (el) {
        const progress = elapsed / DAMAGE_NUMBER_LIFETIME_MS;
        const yOffset = DAMAGE_NUMBER_FLOAT_SPEED * (elapsed / 1000);
        el.style.top = `${num.y - yOffset}px`;
        el.style.opacity = `${1 - progress}`;
      }
    }

    return expired;
  }

  /**
   * Clean up all DOM elements.
   */
  destroy(): void {
    for (const [, el] of this.damageElements) {
      el.remove();
    }
    this.damageElements.clear();
    this.damageNumbers.length = 0;
    this.container.remove();
  }
}
