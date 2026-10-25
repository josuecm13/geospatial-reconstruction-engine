import type * as THREE from "three";
import { createFpsMeter } from "./fpsMeter";

export interface FpsReadout {
  /** Once per frame with the frame's time in milliseconds. */
  frame(deltaMs: number): void;
  dispose(): void;
}

const REFRESH_MS = 250;

/** The dev readout behind `?fps`: null (and nothing in the page) without the query parameter. */
export function createFpsReadout(
  container: HTMLElement,
  renderer: THREE.WebGLRenderer,
  info: { theme: () => string; shadowRedraws: () => number },
  search: string = window.location.search,
): FpsReadout | null {
  if (!new URLSearchParams(search).has("fps")) return null;
  const meter = createFpsMeter();
  const element = Object.assign(document.createElement("pre"), { className: "scene-fps" });
  container.appendChild(element);
  let sinceRefresh = 0;
  let lastRedraws = info.shadowRedraws();
  return {
    frame(deltaMs) {
      meter.record(deltaMs);
      sinceRefresh += deltaMs;
      if (sinceRefresh < REFRESH_MS) return;
      sinceRefresh = 0;
      const { fps, p95Ms } = meter.stats();
      const redraws = info.shadowRedraws();
      const shadows = redraws !== lastRedraws;
      lastRedraws = redraws;
      const { render, memory } = renderer.info;
      element.textContent = [
        `${fps.toFixed(0)} fps  p95 ${p95Ms.toFixed(1)} ms`,
        `calls ${render.calls}  tris ${render.triangles}`,
        `textures ${memory.textures}`,
        `theme ${info.theme()}`,
        `shadows redrawn: ${shadows ? "yes" : "no"}`,
      ].join("\n");
    },
    dispose() {
      element.remove();
    },
  };
}
