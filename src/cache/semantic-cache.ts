import { type ProviderName } from '../llm/llm.types';

export const SEMANTIC_CACHE = Symbol('SEMANTIC_CACHE');

export interface SemanticCacheKey {
  tenantId: string;
  /**
   * Exact-match partition: hash of (model, system prompt, prior conversation turns). Only the
   * final user question is compared semantically, so a cached answer is never reused under a
   * different persona or conversation context.
   */
  scope: string;
  /** The text compared by embedding similarity (the latest user message). */
  query: string;
}

export interface CachedCompletion {
  content: string;
  provider: ProviderName;
  model: string;
}

export interface CacheHit {
  value: CachedCompletion;
  similarity: number;
}

/** Response-level cache. Implementations: in-memory (this repo), pgvector / Redis (roadmap). */
export interface SemanticCache {
  lookup(key: SemanticCacheKey): Promise<CacheHit | null>;
  store(key: SemanticCacheKey, value: CachedCompletion): Promise<void>;
}

/** Pluggable embeddings; swap the local embedder for a real model in production. */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimensions differ');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
