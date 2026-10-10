// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { OSM_COPYRIGHT_URL, REPO_URL, renderFooter } from "./footer";

describe("renderFooter", () => {
  const footer = renderFooter();
  const hrefs = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));

  it("links the locations, the import and the repository", () => {
    expect(hrefs).toEqual(expect.arrayContaining(["/locations", "/explore", REPO_URL]));
  });

  it("credits OpenStreetMap contributors, linking its copyright page", () => {
    expect(footer.textContent).toContain("Map data © OpenStreetMap contributors");
    expect(hrefs).toContain(OSM_COPYRIGHT_URL);
  });

  it("names the stack and keeps the wordmark out of the accessibility tree", () => {
    expect(footer.textContent).toContain("PostGIS · FastAPI · MapLibre · Three.js");
    expect(footer.querySelector(".landing-wordmark")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens only the external links in a new tab", () => {
    for (const a of footer.querySelectorAll("a")) {
      const external = a.getAttribute("href")!.startsWith("https://");
      expect(a.target === "_blank").toBe(external);
    }
  });
});
