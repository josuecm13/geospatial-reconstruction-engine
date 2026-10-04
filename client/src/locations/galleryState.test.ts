import { describe, expect, it } from "vitest";
import { DEFAULT_GALLERY_STATE, readGalleryState, withGalleryState } from "./galleryState";

describe("readGalleryState", () => {
  it("keeps the name sort", () => {
    expect(readGalleryState({ locations: { scroll: 0, text: "", sort: "name" } }).sort).toBe("name");
  });

  it("is the default for an entry the gallery never wrote", () => {
    expect(readGalleryState(null)).toEqual({ scroll: 0, text: "", sort: "recent" });
    expect(readGalleryState({ other: 1 })).toEqual(DEFAULT_GALLERY_STATE);
    expect(readGalleryState({ locations: "nope" })).toEqual(DEFAULT_GALLERY_STATE);
  });

  it("reads what was saved", () => {
    expect(readGalleryState({ locations: { scroll: 640, text: "berlin", sort: "size" } })).toEqual({ scroll: 640, text: "berlin", sort: "size" });
  });

  it("replaces a bad field with its default and keeps the good ones", () => {
    expect(readGalleryState({ locations: { scroll: -5, text: 7, sort: "alphabetical" } })).toEqual(DEFAULT_GALLERY_STATE);
    expect(readGalleryState({ locations: { scroll: Infinity, text: "x", sort: "size" } })).toEqual({ scroll: 0, text: "x", sort: "size" });
  });
});

describe("withGalleryState", () => {
  it("round-trips through readGalleryState", () => {
    const gallery = { scroll: 120, text: "52.5", sort: "size" as const };

    expect(readGalleryState(withGalleryState(null, gallery))).toEqual(gallery);
  });

  it("keeps the rest of the entry's state", () => {
    expect(withGalleryState({ keep: true }, DEFAULT_GALLERY_STATE)).toEqual({ keep: true, locations: DEFAULT_GALLERY_STATE });
  });
});
