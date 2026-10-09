import { InMemorySemanticCache } from './in-memory-semantic-cache';
import { LocalHashingEmbedder } from './local-hashing-embedder';
import { cosineSimilarity, type SemanticCacheKey } from './semantic-cache';

const value = { content: 'We are open 9am-6pm, Monday to Friday.', provider: 'openai' as const, model: 'gpt-4o-mini' };

describe('InMemorySemanticCache', () => {
  let now = 0;
  let cache: InMemorySemanticCache;
  const key = (query: string, overrides: Partial<SemanticCacheKey> = {}): SemanticCacheKey => ({
    tenantId: 'tenant-a',
    scope: 'scope-1',
    query,
    ...overrides,
  });

  beforeEach(() => {
    now = 0;
    cache = new InMemorySemanticCache(
      new LocalHashingEmbedder(),
      { similarityThreshold: 0.8, ttlMs: 10_000, maxEntriesPerTenant: 3 },
      () => now,
    );
  });

  it('returns a hit for a near-duplicate question', async () => {
    await cache.store(key('What are your opening hours?'), value);
    const hit = await cache.lookup(key('what are your opening hours'));
    expect(hit?.value.content).toBe(value.content);
    expect(hit?.similarity).toBeGreaterThan(0.95);
  });

  it('misses for an unrelated question', async () => {
    await cache.store(key('What are your opening hours?'), value);
    await expect(cache.lookup(key('How do I file a car insurance claim?'))).resolves.toBeNull();
  });

  it('never serves entries across tenants', async () => {
    await cache.store(key('What are your opening hours?'), value);
    await expect(cache.lookup(key('What are your opening hours?', { tenantId: 'tenant-b' }))).resolves.toBeNull();
  });

  it('requires an exact scope match (system prompt / conversation context)', async () => {
    await cache.store(key('What are your opening hours?'), value);
    await expect(cache.lookup(key('What are your opening hours?', { scope: 'scope-2' }))).resolves.toBeNull();
  });

  it('expires entries after the TTL', async () => {
    await cache.store(key('What are your opening hours?'), value);
    now = 10_001;
    await expect(cache.lookup(key('What are your opening hours?'))).resolves.toBeNull();
  });

  it('evicts the oldest entry beyond the per-tenant capacity', async () => {
    for (const q of ['first question about pricing', 'second about refunds', 'third about shipping', 'fourth about returns']) {
      await cache.store(key(q), { ...value, content: q });
    }
    await expect(cache.lookup(key('first question about pricing'))).resolves.toBeNull();
    await expect(cache.lookup(key('fourth about returns'))).resolves.not.toBeNull();
  });

  it('cosine similarity sanity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
