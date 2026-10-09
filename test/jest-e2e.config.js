/** End-to-end tests: full Nest app over HTTP (supertest), fake LLM providers, in-memory persistence. */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  testRegex: 'test/e2e/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
