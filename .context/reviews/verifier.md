# Verifier Review - Cycle 6/100

Date: 2026-06-29
Role: verifier
Scope: current `HEAD` only (`e6db9241`, `master`, clean worktree at review start). No fixes implemented.

## Inventory Built Before Findings

Read first, per instruction: `AGENTS.md`, `CLAUDE.md`.

HEAD inventory counts:
- Docs/context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, 5 `docs/**` files, 65 plan files, 1664 review/archive files.
- App/runtime: 76 `src/app/**` files, 55 `src/components/**` files, 94 `src/lib/**` files, 3 `src/db/**` files.
- Verification/migration/config: 253 `src/__tests__/**` files, 27 `apps/web/scripts/**` files, 28 `apps/web/drizzle/**` files, 14 key config/deploy files.

Review-relevant surfaces inspected from HEAD:
- Recent cycle-5 implementation plan and deferred plan: `.context/plans/archive/cycle-5-2026-06-29-plan.md`, `.context/plans/cycle-5-2026-06-29-deferred.md`.
- Current aggregate and prior verifier record: `.context/reviews/_aggregate.md`, previous `.context/reviews/verifier.md`.
- Deployment/storage: `apps/web/Dockerfile`, `.dockerignore`, `apps/web/.dockerignore`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- DB/restore/migration: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, all migration filenames, `apps/web/src/db/schema.ts`.
- Search/CLIP: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/rate-limit.ts`, CLIP/search tests.
- Upload/LR: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, LR/upload tests.
- Service worker/PWA: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, SW contract tests.
- Privacy/selects: `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- UI/i18n copy touched by cycle 5: analytics page/client, `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

## Confirmed Issues

### V-C6-01 - DB-only restore docs point operators at the wrong original-upload path

Severity: Medium
Confidence: High
Status: Confirmed

Regions:
- `CLAUDE.md:209`
- `apps/web/src/lib/upload-paths.ts:26-40`
- `apps/web/scripts/migrate.js:46-55`
- `CLAUDE.md:176`, `CLAUDE.md:249`, `CLAUDE.md:347`

Why this is a problem:
The new DB-only restore warning says restore does not snapshot or roll back host files in `data/originals`, but the application stores private originals under `data/uploads/original` by default. The code path is explicit in `UPLOAD_ORIGINAL_ROOT` (`apps/web/src/lib/upload-paths.ts:31-40`) and the migration/default resolver mirrors that path (`apps/web/scripts/migrate.js:46-55`). Other CLAUDE sections also name `data/uploads/original`.

Failure scenario:
An operator follows the restore/backup warning literally, audits or backs up `data/originals`, and misses `data/uploads/original`. After a DB restore or host rollback, database rows can point at originals that were never backed up.

Suggested fix:
Change the DB-only restore warning to name `data/uploads/original` or use the broader `./data` bind mount wording consistently. Prefer mentioning `UPLOAD_ORIGINAL_ROOT` when operators override the default.

### V-C6-02 - Semantic model-version "regression coverage" is a source-string check, not a behavioral filter test

Severity: Low
Confidence: High
Status: Confirmed test/claim mismatch

Regions:
- `.context/plans/archive/cycle-5-2026-06-29-plan.md:128-135`
- `apps/web/src/__tests__/semantic-search-route.test.ts:340-345`
- `apps/web/src/app/api/search/semantic/route.ts:173-247`

Why this is a problem:
The implementation correctly computes `activeModelVersion` and filters `imageEmbeddings.modelVersion`, but the cycle plan says to add tests proving stub mode ignores production rows and production mode ignores stub rows. The committed test only reads route source and checks for two substrings. It does not execute stub-vs-production row mixtures, capture the `where()` predicate, or fail if the mocked DB returns wrong-version rows.

Failure scenario:
A future refactor can leave the same source substrings in place while changing the query chain or mock behavior so wrong-version rows reach ranking. The current test could remain green because it never exercises cross-version result data.

Suggested fix:
Add a behavioral test that mocks `eq`/`where` or the DB chain so rows are returned based on the captured `model_version` predicate, then assert stub mode only sees `STUB_MODEL_VERSION` rows and production mode only sees `PRODUCTION_MODEL_VERSION` rows.

### V-C6-03 - Lightroom topic-lookup quota rollback is only pinned by regex over source text

Severity: Low
Confidence: Medium
Status: Confirmed test gap

Regions:
- `.context/plans/archive/cycle-5-2026-06-29-plan.md:117-124`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:257-266`
- `apps/web/src/app/api/admin/lr/upload/route.ts:198-210`

Why this is a problem:
The route code now settles the upload tracker when topic lookup throws, which matches the intended fix. The plan, however, called for a regression test with a mocked topic lookup failure after preclaim. The committed coverage is a source regex that only proves the catch block contains `settleTrackerToActual(false)`, not that a real request path preclaims, throws from `db.select(...topics...)`, and rolls the tracker state back.

Failure scenario:
A future refactor can preserve that catch-block text while moving preclaim/settlement ordering or changing helper wiring. The source-contract test may pass while the upload tracker still leaks quota on a thrown lookup.

Suggested fix:
Add a focused route-level unit test with mocked auth, `request.formData()`, upload tracker state, and a throwing topic lookup. Assert the tracker count/bytes are restored after the response.

## Likely Issues

None found beyond the confirmed items above.

## Risks Needing Manual Validation

- DB restore now holds upload/backfill advisory locks and runs `scripts/migrate.js` after import (`db-actions.ts:279-388`, `:521-598`). Source tests and targeted tests passed, but I did not perform a live MySQL restore/import cycle. A disposable-DB restore smoke test would be the only direct proof that the spawned migrate path, advisory locks, and maintenance state interact correctly with an actual SQL dump.
- `apps/web/public/sw.js` is stamped as `dba54859-p7` while HEAD is `e6db9241`; the last HEAD commit is docs-only, and `prebuild` regenerates `sw.js` for production builds. I am not treating this as a finding because the template did not change after the stamp, but a future strict artifact-freshness test would remove ambiguity.

## Validation Evidence

Passed during this verifier lane:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm test --workspace=apps/web -- semantic-search-route.test.ts lr-upload-hdr-gate.test.ts restore-upload-lock.test.ts migrate-legacy-originals.test.ts sw-template-contract.test.ts deploy-script-contract.test.ts i18n-key-parity.test.ts` -> 7 files / 82 tests passed.
- `npm run lint --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`

Not run:
- `npm run build --workspace=apps/web`, because `prebuild` rewrites generated assets (`public/sw.js`) and the task requested current-HEAD inspection/reporting only.
- Full `npm test --workspace=apps/web`; targeted tests plus lint/typecheck were used for this report.

## Final Missed-Issues Sweep

Sweeps performed:
- `rg` over docs/source for stale paths, semantic/stub/production comments, `server-only`, rollback helpers, and runtime resource paths.
- Route/action lint gates for admin auth, action origin, and public mutating route rate limits.
- Schema/data privacy cross-check: `schema.ts`, `data.ts`, `privacy-fields.test.ts`, migration journal, and `migrate.js` reconcile/drop coverage.
- Current deploy/runtime claims cross-checked against Dockerfile, compose, deploy script, nginx, and public asset packaging tests.

Relevant files intentionally not inspected individually:
- Archived review screenshots/binary artifacts under `.context/reviews/archive/**`.
- Historical review/plan archives not referenced by the current aggregate, cycle-5 plan, or current docs.
- Fixture image binaries under `apps/web/src/__tests__/fixtures/**` and generated visual artifacts.
- Every React component not on the current changed/review-relevant path; they were covered only through inventory, lint/typecheck, and existing tests.

Overall verifier result: no confirmed application-code correctness regression found in the current cycle-5 fixes. The actionable confirmed issue is the restore-path documentation mismatch; the other two findings are test coverage/claim gaps around behavior the current code appears to implement correctly.
