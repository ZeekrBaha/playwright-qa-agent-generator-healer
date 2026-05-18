import prices from './prices.json' with { type: 'json' };

export interface ModelPrice {
  in: number; // USD per 1M input tokens
  out: number; // USD per 1M output tokens
  cachedIn: number; // USD per 1M cached input tokens
}

const TABLE = prices as Record<string, ModelPrice>;

export function priceFor(modelId: string): ModelPrice | null {
  const p = TABLE[modelId];
  if (!p) {
    console.warn(
      `[veriplay] Unknown model "${modelId}" — cost tracking disabled for this run. ` +
        `Add it to src/agent/prices.json (verify at https://openai.com/api/pricing).`,
    );
    return null;
  }
  return p;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export function computeCost(modelId: string, usage: TokenUsage): number | null {
  const p = priceFor(modelId);
  if (!p) return null;
  return (
    (usage.inputTokens * p.in +
      usage.outputTokens * p.out +
      usage.cachedTokens * p.cachedIn) /
    1_000_000
  );
}
