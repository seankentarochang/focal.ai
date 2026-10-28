import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstRunGate, createRerunGate } from "../src/apply/gate";

let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="list"><div>a</div><div>b</div></div>';
  container = document.getElementById("list")!;
});
afterEach(() => vi.useRealTimers());

describe("render gate", () => {
  it("hides the list, applies before reveal when the plan is in time", () => {
    const gate = createFirstRunGate(container);
    expect(container.style.visibility).toBe("hidden");
    const apply = vi.fn(() => expect(container.style.visibility).toBe("hidden"));
    expect(gate.ready(apply, false)).toBe("before-reveal");
    expect(apply).toHaveBeenCalledOnce();
    expect(container.style.visibility).toBe("");
  });

  it("reveals after 300 ms with a ranking chip, then applies if untouched", () => {
    const gate = createFirstRunGate(container);
    vi.advanceTimersByTime(300);
    expect(gate.revealed).toBe(true);
    expect(document.querySelector('[data-focal="chip"]')!.textContent).toBe("focal is ranking…");
    const apply = vi.fn();
    expect(gate.ready(apply, false)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
  });

  it("offers Apply instead of moving things after the user interacted", () => {
    const gate = createFirstRunGate(container);
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
    const gate = createFirstRunGate(container);
    gate.cancel();
    expect(container.style.visibility).toBe("visible");
    vi.advanceTimersByTime(500);
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
    expect(gate.ready(vi.fn(), false)).toBe("cancelled");
  });
});

describe("R12-1: rerun gate never touches visibility", () => {
  it("a site-set inline visibility:hidden survives reveal, ready and cancel", async () => {
    const { createRerunGate } = await import("../src/apply/gate");
    const container = document.createElement("div");
    container.style.setProperty("visibility", "hidden"); // the SITE hid it
    document.body.appendChild(container);

    const gate = createRerunGate(container);
    gate.ready(() => {}, false); // a real plan arrives
    expect(container.style.getPropertyValue("visibility")).toBe("hidden");

    const gate2 = createRerunGate(container);
    gate2.cancel();
    expect(container.style.getPropertyValue("visibility")).toBe("hidden");
  });

  it("R11-4: scrolling during a rerun's rank does not force an offer", async () => {
    vi.useFakeTimers();
    const { createRerunGate: createRerunGate2 } = await import("../src/apply/gate");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const gate = createRerunGate(container);
    vi.advanceTimersByTime(1); // revealed
    window.dispatchEvent(new Event("scroll"));
    container.dispatchEvent(new Event("wheel"));
    const apply = vi.fn();
    expect(gate.ready(apply, false)).toBe("late-applied");
    expect(apply).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe("R12-1: rerun gate contract", () => {
  it("mounts no chip and writes no visibility before ready; offer gates the Apply chip", async () => {
    const { createRerunGate } = await import("../src/apply/gate");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const gate = createRerunGate(container);
    expect(container.style.getPropertyValue("visibility")).toBe(""); // never hidden
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
    const applied = vi.fn();
    expect(gate.ready(applied, false)).toBe("late-applied");
    expect(applied).toHaveBeenCalled();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();

    const gate2 = createRerunGate(container);
    expect(gate2.ready(vi.fn(), true)).toBe("late-offered");
    expect(document.querySelector('[data-focal="chip"]')).toBeTruthy();
    gate2.cancel();
    expect(document.querySelector('[data-focal="chip"]')).toBeNull();
  });
});
