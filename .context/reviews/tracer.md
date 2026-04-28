# Tracer review — causal flow slice

Reviewer role: `tracer`
Scope: causal tracing across admin auth/session, server-action origin checks, upload → processing → serving, restore/maintenance, shared analytics/config, and navigation/lightbox flows.
Constraint followed: source/tests/config left untouched; this report is the only written file.

## Flow inventory
- Upload / lock flow: `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/app/actions/settings.ts`.
- Origin-gate flow: `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/e2e/origin-guard.spec.ts`, `apps/web/e2e/helpers.ts`.
- Navigation flow: `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/lightbox.tsx`.
- Config/gate flow: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/site-config.example.json`.
- Recovery flow: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/data.ts`, `README.md:146-148`.

## Findings

### T-01 — Upload concurrency and the exclusive lock form a self-starving causal chain
- **Severity:** High
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/components/upload-dropzone.tsx:193-251`, `apps/web/src/app/actions/images.ts:171-176`, `apps/web/src/lib/upload-processing-contract-lock.ts:10-57`, `apps/web/src/app/actions/settings.ts:75-86`
- **Causal chain:** the client deliberately fans out three parallel `uploadImages()` requests. Each request tries to obtain the same exclusive MySQL lock, and the lock is held for the whole request while the server reads config, writes the original, extracts metadata, inserts the DB row, and enqueues processing. That means upload traffic is not just protected from settings changes; it can be blocked by itself.
- **Competing hypotheses:**
  - *Hypothesis A:* the lock is merely a safe guardrail around settings changes.
  - *Hypothesis B:* the lock also serializes uploads and can reject them under load.
- **Why B is stronger:** the client code and the server code together show real concurrent upload requests, while the lock helper only offers a single exclusive `GET_LOCK` with a 5s timeout. Under slow I/O, the second and third requests can time out even though the settings never changed.
- **Suggested fix:** move to read/write coordination or remove the lock from the upload path until it can differentiate settings edits from parallel uploads.

### T-02 — The origin-guard E2E only proves the guard in one branch
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/lib/api-auth.ts:14-26`, `apps/web/src/app/api/admin/db/download/route.ts:13-32`, `apps/web/e2e/origin-guard.spec.ts:28-67`, `apps/web/e2e/admin.spec.ts:6-13`, `apps/web/e2e/helpers.ts:28-45`
- **Causal chain:** the API route is wrapped by `withAdminAuth`, so an unauthenticated request can stop at 401 before the origin check is exercised. The unauthenticated E2E accepts either 401 or 403, and the authenticated E2E branch is skipped when admin credentials are absent.
- **Competing hypotheses:**
  - *Hypothesis A:* the E2E reliably proves same-origin rejection.
  - *Hypothesis B:* the E2E only proves that either auth or the origin guard rejected the request, depending on credentials.
- **Why B is stronger:** the test itself allows 401 and explicitly skips the stronger authenticated branch when credentials are missing. That makes the unauthenticated case a useful smoke test, but not a definitive origin-guard proof.
- **Suggested fix:** require the authenticated branch in protected lanes or fail the spec when credentials are absent so the causal chain actually reaches the same-origin guard.

### T-03 — Swipe math has an inconsistent coordinate origin, which is the most plausible source of gesture bugs
- **Severity:** Medium
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/components/photo-navigation.tsx:46-99`, compared with `apps/web/src/components/info-bottom-sheet.tsx:56-98`
- **Causal chain:** the gesture begins with `screenX/screenY`, the early `preventDefault` decision uses `clientX/clientY` against those screen-origin values, and the final swipe decision uses screen-origin thresholds again. That makes the gesture sensitive to coordinate-space differences that should not matter.
- **Competing hypotheses:**
  - *Hypothesis A:* the mixed coordinate spaces are harmless because the values happen to stay close enough on most desktops.
  - *Hypothesis B:* the mixed coordinate spaces produce misclassification on some mobile/zoomed/browser states.
- **Why B is stronger:** the neighboring `info-bottom-sheet.tsx` gesture handler uses client coordinates consistently, which is the cleaner control case. The divergence here is not a deliberate pattern; it looks like a copy-paste drift.
- **Suggested fix:** standardize the gesture on client coordinates or screen coordinates everywhere, then add a regression test that would fail if the spaces are mixed again.

### T-04 — Analytics rendering and CSP are driven by different sources, so one can silently block the other
- **Severity:** Low
- **Confidence:** High
- **Status:** confirmed
- **Files/regions:** `apps/web/src/app/[locale]/layout.tsx:118-128`, `apps/web/src/lib/content-security-policy.ts:58-69`, `apps/web/src/site-config.example.json:10`, `apps/web/README.md:36-39`
- **Causal chain:** the layout decides whether to render Google Analytics scripts from `siteConfig.google_analytics_id`, while CSP decides whether Google domains are allowed from `NEXT_PUBLIC_GA_ID`. The user-facing rendering path and the security allow-list are not tied together.
- **Competing hypotheses:**
  - *Hypothesis A:* the two knobs are intentionally independent.
  - *Hypothesis B:* the split is accidental and will produce silent analytics failures when only one is configured.
- **Why B is stronger:** the docs expose the file-backed `google_analytics_id`, but CSP has its own env-only branch. That creates a realistic deployment path where scripts are injected but blocked without any explicit app error.
- **Suggested fix:** unify the analytics configuration source or add a startup/validation check that ensures the render path and CSP branch agree.

## Hypotheses validated/refuted during trace
- Confirmed: `requireSameOriginAdmin()` is used as defense in depth on mutating admin actions, and the backup-download route enforces same-origin independently.
- Confirmed: restore maintenance and queue state are process-local, which is fine only if the documented single-writer topology remains true.
- Refuted for current code: the lightbox touch-target fix is not a current bug; the controls now satisfy the 44 px floor.

## Final sweep notes
- I traced the current upload, origin, navigation, and analytics flows against the code and the existing tests rather than trusting the historical review notes.
- No source edits were made.
- The strongest unresolved runtime risk remains the upload lock / concurrency path.

## Summary counts
- Findings: 4 (1 high, 1 medium, 1 medium, 1 low)
- Report file written: `.context/reviews/tracer.md`
