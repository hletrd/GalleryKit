import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        include: ['src/__tests__/**/*.test.ts'],
        // Cycle 3 / D-101-02: bump default testTimeout from 5s → 15s.
        // Several fixture-style tests (touch-target-audit, serve-upload,
        // import-side-effect scans) walk the full source tree and routinely
        // exceed 5s when the host is under heavy contention (parallel
        // ESLint + IDE indexing + dev server). The 15s ceiling is a safety
        // margin, not a real assertion change — every legitimate test still
        // completes in well under a second.
        testTimeout: 15000,
    },
});
