import type { Mount } from "./types";

export const mount: Mount<{ page: "not-found"; path: string }> = (el, ctx) => {
  const page = document.createElement("div");
  page.className = "page";
  const heading = Object.assign(document.createElement("h2"), { textContent: "Page not found" });
  const message = Object.assign(document.createElement("p"), { textContent: `There is no page at ${ctx.route.path}.` });
  const links = document.createElement("p");
  for (const [href, text] of [["/", "Go to the start"], ["/locations", "Browse locations"]] as const) {
    const link = Object.assign(document.createElement("a"), { href, textContent: text });
    link.dataset.link = "";
    links.append(link, " ");
  }
  page.append(heading, message, links);
  el.replaceChildren(page);
  return () => {};
};
