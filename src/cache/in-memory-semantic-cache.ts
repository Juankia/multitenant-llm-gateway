import {
  type CachedCompletion,
  type CacheHit,
  cosineSimilarity,
  type EmbeddingProvider,
  type SemanticCache,
  type SemanticCacheKey,
} from './semantic-cache';

export interface InMemorySemanticCacheOptions {
  similarityThreshold: number;
  ttlMs: number;
  maxEntriesPerTenant: number;
}

interface Entry {
  scope: string;
  vector: number[];
  value: CachedCompletion;
  storedAt: number;
}

/**
 * Brute-force cosine search per tenant partition. O(n) per lookup with n <= maxEntriesPerTenant,
 * which is fine for a single node; a vector index (pgvector HNSW) is the scale-out path.
 * Entries are partitioned by tenant first, so cross-tenant hits are impossible by construction.
 */
export class InMemorySemanticCache implements SemanticCache {
  private readonly partitions = new Map<string, Entry[]>();

  constructor(
    private readonly embedder: EmbeddingProvider,
    private readonly options: InMemorySemanticCacheOptions,
    private readonly now: () => number = Date.now,
  ) {}

  async lookup(key: SemanticCacheKey): Promise<CacheHit | null> {
    const entries = this.live(key.tenantId);
    const candidates = entries.filter((e) => e.scope === key.scope);
    if (candidates.length === 0) return null;
    const vector = await this.embedder.embed(key.query);
    let best: CacheHit | null = null;
    for (const entry of candidates) {
      const similarity = cosineSimilarity(vector, entry.vector);
      if (similarity >= this.options.similarityThreshold && (!best || similarity > best.similarity)) {
        best = { value: { ...entry.value }, similarity };
      }
    }
    return best;
  }

  async store(key: SemanticCacheKey, value: CachedCompletion): Promise<void> {
    const entries = this.live(key.tenantId);
    entries.push({ scope: key.scope, vector: await this.embedder.embed(key.query), value: { ...value }, storedAt: this.now() });
    while (entries.length > this.options.maxEntriesPerTenant) entries.shift(); // evict oldest
    this.partitions.set(key.tenantId, entries);
  }

  private live(tenantId: string): Entry[] {
    const cutoff = this.now() - this.options.ttlMs;
    const entries = (this.partitions.get(tenantId) ?? []).filter((e) => e.storedAt > cutoff);
    this.partitions.set(tenantId, entries);
    return entries;
  }
}
