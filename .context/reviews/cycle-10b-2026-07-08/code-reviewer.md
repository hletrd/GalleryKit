# Cycle 10b — Code Reviewer Lane (correctness / logic-bug focus)

**Summary: 1 finding — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW (High-confidence latent logic bug, currently dormant/unreachable in production).**

Reviewed committed HEAD only (`f4faad29`) via `git show HEAD:<path>`, not the dirty working tree. Peer-dirty files (`check-action-origin.ts`, `check-action-origin.test.ts`, `cycle-28-source-contracts.test.ts`) were out of scope. Coverage was exhaustive (every relevant file read in full, not sampled) across five parallel lanes:

1. **Server actions (all 13) + concurrency/locking/auth libs (21 files)** — 0 findings.
2. **Data-access + security libs + all 8 API routes + db/schema.ts + db/index.ts** — 1 finding (F1 below).
3. **Image/color/EXIF/ICC pipeline + upload libs + CLIP + SW cache (48 files)** — 0 findings.
4. **React components/hooks (all 61)** — 0 findings.
5. **Admin client components + all public route pages/layouts** — 0 findings.

Plus a manual pass on `proxy.ts`, `instrumentation.ts`, `i18n/request.ts`, `db-actions.ts` (backup/restore, 1069 lines), and both upload-serving route handlers — no new findings.

This codebase is at an exceptional level of convergence after 29+ prior cycles. Nearly every non-trivial branch carries an inline citation to the specific prior cycle that hardened it, and spot-checks confirmed those fixes are intact. Finding zero *additional* actionable defects in most lanes is the honest, expected outcome — no speculative issues were invented to pad the report.

---

## Findings

### [LOW] F1 — `archiveRange()` produces an invalid `2026-13-01` end date for December (`month === 12`)

- **File:** `apps/web/src/lib/data-timeline.ts:93-101` (committed HEAD; file is NOT peer-dirty)
- **Confidence:** HIGH (that the code is wrong for `month === 12`)
- **Severity:** LOW (currently unreachable from any live caller — dormant landmine, not an active production bug)

**Code (HEAD):**
```ts
function archiveRange(year: number, month?: number): { start: string; end: string } {
    const startMonth = month ?? 1;
    const endYear = month === undefined || month === 12 ? year + 1 : year;
    const endMonth = month === undefined ? 1 : month + 1;   // <-- missing the `month === 12` wrap
    return {
        start: `${year}-${padDatePart(startMonth)}-01 00:00:00`,
        end: `${endYear}-${padDatePart(endMonth)}-01 00:00:00`,
    };
}
```

**Why it's a problem:** `endYear` correctly wraps to `year + 1` when `month === 12`, but `endMonth`'s ternary only checks `month === undefined` — it does not mirror the `month === 12` case, so it computes `month + 1 = 13`. For `archiveRange(2025, 12)` the result is `end = "2026-13-01 00:00:00"`, an invalid MySQL DATETIME literal (there is no month 13). That string binds directly into `lt(images.capture_date, end)` in `getTimelineImages` (`data-timeline.ts:196-223`) against the real `datetime` column `images.capture_date` (`db/schema.ts`). Depending on SQL mode, MySQL either fails the conversion and returns zero rows (silent empty month), or raises a truncation error — either way the December-of-a-specific-year archive query is broken. Months 1–11 and the full-year (`month === undefined`) path are all correct; only `month === 12` is wrong.

**Concrete repro:** `archiveRange(2025, 12)` → `{ start: "2025-12-01 00:00:00", end: "2026-13-01 00:00:00" }`. Correct `end` is `"2026-01-01 00:00:00"`.

**Current impact / why LOW:** No live caller passes a `month` argument today. Verified by full-repo grep — `getTimelineImages` is called year-only from `timeline/page.tsx:94` (`getTimelineImages(selectedYear)`, grouped by month client-side) and from `getYearInReviewImages` at `data-timeline.ts:245` (`getTimelineImages(year)`). So the buggy branch is unreachable in production. It is nonetheless a genuine defect in the function's public, documented contract (the `month` parameter is clearly built for a per-month archive view, matching this repo's "reserved but not yet wired" pattern), and existing timeline tests assert SQL *shape* via source-text extraction, not the actual date-range *values* `archiveRange` returns — so nothing would catch it. The moment a per-month view is wired (or the helper is reused), December silently breaks.

**Suggested fix** (mirror the existing `endYear` ternary exactly):
```ts
const endMonth = month === undefined || month === 12 ? 1 : month + 1;
```
Optionally add a unit test asserting `archiveRange(2025, 12).end === "2026-01-01 00:00:00"` to lock the wrap.

---

## Positive Observations

- Every mutating admin server action follows one carefully-commented pipeline (maintenance gate → same-origin check → mutation-barrier slot → `isAdmin()` → sanitize/validate → rate-limit pre-increment-then-check → conditional UPDATE/transaction with `affectedRows` verification → class-specific rollback → audit → revalidate). Defense-in-depth is consistent, not ad hoc.
- The BoundedMap shallow-copy-write-back bug class (a recurring prior defect) is now uniformly fixed everywhere it was checked.
- `db-actions.ts` restore path is a model of partial-failure discipline: chained advisory locks with a staged releaser that destroys-rather-than-releases a connection whose `RELEASE_LOCK` failed (so a fail-fast lock can't leak onto a pooled session), drain-checklist quiescence of every process-local DB writer before import, and keep-maintenance-on-any-uncertainty semantics.
- Byte-level ISOBMFF/ICC/TIFF parsers (`gps-exif-strip.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, `icc-extractor.ts`, `color-detection.ts`) have consistent bounds checks (offset+size vs. container/buffer end) at each read site.
- CLIP inference slot baton-handoff (`clip-model.ts`) keeps `activeInferenceCount` correct across handoff/timeout/abort races (hand-traced 3-waiter scenario).
- Component layer: per-photo `ImageZoom` remount via `AnimatePresence` key, mutually-exclusive desktop/mobile Histogram mounting, and settle-before-close dialog rollback are all correct.

## Recommendation

**COMMENT** — no CRITICAL/HIGH/MEDIUM issues at any confidence. One LOW-severity, HIGH-confidence latent bug (F1) is worth a one-line fix to defuse before the `month` path is ever wired, but it does not block anything today. No verdict-gating issues; nothing under Open Questions.
