import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface SceneView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Starts rendering; the loop stops while the view is hidden. */
  shown(): void;
  hidden(): void;
}

/** An empty low-poly world: sky, light, and a ground plane. Later issues add the imported city. */
export function createSceneView(container: HTMLElement): SceneView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfe3f2");
  scene.add(new THREE.HemisphereLight("#ffffff", "#7a8b6f", 1.4));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.6);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ color: "#d9d4c7" }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  scene.add(new THREE.GridHelper(1000, 20, "#b8b2a4", "#c8c2b4"));

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
  camera.position.set(0, 400, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2.1;

  let running = false;
  const resize = () => {
    const { clientWidth, clientHeight } = container;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  const frame = () => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };

  return {
    scene,
    camera,
    shown() {
      resize();
      if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    },
    hidden() {
      running = false;
    },
  };
}
