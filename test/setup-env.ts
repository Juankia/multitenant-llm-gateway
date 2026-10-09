// Deterministic, offline test environment: no API keys, no database, quiet logs.
process.env.LOG_LEVEL = 'silent';
process.env.PERSISTENCE = 'memory';
process.env.ADMIN_API_KEY = 'test-admin-key-0123456789abcdef';
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
