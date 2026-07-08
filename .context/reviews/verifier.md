# Cycle 38 Verifier Review

Date: 2026-07-08 KST
Role: cycle-38 verifier
Repository: `/Users/hletrd/flash-shared/gallery`
Mode: evidence-based correctness review only. I edited only this required review file.

## Provenance

- Read first, as requested: `AGENTS.md` and `CLAUDE.md`.
- Loaded review workflow guidance: `/Users/hletrd/.agents/skills/code-review/SKILL.md`.
- Built inventory before reviewing:
  - Tracked files: 3641.
  - Current behavior surface reviewed: `AGENTS.md`, `CLAUDE.md`, root/workspace package files, `apps/web/src/{app,components,lib,db}`, `apps/web/src/__tests__`, `apps/web/e2e`, `apps/web/scripts`, root `scripts`, `apps/web/drizzle`, `.github/workflows`, Docker/deploy/config files.
  - Counted current source/test/script/config files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, root `scripts`, and `.github`: 716.
  - Historical review/plan artifacts were used as provenance and regression leads, not as current runtime behavior definitions.
- Fresh validation evidence:
  - `npm run lint:api-auth --workspace=apps/web` passed.
  - `npm run lint:action-origin --workspace=apps/web` passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
  - `npm run typecheck --workspace=apps/web` passed.
  - `rg -n "\.only\(" apps/web/src apps/web/e2e apps/web/scripts` returned no focused-test markers.
- Worktree note: before writing this file, unrelated modifications already existed in `.context/reviews/code-reviewer.md`, `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`, and `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`. I did not inspect or modify them as part of this artifact.

## Findings

### VER-C38-01 - Analytics privacy claim is false for the DB-backed rate-limit path

Severity: Medium
Confidence: High
Classification: Confirmed issue

Evidence:
- `apps/web/src/app/actions/public.ts:331-339` documents the public view-recording actions and states: "Full IPs are never stored; only country_code derived from the IP."
- The same actions pass the raw request IP into the limiter before writing view rows: `recordPhotoView` at `apps/web/src/app/actions/public.ts:443-450`, `recordTopicView` at `apps/web/src/app/actions/public.ts:477-490`, and `recordSharedGroupView` at `apps/web/src/app/actions/public.ts:517-527`.
- `checkViewRecordRateLimit` persists the limiter attempt through `incrementRateLimit(ip, ...)` at `apps/web/src/app/actions/public.ts:377-414`.
- `incrementRateLimit` inserts the `ip` value into `rateLimitBuckets` at `apps/web/src/lib/rate-limit.ts:491-506`.
- The schema stores that value in `rate_limit_buckets.ip varchar(45)` as part of the primary key at `apps/web/src/db/schema.ts:244-251`.
- `apps/web/src/db/schema.ts:254-255` repeats the narrower analytics privacy claim immediately after the limiter table definition, which makes the mismatch easy to miss during schema review.

Failure scenario:
An operator or future maintainer relies on the "full IPs are never stored" claim for privacy/compliance reasoning. The view event rows do omit full IPs, but each accepted analytics view attempt can store the client IP in `rate_limit_buckets` until the bounded purge removes old buckets. That is materially different from "never stored."

Concrete fix:
Either hash the IP before using the persistent DB limiter key and migrate/rename `rate_limit_buckets.ip` to a neutral `bucket_key`, or narrow the documentation and comments to say that analytics event rows do not store full IPs while the rate-limit table may temporarily retain the client IP for abuse control. Add a regression test that asserts the documented privacy contract explicitly.

### VER-C38-02 - The touch-target audit misses raw default text inputs

Severity: Medium
Confidence: High
Classification: Likely issue; confirmed test false-negative class, no current violating source found

Evidence:
- `CLAUDE.md:710-714` claims the blocking touch-target audit enforces a 44x44 px floor for all interactive elements in the scanned roots.
- The documented pattern list includes raw text-like inputs at `CLAUDE.md:716-724`.
- The scanner only matches raw inputs when an explicit `type="text"`, `type="search"`, `type="email"`, or `type="password"` appears: `apps/web/src/__tests__/touch-target-audit.test.ts:448-455`.
- The fixture coverage only proves explicit `type="text"` and `type="file"` behavior: `apps/web/src/__tests__/touch-target-audit.test.ts:991-1000`.

Failure scenario:
HTML defaults `<input>` with no `type` attribute to a text input. A future scanned component can introduce `<input className="h-8 ...">` or another sub-44 visible default text input and pass the audit because the regex requires an explicit matching `type`. That contradicts the "all interactive elements" and raw-input coverage claims.

Concrete fix:
Update the raw-input scanner to treat missing `type` as text-like unless the tag is explicitly hidden, file, checkbox, radio, or otherwise documented as exempt. Add fixtures for `<input className="h-8" />`, `<input className="min-h-11" />`, hidden/file inputs, and a checkbox/radio case that remains owned by the wrapper-aware scan.

### VER-C38-03 - Legacy schema reconciliation tests are still source tripwires, not structural parity proof

Severity: Medium
Confidence: Medium
Classification: Manual-validation risk / test-depth gap

Evidence:
- The migration runbook requires every new migration to be mirrored into `reconcileLegacySchema` so fresh or legacy-baselined DBs can reach the complete schema: `CLAUDE.md:483-489`.
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19` explicitly says the coverage test is a source tripwire and cannot verify types or defaults.
- Table coverage checks only that `migrate.js` contains `CREATE TABLE IF NOT EXISTS <table>`: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:86-93`.
- Column coverage checks only that every column name appears somewhere in comment-stripped `migrate.js`: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-103`.
- Index coverage similarly checks index-name presence and documents that it is not structural equivalence: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:107-123`.
- The current test adds a narrow structural pin for `image_embeddings` only: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175-180`.

Failure scenario:
A migration can update a column type, default, nullability, index order, index uniqueness, or foreign-key action while `migrate.js` still mentions the same table/column/index names. The source tripwire passes, but a fresh DB or drift-reconciled DB can differ from a normally migrated DB and later fail at runtime.

Concrete fix:
Add a disposable MySQL parity test or script that creates two schemas: one via committed Drizzle migrations and one via the reconcile/baseline path. Compare `information_schema` for columns, types, nullability, defaults, indexes, and foreign keys. Keep the current source tripwire for fast feedback, but stop treating it as proof of full schema parity.

### VER-C38-04 - CLIP production-readiness proof is outside the normal blocking quality gates

Severity: Medium
Confidence: High
Classification: Manual-validation risk

Evidence:
- `CLAUDE.md:618-626` states the two CLIP integration suites are permanently skipped in CI without model weights and are the only verification that the real encoder loads offline and ranks semantically before production activation.
- `apps/web/src/__tests__/clip-offline-load.test.ts:32-42` uses `describe.skip` unless `CLIP_OFFLINE_LOAD=1` and `CLIP_MODELS_ROOT` points at seeded weights.
- `apps/web/src/__tests__/clip-semantic-integration.test.ts:27-31` uses `describe.skip` unless `CLIP_INTEGRATION=1`.
- `.github/workflows/clip-preflight.yml:1-46` runs the preflight only on `workflow_dispatch` or a weekly schedule.
- The normal blocking workflow `.github/workflows/quality.yml:54-83` runs lint, typecheck, security lint gates, audit, unit tests, DB init, Playwright E2E, and build, but does not invoke the CLIP preflight.

Failure scenario:
A CLIP-path change can merge and deploy with all normal gates green while the real production encoder path is broken. The scheduled/manual preflight may catch it later, but it is not tied to the change that introduced the regression and it is not a merge/deploy blocker.

Concrete fix:
Make the CLIP preflight required for CLIP-touching changes through a path-filtered required workflow, or require a generated activation artifact from the preflight before allowing `semantic_search_mode='production'`. If CI weight cost is the blocker, keep the default unit suite lightweight but add a merge-blocking job that restores/caches weights only when `clip-*`, embedding, semantic-search, or download-script paths change.

## Final Sweep

- Commonly missed issue sweep:
  - Focused tests: no `.only(` markers found under current source, scripts, or E2E tests.
  - Custom enforcement gates: admin API auth, action origin/mutation barrier, and public route rate-limit scanners pass.
  - Type surface: `npm run typecheck --workspace=apps/web` passes, including test files through the app typecheck config.
  - Known env-gated suites: CLIP preflight remains intentionally skipped unless weights/env are supplied; admin local E2E still depends on local credentials/config by design.
- Relevant files skipped:
  - No current review-relevant source/test/script/config files were intentionally skipped.
  - I did not line-review all historical `.context/reviews/**` and `.context/plans/**` archives, generated/cache artifacts, uploaded media, or binary fixtures because they do not define current runtime behavior. Current aggregate/deferred review files were used as provenance to guide regression checks.
- Validation not run:
  - I did not run the full `npm test`, `npm run build`, `npm run audit:prod`, or Playwright E2E suite in this verifier pass. The report relies on targeted enforcement gates, TypeScript, repository inspection, and exact source/test evidence above.
