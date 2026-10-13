import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { denseCentre, dronePosition, droneShot, type Footprint } from "./droneShot";

const box = new THREE.Box3(new THREE.Vector3(-1000, 0, -1000), new THREE.Vector3(1000, 60, 1000));
const city: Footprint[] = [
  ...Array.from({ length: 40 }, (_, i) => ({ x: 100 + (i % 8) * 10, z: -50 + Math.floor(i / 8) * 10, height: 15 })),
  { x: -900, z: 900, height: 8 },
];

describe("droneShot", () => {
  const shot = droneShot(box, city);

  it("aims inside the box, at the dense centre rather than the outlier", () => {
    expect(box.containsPoint(shot.target)).toBe(true);
    expect(shot.target.x).toBeGreaterThan(50);
    expect(shot.target.z).toBeLessThan(0);
  });

  it("looks 12 to 20 degrees down", () => {
    expect(shot.pitch).toBeGreaterThanOrEqual(12);
    expect(shot.pitch).toBeLessThanOrEqual(20);
  });

  it("hangs 35 to 70 m above the ground, above the buildings", () => {
    expect(shot.altitude).toBeGreaterThanOrEqual(35);
    expect(shot.altitude).toBeLessThanOrEqual(70);
    expect(shot.position.y).toBeGreaterThan(15);
  });

  it("keeps clear of rising terrain under the camera", () => {
    const hill = (x: number, z: number) => (x + z > 150 ? 80 : 0);
    const onHill = droneShot(box, city, hill);
    expect(onHill.position.y).toBeGreaterThanOrEqual(hill(onHill.position.x, onHill.position.z) + 25);
  });

  it("falls back to the box centre with no buildings", () => {
    const bare = droneShot(box, []);
    expect(bare.target.x).toBeCloseTo(0);
    expect(bare.target.z).toBeCloseTo(0);
  });

  it("covers the whole box with the far plane", () => {
    expect(shot.far).toBeGreaterThan(box.getSize(new THREE.Vector3()).length());
  });

  it("starts at its own position and drifts smoothly", () => {
    expect(dronePosition(shot, 0).distanceTo(shot.position)).toBeLessThan(1e-9);
    expect(dronePosition(shot, 1).distanceTo(dronePosition(shot, 0))).toBeLessThan(5);
    expect(dronePosition(shot, 60).distanceTo(shot.position)).toBeGreaterThan(1);
  });

  it("has no centre for no footprints", () => {
    expect(denseCentre([])).toBeNull();
  });
});
