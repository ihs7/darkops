export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

const DEFAULT_PRICE: ModelPrice = { inputPerMillion: 0.042, outputPerMillion: 0 };

const PRICES: Record<string, ModelPrice> = {
  "jev-1.13.0": DEFAULT_PRICE,
  "jev-latest": DEFAULT_PRICE,
  "jev-preview": DEFAULT_PRICE,
};

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? DEFAULT_PRICE;
}

export function estimateCost(usage: TokenUsage, model: string): number {
  const price = priceFor(model);
  return (
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion
  );
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(5)}`;
  return `$${amount.toFixed(4)}`;
}

export function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}
