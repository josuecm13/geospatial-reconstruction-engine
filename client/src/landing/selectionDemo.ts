import { IMPORT_STAGES } from "../api/types";
import { svg } from "./svg";

const W = 480;
const H = 300;
const RECT = { x: 48, y: 36, width: 384, height: 228 };

/** The stages the server streams while an import builds, in order (the failure event is not a stage of a good build). */
export const TICKER_STAGES = IMPORT_STAGES.filter((stage) => stage !== "failed");

/**
 * The call to action's picture: a dashed selection rectangle, the map's rectangle tool in miniature, that draws itself
 * as it scrolls into view with its corner handles and an area that counts up, and under it the import stages ticking
 * through as `✓ fetched → ✓ ground → ...`. All motion is CSS (style.css), so with reduced motion it is the finished picture.
 */
export function selectionDemo(): HTMLElement {
  const root = document.createElement("div");
  root.className = "landing-cta-demo";

  const canvas = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "cta-svg", "aria-hidden": "true" });
  const mask = svg("mask", { id: "cta-draw", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H });
  mask.append(svg("rect", { ...RECT, pathLength: 1, class: "cta-mask-line" }));
  canvas.append(
    svg("defs"),
    svg("rect", { ...RECT, class: "cta-fill" }),
    svg("rect", { ...RECT, class: "cta-rect", mask: "url(#cta-draw)" }),
  );
  canvas.querySelector("defs")!.append(mask);
  // The buildable blocks the engine would find inside: three by two, with the streets between them.
  const gap = 16;
  const blockW = (RECT.width - 4 * gap) / 3;
  const blockH = (RECT.height - 3 * gap) / 2;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const x = RECT.x + gap + col * (blockW + gap);
      const y = RECT.y + gap + row * (blockH + gap);
      canvas.append(svg("rect", { x, y, width: blockW, height: blockH, rx: 3, class: "cta-block", style: `--k:${row * 3 + col}` }));
    }
  }
  for (const [x, y] of [[RECT.x, RECT.y], [RECT.x + RECT.width, RECT.y], [RECT.x, RECT.y + RECT.height], [RECT.x + RECT.width, RECT.y + RECT.height]]) {
    canvas.append(svg("rect", { x: x - 5, y: y - 5, width: 10, height: 10, rx: 2, class: "cta-handle" }));
  }

  const area = document.createElement("span");
  area.className = "cta-area";
  area.setAttribute("aria-label", "0.98 square kilometres");

  const stages = document.createElement("ol");
  stages.className = "cta-stages";
  stages.setAttribute("aria-label", `The import stages: ${TICKER_STAGES.join(", ")}`);
  TICKER_STAGES.forEach((stage, i) => {
    const item = document.createElement("li");
    item.className = "cta-stage";
    item.style.setProperty("--k", String(i));
    item.textContent = stage;
    stages.append(item);
  });

  const frame = document.createElement("div");
  frame.className = "cta-frame";
  frame.append(canvas, area);
  root.append(frame, stages);
  return root;
}
