import * as THREE from "three";
import type { Geometry, Position, Projection } from "../api/types";
import { flatGeometry, footprintShape } from "./extrude";
import { toLocal, toLonLat } from "./projection";
import { MATERIALS } from "./palette";
import { roadPolygon } from "./roadGeometry";
import { shadeGeometry } from "./shading";

/** Just above the road surfaces (LAYER_Y.roads = 0.05), so the ribbon doesn't z-fight them. */
export const ROUTE_Y = 0.08;
export const ROUTE_WIDTH = 2;
const MARKER_HEIGHT = 8;

/** Groups a click can land on: the ground, the area features, and the roads. Never buildings. */
const PICKABLE_GROUPS = ["ground", "area_features", "roads"];

export interface RouteLayer {
  /** The scene object holding the markers and the ribbon. It is not part of the world, so it is not
   * exported with it; `setWorld` empties it. */
  readonly root: THREE.Group;
  /** Follows the loaded world (or `undefined` once it is gone); clears the markers and the ribbon. */
  setWorld(world: THREE.Object3D | undefined): void;
  /** [longitude, latitude] under a pointer position (client pixels), or null when it hits no ground or road. */
  pick(clientX: number, clientY: number): Position | null;
  setMarkers(origin: Position | null, destination: Position | null): void;
  /** Draws the route's geometry as a ribbon; null or a non-LineString clears it. */
  setRoute(geometry: Geometry | null): void;
  clear(): void;
}

export function createRouteLayer(camera: THREE.Camera, canvas: HTMLElement): RouteLayer {
  const root = Object.assign(new THREE.Group(), { name: "route" });
  const raycaster = new THREE.Raycaster();
  let world: THREE.Object3D | undefined;
  let projection: Projection | undefined;
  let markers: THREE.Mesh[] = [];
  let ribbon: THREE.Mesh | undefined;

  const dispose = (object: THREE.Mesh | undefined) => {
    if (!object) return;
    root.remove(object);
    object.geometry.dispose();
  };

  const layer: RouteLayer = {
    root,
    setWorld(next) {
      layer.clear();
      world = next;
      projection = next?.userData.projection;
    },
    pick(clientX, clientY) {
      if (!world || !projection) return null;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const targets = PICKABLE_GROUPS.flatMap((name) => world!.getObjectByName(name)?.children ?? []);
      const [hit] = raycaster.intersectObjects(targets, true);
      return hit ? toLonLat(projection, hit.point.x, hit.point.z) : null;
    },
    setMarkers(origin, destination) {
      markers.forEach(dispose);
      markers = [];
      if (!projection) return;
      for (const [point, material] of [
        [origin, MATERIALS.origin],
        [destination, MATERIALS.destination],
      ] as const) {
        if (!point) continue;
        const { x, z } = toLocal(projection, point);
        // Tip down, so the point of the cone is the picked spot; baked in, as the shade can't see a mesh rotation.
        const cone = new THREE.Mesh(shadeGeometry(new THREE.ConeGeometry(2.5, MARKER_HEIGHT, 12).rotateX(Math.PI)), material);
        cone.position.set(x, MARKER_HEIGHT / 2, z);
        markers.push(cone);
        root.add(cone);
      }
    },
    setRoute(geometry) {
      dispose(ribbon);
      ribbon = undefined;
      if (!projection || geometry?.type !== "LineString") return;
      const outline = roadPolygon(
        geometry.coordinates.map((p) => toLocal(projection!, p)),
        ROUTE_WIDTH,
      );
      if (!outline.length) return;
      ribbon = new THREE.Mesh(flatGeometry([footprintShape(outline)]), MATERIALS.route);
      ribbon.position.y = ROUTE_Y;
      ribbon.name = "route:ribbon";
      root.add(ribbon);
    },
    clear() {
      layer.setMarkers(null, null);
      layer.setRoute(null);
    },
  };
  return layer;
}
