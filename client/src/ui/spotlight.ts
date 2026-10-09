/** Where a pointer is inside a box, in CSS pixels from the box's top-left corner (negative or past the size when outside it). */
export function pointInBox(box: { left: number; top: number }, clientX: number, clientY: number): { x: number; y: number } {
  return { x: clientX - box.left, y: clientY - box.top };
}

/**
 * The cursor spotlight: one delegated `pointermove` listener on `root` sets `--x` and `--y` (px, relative to the card)
 * on the card under the pointer, at most once per animation frame. The CSS (`style.css`, under `hover: hover`) paints
 * a radial gradient at that point on `:hover`. Returns the disposer; call it when the page unmounts.
 */
export function attachSpotlight(root: HTMLElement, selector: string): () => void {
  let pending: { card: HTMLElement; clientX: number; clientY: number } | null = null;
  let frame = 0;

  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { card, clientX, clientY } = pending;
    pending = null;
    const { x, y } = pointInBox(card.getBoundingClientRect(), clientX, clientY);
    card.style.setProperty("--x", `${x}px`);
    card.style.setProperty("--y", `${y}px`);
  };

  const onMove = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest?.<HTMLElement>(selector);
    if (!card || !root.contains(card)) return;
    pending = { card, clientX: event.clientX, clientY: event.clientY };
    if (!frame) frame = requestAnimationFrame(flush);
  };

  root.addEventListener("pointermove", onMove, { passive: true });
  return () => {
    root.removeEventListener("pointermove", onMove);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = null;
  };
}
