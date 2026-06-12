// Vitest stub for the `server-only` package (ARCH-R5C2-02 follow-up).
//
// `caption-generator.ts` carries `import 'server-only'` so any future client
// bundle import fails the Next.js build loudly. The real package's default
// export-condition throws at import time outside a React Server environment —
// which vitest is. Aliasing it here (vitest.config.ts resolve.alias) keeps the
// production guard intact while letting server modules be unit-tested without
// per-file `vi.mock('server-only', …)` boilerplate in every transitive
// importer (image-queue → caption-generator chain et al.).
export {};
