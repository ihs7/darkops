import { choice, score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { CompiledNode } from "../map/compile";
import {
  STOP,
  type RelevanceJudgment,
  type RankOptions,
  type ScoreRelevance,
  type StepChoice,
} from "../map/search";
import type { Candidate } from "../map/strategies";
import { navKey, readNav, writeNav, type NavCache } from "../state/nav-cache";

const CHILD_SAMPLE = 10;
const EXPORT_SAMPLE = 8;
const RELEVANCE_SCALE = 3;

const RELEVANCE_RUBRIC = [
  "Unrelated: the intent does not concern this file at all",
  "Tangential: same area or a shared concept, but not what the intent targets",
  "Relevant: this file is part of what the intent is about",
  "Direct: this file is the specific place the intent refers to",
] as const;

export interface NavigatorOptions {
  apiKey?: string;
  model?: string;
  cache?: NavCache;
}

export interface Navigator {
  model: string;
  rank: RankOptions;
  score: ScoreRelevance;
}

interface CachedScore {
  judgments: Array<[string, RelevanceJudgment]>;
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

export function createNavigator(options: NavigatorOptions = {}): Navigator {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model,
  });
  const model = client.defaultModel;
  const cache = options.cache;

  return {
    model,
    async rank(intent, node, candidates) {
      const criteria: Record<string, string> = {};
      for (const candidate of present(candidates)) {
        criteria[candidate.node.path] = describeCandidate(candidate, node.depth);
      }
      criteria[STOP] = "No option is relevant enough to the intent; stop the search.";

      const key = navKey("rank", model, intent, criteria);
      const cached = cache ? readNav<StepChoice>(cache, key) : undefined;
      if (cached) return { ...cached, usage: { ...NO_USAGE } };

      const result = await client.systemOne({
        state: {
          intent,
          area: describeArea(node),
        },
        questions: {
          next: choice(
            "Given `intent`, which option should be investigated next? Choose the option most relevant to the intent, or `__stop__` if none is relevant.",
            criteria,
          ),
        },
        model: options.model,
      });

      const answer = result.answers.next;
      const probabilities: Record<string, number> = {};
      for (const candidate of candidates) {
        probabilities[candidate.node.path] = answer.probabilities[candidate.node.path] ?? 0;
      }

      const chosen =
        answer.choice === STOP || probabilities[answer.choice] === undefined ? STOP : answer.choice;

      const decision: StepChoice = {
        probabilities,
        choice: chosen,
        confidence: answer.confidence,
        usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
      };
      if (cache) writeNav(cache, key, model, decision);
      return decision;
    },
    async score(intent, paths) {
      const key = navKey("score", model, intent, paths);
      const cached = cache ? readNav<CachedScore>(cache, key) : undefined;
      if (cached) return { judgments: new Map(cached.judgments), usage: { ...NO_USAGE } };

      const questions: Record<string, ReturnType<typeof score>> = {};
      const keyToPath = new Map<string, string>();
      paths.forEach((path, index) => {
        const questionKey = `relevance_${index}`;
        keyToPath.set(questionKey, path);
        questions[questionKey] = score(
          `How relevant is the file "${path}" to \`intent\`? Judge how likely this is the place the intent refers to; ignore how risky or high-priority the file is.`,
          RELEVANCE_RUBRIC,
        );
      });

      const result = await client.systemOne({
        state: { intent },
        questions,
        model: options.model,
      });

      const judgments = new Map<string, RelevanceJudgment>();
      for (const [questionKey, path] of keyToPath) {
        const answer = result.answers[questionKey];
        if (!answer) continue;
        judgments.set(path, {
          relevance: clamp01(answer.score / RELEVANCE_SCALE),
          confidence: answer.confidence,
        });
      }

      if (cache) writeNav(cache, key, model, { judgments: [...judgments] } satisfies CachedScore);
      return {
        judgments,
        usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
      };
    },
  };
}

export function describeCandidate(candidate: Candidate, areaDepth: number): string {
  const node = candidate.node;
  const symbols = exportedSymbols(node);
  if (candidate.strategy !== "descend") {
    return `related file ${node.path}${symbols} — ${candidate.relation}`;
  }
  const offset = node.depth - areaDepth;
  const where = offset <= 1 ? "child" : `${offset} levels down`;
  if (node.kind === "unit") return `${where} file ${node.path}${symbols}`;
  return `${where} area ${node.path} (${node.units} files: ${childNames(node)})`;
}

export function present(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => a.node.path.localeCompare(b.node.path));
}

function exportedSymbols(node: CompiledNode): string {
  if (node.exports.length === 0) return "";
  const shown = node.exports.slice(0, EXPORT_SAMPLE);
  const more = node.exports.length > shown.length ? ", …" : "";
  return ` (exports: ${shown.join(", ")}${more})`;
}

function describeArea(node: CompiledNode): string {
  if (!node.path) return `repository root (${node.units} files)`;
  return `${node.path} (${node.units} files)`;
}

function childNames(node: CompiledNode): string {
  const names = node.children.map(lastSegment).slice(0, CHILD_SAMPLE);
  const more = node.children.length > names.length ? ", …" : "";
  return `${names.join(", ")}${more}`;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
