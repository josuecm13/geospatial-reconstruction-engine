import * as THREE from "three";
import { CELL_WIDTH, FLOOR_HEIGHT } from "../wallGrid";

/** Realistic's procedural textures, drawn into RGBA byte arrays (no canvas, so they test in jsdom). */

const SIZE = 64;

/** The facade texture covers 2 cells by 2 floors. */
export const FACADE_REPEAT_METRES = { u: 2 * CELL_WIDTH, v: 2 * FLOOR_HEIGHT };

/**
 * Metres covered by one repeat of each ground texture: 8 m for asphalt (fine grain reads as
 * road surface), 16 m for the rest (coarser patterns would look busy any smaller).
 */
export const GROUND_TILE_METRES = {
  asphalt: 8,
  grass: 16,
  forest: 16,
  water: 16,
  roof: 16,
} as const;

export interface RealisticColors {
  facade: string;
  roof: string;
  asphalt: string;
  grass: string;
  forest: string;
  water: string;
}

export interface RealisticTextures {
  facade: THREE.DataTexture;
  roof: THREE.DataTexture;
  asphalt: THREE.DataTexture;
  grass: THREE.DataTexture;
  forest: THREE.DataTexture;
  water: THREE.DataTexture;
}

type Rgb = [number, number, number];
type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function shade(c: Rgb, f: number): Rgb {
  return [clamp(c[0] * f), clamp(c[1] * f), clamp(c[2] * f)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    clamp(a[0] + (b[0] - a[0]) * t),
    clamp(a[1] + (b[1] - a[1]) * t),
    clamp(a[2] + (b[2] - a[2]) * t),
  ];
}

function put(data: Uint8Array, x: number, y: number, c: Rgb): void {
  const i = (y * SIZE + x) * 4;
  data[i] = c[0];
  data[i + 1] = c[1];
  data[i + 2] = c[2];
  data[i + 3] = 255;
}

function fill(fn: (x: number, y: number) => Rgb): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) put(data, x, y, fn(x, y));
  return data;
}

function drawFacade(color: Rgb, rng: Rng): Uint8Array {
  const cell = SIZE / 2; // 2 cells by 2 floors
  const glass = shade(color, 0.35);
  const sill = shade(color, 0.7);
  return fill((x, y) => {
    const cx = x % cell;
    const cy = y % cell;
    const noise = 0.95 + rng() * 0.1;
    if (cx >= 8 && cx < 24 && cy >= 8 && cy < 24) return shade(glass, noise);
    if (cx >= 7 && cx < 25 && cy === 24) return shade(sill, noise);
    return shade(color, noise);
  });
}

function drawRoof(color: Rgb, rng: Rng): Uint8Array {
  return fill(() => {
    const gravel = rng() < 0.12 ? 1.2 : 1;
    return shade(color, (0.85 + rng() * 0.25) * gravel);
  });
}

function drawAsphalt(color: Rgb, rng: Rng): Uint8Array {
  const fleck = shade(color, 1.8);
  return fill(() => (rng() < 0.03 ? fleck : shade(color, 0.9 + rng() * 0.2)));
}

function drawGrass(color: Rgb, rng: Rng): Uint8Array {
  const light = shade(color, 1.2);
  const dark = shade(color, 0.8);
  return fill(() => (rng() < 0.5 ? light : dark));
}

function drawForest(color: Rgb, rng: Rng): Uint8Array {
  const blobs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 14; i++) {
    blobs.push({ x: rng() * SIZE, y: rng() * SIZE, r: 4 + rng() * 6 });
  }
  const dark = shade(color, 0.6);
  return fill((x, y) => {
    let inside = false;
    for (const b of blobs) {
      // wrap so the texture tiles
      const dx = Math.min(Math.abs(x - b.x), SIZE - Math.abs(x - b.x));
      const dy = Math.min(Math.abs(y - b.y), SIZE - Math.abs(y - b.y));
      if (dx * dx + dy * dy < b.r * b.r) {
        inside = true;
        break;
      }
    }
    const n = 0.95 + rng() * 0.1;
    return shade(inside ? dark : color, n);
  });
}

function drawWater(color: Rgb, rng: Rng): Uint8Array {
  const light = shade(color, 1.25);
  const phase = rng() * Math.PI * 2;
  return fill((x, y) => {
    const wave = Math.sin((y / SIZE) * Math.PI * 8 + phase + Math.sin((x / SIZE) * Math.PI * 2) * 0.6);
    const t = Math.max(0, wave) * 0.5;
    return shade(mix(color, light, t), 0.98 + rng() * 0.04);
  });
}

function wrap(data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createRealisticTextures(colors: RealisticColors, seed = 1): RealisticTextures {
  const rng = mulberry32(seed);
  return {
    facade: wrap(drawFacade(parseHex(colors.facade), rng)),
    roof: wrap(drawRoof(parseHex(colors.roof), rng)),
    asphalt: wrap(drawAsphalt(parseHex(colors.asphalt), rng)),
    grass: wrap(drawGrass(parseHex(colors.grass), rng)),
    forest: wrap(drawForest(parseHex(colors.forest), rng)),
    water: wrap(drawWater(parseHex(colors.water), rng)),
  };
}

/** GPU memory of a texture set, mipmaps included (base level x 4/3). */
export function textureBytes(set: RealisticTextures): number {
  let total = 0;
  for (const tex of Object.values(set)) {
    const { width, height } = tex.image as { width: number; height: number };
    total += Math.ceil((width * height * 4 * 4) / 3);
  }
  return total;
}
