# Plan 305 — Run-4 Cycle 17 fixes

**Source review:** `.context/reviews/run4-cycle17/_aggregate.md`
**Status:** PENDING (update per task as landed)
**Gates per repo policy:** eslint, typecheck, vitest, api-auth lint,
action-origin lint, public-route-rate-limit lint, production build,
playwright e2e — all 8 must be green before deploy. GPG-signed
conventional commits + gitmoji; commit+push per task; per-cycle deploy.

## Task 1 — SEC-R4C17-01 (+TEST-R4C17-01, +DOC-R4C17-02): charge post-DB failures on the per-photo OG route
**Severity:** MED/High (security/abuse-resistance). 5/6 cross-angle.
**Files:**
- `apps/web/src/app/api/og/photo/[id]/route.tsx` — DELETE the
  `rollbackOgAttempt(ip)` calls on the `!image` branch (:83), the
  `!fetched` branch (:116), and the catch path (:221). KEEP the two
  pre-DB rollbacks on the syntactic id-validation rejections (:63,
  :68). Add a comment on the `!image` branch mirroring the sibling
  route's charged-404 rationale (enumeration oracle / unmetered DB
  load), citing SEC-R4C17-01.
- `apps/web/src/lib/rate-limit.ts` — rewrite the `rollbackOgAttempt`
  docstring (:224-228): rollback is ONLY for rejections that consumed
  no post-validation work (malformed params before any DB/CPU);
  post-DB failures stay charged per the enumeration-oracle policy
  (AGG8F-01); point at both routes' source-contract tests.
- `apps/web/src/__tests__/og-photo-fallback.test.ts` — flip the
  rollback assertion: exactly 2 `rollbackOgAttempt(ip)` occurrences,
  both BEFORE the `getImageCached` call in source order; negative
  assertions that the `!image` / `!fetched` / catch branches do not
  refund. Keep all runtime helper cases unchanged. Prove failing
  pre-fix (assertion flip first), green post-fix.
**Acceptance:** vitest green incl. flipped lock; both OG routes encode
the same charged-post-DB policy; docstring no longer cites
"topic not found" as a rollback example.
**Progress:** PENDING

## Task 2 — DES-R4C17-03: accessible names for dashboard pagination controls
**Severity:** LOW/High (a11y).
**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
  — add `aria-label` to the two disabled chevron-only placeholder
  Buttons AND the two enabled prev/next Buttons (page number alone is
  a weak name): `t('dashboard.previousPage')` / `t('dashboard.nextPage')`.
- `apps/web/messages/en.json` + `ko.json` — add
  `dashboard.previousPage` ("Previous page") / `dashboard.nextPage`
  ("Next page") and Korean equivalents ("이전 페이지" / "다음 페이지").
**Acceptance:** no icon-only button without an accessible name on the
dashboard; eslint/typecheck green.
**Progress:** PENDING

## Task 3 — DES-R4C17-04: announce retry success
**Severity:** LOW/Medium (a11y/feedback parity).
**Files:**
- same dashboard client — `toast.success(t('dashboard.retrySuccess'))`
  in the success branch of `handleRetry`.
- `en.json`/`ko.json` — `dashboard.retrySuccess`
  ("Queued for re-processing." / "재처리 대기열에 추가되었습니다.").
**Acceptance:** success and failure paths both announce via the
established sonner live-region channel.
**Progress:** PENDING (may land in one commit with Task 2 — same file,
same i18n namespace, same a11y class)

## Task 4 — COR-R4C17-05: warning parity for control-char-rejected tag names in bulk tag update
**Severity:** LOW/Medium (correctness of partial-success reporting).
**Files:**
- `apps/web/src/app/actions/tags.ts` — in `batchUpdateImageTags`'s add
  loop (:397-408) and remove loop (:423-428), push
  `warnings.push(t('invalidTagName'))` on the `nameRejected` path
  before `continue` (generic key only — NEVER echo the rejected value;
  `requireCleanInput` returns null by contract on rejection).
**Acceptance:** a rejected name now surfaces in `warnings[]` exactly
like a format-invalid name; no dirty value echoed; action-origin lint
green (no signature change). TEST-R4C17-03 disposition: no DB-coupled
harness exists for this action — document the exercised path in the
commit body per the test-engineer note.
**Progress:** PENDING

## Gate run + deploy record (cycle close)
To be filled during PROMPT 3: all 8 gates with counts, GATE_FIXES
note, DEPLOY record with live-probe evidence.
