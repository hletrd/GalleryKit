# Plan 376 - Cycle 19 Review Fixes

Status: DONE
Cycle: 19/100
Source review aggregate: `.context/reviews/_aggregate.md`
Created: 2026-06-30 KST

Repo rules checked before planning: `CLAUDE.md`, `AGENTS.md`, `.context/**`, `docs/**`, root/app README files. Security, correctness, data-loss, gate, trust-disclosure, and concrete accessibility findings are scheduled here unless the deferred ledger records the original severity/confidence, concrete reason, and exit criterion.

## Scheduled Findings

1. AGG-C19-01 - Backup/restore child processes can hang indefinitely while holding maintenance and advisory locks
   - Original severity/confidence: High / High.
   - Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:157-183`, `:205-290`, `:372-438`, `:560-642`, `:667-693`.
   - Implementation: add a shared child-process watchdog for `mysqldump`, `mysql`, and post-restore migration. On timeout, kill the process, destroy attached streams, settle once, and let existing `finally` paths release locks. Preserve restore's `keepMaintenance` policy only for possible partial DB mutation.
   - Tests: add focused source or behavior tests that timeout handling exists for backup, restore import, and post-restore migration paths.
   - Status: [x] DONE.

2. AGG-C19-03 - Privacy page omits first-party view analytics disclosure
   - Original severity/confidence: High / High.
   - Citations: `apps/web/messages/en.json:783-790`, `apps/web/messages/ko.json:783-790`, analytics recorders and schema cited in aggregate.
   - Implementation: add EN/KO privacy copy that discloses first-party photo/topic/shared-group view analytics, fields stored, no full-IP analytics storage, and `VIEW_RETENTION_DAYS` default retention.
   - Tests: update/add privacy/i18n source coverage if existing tests pin privacy copy.
   - Status: [x] DONE.

3. AGG-C19-04 - Primary photo focus target hides photo identity behind a generic zoom action
   - Original severity/confidence: High / High.
   - Citations: `apps/web/src/components/image-zoom.tsx:343-362`, `apps/web/src/components/photo-viewer.tsx:467-548`, `apps/web/src/lib/photo-title.ts:85-122`.
   - Implementation: pass the computed alt/title into `ImageZoom` and include it in the zoom wrapper accessible name, while preserving zoom state/action text.
   - Tests: add source-contract coverage that `PhotoViewer` passes the photo alt into `ImageZoom` and `ImageZoom` composes it into `aria-label`.
   - Status: [x] DONE.

4. AGG-C19-05 - Public route rate-limit scanner accepts aliased non-limiter imports
   - Original severity/confidence: Medium / High.
   - Citations: `apps/web/scripts/check-public-route-rate-limit.ts:96-122`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:270-281`.
   - Implementation: approve imported helpers by exported symbol name, then record the local binding. Prefer exact approved helper prefixes on the exported name.
   - Tests: add regression where `rollbackSemanticAttempt as preIncrementSemanticAttempt` fails.
   - Status: [x] DONE.

5. AGG-C19-06 - CLIP semantic-search inference queue is bounded but abort-insensitive
   - Original severity/confidence: Medium / High.
   - Citations: `apps/web/src/lib/clip-model.ts:53-127`, `apps/web/src/app/api/search/semantic/route.ts:246-264`.
   - Implementation: thread `AbortSignal` from semantic route into `embedTextReal` and slot acquisition. Remove queued waiters on abort and check signal before model execution.
   - Tests: add source/behavior coverage proving `embedTextReal` accepts a signal, `waitForInferenceSlot` removes abort waiters, and route passes `request.signal`.
   - Status: [x] DONE.

6. AGG-C19-07 - Semantic-search rate-limit comments and tests drift from current charged behavior
   - Original severity/confidence: Medium / High.
   - Citations: `apps/web/src/app/api/search/semantic/route.ts:12-16`, `apps/web/src/lib/rate-limit.ts:24-34`, `apps/web/src/__tests__/semantic-search-route.test.ts:230-262`.
   - Implementation: update route/rate-limit comments to document the current charged policy for disabled config lookup and invalid query lengths.
   - Tests: assert short and long semantic queries call `preIncrementSemanticAttempt` and do not rollback.
   - Status: [x] DONE.

7. AGG-C19-08 - Bulk edit dialog state can survive a successful parent-driven close
   - Original severity/confidence: Medium / High.
   - Citations: `apps/web/src/components/bulk-edit-dialog.tsx:81-160`, `apps/web/src/components/image-manager.tsx:225-232`.
   - Implementation: reset dialog state on every `open` transition to false or after successful submit.
   - Tests: add focused source/component contract for reset-on-close behavior.
   - Status: [x] DONE.

8. AGG-C19-09 - Topic deletion can report failure after committed DB delete if image cleanup fails
   - Original severity/confidence: Medium / High.
   - Citation: `apps/web/src/app/actions/topics.ts:429-469`.
   - Implementation: after committed DB delete, audit and revalidate even if image cleanup fails; log cleanup failure as best effort rather than returning DB delete failure.
   - Tests: add source/behavior contract for cleanup failure not skipping invalidation.
   - Status: [x] DONE.

9. AGG-C19-15 / AGG-C19-43 / AGG-C19-44 - CLIP operational docs drift
   - Original severity/confidence: Medium / High for `CLIP_MODELS_ROOT`; Low / High for missing env inventory and stale `tsx`.
   - Citations: `CLAUDE.md:88-112`, `CLAUDE.md:340-353`, `CLAUDE.md:492-527`, `apps/web/.env.local.example:70-75`, `apps/web/package.json:80-84`.
   - Implementation: clarify cwd-relative default versus production absolute `CLIP_MODELS_ROOT`; document `CLIP_INFERENCE_MAX_PENDING`, `CLIP_INFERENCE_QUEUE_TIMEOUT_MS`, `SEMANTIC_SCAN_LIMIT`, and `SEMANTIC_TOP_K_MAX`; update sidecar runbook commands to `tsx@4.22.4`.
   - Tests: docs/source only unless existing tests inspect these strings.
   - Status: [x] DONE.

10. AGG-C19-16 - `robots.txt` blocks `/api/og*` endpoints used as OG images
    - Original severity/confidence: Medium / Medium.
    - Citation: `apps/web/src/app/robots.ts:9-24`.
    - Implementation: add explicit allow rules for `/api/og` and `/api/og/photo/` before disallowing the rest of `/api`.
    - Tests: add/update robots route source or behavior test.
    - Status: [x] DONE.

11. AGG-C19-18 - Public empty gallery state exposes operator instructions to visitors
    - Original severity/confidence: Medium / High.
    - Citations: `apps/web/src/components/home-client.tsx:424-439`, `apps/web/messages/en.json:247-248`, `apps/web/messages/ko.json:247-248`.
    - Implementation: replace public empty-gallery copy with visitor-safe wording. Do not add admin-session branching in this cycle.
    - Tests: i18n parity and source checks.
    - Status: [x] DONE.

12. AGG-C19-19 - Similar photos silently disappears on setup/backfill failures
    - Original severity/confidence: Medium / High.
    - Citations: `apps/web/src/components/similar-photos.tsx:77-104`, similar route error regions.
    - Implementation: keep the panel visible after setup/rate-limit/fetch failures and show localized explanatory copy.
    - Tests: add source or component coverage for non-OK response state.
    - Status: [x] DONE.

13. AGG-C19-20 - Mobile photo swipe navigation is registered on `window`
    - Original severity/confidence: Medium / High.
    - Citations: `apps/web/src/components/photo-navigation.tsx:47-133`, `apps/web/src/components/photo-viewer.tsx:687-694`.
    - Implementation: scope swipe to the photo/media container by passing a ref/element target or ignoring touch starts outside it.
    - Tests: add source contract that listeners bind to the scoped element rather than `window`.
    - Status: [x] DONE.

14. AGG-C19-23 - Token revoke dialog can be hidden mid-request via Cancel
    - Original severity/confidence: Medium / Medium.
    - Citation: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:75-258`.
    - Implementation: disable Cancel while revoke is pending and keep revocation feedback visible.
    - Tests: add source contract if no component harness exists.
    - Status: [x] DONE.

15. AGG-C19-26 - EXIF metadata is visually grouped but semantically flat
    - Original severity/confidence: Medium for a11y semantics / High.
    - Citations: `apps/web/src/components/photo-viewer.tsx:790-825`, `apps/web/src/components/info-bottom-sheet.tsx:335-375`.
    - Implementation: render EXIF key/value blocks with `dl`/`dt`/`dd` while preserving layout.
    - Tests: add source contract that both components use `dt`/`dd`.
    - Status: [x] DONE.

16. AGG-C19-36 - Admin failed-image list is unbounded
    - Original severity/confidence: Low / High.
    - Citations: `apps/web/src/lib/data.ts:1000-1013`, dashboard page fanout.
    - Implementation: cap dashboard failed-image query to a conservative recent limit and document the limit in code.
    - Tests: source contract for `.limit(...)`.
    - Status: [x] DONE.

17. AGG-C19-37 - Topic image processing writes scratch originals inside public resources tree
    - Original severity/confidence: Low / Medium.
    - Citations: `apps/web/src/lib/process-topic-image.ts:11-119`.
    - Implementation: write topic scratch originals under private `data/tmp/topic-resources`, keep public legacy `tmp-*` cleanup for old orphans, and move only final `.webp` into public resources.
    - Tests: source/path contract.
    - Status: [x] DONE.

18. AGG-C19-41 - Upload-serving route handlers lack explicit Node runtime pin
    - Original severity/confidence: Low / High.
    - Citations: `apps/web/src/app/uploads/[...path]/route.ts:1-27`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:1-22`.
    - Implementation: add `export const runtime = 'nodejs'` to both upload fallback route handlers.
    - Tests: source contract.
    - Status: [x] DONE.

19. AGG-C19-42 - Public numeric route params accept huge unsafe integers
    - Original severity/confidence: Low / Medium.
    - Citations: similar, OG/photo, photo page, shared gallery numeric parse sites.
    - Implementation: add shared safe positive integer parser and replace route-local `parseInt()` patterns.
    - Tests: huge unsafe ID regressions for affected routes/helpers where feasible.
    - Status: [x] DONE.

20. AGG-C19-45 - Generated service worker comment becomes false after stamping
    - Original severity/confidence: Low / High.
    - Citations: `apps/web/public/sw.template.js:21-26`, `apps/web/public/sw.js:21-26`.
    - Implementation: rewrite template comment so generated comment remains true, then regenerate `sw.js`.
    - Tests: existing service-worker contract should pass.
    - Status: [x] DONE.

21. AGG-C19-46 - On-this-day date behavior lacks clock-injected behavior tests
    - Original severity/confidence: Low-Medium / High.
    - Citations: `apps/web/src/components/on-this-day-widget.tsx:14-23`, `apps/web/src/__tests__/data-timeline.test.ts:49-200`.
    - Implementation: extract a small date resolver helper and add deterministic tests for normal dates and leap day.
    - Tests: unit test for resolver.
    - Status: [x] DONE.

22. AGG-C19-48 - Timeline sticky month headings can slide under sticky nav
    - Original severity/confidence: Low-Medium / Medium.
    - Citations: `apps/web/src/components/nav-client.tsx:84-88`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:204-208`.
    - Implementation: offset sticky month headings below the nav using the existing 64px nav height token/class.
    - Tests: source contract if applicable.
    - Status: [x] DONE.

23. AGG-C19-51 - Cycle 18 plan status/index is stale
    - Original severity/confidence: Low / High.
    - Citations: `plan/plan-374-cycle18-fixes.md:1-59`, `.context/plans/README.md:3-6`.
    - Implementation: mark plan 374 DONE and move it from active to completed in `.context/plans/README.md`. Keep plan 375 deferred active.
    - Tests: docs/artifact only.
    - Status: [x] DONE.

## Verification Gates

Run every configured gate against the whole repo before final commit/push:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

Then `git pull --rebase`, commit with GPG signing and Conventional Commit + gitmoji, push, and run `npm run deploy` once for per-cycle deployment.

## Completion Notes

Completed in cycle 19. Verification passed:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`
