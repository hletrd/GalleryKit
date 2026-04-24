# Designer (UI/UX) Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** designer (UI/UX review)
**UI/UX detection:** repo contains Next.js App Router with JSX/TSX,
CSS via Tailwind, Radix UI, shadcn/ui components, and i18n. UI/UX
review is in scope.

**Multimodal caveat:** This reviewer operates textually. Findings use
accessibility snapshot semantics, computed styles, ARIA roles, and
precise selectors. No screenshot-dependent claims.

**Browser-automation caveat:** `agent-browser-*` tools were not
invoked in this cycle's review — the changes landed in cycle 6-rpl
are server-side only (lint gates, CSV escaping, advisory-lock docs,
rate-limit rollback). No visual/interactive diff since cycle 5.

## Findings

### DE7-01 — CSV export UX: `warning` field from `exportImagesCsv` is
returned alongside `data` but no UI pathway is verified this cycle
to surface the `csvTruncated` message when row count reaches 50 000.

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:93`

```ts
const warning = rowCount >= 50000 ? t('csvTruncated') : undefined;
```

The admin-dashboard export button handler would need to display this
warning to the user. Without verification, there's a possible silent
truncation.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** verify the client-side export button surfaces the
`warning` value via toast.

### DE7-02 — Share-link creation error message surface: all
rate-limit-exceeded paths return `t('tooManyShareRequests')`. The
message is localized. UI should ensure this flows through the toast
on both `createPhotoShareLink` and `createGroupShareLink` success/
error paths.

**File:** `apps/web/src/app/actions/sharing.ts:119-120, 224-225`

**Severity:** INFORMATIONAL
**Confidence:** MEDIUM

### DE7-03 — Origin-mismatch error: `requireSameOriginAdmin()` returns
`t('unauthorized')` on failure. Same message as session-expired. This
is correct for privacy (no info leak) but may confuse legitimate users
who get logged in-but-wrong-origin.

Risk: an admin opening a stale tab after a domain change sees
"unauthorized" and may assume session expired.

**File:** `apps/web/src/lib/action-guards.ts:41`

**Severity:** LOW (UX tradeoff)
**Confidence:** HIGH
**Recommendation:** accepted tradeoff; log the origin mismatch
server-side for operator diagnosis.

### DE7-04 — Accessibility: the form validation messages for share
rate-limit rely on toast notifications. Screen readers depend on
`aria-live` regions in the toast component. Not re-audited this
cycle; prior cycles found Sonner's default aria-live is `polite`
which is correct for error announcements.

**File:** toast component (not re-read this cycle)

**Severity:** INFORMATIONAL
**Confidence:** MEDIUM

### DE7-05 — Search UX: `searchImagesAction` returns `[]` on rate-
limit. User sees "no results" instead of a distinguishable "slow
down" message. Low discoverability — may confuse legitimate users
who hit the 30-per-minute limit.

**File:** `apps/web/src/app/actions/public.ts:89`

**Severity:** LOW (UX impact)
**Confidence:** HIGH
**Recommendation:** return a sentinel value (e.g.,
`{ throttled: true, results: [] }`) and show "too many searches, wait
a moment" in the UI.

### DE7-06 — CSV export button accessibility: no re-audit of the
button's `aria-label`, `disabled` state, and focus-return. Prior
cycles covered this. No regression indicated by cycle-6-rpl diffs.

**File:** admin dashboard export button

**Severity:** INFORMATIONAL
**Confidence:** MEDIUM

### DE7-07 — Restore maintenance UX: when restore is in progress,
all mutating actions return `t('restoreInProgress')`. UI needs to
display this clearly (not as a generic error). Not re-verified.

**File:** `apps/web/src/lib/restore-maintenance.ts` + admin UI

**Severity:** INFORMATIONAL
**Confidence:** MEDIUM

### DE7-08 — i18n gap check: translation keys referenced in cycle-6-rpl
changes (`tooManyShareRequests`, `restoreInProgress`, `unauthorized`,
`csvTruncated`) should exist in both `en.json` and `ko.json`. Not
verified this cycle.

**File:** `apps/web/messages/{en,ko}.json`

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** grep to confirm.

## Summary

8 findings, all LOW or INFORMATIONAL. Cycle-6-rpl changes were
server-side; no new UI/UX regressions. DE7-01 (CSV truncation warning
surfacing) and DE7-05 (search rate-limit UX) are the most actionable
for a user-facing followup.
