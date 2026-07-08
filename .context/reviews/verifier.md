# Cycle 24 Verifier Review

Role: `verifier`
Repo: `/Users/hletrd/flash-shared/gallery`
Mode: review-only; no source code edited.
Date: 2026-07-08 KST

## Inventory

Guidance read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, and the local `code-review` skill.

Review-relevant inventory was built before judging findings. The repo currently has 624 TypeScript/JavaScript/SQL/JSON/shell/YAML files in the reviewed source, script, migration, deploy, and test directories:

- Auth and admin API enforcement: `apps/web/scripts/check-api-auth.ts`, `apps/web/src/lib/api-auth.ts`, admin API routes, and `apps/web/src/__tests__/check-api-auth.test.ts`.
- Server-action origin and mutation barrier: `apps/web/scripts/check-action-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, all `apps/web/src/app/actions/**`, `apps/web/src/app/[locale]/admin/db-actions.ts`, and related tests.
- Public route rate limits: `apps/web/scripts/check-public-route-rate-limit.ts`, every `apps/web/src/app/**/route.ts(x)` handler, rate-limit helpers, and route-rate tests.
- Privacy projections: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public semantic/similar routes, map query paths, and privacy tests.
- Migrations and reconcile: `apps/web/src/db/schema.ts`, all `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, and migration coverage tests.
- Restore maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, restore durable marker helpers, recovery script, restore SQL scanner, drain checklist, queue/background-drain helpers, and restore tests.
- Queue/backfill locks: image queue, admin color backfill runner, color/CLIP sidecar scripts, advisory-lock helpers, upload-processing contract lock, and lock/backfill/queue tests.
- Deploy and cache/PWA: root deploy wrapper, `apps/web/deploy.sh`, Dockerfile/Compose/nginx config, service worker template/generated worker, SW cache helper, proxy admin-render marker, and deploy/SW/cache tests.
- Docs and plan rules: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `README.md`, and `apps/web/README.md`.

## Findings

No confirmed code correctness findings were found in this verifier pass.

No likely issues are being reported. The source and tests I examined provide executable enforcement for the claimed invariants in scope: admin API wrappers, action-origin checks, restore mutation barriers, public route rate limits, privacy omissions, migration/reconcile mirrors, restore maintenance fences, queue/backfill locks, deployment disk-safety claims, and PWA/cache behavior.

## Evidence

Fresh checks run in this lane:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
npm run lint:public-route-rate-limit --workspace=apps/web
npm test --workspace=apps/web -- src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/api-auth-response-headers.test.ts src/__tests__/request-origin.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/map-privacy.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/db-restore.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/restore-maintenance.test.ts src/__tests__/restore-maintenance-recovery-mjs.test.ts src/__tests__/restore-upload-lock.test.ts src/__tests__/restore-drain-checklist.test.ts src/__tests__/admin-mutation-barrier.test.ts src/__tests__/auth-mutation-barrier-source.test.ts src/__tests__/image-queue-quiesce.test.ts src/__tests__/advisory-lock-release.test.ts src/__tests__/advisory-lock-release-contract.test.ts src/__tests__/admin-backfill-concurrency-cap.test.ts src/__tests__/admin-backfill-runner-batching.test.ts src/__tests__/admin-backfill-runner-leak.test.ts src/__tests__/backfill-color-pipeline.test.ts src/__tests__/backfill-clip-embeddings-reembed.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/nginx-config.test.ts src/__tests__/sw-cache.test.ts src/__tests__/sw-template-contract.test.ts src/__tests__/serve-upload.test.ts
npm run typecheck --workspace=apps/web
npm run lint --workspace=apps/web
```

Results:

- `lint:api-auth`: passed; both admin API route exports are wrapped by `withAdminAuth(...)`.
- `lint:action-origin`: passed; mutating server actions are guarded by same-origin checks and restore mutation slots or explicit exemptions.
- `lint:public-route-rate-limit`: passed; public mutating/expensive route handlers have pre-increment rate limits or explicit exemptions.
- Targeted invariant suite: 32 test files passed, 616 tests passed.
- `typecheck`: passed for app route types and scripts.
- `lint`: passed.

## Confirmed Enforcement

- Admin API wrappers are executable, not just convention: `apps/web/scripts/check-api-auth.ts` rejects unwrapped exports, spoofed imports, star re-exports, and alias/export shapes; `apps/web/src/__tests__/check-api-auth.test.ts` covers those cases. Runtime `withAdminAuth` in `apps/web/src/lib/api-auth.ts` applies same-origin admin-cookie auth and scoped token auth with no-store/nosniff defaults.
- Action origin and mutation barrier are enforced by scanner and runtime primitives: `apps/web/scripts/check-action-origin.ts` requires `requireSameOriginAdmin()` or the approved auth guard and also requires `using ... = acquireAdminMutationSlot()` for mutating actions. The current tests include nested/sibling mutation, auth-before-origin, imported side-effect helper, revalidation-before-origin, public action rate-limit, and barrier-spoofing cases.
- Public routes are rate-limited before expensive work: `apps/web/scripts/check-public-route-rate-limit.ts` scans public App Router routes, recognizes approved pre-increment helpers, rejects protected work before limiter calls, and treats upload helper routes and cheap health/live routes through documented exemptions.
- Privacy fields have symmetric compile/test guards: `apps/web/src/lib/data.ts` derives public selectors from admin selectors by omitting sensitive fields, defines `_PrivacySensitiveKeys`, and map GPS exposure is isolated to `getMapImages()` with `topics.map_visible = true`. `privacy-fields.test.ts`, `data-viewer-select-fields.test.ts`, `search-route-privacy.test.ts`, and map privacy tests pin these contracts.
- Migration/reconcile invariants are executable: journal tags match files, new `when` values are monotonic after the documented historical inversion, `migrate.js` has a silent-skip post-condition, and `migrate-reconcile-coverage.test.ts` checks schema table/column/index/FK/drop coverage against executable reconcile code.
- Restore maintenance is fenced across process and durable markers: restore writes a durable marker before drains/import, drains image queue/background DB writes/maintenance/admin mutation slots, holds restore/upload/backfill advisory locks, and keeps maintenance active on import/migration failure. Restore SQL scanning blocks dangerous or unknown-table writes and is covered across chunk-boundary cases.
- Queue/backfill locks are source- and behavior-backed: image processing uses per-image advisory locks with destroy-on-release-failure discipline; restore quiesce clears queued work before `onIdle()`; admin color backfill and sidecar share the color backfill lock; semantic backfill uses its own restore-serialized lock; pooled raw `RELEASE_LOCK` call sites are allowlisted and tested.
- Deployment claims are enforced: root deploy target is env-file driven, deploy/runtime env files are permission-checked before sourcing/Compose, `apps/web/deploy.sh` waits for health before Docker prune, and tests pin no `docker volume prune -a`, narrow bind mounts, immutable assets in the image, and no recursive chown of bind-mounted data.
- PWA/cache claims are pinned: the service worker bypasses admin routes, caches only same-origin derivative paths for image SWR with a 50 MB LRU, uses offline-only HTML fallback with the `x-gk-admin-render` marker from `proxy.ts`, and source-contract tests compare template/generated worker behavior.

## Manual Validation Gaps

No source finding is attached to these gaps, but they still require operator or browser validation outside this review lane:

- I did not run a production deploy or modify production infrastructure. Deploy behavior was verified through scripts and tests only.
- I did not perform a real database restore/import against a live MySQL instance; restore behavior was verified through source inspection and unit/source-contract tests.
- I did not run the real CLIP preflight or seed model weights. The runbook remains operator-gated in `CLAUDE.md`, and source/tests verify the gating/backfill paths.
- I did not run Playwright or manual PWA browser flows in this lane; PWA/cache assertions are source-contract and unit-test backed.

## Final Sweep

Checked common missed issue classes:

- New admin API route without `withAdminAuth(...)`: not found; scanner passed.
- Mutating server action without same-origin return-early or restore mutation slot: not found; scanner passed.
- Public mutating or expensive route doing work before rate-limit pre-increment: not found; scanner passed.
- Admin-only or upload/color/HDR/GPS fields leaking through public selectors, search enrichment, timeline, or map paths: not found in inspected selectors/routes/tests.
- New migration missing journal entry, stale `when`, missing reconcile mirror, or silent-skip post-condition: not found in inspected journal/reconcile tests.
- Restore marker clear before import/migration failure, missing drain, or raw pooled advisory-lock release leak: not found in inspected restore and lock paths.
- Deployment docs claiming data safety without script/test backing: not found; deploy docs/scripts/tests agree on bind mounts and prune-after-health.
- PWA/cache claims drifting between TS helper, template, generated worker, and proxy marker: not found; contract tests cover the duplicated worker surface.

Concurrent note: `.context/reviews/code-reviewer.md` already had unrelated working-tree changes during this lane. I did not edit it.
