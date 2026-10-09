import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'tgw_';

export interface GeneratedApiKey {
  /** Plaintext key: returned to the caller exactly once, never stored. */
  apiKey: string;
  /** Non-secret display prefix (e.g. in dashboards / logs). */
  prefix: string;
  /** SHA-256 hex digest, the only form persisted. */
  hash: string;
}

/**
 * API keys are 256-bit random secrets, so a fast hash (SHA-256) is appropriate: unlike
 * passwords there is no low-entropy input for an attacker to brute-force. Lookups by hash
 * are index-friendly and never compare plaintext.
 */
export function generateApiKey(): GeneratedApiKey {
  const apiKey = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { apiKey, prefix: apiKey.slice(0, 12), hash: hashApiKey(apiKey) };
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** Constant-time comparison of two secrets of arbitrary length. */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Deterministic JSON (sorted keys) for hashing request payloads. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
