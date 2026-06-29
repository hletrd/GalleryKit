# Cycle 12 Critic Review

Review target: current `master` HEAD `155f684f`.

Scope: review-plan-fix cycle 12 critic lane. I did not implement fixes, delete files, or revert other work. This report is the intended output.

## Inventory and Evidence

Repository guidance reviewed:
- `AGENTS.md`
- `CLAUDE.md`
- Code-review skill instructions
- Prior committed review/plan history under `.context/reviews/` and `.context/plans/`
- Existing top-level critic report at this path before replacement

Inventory built before findings:
- 568 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e`
- 2324 tracked review-relevant paths after adding deploy/config/docs/history surfaces and excluding dependency/build/test-output artifacts
- App routes/pages/API handlers: `apps/web/src/app/**`
- Server actions and admin flows: `apps/web/src/app/actions/**`, admin page/action files
- Core libraries: `apps/web/src/lib/**`
- Schema/migration path: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`
- Runtime/deploy: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, root/app package/config files
- Tests/source-contract gates: `apps/web/src/__tests__/**`, `apps/web/e2e/**`, lint scripts
- Docs/review history: `CLAUDE.md`, `AGENTS.md`, `.context/**`

Review method:
- No random sampling: every path in the inventory was included in repo-wide scans for auth/origin/rate-limit guards, migration/schema drift, unsafe HTML/script sinks, file IO, process execution, uploads, env/config, public projections, TODOs, and source-contract tests.
- High-risk surfaces were then read directly: semantic search, similar search, public pages with JSON-LD, public actions, admin image actions, LR upload, image queue, image processing, upload limits/tracker, data privacy selectors, analytics, schema, all migration SQL, migration runner, nginx, Next config, deploy contracts, and the relevant tests.
- Excluded as non-review source: `node_modules`, `.next`, `.claude/worktrees`, `test-results`, screenshots, generated build artifacts, and binary/media payloads.

## Findings

### C12-CRIT-01 - Confirmed: current schema columns still do not have a journaled migration applier, and journal-covered databases can skip the only repair path

Severity: High

Confidence: High

Status: Confirmed

Code regions:
- `apps/web/src/db/schema.ts:73-75` declares `images.was_downscaled`.
- `apps/web/src/db/schema.ts:102-108` declares `processing_error`, `failed_at`, and `processing_settings_json`.
- `apps/web/scripts/migrate.js:418` adds `was_downscaled` only through `reconcileLegacySchema`.
- `apps/web/scripts/migrate.js:424-426` adds `processing_error`, `failed_at`, and `processing_settings_json` only through `reconcileLegacySchema`.
- `apps/web/scripts/migrate.js:748-753` returns early when every journal hash is already recorded, so the reconcile repair path does not run for a journal-covered database.
- `apps/web/drizzle/0025_processing_settings_snapshot.sql:1-2` adds `processing_settings_json AFTER failed_at`, but no earlier journaled SQL migration creates `failed_at`.
- `apps/web/src/app/actions/images.ts:451` writes `processing_settings_json` during upload insert.
- `apps/web/src/lib/image-queue.ts:655-657` writes `was_downscaled`, `avif_10bit`, `processing_error`, `failed_at`, and clears `processing_settings_json` on successful processing.
- `apps/web/src/lib/image-queue.ts:796-798` persists `processing_error` and `failed_at` after retry exhaustion.
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:95-102` only asserts that `migrate.js` mentions every schema column; it does not prove a journaled applier or a guaranteed reconcile trigger exists.
- `apps/web/src/__tests__/migration-journal.test.ts:108-114` asserts journal tag to SQL file coverage, while the file comments at `apps/web/src/__tests__/migration-journal.test.ts:37-40` explicitly note the reverse direction is not asserted.

Failure scenario:
Any database whose `__drizzle_migrations` table contains every current journal hash but whose `images` table lacks one of these reconcile-only columns will pass `prepareLegacyDatabaseIfNeeded` without repair. The next upload or queue pass can then fail with an unknown-column error, for example when upload insert writes `processing_settings_json` or when the queue updates `was_downscaled`, `processing_error`, or `failed_at`.

This is not only theoretical drift. The committed SQL chain is not self-contained: direct replay of journaled SQL reaches `0025_processing_settings_snapshot.sql`, which depends on `failed_at` even though no prior journaled migration creates it. The supported `migrate.js` fresh path currently avoids that by reconciling and baselining, but the early-return branch leaves journal-covered drift invisible.

Suggested fix:
Add a new post-`0027` journaled repair migration that idempotently creates the missing columns before any dependent column placement, using `INFORMATION_SCHEMA`-guarded dynamic SQL or another MySQL-safe idempotent pattern. Alternatively, move a cheap current-schema drift assertion before the `journalCovered` early return and fail deploy loudly if any schema column required by current code is missing. Add a regression test that models a journal-covered database missing these columns and asserts migration does not return cleanly without applying or reporting the repair. Also add a schema-to-applier tripwire: every current Drizzle column must be backed by either journaled SQL or an explicit tested reconcile trigger.

Cross-perspective impact:
- Architecture/correctness: schema truth is split between Drizzle schema, journal SQL, and reconcile side effects.
- Operations: deploy can report migrations complete while runtime writes fail.
- Tests: existing tripwires validate source shape, not the journal-covered drift branch that matters here.

### C12-CRIT-02 - Confirmed risk: the Lightroom upload route parses oversized files before enforcing the 200 MiB per-file cap

Severity: Medium

Confidence: High

Status: Confirmed risk

Code regions:
- `apps/web/src/lib/upload-limits.ts:1-3` defines a 2 GiB rolling upload window and a 200 MiB per-file upload cap.
- `apps/web/src/app/api/admin/lr/upload/route.ts:85-98` validates `Content-Length` only against `MAX_TOTAL_UPLOAD_BYTES`, not `MAX_UPLOAD_FILE_BYTES`.
- `apps/web/src/app/api/admin/lr/upload/route.ts:115-123` pre-claims the rolling byte window using the declared request size.
- `apps/web/src/app/api/admin/lr/upload/route.ts:139-144` calls `await request.formData()` before any per-file size check can run.
- `apps/web/src/app/api/admin/lr/upload/route.ts:147-152` reads `fileEntry.size` but does not reject when it exceeds the 200 MiB cap.
- `apps/web/src/lib/process-image.ts:887-890` eventually rejects files larger than `MAX_FILE_SIZE`, but only after the route has already materialized the multipart body into a `File`.
- `apps/web/src/components/upload-dropzone.tsx:151-156` filters oversized files on the browser path before upload, so LR is the parity outlier.
- `apps/web/nginx/default.conf:122-132` gives the documented production LR route a 216 MiB edge cap, which masks the route bug only when this exact nginx layer is present and correctly ordered.
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:237-247` source-checks pre-body cumulative-window enforcement but imports/asserts only `MAX_TOTAL_UPLOAD_BYTES` and `UPLOAD_MAX_FILES_PER_WINDOW`, not `MAX_UPLOAD_FILE_BYTES`.

Failure scenario:
A valid PAT caller, an internal client, a local/dev caller, or a deployment that reaches the Next process without the documented nginx cap can send a multipart body well above 200 MiB but below the 2 GiB rolling window. The LR route accepts the declared size, pre-claims quota, and asks Next to parse the full multipart body before `saveOriginalAndGetMetadata` rejects the file. That turns an intended application-level per-file cap into a post-parse validation, consuming memory/temp storage/CPU and creating operational DoS risk on the upload worker.

The current production nginx config reduces the blast radius, but the route comments say the LR path reuses the same upload infrastructure and enforces the app-level 200 MiB cap. That claim is only true after body parsing.

Suggested fix:
Import `MAX_UPLOAD_FILE_BYTES` in the LR route and reject declared `Content-Length` values above `MAX_UPLOAD_FILE_BYTES + SERVER_ACTION_BODY_OVERHEAD_BYTES` before `request.formData()`. After parsing, immediately reject `fileEntry.size > MAX_UPLOAD_FILE_BYTES` before filename/topic/settings work and before image processing. If multipart overhead makes a strict pre-body cap awkward, use a route-local constant aligned with the nginx 216 MiB budget and keep the exact `fileEntry.size` check after parse. Add a route/source test that the LR path imports `MAX_UPLOAD_FILE_BYTES`, performs a pre-`formData()` declared-size guard, and performs a post-parse file-size guard.

Cross-perspective impact:
- Security/operations: proxy configuration is currently carrying the primary protection for one upload ingress.
- UX/correctness: browser uploads silently skip oversized files before transfer, while LR can spend the whole upload only to fail after parsing.
- Tests/maintainability: existing source-contract coverage checks cumulative quota but omits the per-file invariant that the product docs rely on.

## Cross-Agent-Style Agreement Signals

I independently saw the same pattern from multiple review lenses:
- Migration drift is called out repeatedly in code comments and tests, yet the current assertion set still permits schema columns that are reconcile-only and invisible to journal-covered databases. Architecture, operations, and test lenses converge on the same failure mode.
- Browser/LR upload parity is a repeated explicit goal in the LR route comments, nginx comments, and source-contract tests. The omitted per-file pre-parse guard is therefore not a stylistic preference; it is a missed invariant across security, UX, and operational boundaries.

## Final Sweep

Commonly missed issue classes checked:
- Admin API auth wrapping through `withAdminAuth`.
- Mutating server action same-origin guards.
- Public mutating API rate-limit pre-increment helpers and documented exemptions.
- Public privacy projections for admin-only fields.
- JSON-LD injection sites and CSP nonce use.
- Upload filename/path traversal and original-file serving controls.
- Semantic-search body caps, same-origin checks, and expensive-resource rate-limit posture.
- Public analytics pre-lookup rate limiting and crawler behavior.
- Deployment/body-size contracts across Next config and nginx.
- Migration journal monotonicity, reconcile coverage, and schema-runtime write sites.
- Touch-target/a11y-related test surfaces and localized public copy surfaces.

No additional high-confidence findings were promoted from that sweep. One low-risk documentation wart remains: `apps/web/src/lib/safe-json-ld.ts:4` says ``<` -> `<`` even though the implementation at `apps/web/src/lib/safe-json-ld.ts:15-19` correctly escapes to `\\u003c` / `\\u003e`; that comment should be fixed when nearby security-helper docs are touched, but I did not treat it as a cycle-blocking product issue.

Verification performed for this review:
- Read project guidance and code-review skill.
- Built the review inventory before findings.
- Ran repository-wide scans for guard coverage, unsafe sinks, upload limits, schema/migration drift, env/config, and TODO/source-contract patterns.
- Read the high-risk files and all migration SQL relevant to the findings.
- No lint/typecheck/test suite was run because this was a review-only artifact and no production code was modified.
