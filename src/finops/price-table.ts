import { type ModelRef, type ProviderName, type TokenUsage } from '../llm/llm.types';

/** USD per 1M tokens. */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
  /** Price for prompt tokens served from the provider's prompt cache. */
  cachedInputPer1M?: number;
}

export type PriceCatalog = Record<ProviderName, Record<string, ModelPrice>>;

/**
 * ILLUSTRATIVE list prices - verify against each vendor's pricing page before relying on them.
 * Keys match by longest prefix, so dated snapshots ("gpt-4o-mini-2024-07-18") resolve to their
 * family. `*` is the provider-wide fallback: an unknown model is priced conservatively
 * instead of silently costing $0 (a classic FinOps leak).
 */
export const DEFAULT_PRICES: PriceCatalog = {
  openai: {
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
    'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
    'gpt-4.1': { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
    '*': { inputPer1M: 2.5, outputPer1M: 10 },
  },
  anthropic: {
    'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cachedInputPer1M: 0.1 },
    'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 },
    'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75, cachedInputPer1M: 1.5 },
    '*': { inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 },
  },
  gemini: {
    'gemini-2.5-flash': { inputPer1M: 0.3, outputPer1M: 2.5, cachedInputPer1M: 0.075 },
    'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10, cachedInputPer1M: 0.31 },
    '*': { inputPer1M: 1.25, outputPer1M: 10 },
  },
  // Self-hosted: no per-token vendor bill (infra cost is tracked elsewhere).
  ollama: { '*': { inputPer1M: 0, outputPer1M: 0 } },
  // Synthetic price so budgets and usage reports are meaningful in the offline demo.
  mock: { '*': { inputPer1M: 1, outputPer1M: 2 } },
};

export class PriceTable {
  constructor(private readonly catalog: PriceCatalog = DEFAULT_PRICES) {}

  priceFor(ref: ModelRef): ModelPrice {
    const models = this.catalog[ref.provider];
    const match = Object.keys(models)
      .filter((key) => key !== '*' && ref.model.startsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    const price = match ? models[match] : models['*'];
    if (!price) throw new Error(`No price configured for ${ref.provider}/${ref.model}`);
    return price;
  }

  /** Cost in USD, rounded to 8 decimals (sub-micro-dollar precision for cheap models). */
  cost(ref: ModelRef, usage: TokenUsage): number {
    const price = this.priceFor(ref);
    const cached = Math.min(usage.cachedPromptTokens ?? 0, usage.promptTokens);
    const uncached = usage.promptTokens - cached;
    const usd =
      (uncached * price.inputPer1M +
        cached * (price.cachedInputPer1M ?? price.inputPer1M) +
        usage.completionTokens * price.outputPer1M) /
      1_000_000;
    return Math.round(usd * 1e8) / 1e8;
  }
}
