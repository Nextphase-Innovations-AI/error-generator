import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['actions-failures/failing-test/**/*.test.ts'] },
});
