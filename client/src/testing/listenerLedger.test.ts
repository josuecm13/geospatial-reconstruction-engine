// @vitest-environment jsdom
import { expect, it } from "vitest";
import { listenerLedger } from "./listenerLedger";

it("reports a listener that was added and never removed", () => {
  const ledger = listenerLedger();
  const kept = () => {};
  const dropped = () => {};
  window.addEventListener("keydown", kept);
  document.addEventListener("keydown", dropped, true);
  document.removeEventListener("keydown", dropped, true);
  expect(ledger.leaked()).toHaveLength(1);
  window.removeEventListener("keydown", kept);
  expect(ledger.leaked()).toEqual([]);
  ledger.restore();
});
