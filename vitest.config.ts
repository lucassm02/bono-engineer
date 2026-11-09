import { defineConfig } from 'vitest/config';

/** Tests that bind real UDP/TCP sockets and stream at 20x speed: timing-sensitive under load. */
const NETWORK_TESTS = [
  'packages/core/src/runtime/runtime.test.ts',
  'packages/core/src/runtime/discovery.test.ts',
  'packages/protocol/src/integration.test.ts',
  'packages/protocol/src/discovery.integration.test.ts',
  'packages/server/src/app.test.ts',
  'packages/server/src/startup.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
          exclude: ['**/node_modules/**', ...NETWORK_TESTS],
          sequence: { groupOrder: 1 },
        },
      },
      {
        // Run after the unit project and one file at a time, so the CPU is idle while packets
        // are streamed in compressed time (20x) and no UDP datagram gets dropped or delayed.
        extends: true,
        test: {
          name: 'network',
          include: NETWORK_TESTS,
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
