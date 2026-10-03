import { describe, expect, it } from "vitest";
import { previewTransform, projectToPreview } from "./previewTransform";

// Centre latitude 0, so a degree of longitude is as long as one of latitude (cos 0 = 1) and the maths is plain.
const wideBox = { min_latitude: -0.01, min_longitude: 0, max_latitude: 0.01, max_longitude: 0.04 };

describe("previewTransform", () => {
  it("fits the wider side and centres the other", () => {
    // 0.04 wide and 0.02 tall in 400 x 400: 400 / 0.04 = 10 000 px per degree, so 400 x 200 px, 100 px down.
    const t = previewTransform(wideBox, 400, 400);

    expect(t.scale).toBeCloseTo(10_000, 6);
    expect(t.offsetX).toBeCloseTo(0, 6);
    expect(t.offsetY).toBeCloseTo(100, 6);
  });

  it("keeps the padding all round", () => {
    // 360 px of room: 360 / 0.04 = 9000 px per degree, 360 x 180 px, 20 px in from the sides and 110 px down.
    const t = previewTransform(wideBox, 400, 400, 20);

    expect(t.scale).toBeCloseTo(9000, 6);
    const [nwX, nwY] = projectToPreview(t, 0, 0.01);
    const [seX, seY] = projectToPreview(t, 0.04, -0.01);
    expect([nwX, nwY].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([20, 110]); // north-west corner
    expect([seX, seY].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([380, 290]); // south-east corner
  });

  it("fits the taller side of a tall rectangle", () => {
    // 0.01 wide, 0.04 tall in 400 x 200: 200 / 0.04 = 5000 px per degree, 50 x 200 px, 175 px in.
    const t = previewTransform({ min_latitude: -0.02, min_longitude: 0, max_latitude: 0.02, max_longitude: 0.01 }, 400, 200);

    expect(t.scale).toBeCloseTo(5000, 6);
    expect(t.offsetX).toBeCloseTo(175, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
  });

  it("shrinks longitude by the cosine of the latitude", () => {
    // At 60 degrees north cos = 0.5. 0.04 degrees of longitude is 0.02 wide in latitude units, as tall as 0.02 of latitude.
    const t = previewTransform({ min_latitude: 59.99, min_longitude: 10, max_latitude: 60.01, max_longitude: 10.04 }, 200, 200);

    expect(t.cosLat).toBeCloseTo(0.5, 12);
    expect(t.scale).toBeCloseTo(10_000, 3); // 200 / 0.02 on both axes: a square
    expect(projectToPreview(t, 10.04, 59.99)[0]).toBeCloseTo(200, 3);
    expect(projectToPreview(t, 10.04, 59.99)[1]).toBeCloseTo(200, 3);
  });

  it("puts everything in the middle of a rectangle with no extent", () => {
    const t = previewTransform({ min_latitude: 5, min_longitude: 5, max_latitude: 5, max_longitude: 5 }, 300, 200);

    expect(t.scale).toBe(0);
    expect(projectToPreview(t, 5, 5)).toEqual([150, 100]);
  });

  it("does not go negative when the padding is larger than the canvas", () => {
    expect(previewTransform(wideBox, 30, 30, 20).scale).toBe(0);
  });
});
