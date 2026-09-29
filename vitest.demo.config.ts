import { defineConfig } from 'vitest/config';

// Demos for screen recordings (test/demo/*.demo.ts) — kept out of the e2e suite.
export default defineConfig({
    test: {
        globals: true,
        include: ['test/demo/**/*.demo.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true, // only one app on screen at a time
            },
        },
    },
});
