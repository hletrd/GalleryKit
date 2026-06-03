import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        include: ['src/__tests__/**/*.test.ts'],
        // Run-3 cycle 1 / F1: exclude the Next.js build output from test
        // discovery. `next build` with `output: 'standalone'` copies the
        // source tree — including `src/__tests__/**` — into
        // `.next/standalone/apps/web/src/__tests__/`. Those gitignored copies
        // cannot resolve the `@/` alias, so when vitest's project-root
        // resolution lets them be discovered (CWD- and invocation-sensitive)
        // the suite fails non-deterministically with `ERR_MODULE_NOT_FOUND`
        // against a phantom path that does not exist in source control. The
        // cycle gate runs both `build` and `test`, so this was a live flaky
        // gate. Spread the vitest defaults first so the standard ignores
        // (node_modules, dist, .idea, .git, .cache) are preserved; we only ADD
        // the build-output dirs.
        exclude: [...configDefaults.exclude, '**/.next/**', '.next/**'],
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
