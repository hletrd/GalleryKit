# Cycle 40/100 Deferred Findings

## `TV-40-03` - JS operational scripts need semantic checking

Original severity/confidence: medium / medium.

Citation: `apps/web/scripts/check-js-scripts.mjs:34-40` runs `node --check` only; `apps/web/tsconfig.scripts.json:7-11` includes TypeScript scripts and `.next/types`, not `scripts/**/*.{js,mjs,cjs}`.

Reason: this is valid gate-hardening work, but it is not safe to schedule inside this cycle as a small fix. A direct probe with `tsc --ignoreConfig --allowJs --checkJs --noEmit --module NodeNext --moduleResolution NodeNext --target ESNext --skipLibCheck scripts/*.js scripts/*.mjs` produced many existing JavaScript typing errors across `migrate.js`, `mysql-connection-options.js`, `run-e2e-server.mjs`, and other operational scripts. Enabling semantic JS checking therefore requires a dedicated migration plan, JSDoc/type cleanup, and possibly staged conversion of production-critical scripts. The repo does not have a rule allowing security/correctness findings to be silently dropped, so this item is recorded here with its original severity.

Exit criterion: a dedicated plan chooses the script-checking approach (`checkJs` with JSDoc, TypeScript conversion, or a focused semantic checker), enumerates expected current errors, fixes them without weakening deploy/runtime behavior, and adds a regression test or gate fixture showing undefined runtime identifiers in operational scripts fail before deploy.

## Carry-forward Deferred Items

- `PERF-C39-03` - Feed and sitemap updated-time indexes: remains migration-shaped work requiring EXPLAIN output, production-cardinality assumptions, rollback notes, and `reconcileLegacySchema` mirroring.
- `PERF-C39-04` - Backfill pipeline-version indexes: remains migration-shaped work requiring query-plan evidence and write-path impact review.
- `AGG-C38-07` - Broad imported-helper side-effect classification: remains deferred until a scanner model can distinguish pure imports from mutating helpers without noisy false positives.
- `AGG-C38-08` - Sidecar keyset pagination: remains deferred until a broader throughput/memory plan defines keyset cursor semantics and regression coverage.
