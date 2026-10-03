import type { Mount } from "./types";

/** Placeholder: the landing page proper is brief 14. */
export const mount: Mount<{ page: "landing" }> = (el) => {
  el.innerHTML = `
    <div class="page">
      <h2>Geospatial Reconstruction Engine</h2>
      <p><a data-link href="/locations">Browse locations</a></p>
    </div>`;
  return () => {};
};
