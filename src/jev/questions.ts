import { score, type SystemOneResult } from "@typesafe-ai/sdk";

export const wideQuestions = {
  criticality: score(
    "Based on `unit.content`, how critical is this unit to the product's core behavior?",
    [
      "Local: tooling, scripts, examples, or docs-adjacent code that no user behavior depends on",
      "Supporting: helpers, config, or integration glue whose failure degrades but does not break a feature",
      "Important: a feature users depend on; a bug here is visible and disruptive",
      "Core: central domain behavior; a bug here breaks the product's main flow or data",
    ],
  ),
  blast_radius: score(
    "Given that `unit.fan_in` files depend on `unit.content` and it imports `unit.fan_out` others, if a serious bug shipped here, how far would the damage spread?",
    [
      "Contained: only this unit is affected",
      "Limited: a few direct dependents or a single subsystem",
      "Broad: many dependents or a widely shared path",
      "Systemic: spans subsystems or affects critical flows",
    ],
  ),
  cohesion: score("How focused is `unit.content` on a single responsibility?", [
    "Unfocused: several unrelated responsibilities that change for different reasons",
    "Loose: a primary responsibility plus unrelated additions",
    "Mostly focused: one responsibility with minor incidental code",
    "Focused: a single responsibility; everything here changes together",
  ]),
  change_risk: score(
    "Given `unit.history.recent_commits` recent commits and `unit.history.bug_fix_commits` bug fixes, how risky is it to change `unit.content`?",
    [
      "Low: small, local, and obvious to verify",
      "Moderate: some coupling or subtle branching",
      "High: intricate control flow or widely depended-on behavior",
      "Severe: fragile, critical, or poorly understood by the current authors",
    ],
  ),
};

export type WideAnswers = SystemOneResult<typeof wideQuestions>["answers"];
