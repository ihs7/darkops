import { describe, expect, test } from "bun:test";
import { scoreSignals, type UnitSignals } from "../src/jev/policy";

const healthy: UnitSignals = {
  criticality: 0,
  blastRadius: 0,
  cohesion: 3,
  changeRisk: 0,
  churn: 0,
  defect: 0,
  complexity: 0,
  confidence: 0.9,
};

describe("scoreSignals", () => {
  test("a healthy unit scores low with no drivers", () => {
    const scored = scoreSignals(healthy);
    expect(scored.priority).toBeLessThan(10);
    expect(scored.drivers).toEqual([]);
  });

  test("a critical, high-blast unit outranks a peripheral one", () => {
    const risky = scoreSignals({
      ...healthy,
      criticality: 3,
      blastRadius: 3,
      changeRisk: 3,
      cohesion: 0,
    });
    const safe = scoreSignals({ ...healthy, criticality: 1 });

    expect(risky.priority).toBeGreaterThan(safe.priority);
    expect(risky.drivers).toContain("criticality");
    expect(risky.drivers).toContain("blast_radius");
  });

  test("drivers reflect contribution share, not a fixed threshold", () => {
    const scored = scoreSignals({ ...healthy, criticality: 3 });
    expect(scored.drivers).toEqual(["criticality"]);
  });

  test("keeps Jev confidence as the confidence signal", () => {
    expect(scoreSignals({ ...healthy, confidence: 0.2 }).confidence).toBe(0.2);
    expect(scoreSignals(healthy).confidence).toBe(0.9);
  });

  test("surfaces uncertain dimensions", () => {
    const scored = scoreSignals({ ...healthy, uncertain: ["blast_radius"] });
    expect(scored.uncertain).toEqual(["blast_radius"]);
  });
});
