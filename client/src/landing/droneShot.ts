import * as THREE from "three";

/** A building's footprint centre on the ground plane, and how tall it stands. */
export interface Footprint {
  x: number;
  z: number;
  height: number;
}

/** The camera's field of view for the hero, degrees: a longer lens than the overview's. */
export const DRONE_FOV = 38;
/** The drift's angular speed at its fastest, radians per second. */
export const DRONE_DRIFT_SPEED = 0.02;
/** How far the drone swings to either side of its starting bearing, radians. */
const SWING = 0.5;
/** How far it dollies in at the end of a swing, as a share of its distance. */
const DOLLY = 0.1;
/** How high the camera bobs, metres. */
const BOB = 2.5;
/** The bearing the shot starts from, radians turned from +z. */
const BEARING = 0.55;
/** The aim point's height above the ground at the target, metres: the upper floors, not the pavement. */
const AIM_HEIGHT = 14;

export interface DroneShot {
  /** The point the camera looks at, in the dense centre of the buildings. */
  target: THREE.Vector3;
  /** The camera's starting position. */
  position: THREE.Vector3;
  /** The far plane that covers the whole area from the camera. */
  far: number;
  /** The camera's height above the ground at the target, and its horizontal distance from it, metres. */
  altitude: number;
  distance: number;
  /** The angle below the horizon the camera looks down at, degrees. */
  pitch: number;
  /** The bearing the camera starts from, radians. */
  bearing: number;
}

/**
 * The inner-city centre of a set of footprints: the mean of the half that lie closest to the overall mean, so a few far
 * outliers don't drag the shot out of the dense middle. Null when there are none.
 */
export function denseCentre(footprints: Footprint[]): { x: number; z: number } | null {
  if (!footprints.length) return null;
  const mean = (list: Footprint[]) => ({ x: list.reduce((s, f) => s + f.x, 0) / list.length, z: list.reduce((s, f) => s + f.z, 0) / list.length });
  const first = mean(footprints);
  const nearest = [...footprints].sort((a, b) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(b.x - first.x, b.z - first.z));
  return mean(nearest.slice(0, Math.max(1, Math.ceil(nearest.length / 2))));
}

/**
 * A low, oblique drone shot across the streets toward the dense centre of `footprints` (the world box's centre when there
 * are none). The camera hangs 35 to 70 m up (more in a bigger area, and always above a typical building), looks about 16
 * degrees down at the aim point, and the far plane covers the whole `box`. `heightAt` is the terrain's height at a local
 * x, z; without it the ground is the box's floor.
 */
export function droneShot(box: THREE.Box3, footprints: Footprint[], heightAt?: (x: number, z: number) => number): DroneShot {
  const ground = (x: number, z: number) => heightAt?.(x, z) ?? box.min.y;
  const size = box.getSize(new THREE.Vector3());
  const centre = denseCentre(footprints) ?? { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
  const heights = footprints.map((f) => f.height).sort((a, b) => a - b);
  const typical = heights.length ? heights[Math.floor(heights.length / 2)] : 0;

  const groundAtTarget = ground(centre.x, centre.z);
  const target = new THREE.Vector3(centre.x, groundAtTarget + AIM_HEIGHT, centre.z);
  const rise = THREE.MathUtils.clamp(35 + Math.max(size.x, size.z) * 0.01, 35, 70);
  const distance = Math.max(rise - AIM_HEIGHT, 15) / Math.tan(THREE.MathUtils.degToRad(16));

  const x = target.x + Math.sin(BEARING) * distance;
  const z = target.z + Math.cos(BEARING) * distance;
  const y = Math.max(groundAtTarget + rise, ground(x, z) + 25, ground(x, z) + typical + 15);
  const position = new THREE.Vector3(x, y, z);
  return {
    target,
    position,
    far: Math.max(3000, (size.length() + distance) * 3),
    altitude: y - groundAtTarget,
    distance,
    pitch: THREE.MathUtils.radToDeg(Math.atan2(y - target.y, distance)),
    bearing: BEARING,
  };
}

/**
 * The drone's position `seconds` into the shot: a slow swing to one side and back, a gentle dolly-in at each end of it and
 * a slight bob, all on one eased sine so it never jerks. At 0 it is the shot's own position.
 */
export function dronePosition(shot: DroneShot, seconds: number): THREE.Vector3 {
  const omega = DRONE_DRIFT_SPEED / SWING; // the swing's peak angular speed is SWING * omega
  const s = Math.sin(seconds * omega);
  const bearing = shot.bearing + SWING * s;
  const radius = shot.distance * (1 - DOLLY * Math.abs(s));
  return new THREE.Vector3(
    shot.target.x + Math.sin(bearing) * radius,
    shot.position.y + BOB * Math.sin(seconds * omega * 1.7),
    shot.target.z + Math.cos(bearing) * radius,
  );
}
