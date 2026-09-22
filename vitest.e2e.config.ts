import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['test/e2e/**/*.e2e.ts'],
        // Temporarily disabled (fully commented out) while the suite is scaled down to
        // sap-discovery.e2e.ts — vitest fails a file with no suites, so exclude them too.
        exclude: [
            'test/e2e/sap-attach.e2e.ts',
            'test/e2e/sap-interaction.e2e.ts',
            'test/e2e/sap-login.e2e.ts',
        ],
        // No setupFiles — real I/O, no mocks
        testTimeout: 30_000,
        hookTimeout: 60_000,
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true, // sequential execution — only one app on screen at a time
            },
        },
    },
});
