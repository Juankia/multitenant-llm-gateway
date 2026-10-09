/** Unit tests: colocated *.spec.ts files under src/. */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/../test/setup-env.ts'],
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!main.ts'],
  coverageDirectory: '../coverage',
};
