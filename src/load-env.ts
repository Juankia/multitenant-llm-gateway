// Imported first by main.ts so .env values (e.g. LOG_LEVEL) exist before any module reads them.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: rely on the real environment
}
