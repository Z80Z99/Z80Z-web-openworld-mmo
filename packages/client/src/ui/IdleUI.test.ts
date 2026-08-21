// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdleUI } from "./IdleUI.js";

describe("IdleUI", () => {
  let parent: HTMLElement;
  let idleUI: IdleUI;

  beforeEach(() => {
    parent = document.createElement("div");
    idleUI = new IdleUI(parent);
  });

  it("shows the offline summary", () => {
    idleUI.show({ hours: 2.5, resources: { Wood: 5 } });

    expect(idleUI.isVisible()).toBe(true);
    expect(parent.textContent).toContain("You were offline for 2.5 hours");
    expect(parent.textContent).toContain("5 Wood");
  });

  it("manual claim fires once and hides the modal", () => {
    const claim = vi.fn();
    idleUI.onClaim(claim);
    idleUI.show({ hours: 1, resources: { Herb: 1 } });

    const button = parent.querySelector("button");
    expect(button).not.toBeNull();
    button?.click();
    button?.click();

    expect(claim).toHaveBeenCalledTimes(1);
    expect(idleUI.isVisible()).toBe(false);
  });

  it("auto-claims once after 30 seconds", () => {
    vi.useFakeTimers();
    const claim = vi.fn();
    idleUI.onClaim(claim);
    idleUI.show({ hours: 1, resources: { Sand: 1 } });

    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(idleUI.isVisible()).toBe(false);
    vi.useRealTimers();
  });

  it("hide settles the modal without a later automatic claim", () => {
    vi.useFakeTimers();
    const claim = vi.fn();
    idleUI.onClaim(claim);
    idleUI.show({ hours: 1, resources: { Wood: 2 } });

    idleUI.hide();
    vi.advanceTimersByTime(30_000);

    expect(idleUI.isVisible()).toBe(false);
    expect(claim).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("destroy cleans up the modal and pending auto-claim", () => {
    vi.useFakeTimers();
    const claim = vi.fn();
    idleUI.onClaim(claim);
    idleUI.show({ hours: 1, resources: { Stone: 1 } });
    idleUI.destroy();

    expect(parent.children).toHaveLength(0);
    vi.advanceTimersByTime(30_000);
    expect(claim).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
