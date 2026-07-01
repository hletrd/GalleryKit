# Cycle 69/100 Aggregate Review

Start HEAD: `87e2b98db76e90985299e37ad90cf2faad12c5c4` (current deployed `master` HEAD at cycle start per invocation).

## Review Inputs

- `code-quality.md`
- `security.md`
- `test-verifier.md`
- `perf-concurrency.md`
- `debugger-tracer.md`
- `ui-accessibility-docs.md`
- Main-lane source inspection of settings validation/state, backfill status, service worker cache, semantic embedding side effects, current plan/review ledgers, and deploy documentation.

## Deduplicated Findings

### C69-01 - `image_sizes` accepts derivatives below the documented 128 px floor

- Severity/confidence: Medium / High.
- Cross-agent agreement: code-quality.
- File/line: `apps/web/src/lib/gallery-config-shared.ts:245`, `apps/web/src/lib/gallery-config-shared.ts:254`, `apps/web/messages/en.json:730`.
- Evidence: the shared normalizer only rejects values `<= 0` and `> 10000`; UI copy promises 128 through 10000.
- Failure scenario: a fresh gallery can save tiny derivative widths and every future upload can generate/publicly advertise unusable image candidates.
- Fix direction: enforce a shared 128 px minimum and test 127 rejection / 128 acceptance.

### C69-02 - Zero-candidate in-app backfill is still recorded as a clean completed run

- Severity/confidence: Low / High.
- Cross-agent agreement: code-quality + UI/docs main lane.
- File/line: `apps/web/src/lib/admin-backfill-runner.ts:856`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:370`, `apps/web/messages/en.json:803`.
- Evidence: the zero-candidate path increments `completedRuns`; the Settings last-run panel can render "Completed cleanly - 0 photo(s) re-encoded" beside the Cycle 68 sidecar-required toast.
- Failure scenario: operators get mixed signals after a settings-only byte-impacting change with no stale pipeline-version rows.
- Fix direction: surface a distinct no-candidate last-run state and message.

### C69-03 - Saved settings-only re-encode obligation is still mostly source-contract covered

- Severity/confidence: Medium / High.
- Cross-agent agreement: test-verifier.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:184`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:250`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:262`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:10`.
- Evidence: current coverage pins state-machine substrings rather than behavior.
- Failure scenario: a refactor preserves substrings while clearing the saved pending state after save.
- Fix direction: extract and test a pure helper for pending-baseline transition.

### C69-04 - Same-ETag `HEAD 200` still starts a full image body revalidation

- Severity/confidence: Low / Medium.
- Cross-agent agreement: performance.
- File/line: `apps/web/public/sw.template.js:335`, `apps/web/public/sw.template.js:343`, `apps/web/public/sw.template.js:351`, `apps/web/public/sw.js:335`, `apps/web/src/__tests__/sw-template-contract.test.ts:224`.
- Evidence: same-ETag HEAD sets `cacheVerifiedByProbe = true` but falls through to the background `startRevalidate()` body GET.
- Failure scenario: warm cached masonry revisits can transfer image bodies unnecessarily when the intermediary returns HEAD 200 with the unchanged ETag.
- Fix direction: refresh timestamp/touch metadata and return cached immediately on same-ETag HEAD 200. Regenerate `sw.js`.

### C69-05 - Post-upload embeddings can use stale upload-time semantic mode

- Severity/confidence: Medium / Medium.
- Cross-agent agreement: debugger/tracer.
- File/line: `apps/web/src/lib/image-queue.ts:753`, `apps/web/src/lib/image-queue.ts:766`, `apps/web/drizzle/0012_image_embeddings.sql:10`, `apps/web/src/app/api/search/semantic/route.ts:270`, `apps/web/src/app/api/search/similar/[id]/route.ts:135`.
- Evidence: the embedding side effect prefers the upload-time `semanticSearchMode` snapshot after processing. The table is keyed by `image_id`, while production routes filter on active model version.
- Failure scenario: mode changes between upload and processing completion can skip a production embedding or overwrite a production row with a stale stub row until bootstrap/backfill repairs it.
- Fix direction: resolve current runtime-gated semantic mode immediately before storing the post-processing embedding.

## Existing Carry-Forward Item Reconfirmed

- `C61-07` - Lightroom upload route handler-level coverage gap. This was re-observed by the test/verifier lane with the same exit criterion: add handler-level route tests for token scope/actor, GPS-strip failure, HDR rejection cleanup, DB insert, and enqueue snapshot. It is not counted as a new Cycle 69 source defect.

## Scheduled This Cycle

- `C69-01` through `C69-05` are all scheduled.

## Deferred / Not Scheduled

No new Cycle 69 findings are deferred. The existing carry-forward deferred list remains tracked in the Cycle 69 deferred file.

## Agent Failures / Deviations

- Native subagent capacity allowed five concurrent generic review agents. The UI/accessibility/documentation lane was completed in the main thread after the sixth spawn failed on the thread limit.
- The UI lane did not start a local browser; the scheduled findings are source/test-level and do not require screenshot evidence.

## Disposition

Five new deduplicated findings, all scheduled this cycle. No new security finding was confirmed.
