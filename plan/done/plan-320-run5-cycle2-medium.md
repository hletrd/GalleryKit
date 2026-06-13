# Plan 320 — MEDIUM fixes (Run-5 Cycle 2)

**Source:** `.context/reviews/run5-cycle2/_aggregate.md`. Original severities/confidences preserved. MED doc-only items live in plan-321 (severity preserved there), matching the plan-316 precedent.

## A. Correctness & honesty

### Item 1 — AGG-R5C2-07 (MED, High, confirmed): strip `[AUTO]` at the `applyAltSuggested` copy site
- `apps/web/src/app/actions/images.ts:969-986` — `caption.replace(ALT_TEXT_STUB_PREFIX_RE, '')` before copying `alt_text_suggested` into `title`/`description`; skip rows that strip to empty.
- Centralize: export one `stripStubPrefix(value: string): string` helper (client-safe module from plan-319 item 2) used by both `photo-title.ts` and `images.ts`.
- `apps/web/src/lib/photo-title.ts:112-113` — delete the false "raw value is still returned for alt='' by callers" comment (no such consumer exists); tighten the CRT-R5C1-02 coverage claim.
- Regression test for the copy path (extend `photo-title-stub-prefix-strip.test.ts` or `bulk-update-images.test.ts`).

### Item 2 — AGG-R5C2-08 / TRC-R5C2-01 (MED, High, confirmed): per-image advisory lock in backfill `reprocessOne`
- `apps/web/src/lib/admin-backfill-runner.ts:178-281` — acquire `gallerykit:image-processing:{id}` (exported from `@/lib/advisory-locks`) before `processImageFormats`; skip the row (no version bump) if the lock is unavailable (queue worker owns it); release after the UPDATE in a finally.
- Mirror in `apps/web/scripts/backfill-color-pipeline.ts` if it shares the same gap (verify first).
- Closes the retryFailedImage-vs-backfill concurrent-encode race.

### Item 3 — AGG-R5C2-09 / BUG-R5C2-05 (MED, High, confirmed): embedding-hook stub contract
- `apps/web/src/lib/image-queue.ts:405-434` — stub embeddings ARE required for the stub demo search to return results, so keep writing in `'stub'` mode (consistent with plan-319 item 1 disclaimer posture). Make the contract explicit: comment documenting that stub vectors are meaningless, plus ensure the stored row carries stub provenance (`CLIP_MODEL_VERSION`/model column — verify `clip-embeddings.ts` stores a model identifier; if not, add one) so a future real encoder never serves or overwrites blindly.

### Item 4 — AGG-R5C2-10 (MED, High, confirmed): backfill observability counters
- `apps/web/src/lib/admin-backfill-runner.ts:178-211,319-354` — `reprocessOne` returns `{ ok: true } | { ok: false; reason: 'missing-original' | 'encode-failed' | 'detection-failed' | ... }`; runner tallies `skipped`/`encodeFailures`; include in the periodic progress log, the final `Run complete` summary, and `AdminBackfillState` (surface `lastError` for encode failures).
- Update `admin-backfill-runner-leak.test.ts` / batching test expectations if shapes change.

### Item 5 — AGG-R5C2-12 / COR-R5C2-03 (MED, Med, likely): `formatTitleAsTags` empty tokens
- `apps/web/src/lib/photo-title.ts:48-50` — `.split(/\s+/).filter(Boolean)` before mapping to `#word`; add a test for leading/multiple-space titles.

## B. UI

### Item 6 — AGG-R5C2-13 / DES-R5C2-01 (MED, High, confirmed): shared-group back-link touch target
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:140,172` — add `min-h-11` to both "View Gallery" links (inline-flex already centers). Check `touch-target-audit.test.ts` SCAN_ROOTS: `app/[locale]/(public)` is NOT scanned (only components/ + admin) — note this gap in the test file comment or extend scanning if cheap.

## C. Test hardening

### Item 7 — AGG-R5C2-14 / TEST-R5C2-03+16 (MED, confirmed/likely): session-verify isolation
- `apps/web/src/__tests__/session-verify.test.ts` — `vi.resetModules()` in `beforeEach` of the `getSessionSecret` describe; unique random bytes per `makeToken` call so React `cache()` can't dedupe across tests.

### Item 8 — AGG-R5C2-15 / TEST-R5C2-04 (MED, confirmed): sw-cache timestamp test determinism
- `apps/web/src/__tests__/sw-cache.test.ts:191` — fake timers / `vi.setSystemTime` instead of the 2 ms sleep.

### Item 9 — AGG-R5C2-16 / TEST-R5C2-08 (MED, confirmed): `process-topic-image.ts` unit tests
- New tests (tmpdir-based, real Sharp on a tiny fixture or mocked Sharp): output path construction, temp-file cleanup, delete path, orphan cleanup.

### Item 10 — AGG-R5C2-17 / TEST-R5C2-09 (MED, confirmed): `gallery-config.ts` resolver tests
- New `__tests__/gallery-config.test.ts`: DB-override-wins, invalid value → default (incl. the `'production'` heal), numeric/boolean coercion, unknown keys ignored.

### Item 11 — AGG-R5C2-18 / TEST-R5C2-10 (MED, confirmed): e2e `/s/[key]` + 404
- `apps/web/e2e/public.spec.ts` — shared-link page renders (needs seeded share or graceful skip like the admin opt-in pattern); unknown route renders the localized 404 page.

### Item 12 — AGG-R5C2-19 / TEST-R5C2-12 (MED, confirmed): download GET interstitial behavioral tests
- New behavioral tests: valid token → 200 HTML, correct Content-Type, CSP header, `X-Robots-Tag: noindex, nofollow`, form action; expired token → 410; refunded → 410.

## D. Docs-adjacent code comment

### Item 13 — AGG-R5C2-11 / PERF-R5C2-01 (MED, High, confirmed — ship-and-tune): analytics `'all'`-window aggregation note
- `apps/web/src/lib/analytics-data.ts:93-114,169-190` — comment documenting that the `(bot, viewed_at, *)` indexes serve the windowed (default) case; the `'all'` window is a covering-index temp-table aggregation bounded by retention (plan-315 item 12). Index re-ordering is DEFERRED with EXPLAIN exit criterion (plan-322).

## Progress

| # | Finding | Commit | Status |
|---|---|---|---|
| 1 | AGG-R5C2-07 | 3b5d9f20 (+6d17ca58 helper) | DONE |
| 2 | AGG-R5C2-08 | a5e787ee | DONE (runner); sidecar half deferred → plan-322 entry 4b |
| 3 | AGG-R5C2-09 | 5700f184 | DONE — contract + CLIP_MODEL_VERSION provenance documented |
| 4 | AGG-R5C2-10 | a5e787ee | DONE — counters in logs + AdminBackfillState (additive) |
| 5 | AGG-R5C2-12 | 6d17ca58 | DONE — filter(Boolean) + tests |
| 6 | AGG-R5C2-13 | d8307299 | DONE — min-h-11 on both links |
| 7 | AGG-R5C2-14 | eb4432f0 | DONE |
| 8 | AGG-R5C2-15 | eb4432f0 | DONE — fake timers |
| 9 | AGG-R5C2-16 | 1305bc5e | DONE — 12 tests |
| 10 | AGG-R5C2-17 | 67bdf447 | DONE — resolver suite |
| 11 | AGG-R5C2-18 | 3bccd70a | DONE — 404 + /s/[key] specs |
| 12 | AGG-R5C2-19 | 1305bc5e | DONE — 35 tests |
| 13 | AGG-R5C2-11 (doc half) | 22671f52 | DONE — index-utilization comments; index re-order stays deferred (plan-322) |

**All 13 items implemented 2026-06-12 (run-5 cycle-2).**
