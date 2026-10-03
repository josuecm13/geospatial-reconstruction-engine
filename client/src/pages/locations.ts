import type { Mount } from "./types";

/** Placeholder: the locations gallery is brief 15. */
export const mount: Mount<{ page: "locations" }> = (el) => {
  el.innerHTML = `
    <div class="page">
      <h2>Locations</h2>
      <p><a data-link href="/">Back to the start</a></p>
    </div>`;
  return () => {};
};
