# Cycle 57/100 Aggregate Review

Start HEAD: `677a8410933a9aaabbd43721dcc5a0bdb6eee786`.

## Review Lanes

- `code-reviewer.md`
- `security-reviewer.md`
- `perf-reviewer.md`
- `test-engineer.md`
- `designer.md`
- `critic.md`

## Deduplicated Findings

### C57-01 - Public photo render lost public-image cache reuse and starts the main image query late

- Severity: Medium
- Confidence: High
- Cross-agent agreement: perf-reviewer, critic
- Citations: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:55`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:59`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:143`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:150`, `apps/web/src/lib/data.ts:1200`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/lib/data.ts:1730`, `apps/web/src/lib/data.ts:1731`
- Failure scenario: Anonymous `/p/[id]` traffic fetches the public image in metadata through `getImageCached(imageId)`, then the page render waits for locale, translations, SEO, gallery config, and `isAdmin()` before starting `getImageForViewerCached(imageId, false)`. The false branch uses the public select shape but is wrapped by a different React `cache()` function, so metadata/page work does not dedupe and the visible render starts image/tags/prev/next later under DB latency or pool contention.
- Fix: Start the public `getImageCached(imageId)` promise immediately in the page render, resolve admin/config work in parallel, reuse the public promise for non-admin visitors, and fetch admin fields only for admins. Update the source contract to pin that branch split.

### C57-02 - Admin photo audit-data regression is guarded by source strings instead of behavior

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer, critic
- Citations: `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:13`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:14`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:24`, `apps/web/src/__tests__/cycle-56-source-contracts.test.ts:28`, `apps/web/src/lib/data.ts:1204`, `apps/web/src/lib/data.ts:1205`
- Failure scenario: Cycle 56 restored admin audit rows by selecting admin fields only after `isAdmin()`, but the regression test only checks literal snippets. A future refactor could leave the strings in comments or make `getImageForViewer` ignore its boolean while the test still passes, causing logged-in photographers to lose color/HDR/original-file audit rows again.
- Fix: Add behavior-level coverage for `getImageForViewer` that asserts the public branch omits representative privacy-sensitive keys and the admin branch includes representative audit fields.

### C57-03 - Changed `strip_gps_on_upload` lock branch lacks behavior coverage

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer, critic
- Citations: `apps/web/src/app/actions/settings.ts:103`, `apps/web/src/app/actions/settings.ts:112`, `apps/web/src/app/actions/settings.ts:142`, `apps/web/src/app/actions/settings.ts:149`, `apps/web/src/__tests__/settings-semantic-mode-action.test.ts:198`, `apps/web/e2e/admin.spec.ts:73`
- Failure scenario: A stale same-origin admin client or direct server-action call submits `strip_gps_on_upload=true` after images already exist. The server action should detect a real upload-processing contract change, acquire/release the contract lock, and return `uploadSettingsLocked` before persistence. Current tests only prove unchanged `false` payloads skip active-upload checks, while E2E only proves the hydrated UI can show a disabled toggle.
- Fix: Add a behavior test mirroring the changed `image_sizes` case: current value `false`, existing image row present, request `true`, expect `uploadSettingsLocked`, lock release, and no transaction/revalidation/audit.

### C57-04 - Cycle 56 release ledger still reads active after two fix commits

- Severity: Medium
- Confidence: High
- Cross-agent agreement: test-engineer, perf-reviewer, critic
- Citations: `.context/plans/README.md:7`, `.context/plans/README.md:12`, `.context/plans/cycle-56-2026-07-01-plan.md:51`, `.context/plans/cycle-56-2026-07-01-plan.md:52`, `.context/reviews/_aggregate.md:3`
- Failure scenario: Current `master` / `origin/master` is `677a8410`, containing the Cycle 56 implementation commit and deploy-stat follow-up, but the plan index still labels Cycle 56 active and the Cycle 56 plan leaves commit/push/deploy unchecked. Future reviewers or operators cannot tell from committed ledgers whether `30dad6a8` or `677a8410` was deployed.
- Fix: Close the Cycle 56 plan with exact commit/push/deploy evidence for `30dad6a8` and `677a8410`, update `.context/plans/README.md` to mark Cycle 56 implemented and advance Cycle 57 pointers, and update `.context/reviews/_aggregate.md` to point at this aggregate.

## Deferred Findings

No new Cycle 57 findings are deferred. Existing carry-forward deferred items remain unchanged:

- `PA-42-02` - production CLIP web-process catch-up advisory locking and caps.
- `TV-40-03` - JavaScript operational scripts need semantic checking.
- `PERF-C39-03` - feed and sitemap updated-time indexes.
- `PERF-C39-04` - backfill pipeline-version indexes.
- `AGG-C38-07` - broad imported-helper side-effect classification.
- `AGG-C38-08` - sidecar keyset pagination.

## Agent Failures

- The native session exposed generic/default subagents rather than all named review roles from the workflow prompt. Six independent review lanes were completed with role-specific prompts and artifacts. The critic/docs lane initially hit the native thread limit, was retried after a completed lane closed, and returned successfully.
