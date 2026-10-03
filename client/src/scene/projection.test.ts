import { describe, expect, it } from "vitest";
import type { Projection } from "../api/types";
import { toLocal, toLonLat } from "./projection";

const projection: Projection = {
  origin: { latitude: 9.93, longitude: -84.08 },
  meters_per_degree_latitude: 110_600,
  meters_per_degree_longitude: 109_500,
};

describe("projection", () => {
  it("puts the origin at zero", () => {
    const local = toLocal(projection, [-84.08, 9.93]);
    expect(local.x).toBeCloseTo(0);
    expect(local.z).toBeCloseTo(0);
  });

  it("maps north to -z and east to +x", () => {
    expect(toLocal(projection, [-84.08, 9.931]).z).toBeCloseTo(-110.6);
    expect(toLocal(projection, [-84.079, 9.93]).x).toBeCloseTo(109.5);
  });

  it("round-trips", () => {
    const { x, z } = toLocal(projection, [-84.0712, 9.9345]);
    const [lon, lat] = toLonLat(projection, x, z);
    expect(lon).toBeCloseTo(-84.0712, 9);
    expect(lat).toBeCloseTo(9.9345, 9);
  });
});
