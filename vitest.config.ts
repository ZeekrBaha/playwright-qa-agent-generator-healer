import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    exclude: ['node_modules'],
    coverage: {
      provider: 'v8',
      include: ['src/agent/**'],
      exclude: ['src/agent/trace.ts'],
      thresholds: { lines: 85, functions: 85, statements: 85 },
    },
  },
});
