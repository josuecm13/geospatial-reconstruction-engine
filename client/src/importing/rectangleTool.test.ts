// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fakeMap } from "../testing/fakeMap";
import { listenerLedger } from "../testing/listenerLedger";
import { RectangleTool } from "./rectangleTool";

let ledger: ReturnType<typeof listenerLedger>;
afterEach(() => ledger.restore());

it("leaves no document listener behind once disposed", () => {
  ledger = listenerLedger();
  const tool = new RectangleTool(fakeMap(), () => {});
  expect(ledger.leaked().length).toBeGreaterThan(0);
  tool.dispose();
  expect(ledger.leaked()).toEqual([]);
});

describe("locking", () => {
  const BOX = { min_latitude: 0, min_longitude: 0, max_latitude: 0.02, max_longitude: 0.02 };

  /** A map whose pixels are thousandths of a degree, with a rectangle shown on it. */
  function setup() {
    ledger = listenerLedger();
    const base = fakeMap();
    const canvas = base.getCanvas();
    Object.assign(canvas, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
    const map = Object.assign(base, {
      unproject: ([x, y]: [number, number]) => ({ lng: x / 1000, lat: y / 1000 }),
      getZoom: () => 15,
    });
    const changes: unknown[] = [];
    const tool = new RectangleTool(map, (bbox) => changes.push(bbox));
    tool.show(BOX, true);
    const send = (type: string, [x, y]: [number, number]) =>
      canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: "mouse" }));
    const drag = (from: [number, number], to: [number, number]) => {
      send("pointerdown", from);
      send("pointermove", to);
      send("pointerup", to);
    };
    return { tool, changes, drag, send };
  }

  it("moves when unlocked: dragging inside shifts the rectangle", () => {
    const { tool, changes, drag } = setup();
    drag([10, 10], [12, 10]);
    expect(changes.length).toBeGreaterThan(0);
    expect(tool.bbox).not.toEqual(BOX);
    tool.dispose();
  });

  it("ignores the pointer when locked, and moves again once unlocked", () => {
    const { tool, changes, drag } = setup();
    tool.setLocked(true);
    expect(tool.isLocked).toBe(true);
    drag([10, 10], [12, 10]); // inside: would move it
    drag([0, 10], [-5, 10]); // on an edge: would resize it
    expect(changes).toEqual([]);
    expect(tool.bbox).toEqual(BOX);
    tool.setLocked(false);
    drag([10, 10], [12, 10]);
    expect(tool.bbox).not.toEqual(BOX);
    tool.dispose();
  });

  it("restores the rectangle when locked mid-drag", () => {
    const { tool, send } = setup();
    send("pointerdown", [10, 10]);
    send("pointermove", [14, 10]);
    expect(tool.bbox).not.toEqual(BOX);
    tool.setLocked(true);
    expect(tool.bbox).toEqual(BOX);
    tool.dispose();
  });
});
