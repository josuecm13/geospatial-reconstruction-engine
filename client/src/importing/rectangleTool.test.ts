// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
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
