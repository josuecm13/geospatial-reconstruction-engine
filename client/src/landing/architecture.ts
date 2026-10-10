import { docPath, EDGES, STAGES, stageNumber, type Stage } from "./architectureModel";
import { svg } from "./svg";

const NODE_W = 176;
const NODE_H = 52;
const GAP_X = 36;
const GAP_Y = 44;
const PAD = 12;

export interface Placement {
  x: number;
  y: number;
}

/** Where each stage sits when the diagram wraps after `columns` stages, in pipeline order, plus the drawing's size. Six columns is one line. */
export function layout(columns: number): { positions: Placement[]; width: number; height: number } {
  const rows = Math.ceil(STAGES.length / columns);
  return {
    positions: STAGES.map((_, i) => ({
      x: PAD + (i % columns) * (NODE_W + GAP_X),
      y: PAD + Math.floor(i / columns) * (NODE_H + GAP_Y),
    })),
    width: 2 * PAD + columns * NODE_W + (columns - 1) * GAP_X,
    height: 2 * PAD + rows * NODE_H + (rows - 1) * GAP_Y,
  };
}

/** The arrow from one stage to the next: straight along a row, an elbow when the next stage is on another row. */
function edgePath(from: Placement, to: Placement): string {
  if (from.y === to.y) return `M ${from.x + NODE_W} ${from.y + NODE_H / 2} H ${to.x}`;
  const midY = from.y + NODE_H + GAP_Y / 2;
  return `M ${from.x + NODE_W / 2} ${from.y + NODE_H} V ${midY} H ${to.x + NODE_W / 2} V ${to.y}`;
}

function drawDiagram(columns: number, onSelect: (stage: Stage) => void, selectedId: string | null): SVGSVGElement {
  const { positions, width, height } = layout(columns);
  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "group",
    "aria-label": "The pipeline from OpenStreetMap to this client, as six stages",
    class: "arch-diagram",
  });
  root.style.maxWidth = `${width}px`;

  const defs = svg("defs");
  const marker = svg("marker", { id: "arch-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto" });
  marker.append(svg("path", { d: "M 0 1 L 10 5 L 0 9 z", class: "arch-arrowhead" }));
  defs.append(marker);
  root.append(defs);

  const index = new Map(STAGES.map((stage, i) => [stage.id, i]));
  for (const edge of EDGES) {
    root.append(svg("path", { d: edgePath(positions[index.get(edge.from)!], positions[index.get(edge.to)!]), class: "arch-edge", "marker-end": "url(#arch-arrow)" }));
  }

  STAGES.forEach((stage, i) => {
    const { x, y } = positions[i];
    const node = svg("g", {
      role: "button",
      tabindex: 0,
      class: "arch-stage",
      "data-stage": stage.id,
      "aria-label": `${stage.title}: ${stage.caption}. Show what it produces.`,
      "aria-pressed": String(stage.id === selectedId),
    });
    const number = svg("text", { x: x + 22, y: y + NODE_H / 2, class: "arch-number", "dominant-baseline": "central" });
    number.textContent = stageNumber(stage.id);
    const title = svg("text", { x: x + 50, y: y + NODE_H / 2, class: "arch-title", "dominant-baseline": "central" });
    title.textContent = stage.title;
    node.append(svg("rect", { x, y, width: NODE_W, height: NODE_H, rx: NODE_H / 2 }), number, title);

    const choose = () => onSelect(stage);
    node.addEventListener("mouseenter", choose);
    node.addEventListener("focus", choose);
    node.addEventListener("click", choose);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
    root.append(node);
  });
  return root;
}

/** Fills `card`, a terminal panel, with a stage: `$ stage 03 · PostGIS domain`, what it produces as `→` lines, a caret, and its doc as a path. */
function fillCard(card: HTMLElement, stage: Stage | null): void {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] =>
    Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) });
  const caret = () => make("span", "arch-caret");
  if (!stage) {
    const hint = make("p", "arch-hint", "hover, focus or tap a stage to see what it produces");
    hint.prepend(make("span", "arch-prompt", "$ "));
    hint.append(caret());
    card.replaceChildren(hint);
    return;
  }
  const heading = make("h3", "arch-cmd", `stage ${stageNumber(stage.id)} · ${stage.title}`);
  heading.prepend(make("span", "arch-prompt", "$ "));
  const list = make("ul", "arch-out");
  for (const line of stage.produces) list.append(make("li", "arch-line", line));
  list.lastElementChild?.append(caret());
  const doc = Object.assign(make("a", "arch-doc", docPath(stage)), { href: stage.docHref, target: "_blank", rel: "noopener" });
  card.replaceChildren(heading, list, doc);
}

/**
 * Draws the interactive pipeline diagram into `root` and returns the function that removes it.
 * The diagram is one line, wraps in three columns on a tablet, or stacks in one on a phone; the side card follows the stage
 * that was last hovered, focused, or tapped.
 */
export function renderArchitecture(root: HTMLElement): () => void {
  const figure = Object.assign(document.createElement("div"), { className: "arch-figure" });
  const card = Object.assign(document.createElement("aside"), { className: "arch-card" });
  card.setAttribute("aria-live", "polite");
  root.replaceChildren(figure, card);

  const narrow = window.matchMedia("(max-width: 719px)");
  const medium = window.matchMedia("(max-width: 1019px)");
  let selected: Stage | null = null;

  const select = (stage: Stage) => {
    if (selected?.id === stage.id) return;
    selected = stage;
    fillCard(card, stage);
    for (const node of figure.querySelectorAll<SVGGElement>(".arch-stage")) {
      const on = node.dataset.stage === stage.id;
      node.classList.toggle("is-active", on);
      node.setAttribute("aria-pressed", String(on));
    }
  };
  const draw = () => {
    figure.replaceChildren(drawDiagram(narrow.matches ? 1 : medium.matches ? 3 : 6, select, selected?.id ?? null));
    if (selected) figure.querySelector(`[data-stage="${selected.id}"]`)?.classList.add("is-active");
  };
  narrow.addEventListener("change", draw);
  medium.addEventListener("change", draw);
  draw();
  fillCard(card, null);

  return () => {
    narrow.removeEventListener("change", draw);
    medium.removeEventListener("change", draw);
    root.replaceChildren();
  };
}
