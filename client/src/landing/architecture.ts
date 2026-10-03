import { EDGES, STAGES, type Stage } from "./architectureModel";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_W = 210;
const NODE_H = 64;
const GAP_X = 56;
const GAP_Y = 44;
const PAD = 12;

export interface Placement {
  x: number;
  y: number;
}

/** Where each stage sits when the diagram wraps after `columns` stages, in pipeline order, plus the drawing's size. */
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

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
};

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
  const marker = svg("marker", { id: "arch-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto" });
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
    const title = svg("text", { x: x + NODE_W / 2, y: y + 28, class: "arch-title", "text-anchor": "middle" });
    title.textContent = stage.title;
    const caption = svg("text", { x: x + NODE_W / 2, y: y + 48, class: "arch-caption", "text-anchor": "middle" });
    caption.textContent = stage.caption;
    node.append(svg("rect", { x, y, width: NODE_W, height: NODE_H, rx: 10 }), title, caption);

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

/** Fills `card` with a stage: what it produces and a link to its doc (or the hint, with no stage chosen). */
function fillCard(card: HTMLElement, stage: Stage | null): void {
  if (!stage) {
    card.replaceChildren(Object.assign(document.createElement("p"), { className: "arch-hint", textContent: "Hover, focus or tap a stage to see what it produces." }));
    return;
  }
  const heading = Object.assign(document.createElement("h3"), { textContent: stage.title });
  const sub = Object.assign(document.createElement("p"), { className: "arch-sub", textContent: "Produces" });
  const list = document.createElement("ul");
  for (const line of stage.produces) list.append(Object.assign(document.createElement("li"), { textContent: line }));
  const doc = Object.assign(document.createElement("a"), {
    href: stage.docHref,
    target: "_blank",
    rel: "noopener",
    textContent: `${stage.docLabel} in the docs`,
  });
  card.replaceChildren(heading, sub, list, doc);
}

/**
 * Draws the interactive pipeline diagram into `root` and returns the function that removes it.
 * The diagram wraps in three columns, or stacks in one on a phone; the side card follows the stage
 * that was last hovered, focused, or tapped.
 */
export function renderArchitecture(root: HTMLElement): () => void {
  const figure = Object.assign(document.createElement("div"), { className: "arch-figure" });
  const card = Object.assign(document.createElement("aside"), { className: "arch-card" });
  card.setAttribute("aria-live", "polite");
  root.replaceChildren(figure, card);

  const narrow = window.matchMedia("(max-width: 719px)");
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
    figure.replaceChildren(drawDiagram(narrow.matches ? 1 : 3, select, selected?.id ?? null));
    if (selected) figure.querySelector(`[data-stage="${selected.id}"]`)?.classList.add("is-active");
  };
  narrow.addEventListener("change", draw);
  draw();
  fillCard(card, null);

  return () => {
    narrow.removeEventListener("change", draw);
    root.replaceChildren();
  };
}
