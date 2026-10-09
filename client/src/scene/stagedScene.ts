import * as THREE from "three";
import type { BoundingBox, FeatureCollection, MapData, Projection } from "../api/types";
import { metersPerDegree } from "../geo/localMeters";
import { Animator } from "./buildAnimation";
import { buildWorld, groundPlane, WORLD_GROUPS } from "./buildWorld";
import { MATERIALS } from "./palette";
import { toLocal } from "./projection";
import type { RevealStep } from "./stagedBuild";

const GROUND_MARGIN = 20;

/** What an inner area adds to a staged build. Not its roads: the outer area's `roads` stage carries
 *  the whole network across the rectangle, inner areas included. */
export const INNER_AREA_LAYERS = ["area_features", "blocks", "buildings"] as const;
const WAITING_LABEL = "Building the map…";
const FETCHED_LABEL = "Building…";

/** The rectangle's size in meters, on the same sphere the server uses. */
export function bboxMeters(bbox: BoundingBox): { width: number; height: number } {
  const perDegree = metersPerDegree((bbox.min_latitude + bbox.max_latitude) / 2);
  return { width: (bbox.max_longitude - bbox.min_longitude) * perDegree.lon, height: (bbox.max_latitude - bbox.min_latitude) * perDegree.lat };
}

/** What the scene view and the import flow drive while a place is being built. */
export interface StagedHandle {
  /** Queues a step. Steps play one after another, each once the one before has finished. */
  apply(step: RevealStep): void;
  /** Shows an already imported inner area's features, blocks and buildings at once (its map-data, in its own projection). Its roads come from the `roads` stage. */
  addBuilt(data: MapData): void;
  /** No more steps are coming: `finished` resolves once those queued have played. */
  complete(): void;
  /** The build failed: drop what was built so far. */
  abandon(): void;
  /** Resolves when the animation has played out (or been skipped), or the build was abandoned. */
  readonly finished: Promise<void>;
}

export interface StagedScene {
  /** Starts a build in the rectangle: the waiting animation plays until the `fetched` step. `world` is the group the steps fill. */
  begin(bbox: BoundingBox): { handle: StagedHandle; world: THREE.Group };
  /** Call each frame. */
  update(delta: number): void;
}

const emptyCollection = <P>(): FeatureCollection<P> => ({ type: "FeatureCollection", features: [] });

/** A map-data response with only the layers given, so `buildWorld` turns just those into meshes. */
function partialData(projection: Projection, layers: Partial<MapData>): MapData {
  return {
    attribution: "",
    scope: { type: "import_area", id: "", composed_area_ids: [] },
    mode: "filter",
    projection,
    road_segments: emptyCollection(),
    navigable_nodes: emptyCollection(),
    blocks: emptyCollection(),
    buildings: emptyCollection(),
    pois: emptyCollection(),
    area_features: emptyCollection(),
    ...layers,
  };
}

/** The ground under the rectangle, with the same margin `buildWorld` leaves around a world. */
function groundFor(bbox: BoundingBox, projection: Projection): THREE.Mesh {
  const a = toLocal(projection, [bbox.min_longitude, bbox.min_latitude]);
  const b = toLocal(projection, [bbox.max_longitude, bbox.max_latitude]);
  const [minX, maxX] = [Math.min(a.x, b.x) - GROUND_MARGIN, Math.max(a.x, b.x) + GROUND_MARGIN];
  const [minZ, maxZ] = [Math.min(a.z, b.z) - GROUND_MARGIN, Math.max(a.z, b.z) + GROUND_MARGIN];
  return groundPlane(minX, maxX, minZ, maxZ);
}

const meshesOf = (objects: THREE.Object3D[]): THREE.Mesh[] => objects.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh);

/**
 * The scene's staged build (stagedBuild.ts decides the order; this draws it). It needs WebGL's scene
 * graph but no renderer of its own, so it takes the scene view's scene and container.
 */
export function createStagedScene(scene: THREE.Scene, container: HTMLElement): StagedScene {
  const animator = new Animator();
  const label = Object.assign(document.createElement("div"), { className: "scene-building", hidden: true });
  const skip = Object.assign(document.createElement("button"), { className: "scene-skip", type: "button", textContent: "Skip animation", hidden: true });
  container.append(label, skip);
  skip.addEventListener("click", () => animator.skip());

  let waiting: THREE.Group | undefined;
  const stopWaiting = () => {
    if (!waiting) return;
    scene.remove(waiting);
    waiting.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
    waiting = undefined;
  };
  let end: (() => void) | undefined; // ends the build in progress: abandoned or not

  return {
    begin(bbox) {
      end?.(); // a build still running is replaced
      animator.reset();
      const world = new THREE.Group();
      world.name = "world";
      const groups = Object.fromEntries(WORLD_GROUPS.map((name) => [name, Object.assign(new THREE.Group(), { name })])) as Record<(typeof WORLD_GROUPS)[number], THREE.Group>;
      world.add(...WORLD_GROUPS.map((name) => groups[name]));
      scene.add(world);

      // The waiting animation: a slowly turning wireframe of the rectangle, until `fetched`.
      const { width, height } = bboxMeters(bbox);
      waiting = new THREE.Group();
      const grid = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 12, 12), MATERIALS.waiting);
      grid.rotation.x = -Math.PI / 2;
      waiting.add(grid);
      scene.add(waiting);
      label.textContent = WAITING_LABEL;
      label.hidden = false;
      skip.hidden = false;

      let projection: Projection | undefined;
      const queue: RevealStep[] = [];
      let playing = false;
      let completed = false;
      let over = false;
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => (resolveFinished = resolve));

      const finish = () => {
        if (over) return;
        over = true;
        stopWaiting();
        label.hidden = true;
        skip.hidden = true;
        end = undefined;
        resolveFinished();
      };
      end = finish;

      /** Moves a layer's meshes from a built partial world into the live world. */
      const take = (built: THREE.Group, name: (typeof WORLD_GROUPS)[number]): THREE.Object3D[] => {
        const added = [...built.getObjectByName(name)!.children];
        groups[name].add(...added);
        return added;
      };

      const play = async (step: RevealStep): Promise<void> => {
        switch (step.layer) {
          case "fetched":
            stopWaiting();
            label.textContent = FETCHED_LABEL;
            return;
          case "ground": {
            const ground = groundFor(bbox, step.projection);
            groups.ground.add(ground);
            const features = take(buildWorld(partialData(step.projection, { area_features: step.areaFeatures })), "area_features");
            await animator.fadeIn([ground, ...features]);
            return;
          }
          case "roads":
            await animator.fadeIn(take(buildWorld(partialData(step.projection, { road_segments: step.roadSegments })), "roads"));
            return;
          case "buildings":
            await animator.rise(meshesOf(take(buildWorld(partialData(step.projection, { buildings: step.buildings })), "buildings")));
            return;
          case "blocks":
            await animator.fadeIn(take(buildWorld(partialData(step.projection, { blocks: step.blocks })), "blocks"));
            return;
        }
      };

      const pump = async () => {
        if (playing) return;
        playing = true;
        while (queue.length && !over) {
          // A layer that can't be drawn is skipped: the finished world is loaded from map-data anyway.
          await play(queue.shift()!).catch((error) => console.error("staged build step failed", error));
        }
        playing = false;
        if (completed && !queue.length) finish();
      };

      const handle: StagedHandle = {
        finished,
        apply(step) {
          if (over) return;
          projection = step.projection;
          queue.push(step);
          void pump();
        },
        addBuilt(data) {
          if (over || !projection) return;
          const offset = toLocal(projection, [data.projection.origin.longitude, data.projection.origin.latitude]);
          const inner = buildWorld(data); // its own ground, roads and the unreleased `generated` group stay behind
          inner.getObjectByName("roads")!.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
          for (const name of INNER_AREA_LAYERS) {
            for (const mesh of take(inner, name)) {
              mesh.position.x += offset.x;
              mesh.position.z += offset.z;
            }
          }
        },
        complete() {
          completed = true;
          if (!playing && !queue.length) finish();
        },
        abandon() {
          if (over) return;
          scene.remove(world);
          world.traverse((object) => (object as THREE.Mesh).geometry?.dispose());
          finish();
        },
      };
      return { handle, world };
    },

    update(delta) {
      animator.update(delta);
      if (waiting) waiting.rotation.y += delta * 0.4;
    },
  };
}
