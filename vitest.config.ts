import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests bind UDP ports; run files in parallel but keep ports unique per file.
    pool: 'forks',
  },
});
