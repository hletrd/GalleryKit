# Architecture Review - Cycle 4/100

Date: 2026-06-29
Reviewer role: architect
Scope: current HEAD only (`10b500bb`)
Output: report-only; no application code changes

## Inventory And Review Coverage

I read `AGENTS.md` and `CLAUDE.md` first, then used the existing review history only to avoid stale duplicates. The prior cycle-3 architect report and aggregate review already covered several known debts: process-local single-instance assumptions, detached embedding backfill, brute-force semantic scans, mutable topic slugs, split public selectors, the `api-auth` to app-action import, and dormant storage abstraction. I did not re-file those unchanged carry-forward items unless current HEAD exposed a new architectural failure mode.

Architecture-relevant inventory examined:

- Product and operational contract: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/architect.md`, `.context/reviews/_aggregate.md`, `.context/reviews/architect-debugger-tracer.md`
- Deployment topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/deploy-remote.js`, `apps/web/deploy.sh`
- Routes and server actions: all files under `apps/web/src/app/**/{route.ts,actions.ts,db-actions.ts}` including upload, restore, public analytics, semantic search, similar search, tokens, settings, admin APIs, health, and image serving
- Core architecture modules: `apps/web/src/lib/data.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/clip-*.ts`, `apps/web/src/lib/semantic-*`, `apps/web/src/lib/storage/**`, `apps/web/src/db/schema.ts`, migration scripts, and reconcile/migrate helpers
- State/cache/client boundaries: service worker cache files, upload serving headers, React/server-only config helpers, public selector privacy guards, embedding and smart collection flows
- Test contracts relevant to architecture: restore/upload locking, LR upload parity, semantic search body limiting, privacy fields, storage quarantine, auth/origin/rate-limit lint contracts, touch-target and product constraint tests

Unrelated review artifacts were already modified in the worktree (`.context/reviews/code-reviewer.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`, `verifier.md`). I left them untouched.

## Findings

### ARCH-C4-01 - Lightroom upload accepts and parses work during restore maintenance

Severity: Medium
Confidence: High
Status: confirmed ordering defect; production timing impact is likely

Code region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:70-75` parses the multipart body with `await request.formData()` immediately after token verification.
- `apps/web/src/app/api/admin/lr/upload/route.ts:126-133` reads `topics` before the restore-maintenance gate.
- `apps/web/src/app/api/admin/lr/upload/route.ts:143-148` checks `isRestoreMaintenanceActive()` only after body parsing, metadata validation, and the topic lookup.
- `apps/web/src/app/[locale]/admin/db-actions.ts:310-340` starts the restore maintenance window, flushes buffered state, quiesces the image queue, then runs the DB restore.
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:176-182` only asserts that the restore guard appears before `db.insert(images)`, so the current test contract allows expensive body parsing and a DB read during restore.

Why this is a problem:

`CLAUDE.md` documents restore as a quiescence boundary for upload/queue/database ownership. The browser upload path has an entry guard before meaningful upload work. The Lightroom route does not: it fully materializes the multipart payload and queries `topics` before recognizing that restore maintenance is active. This makes restore maintenance a late write-prevention guard instead of an early entry gate for one of the two production ingest paths.

Concrete failure scenario:

An operator starts a database restore. At the same time, Lightroom retries or publishes a 100-200 MB photo with a valid token. The route accepts the request, parses the whole multipart body, validates fields, and performs a `topics` SELECT while restore has already started dropping/recreating tables. The user can see a 500/404-style failure instead of a retryable 503, while the single web process spends memory and bandwidth on work that the documented maintenance boundary should reject immediately.

Concrete fix:

Move the restore-maintenance entry check to the top of the handler, immediately after cheap auth/token/IP derivation and before `request.formData()` or any database read. Keep the existing late post-save cleanup/recheck because it still covers the mid-request restore race after the original file has been written. Add a source-contract test that asserts the first `isRestoreMaintenanceActive()` check occurs before both `request.formData()` and the `topics` SELECT, not merely before `db.insert(images)`.

### ARCH-C4-02 - Lightroom cumulative upload quota is enforced after full multipart parsing

Severity: Medium
Confidence: High
Status: confirmed ordering defect; resource-exhaustion impact is likely but bounded to authenticated admin/PAT traffic and nginx caps

Code region:

- `apps/web/src/app/api/admin/lr/upload/route.ts:70-75` reads the full multipart body before quota accounting.
- `apps/web/src/app/api/admin/lr/upload/route.ts:77-80` obtains `fileEntry` only after the body has already been parsed.
- `apps/web/src/app/api/admin/lr/upload/route.ts:210-238` initializes the upload tracker, checks cumulative count/bytes, and pre-claims quota only after the parsed `File` exists.
- `apps/web/nginx/default.conf:122-144` intentionally allows this route to receive bodies up to 216 MiB with an admin burst of 10.
- `apps/web/src/app/api/search/semantic/route.ts:140-174` shows the stronger local pattern for body-risk routes: validate body headers and charge the rate-limit budget before body materialization.
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:229-240` checks that tracker logic exists and settles, but not that it runs before `request.formData()`.

Why this is a problem:

The cumulative upload tracker currently protects the save/insert/enqueue stage, not the request-body boundary. For the Lightroom path, the expensive and memory-sensitive operation is `request.formData()`, because Next/Node must materialize the multipart body before the app can inspect `fileEntry.size`. Enforcing the 429 quota after that point leaves the single deployed web process exposed to avoidable parser, memory, temporary storage, and connection pressure.

Concrete failure scenario:

A compromised Lightroom token, a stuck plugin retry loop, or an authenticated admin client sends several 216 MiB multipart requests inside the nginx admin burst window. Every request can be accepted by nginx and parsed by the Node process before the in-process tracker rejects the later ones. On the documented disk-constrained single-host deployment, this can degrade the only web instance even though the route eventually returns 429 before saving files.

Concrete fix:

After auth and the early restore guard from ARCH-C4-01, add a pre-body gate for Lightroom uploads:

- Reject unsupported transfer encodings where body size cannot be known consistently with the upload policy.
- Parse and validate `Content-Length` before `request.formData()`.
- Pre-claim the upload tracker using `Content-Length` or a conservative declared-upload byte budget before parsing.
- After parsing, settle the claim from the conservative body budget to the actual `fileEntry.size`, preserving the existing rollback-on-failure behavior.

Then add a source-contract test that asserts the LR quota/body preflight and tracker claim occur before `request.formData()`. Keep nginx's 216 MiB cap as an outer limit, but do not rely on it as the only resource boundary for the Node process.

## Healthy Boundaries Reconfirmed

- Restore guard fixes from the prior review are present on LR token mutations, public analytics actions, browser upload/delete/update actions, settings mutations, semantic/similar search, and embedding backfill.
- The single-web-instance topology is explicit in Docker/nginx and consistent with process-local state for restore maintenance, upload tracking, queues, and volatile rate-limit buckets. The remaining risk is architectural scale-out debt, already documented in prior reviews.
- `@/lib/storage` remains quarantined from live runtime imports; current storage ownership is still direct local filesystem paths under the upload pipeline.
- Public data selectors and privacy guards remain centralized in `apps/web/src/lib/data.ts` and backed by tests.
- Upload derivative serving and service-worker cache behavior remain aligned: immutable-ish derivative URLs use ETag/settings hashes and bounded revalidation rather than hiding mutable originals behind long-lived opaque cache entries.
- Product constraints still match documentation in the inspected implementation: no paid/Stripe surface, no edit/culling/scoring workflow, and semantic scoring is confined to search/similar-image ranking.

## Missed-Issues Sweep

Final sweep covered route ordering, restore/queue boundaries, upload quota ownership, public/private data selectors, semantic search boundaries, storage quarantine, cache headers/service worker behavior, deployment body limits, migration/reconcile ownership, and product-constraint keywords. I also checked the cycle-3 report and aggregate notes to avoid re-reporting unchanged known debt.

This was a static architecture/design review only. I did not run lint, typecheck, tests, build, or deploy because the requested output was a report-only review of current HEAD with no application-code edits. Runtime concurrency behavior and production memory pressure are therefore validated by code-order evidence rather than load testing.

Finding count: 2
