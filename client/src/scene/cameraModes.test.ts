// @vitest-environment jsdom
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { afterEach, expect, it } from "vitest";
import { listenerLedger } from "../testing/listenerLedger";
import { createCameraModes, EYE_HEIGHT, eyeY } from "./cameraModes";
import { flatTerrain, type Terrain } from "./terrain";

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

it("walks at the eye height above the ground: on a slope the camera follows it, with no terrain it stays at the eye height", () => {
  const slope: Terrain = { ...flatTerrain(), hasGround: true, heightAtLocal: (x) => x * 0.1 };
  expect(eyeY(slope, 0, 0)).toBeCloseTo(EYE_HEIGHT);
  expect(eyeY(slope, 50, 0)).toBeCloseTo(5 + EYE_HEIGHT);
  expect(eyeY(undefined, 50, 0)).toBe(EYE_HEIGHT);
  expect(eyeY(flatTerrain(), 50, 0)).toBe(EYE_HEIGHT);
});
