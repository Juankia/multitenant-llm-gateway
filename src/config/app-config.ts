export const APP_CONFIG = Symbol('APP_CONFIG');

export type PersistenceMode = 'memory' | 'postgres';

export interface AppConfig {
  port: number;
  logLevel: string;
  persistence: PersistenceMode;
  databaseUrl?: string;
  adminApiKey: string;
  providerTimeoutMs: number;
  circuitBreaker: { failureThreshold: number; cooldownMs: number };
  cache: { similarityThreshold: number; ttlMs: number; maxEntriesPerTenant: number };
  providers: {
    openaiApiKey?: string;
    openaiBaseUrl: string;
    anthropicApiKey?: string;
    anthropicBaseUrl: string;
    geminiApiKey?: string;
    geminiBaseUrl: string;
    ollamaBaseUrl?: string;
    enableMock: boolean;
  };
}

type Env = Record<string, string | undefined>;

function str(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function num(env: Env, key: string, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid configuration: ${key} must be a number in [${min}, ${max}], got "${raw}"`);
  }
  return value;
}

function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = str(env, key);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** Reads and validates configuration once at boot; fails fast on misconfiguration. */
export function loadConfig(env: Env = process.env): AppConfig {
  const persistence = (str(env, 'PERSISTENCE') ?? 'memory') as PersistenceMode;
  if (persistence !== 'memory' && persistence !== 'postgres') {
    throw new Error(`Invalid configuration: PERSISTENCE must be "memory" or "postgres"`);
  }
  const databaseUrl = str(env, 'DATABASE_URL');
  if (persistence === 'postgres' && !databaseUrl) {
    throw new Error('Invalid configuration: DATABASE_URL is required when PERSISTENCE=postgres');
  }
  const adminApiKey = str(env, 'ADMIN_API_KEY');
  if (!adminApiKey || adminApiKey.length < 16) {
    throw new Error('Invalid configuration: ADMIN_API_KEY is required (min. 16 characters)');
  }

  return {
    port: num(env, 'PORT', 3000, { min: 1, max: 65535 }),
    logLevel: str(env, 'LOG_LEVEL') ?? 'info',
    persistence,
    databaseUrl,
    adminApiKey,
    providerTimeoutMs: num(env, 'PROVIDER_TIMEOUT_MS', 60_000, { min: 1_000 }),
    circuitBreaker: {
      failureThreshold: num(env, 'CIRCUIT_FAILURE_THRESHOLD', 3, { min: 1 }),
      cooldownMs: num(env, 'CIRCUIT_COOLDOWN_MS', 30_000, { min: 0 }),
    },
    cache: {
      similarityThreshold: num(env, 'CACHE_SIMILARITY_THRESHOLD', 0.9, { min: 0, max: 1 }),
      ttlMs: num(env, 'CACHE_TTL_MS', 3_600_000, { min: 0 }),
      maxEntriesPerTenant: num(env, 'CACHE_MAX_ENTRIES_PER_TENANT', 500, { min: 1 }),
    },
    providers: {
      openaiApiKey: str(env, 'OPENAI_API_KEY'),
      openaiBaseUrl: str(env, 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
      anthropicApiKey: str(env, 'ANTHROPIC_API_KEY'),
      anthropicBaseUrl: str(env, 'ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com/v1',
      geminiApiKey: str(env, 'GEMINI_API_KEY'),
      geminiBaseUrl: str(env, 'GEMINI_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta',
      ollamaBaseUrl: str(env, 'OLLAMA_BASE_URL'),
      enableMock: bool(env, 'ENABLE_MOCK_PROVIDER', true),
    },
  };
}
