import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGate } from "../src/apply/gate";

let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="list"><div>a</div><div>b</div></div>';
  container = document.getElementById("list")!;
});
afterEach(() => vi.useRealTimers());

describe("render gate", () => {
  it("hides the list, applies before reveal when the plan is in time", () => {
    const gate = createGate(container, 300);
    expect(container.style.visibility).toBe("hidden");
    const apply = vi.fn(() => expect(container.style.visibility).toBe("hidden"));
    expect(gate.ready(apply, false)).toBe("before-reveal");
    expect(apply).toHaveBeenCalledOnce();
    expect(container.style.visibility).toBe("");
  });

  it("reveals after 300 ms with a ranking chip, then applies if untouched", () => {
    const gate = createGate(container, 300);
    vi.advanceTimersByTime(300);
    expect(gate.revealed).toBe(true);
    expect(document.querySelector('[data-focal="chip"]')!.textContent).toBe("focal is ranking…");
    const apply = vi.fn();
    expect(gate.ready(apply, false)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
  });

  it("offers Apply instead of moving things after the user interacted", () => {
    const gate = createGate(container, 300);
    vi.advanceTimersByTime(300);
    container.dispatchEvent(new Event("click"));
    const apply = vi.fn();
    expect(gate.ready(apply, true)).toBe("late-offered");
    expect(apply).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-focal="apply"]')!.click();
    expect(apply).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
  });

  it("cancel reveals immediately and restores a prior visibility", () => {
    container.style.visibility = "visible";
    const gate = createGate(container, 300);
    gate.cancel();
    expect(container.style.visibility).toBe("visible");
    vi.advanceTimersByTime(500);
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
    expect(gate.ready(vi.fn(), false)).toBe("cancelled");
  });
});

describe("R11-1: ms=0 gate never touches visibility", () => {
  it("a site-set inline visibility:hidden survives reveal, ready and cancel", async () => {
    const { createGate } = await import("../src/apply/gate");
    const container = document.createElement("div");
    container.style.setProperty("visibility", "hidden"); // the SITE hid it
    document.body.appendChild(container);

    const gate = createGate(container, 0);
    gate.ready(() => {}, false); // a real plan arrives
    expect(container.style.getPropertyValue("visibility")).toBe("hidden");

    const gate2 = createGate(container, 0);
    gate2.cancel();
    expect(container.style.getPropertyValue("visibility")).toBe("hidden");
  });

  it("R11-4: scrolling during a rerun's rank does not force an offer", async () => {
    vi.useFakeTimers();
    const { createGate } = await import("../src/apply/gate");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const gate = createGate(container, 0);
    vi.advanceTimersByTime(1); // revealed
    window.dispatchEvent(new Event("scroll"));
    container.dispatchEvent(new Event("wheel"));
    const apply = vi.fn();
    expect(gate.ready(apply, false)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
