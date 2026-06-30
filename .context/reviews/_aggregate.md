# Cycle 24/100 Aggregate Review

Date: 2026-06-30 KST  
Repo: `/Users/hletrd/flash-shared/gallery`  
Review scope: current HEAD during the fan-out (`0cc094dd` through review-artifact commits `a6efd6fd` and `7ff1eeec`)  
Agent failures: none

## Fan-Out Coverage

Completed reviewer artifacts:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`
- `product-marketer-reviewer.md`
- `ui-ux-designer-reviewer.md`

Repo-local reviewer prompts discovered and included:

- `product-marketer-reviewer`
- `ui-ux-designer-reviewer`

Browser-backed UI review was performed where feasible. Local DB was unavailable (`ECONNREFUSED 127.0.0.1:3306`), so DB-backed public pages were reviewed in their failure state plus source/test evidence.

Two review agents committed review artifacts during Prompt 1 despite the read-only review instruction:

- `a6efd6fd docs(security): 🛡️ record cycle 24 security posture`
- `7ff1eeec docs(review): 📝 record cycle 24 documentation drift`

## High-Signal Findings Scheduled For Cycle 24

### AGG24-01 - CI E2E gate uses a DB name rejected by the destructive seed guard

- Sources: `test-engineer`
- Severity/confidence: High / High
- Citations: `.github/workflows/quality.yml:27-37`, `.github/workflows/quality.yml:76-77`, `apps/web/scripts/seed-e2e.ts:157-170`, `apps/web/src/__tests__/seed-e2e-safety.test.ts:8-20`
- Problem: CI sets `DB_NAME=gallery`, while `seed-e2e.ts` now requires a disposable DB name or explicit destructive opt-in.
- Failure scenario: Playwright CI fails before browser tests run.
- Disposition: scheduled.

### AGG24-02 - Deploy env files can be group/world-readable before sourcing

- Sources: `critic`
- Severity/confidence: High / High
- Citations: `scripts/deploy-remote.sh:65-77`, `.env.deploy.example:7-14`
- Problem: permission check rejects group/world write/execute but allows read bits such as `0644`.
- Failure scenario: local users on a shared/mounted checkout can read deploy target and SSH key path configuration.
- Disposition: scheduled.

### AGG24-03 - Deploy helper tests do not lock the credential-file permission contract

- Sources: `critic`
- Severity/confidence: Medium / High
- Citations: `apps/web/src/__tests__/deploy-script-contract.test.ts:47-54`, `scripts/deploy-remote.sh:65-72`
- Problem: current deploy contract tests pass even when group/world-readable env files are accepted.
- Failure scenario: future deploy-helper changes weaken the check without test failure.
- Disposition: scheduled with AGG24-02.

### AGG24-04 - Foreground image queue can starve the shared MySQL pool when concurrency is raised

- Sources: `critic`, `code-reviewer`, `tracer`
- Severity/confidence: Medium / High
- Citations: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:446-455`, `apps/web/src/lib/image-queue.ts:519-657`, `apps/web/src/lib/image-queue.ts:812-815`, `apps/web/src/lib/admin-backfill-runner.ts:129-141`
- Problem: `QUEUE_CONCURRENCY` can be 8 while each job may hold an advisory-lock connection across Sharp work on the shared 10-connection pool.
- Failure scenario: large uploads pin most DB connections and live requests queue or fail.
- Disposition: scheduled for a conservative pool-budget clamp.

### AGG24-05 - Semantic text search scans stale/unprocessed embeddings before enrichment drops them

- Sources: `code-reviewer`
- Severity/confidence: Medium / Medium
- Citations: `apps/web/src/app/api/search/semantic/route.ts:270-275`, `apps/web/src/app/api/search/semantic/route.ts:325-331`, `apps/web/src/app/api/search/similar/[id]/route.ts:168-177`
- Problem: natural-language search scans embeddings by model version only, then filters `processed=true` later during enrichment.
- Failure scenario: stale embeddings consume scan/top-K budget and valid processed results are omitted.
- Disposition: scheduled.

### AGG24-06 - Photo swipe state is not reset on `touchcancel`

- Sources: `debugger`
- Severity/confidence: Low / High
- Citations: `apps/web/src/components/photo-navigation.tsx:60-151`
- Problem: touch handlers register `touchstart`, `touchmove`, and `touchend`, but not `touchcancel`.
- Failure scenario: an interrupted gesture leaves translated swipe state until a later touch/rerender.
- Disposition: scheduled.

### AGG24-07 - Similar-photos fetch can update state after unmount and cannot be aborted

- Sources: `debugger`
- Severity/confidence: Low / High
- Citations: `apps/web/src/components/similar-photos.tsx:69-90`
- Problem: async fetch has no abort controller or mounted guard.
- Failure scenario: navigating away while a similar-photo request is pending causes stale state updates and wasted route work.
- Disposition: scheduled.

### AGG24-08 - `IMAGE_CLEANUP_CONCURRENCY` is undocumented in operator/env docs

- Sources: `document-specialist`
- Severity/confidence: Low / High
- Citations: `apps/web/src/app/actions/images.ts:832-837`, `apps/web/.env.local.example:32-39`, `CLAUDE.md:100-110`
- Problem: image-delete cleanup has a NAS-tunable concurrency env var absent from docs/examples.
- Failure scenario: operators tune queue/backfill settings instead of the delete-cleanup path.
- Disposition: scheduled.

### AGG24-09 - Auto-alt-text comments still imply Florence/AI behavior for the current stub

- Sources: `document-specialist`
- Severity/confidence: Low / High
- Citations: `apps/web/src/lib/caption-generator.ts:1-15`, `apps/web/src/lib/gallery-config-shared.ts:39-40`, `apps/web/src/lib/photo-title.ts:90-92`
- Problem: comments describe current EXIF-derived hints as Florence/AI.
- Failure scenario: future docs/copy over-advertise AI captioning that is not implemented.
- Disposition: scheduled.

### AGG24-10 - Korean privacy copy uses internal "topic" terminology

- Sources: `product-marketer-reviewer`
- Severity/confidence: Low / High
- Citations: `apps/web/messages/ko.json:801-804`
- Problem: Korean privacy text says "토픽" while public UI uses "카테고리".
- Failure scenario: privacy copy feels implementation-driven and inconsistent.
- Disposition: scheduled.

### AGG24-11 - Localized JSON-LD and Atom fallbacks hard-code English "Photo"

- Sources: `product-marketer-reviewer`
- Severity/confidence: Low / High
- Citations: `apps/web/src/app/[locale]/(public)/page.tsx:183-198`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:187-200`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:114-127`, `apps/web/src/app/feed.xml/route.ts:60-93`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:74-104`
- Problem: Korean/localized metadata can emit `Photo 123`.
- Failure scenario: SEO/feed consumers see mixed-language names.
- Disposition: scheduled where localized route context is available; unlocalized root feed remains default-locale by contract if left unchanged.

### AGG24-12 - Admin SEO copy promises photo share previews for share routes that intentionally emit generic metadata

- Sources: `product-marketer-reviewer`
- Severity/confidence: Medium / High
- Citations: `apps/web/messages/en.json:473-477`, `apps/web/messages/ko.json:473-477`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:163-180`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:36-78`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:41-83`
- Problem: admin help copy says share pages use the photo, but share routes are generic/noindex/image-less.
- Failure scenario: admins expect rich photo previews on private share links and think settings are broken.
- Disposition: scheduled as copy correction.

### AGG24-13 - Color-fidelity positioning overpromises browser/HDR reality

- Sources: `product-marketer-reviewer`
- Severity/confidence: Medium / High
- Citations: `README.md:8`, `README.md:31`, `README.md:38`, `CLAUDE.md:270`, `CLAUDE.md:297-301`, `CLAUDE.md:376-380`, `apps/web/messages/en.json:389-390`
- Problem: top-level copy implies uniformly accurate color on every supported browser while Firefox/HDR caveats exist.
- Failure scenario: photographers expect HDR/wide-gamut intent to survive uniformly.
- Disposition: scheduled as wording correction.

### AGG24-14 - Some new-tab links lack accessible "opens in new window" cues

- Sources: `designer`
- Severity/confidence: Low / High
- Citations: `apps/web/src/components/footer.tsx:45-53`, `apps/web/src/components/photo-viewer.tsx:875-883`, `apps/web/src/components/info-bottom-sheet.tsx:453-461`, contrast pattern `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:117-122`
- Problem: target-blank links have no accessible context-change cue.
- Failure scenario: screen reader/keyboard users unexpectedly move to a new tab.
- Disposition: scheduled.

### AGG24-15 - Mobile screen-reader users get desktop keyboard shortcut instructions in the photo viewer

- Sources: `ui-ux-designer-reviewer`
- Severity/confidence: Medium / High
- Citations: `apps/web/src/components/photo-viewer.tsx:525`, `apps/web/src/components/photo-viewer.tsx:534-545`, `apps/web/messages/en.json:356`, `apps/web/messages/ko.json:356`
- Problem: the root viewer description includes desktop-only keyboard shortcuts in the mobile accessibility tree.
- Failure scenario: touch users hear irrelevant keyboard instructions before useful viewer controls.
- Disposition: scheduled if the change remains localized to description markup/copy.

## Deferred Findings

The following findings are explicitly deferred into `.context/plans/cycle-24-2026-06-30-deferred.md` with original severity/confidence and re-open criteria:

- DB-offline public pages can remain on a loading shell.
- Category admin server validation is toast-only.
- Admin settings copy is dense with operator/runbook details.
- Protected admin navigation is likely too heavy on small screens.
- Single-writer runtime topology is documented but not enforced.
- Browser/LR upload lifecycle duplication.
- Topic slug remains a mutable primary key.
- Embedding schema has two sources of truth.
- Client action imports and auth reuse cross the app/lib boundary.
- Fire-and-forget public analytics writes are not shutdown-owned.
- Public first pages still pay exact grouped count work.
- Map route can ship/mount 10,000 markers.
- Infinite masonry keeps all loaded cards mounted.
- CSV export materializes the full export in memory.
- Admin analytics fans out grouped aggregate scans.
- Topic navigation computes sitemap-only freshness.
- Semantic/similar search recall and CPU cost are bounded by recency scans.
- Timeline/date archive predicates are non-sargable.
- Image processing format fan-out needs production profiling when knobs increase.
- Lightroom upload behavior tests are still mostly source-contract based.
- Browser upload quota settlement behavior assertions are incomplete.
- CLIP inference queue behavior is source-string locked.
- Real production CLIP validation is skipped by default gates.
- Production semantic threshold needs real-gallery calibration.
- Container base image / OS packages are mutable.
- Bundled nginx cleartext edge assumption needs deployment validation.
- Raw auth error messages are logged.
- E2E visual checks capture screenshots but do not compare baselines / multi-browser visual coverage remains limited.
- Smart collection/archive pages can ship text-only social cards without default OG image.
- Path override env-var support boundary is implicit.
- Reverse-proxy IP trust depends on deployment env validation.

## Verification Notes From Reviewers

Reviewer-run validations included targeted lint gates, typecheck, security tests, deploy-script syntax checks, npm audit, focused UI tests, and agent-browser evidence. Full cycle gates still must run in Prompt 3 after implementation.
