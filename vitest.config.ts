import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['runtime-errors/test/**/*.test.ts', 'api-errors/test/**/*.test.ts'],
    // actions-failures/ holds a test that fails on purpose; its own workflow runs it.
    exclude: ['actions-failures/**', '**/node_modules/**'],
    testTimeout: 20_000,
  },
});
