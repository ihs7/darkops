import type { WideAnswers } from "./questions";

export interface PolicyConfig {
  scale: number;
  uncertainFloor: number;
  driverCount: number;
  weights: {
    criticality: number;
    blastRadius: number;
    changeRisk: number;
    lowCohesion: number;
    churn: number;
    defect: number;
    complexity: number;
  };
}

export const policy: PolicyConfig = {
  scale: 3,
  uncertainFloor: 0.5,
  driverCount: 2,
  weights: {
    criticality: 1.2,
    blastRadius: 1.2,
    changeRisk: 0.8,
    lowCohesion: 0.6,
    churn: 1.0,
    defect: 1.0,
    complexity: 1.0,
  },
};

export interface JevSignals {
  criticality: number;
  blastRadius: number;
  cohesion: number;
  changeRisk: number;
  confidence: number;
  uncertain?: string[];
}

export interface ComputedSignals {
  churn: number;
  defect: number;
  complexity: number;
}

export interface UnitSignals extends JevSignals, ComputedSignals {}

export interface ScoredUnit {
  priority: number;
  confidence: number;
  drivers: string[];
  uncertain: string[];
  signals: UnitSignals;
}

export function extractSignals(answers: WideAnswers, config: PolicyConfig = policy): JevSignals {
  const dimensions = [
    {
      key: "criticality",
      confidence: answers.criticality.confidence,
      weight: config.weights.criticality,
    },
    {
      key: "blast_radius",
      confidence: answers.blast_radius.confidence,
      weight: config.weights.blastRadius,
    },
    {
      key: "cohesion",
      confidence: answers.cohesion.confidence,
      weight: config.weights.lowCohesion,
    },
    {
      key: "change_risk",
      confidence: answers.change_risk.confidence,
      weight: config.weights.changeRisk,
    },
  ];

  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const confidence =
    dimensions.reduce((sum, dimension) => sum + dimension.weight * dimension.confidence, 0) /
    totalWeight;

  return {
    criticality: answers.criticality.score,
    blastRadius: answers.blast_radius.score,
    cohesion: answers.cohesion.score,
    changeRisk: answers.change_risk.score,
    confidence,
    uncertain: dimensions
      .filter((dimension) => dimension.confidence < config.uncertainFloor)
      .map((dimension) => dimension.key),
  };
}

export function scoreSignals(signals: UnitSignals, config: PolicyConfig = policy): ScoredUnit {
  const { weights, scale } = config;
  const factors = [
    {
      key: "criticality",
      weight: weights.criticality,
      value: clamp01(signals.criticality / scale),
    },
    {
      key: "blast_radius",
      weight: weights.blastRadius,
      value: clamp01(signals.blastRadius / scale),
    },
    { key: "change_risk", weight: weights.changeRisk, value: clamp01(signals.changeRisk / scale) },
    {
      key: "low_cohesion",
      weight: weights.lowCohesion,
      value: clamp01((scale - signals.cohesion) / scale),
    },
    { key: "churn", weight: weights.churn, value: clamp01(signals.churn / scale) },
    { key: "defect_history", weight: weights.defect, value: clamp01(signals.defect / scale) },
    { key: "complexity", weight: weights.complexity, value: clamp01(signals.complexity / scale) },
  ];

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const weighted = factors.reduce((sum, factor) => sum + factor.weight * factor.value, 0);
  const priority = Math.round((weighted / totalWeight) * 1000) / 10;

  const drivers =
    weighted === 0
      ? []
      : factors
          .map((factor) => ({ key: factor.key, share: (factor.weight * factor.value) / weighted }))
          .filter((factor) => factor.share > 0)
          .sort((a, b) => b.share - a.share)
          .slice(0, config.driverCount)
          .map((factor) => factor.key);

  return {
    priority,
    confidence: signals.confidence,
    drivers,
    uncertain: signals.uncertain ?? [],
    signals,
  };
}

export function scoreUnit(
  answers: WideAnswers,
  computed: ComputedSignals,
  config: PolicyConfig = policy,
): ScoredUnit {
  return scoreSignals({ ...extractSignals(answers, config), ...computed }, config);
}

export function percentileRanks(values: readonly number[]): number[] {
  const count = values.length;
  if (count === 0) return [];
  if (count === 1) return [0];

  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const lowest = order[0];
  const highest = order[count - 1];
  if (lowest && highest && lowest.value === highest.value) {
    return Array.from({ length: count }, () => 0);
  }

  const ranks: number[] = Array.from({ length: count }, () => 0);
  let i = 0;
  while (i < count) {
    let j = i;
    while (j + 1 < count && order[j + 1]?.value === order[i]?.value) j += 1;
    const average = (i + j) / 2 / (count - 1);
    for (let k = i; k <= j; k += 1) {
      const target = order[k];
      if (target) ranks[target.index] = average;
    }
    i = j + 1;
  }
  return ranks;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
