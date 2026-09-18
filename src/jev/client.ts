import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { ComplexityFacts } from "../harness/complexity";
import type { SourceUnit } from "../harness/discover";
import type { UnitGraph } from "../harness/graph";
import type { FileHistory } from "../harness/history";
import { wideQuestions, type WideAnswers } from "./questions";

export interface ReviewerOptions {
  apiKey?: string;
  model?: string;
}

export interface UnitReview {
  model: string;
  answers: WideAnswers;
  usage: { input_tokens: number; output_tokens: number };
}

export interface Reviewer {
  model: string;
  review(
    unit: SourceUnit,
    graph: UnitGraph,
    history: FileHistory | null,
    complexity: ComplexityFacts,
  ): Promise<UnitReview>;
}

const DEPENDENT_SAMPLE = 20;

export function createReviewer(options: ReviewerOptions = {}): Reviewer {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model,
  });

  return {
    model: client.defaultModel,
    async review(
      unit: SourceUnit,
      graph: UnitGraph,
      history: FileHistory | null,
      complexity: ComplexityFacts,
    ): Promise<UnitReview> {
      const result = await client.systemOne({
        state: {
          unit: {
            path: unit.relPath,
            kind: unit.kind,
            lines: unit.lines,
            content: unit.content,
            imports: graph.imports,
            fan_in: graph.fanIn,
            fan_out: graph.fanOut,
            dependents: graph.dependents.slice(0, DEPENDENT_SAMPLE),
            exports: graph.exports,
            complexity: {
              functions: complexity.functions,
              total_cyclomatic: complexity.totalCyclomatic,
              max_cyclomatic: complexity.maxCyclomatic,
              max_nesting: complexity.maxNesting,
              max_function_lines: complexity.maxFunctionLines,
            },
            history: history
              ? {
                  commits: history.commits,
                  recent_commits: history.recentCommits,
                  authors: history.authors,
                  primary_author_share: round(history.primaryAuthorShare),
                  bug_fix_commits: history.bugFixCommits,
                  last_modified: history.lastModified,
                  coupled_with: history.couplings.map((coupling) => coupling.path),
                }
              : null,
          },
        },
        questions: wideQuestions,
        model: options.model,
      });

      return {
        model: result.model,
        answers: result.answers,
        usage: result.usage,
      };
    },
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
