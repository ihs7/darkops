import { choice, noul, TypeSafeClient, type Question } from "@typesafe-ai/sdk";
import type { ToolDefinition } from "../tools/registry";

export const NO_TOOL = "__none__";
const STATED = "?";

export interface ToolCall {
  name: string;
  arguments: Record<string, string>;
  confidence: number;
}

export interface ArgPlan {
  arg: string;
  required: boolean;
  values: string[];
}

export interface DispatchPlan {
  questions: Record<string, Question>;
  args: Record<string, ArgPlan[]>;
}

interface RawAnswer {
  choice?: string;
  confidence?: number;
  noul?: number;
}

type RawAnswers = Record<string, RawAnswer>;

export function buildDispatchPlan(tools: ToolDefinition[]): DispatchPlan {
  const toolCriteria: Record<string, string> = {};
  for (const tool of tools) toolCriteria[tool.name] = tool.description;
  toolCriteria[NO_TOOL] = "No tool fits the intent.";

  const questions: Record<string, Question> = {
    __tool__: choice(
      "Which tool should run to answer `intent`? Choose `__none__` if no tool fits.",
      toolCriteria,
    ),
  };
  const args: Record<string, ArgPlan[]> = {};

  for (const tool of tools) {
    const required = new Set(tool.inputSchema.required ?? []);
    args[tool.name] = [];

    for (const [arg, entries] of Object.entries(tool.choices)) {
      const criteria: Record<string, string> = {};
      for (const entry of entries) criteria[entry.value] = entry.description;
      const isRequired = required.has(arg);
      if (!isRequired) criteria[NO_TOOL] = "Not specified.";

      questions[`${tool.name}.${arg}`] = choice(
        `For the ${tool.name} tool, which ${arg} does \`intent\` point at?`,
        criteria,
      );
      if (!isRequired) {
        questions[`${tool.name}.${arg}${STATED}`] = noul(
          `Does \`intent\` indicate a ${arg} for ${tool.name}?`,
        );
      }

      args[tool.name]?.push({ arg, required: isRequired, values: entries.map((e) => e.value) });
    }
  }

  return { questions, args };
}

export function readToolCall(plan: DispatchPlan, answers: RawAnswers): ToolCall | null {
  const toolAnswer = answers.__tool__;
  if (!toolAnswer?.choice || toolAnswer.choice === NO_TOOL) return null;

  const name = toolAnswer.choice;
  const argPlans = plan.args[name];
  if (!argPlans) return null;

  const callArgs: Record<string, string> = {};
  const confidences = [toolAnswer.confidence ?? 0];

  for (const argPlan of argPlans) {
    if (!argPlan.required && (answers[`${name}.${argPlan.arg}${STATED}`]?.noul ?? 0) < 0.5) {
      continue;
    }

    const answer = answers[`${name}.${argPlan.arg}`];
    const value = answer?.choice;
    if (!value || value === NO_TOOL || !argPlan.values.includes(value)) continue;

    callArgs[argPlan.arg] = value;
    if (answer?.confidence !== undefined) confidences.push(answer.confidence);
  }

  return { name, arguments: callArgs, confidence: Math.min(...confidences) };
}

export interface DispatcherOptions {
  apiKey?: string;
  model?: string;
}

export interface DispatchResult {
  call: ToolCall | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface Dispatcher {
  model: string;
  dispatch(intent: string, tools: ToolDefinition[]): Promise<DispatchResult>;
}

export function createDispatcher(options: DispatcherOptions = {}): Dispatcher {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model,
  });

  return {
    model: client.defaultModel,
    async dispatch(intent, tools) {
      const plan = buildDispatchPlan(tools);
      const result = await client.systemOne({
        state: { intent },
        questions: plan.questions,
        model: options.model,
      });

      return {
        call: readToolCall(plan, result.answers as unknown as RawAnswers),
        model: result.model,
        usage: {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        },
      };
    },
  };
}
