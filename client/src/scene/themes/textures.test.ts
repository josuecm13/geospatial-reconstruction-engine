import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRealisticTextures, textureBytes } from "./textures";

const COLORS = {
  facade: "#c9b79c",
  roof: "#6b6b6b",
  asphalt: "#3a3a3d",
  grass: "#5d8f43",
  forest: "#2f5d34",
  water: "#3f7fbf",
};

const bytes = (t: THREE.DataTexture) => t.image.data as Uint8Array;

describe("createRealisticTextures", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = createRealisticTextures(COLORS, 1);
    const b = createRealisticTextures(COLORS, 1);
    const c = createRealisticTextures(COLORS, 2);
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      expect(Array.from(bytes(a[k]))).toEqual(Array.from(bytes(b[k])));
    }
    expect(Array.from(bytes(a.roof))).not.toEqual(Array.from(bytes(c.roof)));
  });

  it("makes 64x64 repeating nearest-filtered mipmapped sRGB textures", () => {
    const set = createRealisticTextures(COLORS);
    for (const tex of Object.values(set)) {
      expect(tex.image.width).toBe(64);
      expect(tex.image.height).toBe(64);
      expect(tex.magFilter).toBe(THREE.NearestFilter);
      expect(tex.minFilter).toBe(THREE.NearestMipmapNearestFilter);
      expect(tex.generateMipmaps).toBe(true);
      expect(tex.wrapS).toBe(THREE.RepeatWrapping);
      expect(tex.wrapT).toBe(THREE.RepeatWrapping);
      expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    }
  });

  it("keeps the set within 1 MB of GPU memory", () => {
    const total = textureBytes(createRealisticTextures(COLORS));
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(1_048_576);
  });

  it("draws facade windows darker than the wall", () => {
    const data = bytes(createRealisticTextures(COLORS).facade);
    const lum = (x: number, y: number) => {
      const i = (y * 64 + x) * 4;
      return data[i] + data[i + 1] + data[i + 2];
    };
    let win = 0;
    let wn = 0;
    let wall = 0;
    let ln = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const cx = x % 32;
        const cy = y % 32;
        if (cx >= 8 && cx < 24 && cy >= 8 && cy < 24) {
          win += lum(x, y);
          wn++;
        } else if (cx < 6 || cx > 26) {
          wall += lum(x, y);
          ln++;
        }
      }
    }
    expect(win / wn).toBeLessThan(wall / ln);
  });
});
