// @vitest-environment jsdom
import * as THREE from "three";
import { afterEach, expect, it } from "vitest";
import { listenerLedger } from "../testing/listenerLedger";
import { createRoutePanel, type RoutingDeps } from "./routePanel";

let ledger: ReturnType<typeof listenerLedger>;
afterEach(() => ledger.restore());

it("leaves no window or document listener behind once disposed", () => {
  ledger = listenerLedger();
  const deps = { api: { route: async () => ({}), routingStrategies: async () => [] }, areaId: () => null } as unknown as RoutingDeps;
  const panel = createRoutePanel(document.createElement("div"), new THREE.Scene(), new THREE.PerspectiveCamera(), document.createElement("canvas"), deps, () => true);
  expect(ledger.leaked().length).toBeGreaterThan(0);
  panel.dispose();
  expect(ledger.leaked()).toEqual([]);
});
