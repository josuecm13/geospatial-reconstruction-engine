// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { fakeMap } from "../testing/fakeMap";
import { listenerLedger } from "../testing/listenerLedger";
import { BoundaryTool } from "./boundaryTool";

let ledger: ReturnType<typeof listenerLedger>;
afterEach(() => ledger.restore());

it.each(["vertices", "freehand"] as const)("leaves no document listener behind when disposed mid-trace (%s)", (mode) => {
  ledger = listenerLedger();
  const tool = new BoundaryTool(fakeMap(), () => {});
  tool.start(mode);
  expect(ledger.leaked().length).toBeGreaterThan(0);
  tool.dispose();
  expect(ledger.leaked()).toEqual([]);
});
