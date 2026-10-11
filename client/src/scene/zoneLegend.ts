import { legendReasons, ZONE_LABELS } from "./blockInfo";
import { zoneColor } from "./palette";

export interface ZoneLegend {
  /** The zone reasons the world on show has (none for a world without a run); the legend lists just those. */
  setReasons(reasons: Iterable<string>): void;
  /** Shown only while "Show blocks" is on and there is something to list. */
  setVisible(visible: boolean): void;
}

/** A small legend of the generation zones' colours, in `container`. */
export function createZoneLegend(container: HTMLElement): ZoneLegend {
  const root = Object.assign(document.createElement("ul"), { className: "zone-legend", hidden: true });
  root.setAttribute("aria-label", "Generation zones");
  container.appendChild(root);
  let visible = false;
  let reasons: string[] = [];

  const render = () => {
    root.replaceChildren(
      ...legendReasons(reasons).map((reason) => {
        const item = document.createElement("li");
        const swatch = Object.assign(document.createElement("span"), { className: "zone-swatch" });
        swatch.style.background = zoneColor(reason);
        item.append(swatch, ZONE_LABELS[reason]);
        return item;
      }),
    );
    root.hidden = !visible || !root.childElementCount;
  };

  return {
    setReasons(next) {
      reasons = [...next];
      render();
    },
    setVisible(value) {
      visible = value;
      render();
    },
  };
}
