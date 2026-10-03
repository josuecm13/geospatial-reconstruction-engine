// @vitest-environment jsdom
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { afterEach, expect, it } from "vitest";
import { listenerLedger } from "../testing/listenerLedger";
import { createCameraModes } from "./cameraModes";

let ledger: ReturnType<typeof listenerLedger>;
afterEach(() => ledger.restore());

it("leaves no window or document listener behind once disposed", () => {
  ledger = listenerLedger();
  const canvas = document.createElement("canvas");
  const container = document.createElement("div");
  const camera = new THREE.PerspectiveCamera();
  const orbit = new OrbitControls(camera, canvas);
  const modes = createCameraModes(camera, orbit, canvas, container);
  expect(ledger.leaked().length).toBeGreaterThan(0);
  modes.dispose();
  orbit.dispose();
  expect(ledger.leaked()).toEqual([]);
});
