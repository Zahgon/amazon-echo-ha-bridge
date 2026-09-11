import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every suite in this project binds real TCP and UDP sockets, and several
    // assert on the shared ./store.json persistence file. Running them in one
    // process, one file at a time, is what the original's single-context test
    // required too.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['src/**/*.ts'],
      reportsDirectory: 'coverage',
    },
  },
});
