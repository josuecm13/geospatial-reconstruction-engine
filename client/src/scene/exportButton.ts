import type * as THREE from "three";
import { downloadGlb, exportWorld, glbFileName } from "./exportGltf";

export interface ExportButton {
  /** Enabled once a world is loaded; `undefined` disables it. */
  setWorld(world: THREE.Group | undefined): void;
  /** True while something (a staged build) is changing the world: the button waits. */
  setBusy(busy: boolean): void;
}

const LABEL = "Download glTF";

/** The "Download glTF" button in the scene view's corner. */
export function createExportButton(container: HTMLElement): ExportButton {
  const button = Object.assign(document.createElement("button"), { className: "scene-export", type: "button", textContent: LABEL, disabled: true });
  container.appendChild(button);
  let world: THREE.Group | undefined;
  let busy = false;
  let exporting = false;
  const refresh = () => (button.disabled = !world || busy || exporting);
  button.addEventListener("click", async () => {
    if (!world || button.disabled) return;
    exporting = true;
    refresh();
    try {
      downloadGlb(await exportWorld(world), glbFileName(world.userData.scope));
      button.textContent = LABEL;
    } catch (error) {
      button.textContent = "Export failed";
      button.title = error instanceof Error ? error.message : String(error);
    } finally {
      exporting = false;
      refresh();
    }
  });
  return {
    setWorld(next) {
      world = next;
      button.textContent = LABEL;
      button.title = "";
      refresh();
    },
    setBusy(next) {
      busy = next;
      refresh();
    },
  };
}
