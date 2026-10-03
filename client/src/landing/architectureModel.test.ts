import { describe, expect, it } from "vitest";
import { EDGES, STAGES, stageById } from "./architectureModel";

describe("the architecture model", () => {
  it("has six stages with unique ids", () => {
    expect(STAGES).toHaveLength(6);
    expect(new Set(STAGES.map((stage) => stage.id)).size).toBe(6);
  });

  it("starts at Overpass and ends at the client", () => {
    expect(STAGES.map((stage) => stage.id)).toEqual(["overpass", "ingestion", "domain", "derivation", "api", "client"]);
  });

  it("has every edge join two existing stages", () => {
    for (const edge of EDGES) {
      expect(stageById(edge.from)).toBeDefined();
      expect(stageById(edge.to)).toBeDefined();
    }
  });

  it("connects the stages in pipeline order, one edge to the next", () => {
    expect(EDGES).toHaveLength(STAGES.length - 1);
    EDGES.forEach((edge, i) => {
      expect(edge.from).toBe(STAGES[i].id);
      expect(edge.to).toBe(STAGES[i + 1].id);
    });
  });

  it("gives every stage something it produces and a doc link to the repository", () => {
    for (const stage of STAGES) {
      expect(stage.produces.length).toBeGreaterThan(0);
      expect(stage.docHref).toMatch(/^https:\/\/github\.com\/josuecm13\/geospatial-reconstruction-engine\/blob\/main\/docs\/.+\.md/);
      expect(stage.docLabel).not.toBe("");
    }
  });

  it("looks a stage up by id", () => {
    expect(stageById("api")?.title).toBe("HTTP API");
    expect(stageById("nope")).toBeUndefined();
  });
});
