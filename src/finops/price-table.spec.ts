import { PriceTable } from './price-table';
import { TokenEstimator } from './token-estimator';

describe('PriceTable', () => {
  const prices = new PriceTable();

  it('computes cost from input/output prices per 1M tokens', () => {
    // gpt-4o-mini: $0.15 in / $0.60 out per 1M
    expect(prices.cost({ provider: 'openai', model: 'gpt-4o-mini' }, { promptTokens: 1_000_000, completionTokens: 500_000 })).toBeCloseTo(0.45);
  });

  it('bills provider prompt-cache reads at the discounted rate', () => {
    // claude-sonnet-4-5: $3 in, $0.30 cached in, $15 out
    const cost = prices.cost(
      { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { promptTokens: 10_000, cachedPromptTokens: 8_000, completionTokens: 1_000 },
    );
    expect(cost).toBeCloseTo((2_000 * 3 + 8_000 * 0.3 + 1_000 * 15) / 1e6, 8);
  });

  it('matches dated model snapshots by longest prefix', () => {
    expect(prices.priceFor({ provider: 'openai', model: 'gpt-4o-mini-2024-07-18' }).inputPer1M).toBe(0.15);
    expect(prices.priceFor({ provider: 'openai', model: 'gpt-4o-2024-11-20' }).inputPer1M).toBe(2.5);
  });

  it('prices unknown models with the provider default instead of $0', () => {
    expect(prices.priceFor({ provider: 'openai', model: 'some-new-model' }).inputPer1M).toBeGreaterThan(0);
  });

  it('self-hosted models are free per token', () => {
    expect(prices.cost({ provider: 'ollama', model: 'llama3.1' }, { promptTokens: 1e6, completionTokens: 1e6 })).toBe(0);
  });
});

describe('TokenEstimator', () => {
  const estimator = new TokenEstimator();

  it('counts tokens with tiktoken', () => {
    expect(estimator.countText('Hello world', 'gpt-4o-mini')).toBe(2);
    expect(estimator.countText('', 'gpt-4o-mini')).toBe(0);
  });

  it('adds per-message framing overhead for chat prompts', () => {
    const messages = [
      { role: 'system' as const, content: 'Be brief.' },
      { role: 'user' as const, content: 'Hello world' },
    ];
    const raw = estimator.countText('Be brief.') + estimator.countText('Hello world');
    expect(estimator.countMessages(messages)).toBe(raw + 2 * 4 + 3);
  });
});
