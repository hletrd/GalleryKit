# Cycle 91 Code Reviewer

Start HEAD: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

Role coverage: code-reviewer plus merged quality/style/API/performance-reviewer coverage. `omx list` reports `style-reviewer`, `quality-reviewer`, `api-reviewer`, and `performance-reviewer` as `review merged -> code-reviewer`, with `code-reviewer` active; performance-specific notes are included below.

## Inventory First

Relevant code inventory built before issue analysis:

- App framework and gates: `package.json`, `apps/web/package.json`, `AGENTS.md`, `CLAUDE.md`.
- DB/schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*`, `apps/web/drizzle/meta/_journal.json`.
- Public data/query layer: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/smart-collections.ts`.
- Public server actions/API routes: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`.
- Admin/API/auth surfaces: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/images.ts`.
- Processing/concurrency surfaces: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`.
- Client responsiveness surfaces: `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/histogram.tsx`, `apps/web/src/components/home-client.tsx`.
- Prior-cycle context read to avoid duplicate stale findings: `.context/reviews/cycle-90-2026-07-01/_aggregate.md`, `code-quality-logic.md`, `performance-concurrency.md`, `test-verifier.md`.

## Confirmed Findings

No confirmed code quality, logic, API contract, maintainability, concurrency, CPU/memory, or UI-responsiveness findings were identified in this lane.

## Performance-Reviewer Coverage

No confirmed performance or concurrency finding was identified.

Evidence checked:

- Public semantic search admits work only after same-origin, maintenance, content-type, content-length, abort, and rate-limit gates; the public CPU scan is capped by `SEMANTIC_SCAN_LIMIT` at `apps/web/src/app/api/search/semantic/route.ts:178` and `apps/web/src/app/api/search/semantic/route.ts:279`.
- Similar-photo search shares the semantic limiter and production-only gate before scanning embeddings, with bounded scan query at `apps/web/src/app/api/search/similar/[id]/route.ts:102` and `apps/web/src/app/api/search/similar/[id]/route.ts:177`.
- Public load-more/search/view-record actions pre-increment bounded rate-limit buckets before DB work at `apps/web/src/app/actions/public.ts:146`, `apps/web/src/app/actions/public.ts:282`, and `apps/web/src/app/actions/public.ts:423`.
- Image processing queue concurrency is clamped against DB pool headroom at `apps/web/src/lib/image-queue.ts:91` and `apps/web/src/lib/image-queue.ts:108`.
- In-app color backfill is keyset-batched and drains each batch before fetching another at `apps/web/src/lib/admin-backfill-runner.ts:736` and `apps/web/src/lib/admin-backfill-runner.ts:811`.
- Backfill concurrency is clamped to leave live DB-pool headroom at `apps/web/src/lib/admin-backfill-runner.ts:129` and `apps/web/src/lib/admin-backfill-runner.ts:710`.
- Upload serving uses ETag short-circuit and HEAD fast path before opening response bodies at `apps/web/src/lib/serve-upload.ts:239` and `apps/web/src/lib/serve-upload.ts:271`.
- Per-photo OG internal fetches are bounded by total time, per-attempt timeout, and byte caps at `apps/web/src/lib/og-photo-fetch.ts:54`, `apps/web/src/lib/og-photo-fetch.ts:73`, and `apps/web/src/lib/og-photo-fetch.ts:86`.
- Client search/similar/load-more paths include abort or stale-result guards at `apps/web/src/components/search.tsx:150`, `apps/web/src/components/search.tsx:203`, `apps/web/src/components/similar-photos.tsx:69`, `apps/web/src/components/similar-photos.tsx:104`, and `apps/web/src/components/load-more.tsx:31`.

## API / Contract Coverage

No confirmed API contract finding was identified.

Evidence checked:

- Admin API routes are wrapped centrally by `withAdminAuth` at `apps/web/src/lib/api-auth.ts:58`, including token-path rate limiting at `apps/web/src/lib/api-auth.ts:76` and cookie-path same-origin enforcement at `apps/web/src/lib/api-auth.ts:116`.
- Lightroom upload and browser upload both acquire the upload/processing contract lock before the save/insert/enqueue window at `apps/web/src/app/api/admin/lr/upload/route.ts:272` and `apps/web/src/app/actions/images.ts:191`.
- Lightroom upload forwards the same processing snapshot fields as browser upload at `apps/web/src/app/api/admin/lr/upload/route.ts:518` and `apps/web/src/app/actions/images.ts:520`.
- PAT creation validates label, scope, and expiry before insert at `apps/web/src/app/actions/lr-tokens.ts:46`, `apps/web/src/app/actions/lr-tokens.ts:55`, and `apps/web/src/app/actions/lr-tokens.ts:77`.
- Public upload serving has realpath containment and symlink checks at `apps/web/src/lib/serve-upload.ts:176`, `apps/web/src/lib/serve-upload.ts:182`, and `apps/web/src/lib/serve-upload.ts:186`.

## Likely / Manual-Validation Risks

These are not confirmed defects:

- Production CLIP inference was reviewed by source only. The queue bounds and abort handling are present at `apps/web/src/lib/clip-model.ts:53`, `apps/web/src/lib/clip-model.ts:117`, and `apps/web/src/lib/clip-model.ts:156`, but this review did not load real model weights or run an end-to-end production semantic search.
- Sharp/libvips encode and backfill behavior was reviewed by source only. The concurrency and recovery contracts are present in `apps/web/src/lib/image-queue.ts:640` and `apps/web/src/lib/admin-backfill-runner.ts:547`, but no live encode/backfill run was executed under this bounded review.
- Full `lint`, `typecheck`, `build`, and full test suite were not run. The focused route/action scanners below passed, but broad gates remain outside this review artifact's evidence.

## Validation Evidence

Initial `npm run lint:* --workspace=apps/web` invocations failed because the sandbox rejected `tsx` IPC pipe creation with `listen EPERM`. Re-running the same scanner entrypoints through `NODE_OPTIONS='--import tsx' node ...` succeeded:

- `NODE_OPTIONS='--import tsx' node scripts/check-api-auth.ts`: passed for `src/app/api/admin/db/download/route.ts` and `src/app/api/admin/lr/upload/route.ts`.
- `NODE_OPTIONS='--import tsx' node scripts/check-action-origin.ts`: passed; every mutating server action enforces same-origin provenance.
- `NODE_OPTIONS='--import tsx' node scripts/check-public-route-rate-limit.ts`: passed; public mutating/expensive routes are rate-limited or carry explicit exemptions.
- `omx list` confirmed `performance-reviewer  review  merged  -> code-reviewer`.

## Final Missed-Issue Sweep

Additional sweep categories:

- Searched source inventory with `rg --files`, then narrowed high-risk app, API, data, queue, processing, and client component files.
- Reviewed previous cycle aggregate and code/performance/test artifacts to avoid duplicating Cycle 90's closed documentation-ledger issue.
- Searched for `TODO`, `FIXME`, `HACK`, `XXX`, lint suppressions, `@ts-ignore`, `@ts-expect-error`, `Promise.all`, timers, fetches, direct SQL, `GROUP_CONCAT`, `COUNT(*) OVER`, `offset`, `inArray`, and `notInArray` usage.
- Checked scanner coverage for admin API auth, mutating server action origin checks, and public route rate limits.
- Checked route/file-serving containment, ETag/HEAD paths, server-side OG fetch budgets, public search scan caps, upload quota/lock windows, queue retry cleanup, and in-app backfill batching/concurrency.

Files/categories examined are recorded in the inventory above. No source files, plans, aggregate files, commits, pushes, deploys, network, sudo, NFS, or destructive actions were performed.
