# PERF-REVIEWER — run-8 cycle-1

**Scope:** performance, concurrency, CPU/memory, UI responsiveness of the Stripe paid-download REMOVAL only (`6c5e0b61..47b1e21f`, HEAD `47b1e21f`).
**Method:** read the removal diff for every hot-path file; confirmed query shapes, indexes, render cost, Sharp pipeline, and rate-limit cadence; ran `lsp_diagnostics` (clean) on `data.ts` / `schema.ts` / `photo-viewer.tsx`; swept the full TS/TSX diff for newly-introduced loops/maps/Promise.all/N+1.
**Deferred register read:** `.context/plans/run7-cycle6/deferred.md`. Honored all "do not re-file" instructions (R7C1-CR-02 unconditional-prune class, MED-R7C2-01 histogram clip, REJ-R7C3-01 gps-exif indexSize, NCLX pin class).

## VERDICT: NO PERFORMANCE REGRESSION (Y/N = **N**)

The removal is **strictly subtractive on every hot path**. It deletes state, effects, DOM, config compute, a rate-limit map, a DB table + 2 indexes + 1 column, and a `searchParams` await — and adds nothing on any request path. Net effect is perf-neutral-to-positive. Zero CRITICAL/HIGH/MEDIUM findings. Two INFO observations recorded for completeness; neither is actionable.

## Findings by severity
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 0
- INFO: 2 (non-actionable, recorded)

---

## Hot-path inventory & per-concern adjudication

### Concern 1 — masonry-list queries / tagNamesAgg / index alignment — CLEAN (positive)
`data.ts` diff is exactly 2 deletions: the `license_tier` SELECT removed from `adminSelectFields` (data.ts:262-265 region). The masonry-list queries (`getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`, `getImages`) and the shared `tagNamesAgg` `GROUP_CONCAT(DISTINCT ...)` shape are **byte-unchanged** — grep over the diff for `tagNamesAgg|GROUP_CONCAT|getImagesLite*|getImages\b` returns nothing changed. `publicSelectFields` derives from `adminSelectFields`, so it never carried `license_tier` (it was admin-listed but CLAUDE-documented public; either way unaffected). Dropping one non-indexed `varchar(16)` column from a SELECT is perf-neutral-to-positive (marginally smaller row projection into the InnoDB buffer pool / SSR payload). No query plan regression; all sort/filter still ride the unchanged composite indexes.

### Concern 2 — orphaned / removed indexes — CLEAN (positive)
`schema.ts` drops the `license_tier` column and the entire `entitlements` table including its 2 indexes (`idx_entitlements_image_id`, `idx_entitlements_token_hash`). Both indexes belonged **exclusively** to `entitlements`, which was queried only by the now-deleted checkout/download/webhook routes. `grep -rniE 'entitlement|license_tier|licenseTier' apps/web/src` (excluding tests) returns **zero** surviving references, so no remaining query relied on them. All five `images` composite indexes survive intact and verified at `schema.ts:112-116`:
`idx_images_processed_capture_date`, `idx_images_processed_created_at`, `idx_images_topic`, `idx_images_user_filename`, `idx_images_uploaded_by`.
Migration `0023_remove_paid_downloads.sql` does `DROP TABLE IF EXISTS entitlements` (also drops its FK to `images(id)`) + `ALTER TABLE images DROP COLUMN license_tier`. The 0-row/all-`none` data-loss pre-check is documented in the migration header. The dropped FK + indexes are pure dead-weight removal → slightly less write amplification potential, no read-path loss.

### Concern 3 — rate-limit.ts prune cadence — CLEAN (positive)
`rate-limit.ts` deletes the `checkoutRateLimit` bounded map, its constants, and all 4 helpers (`pruneCheckoutRateLimit`, `preIncrementCheckoutAttempt`, `rollbackCheckoutAttempt`, `resetCheckoutRateLimitForTests`). The surviving maps (OG / share / semantic / login) are untouched — same `createResetAtBoundedMap` construction, same prune cadence, same caps. No per-request work added to any surviving path; one fewer in-memory map + its per-checkout prune is GONE. The known unconditional-per-request-prune latency observation (R7C1-CR-02 class) is NOT re-filed per instruction — and the removal in fact *reduces* the set of maps that pattern applies to.

### Concern 4 — unconditional free-download anchors render cost — CLEAN (positive)
`photo-viewer.tsx` and `info-bottom-sheet.tsx` make the **identical** one-line change: the download-anchor guard drops the `(!image.license_tier || image.license_tier === 'none')` clause, becoming just `downloadHref && (...)`. This is a SHORTER conditional → less per-render work.
The gamut-aware dropdown branch (`isWideGamutSource && avifDownloadHref ? <DropdownMenu> : <single anchor>`) is **PRE-EXISTING** — it appears in the diff only as unchanged context, not as an addition. NO new `useMemo`, `useEffect`, `useState`, or DOM was introduced by the removal. Confirmed by grep: no `isWideGamutSource|avifDownloadHref|useMemo|useDisplayCapability|downloadHref =` lines were added/changed.
The removal additionally DELETES render-cost from `photo-viewer.tsx`: the `isCheckingOut` `useState`, the `checkoutToastFiredRef` ref, the entire checkout-status `useEffect` (the only effect with a `[checkoutStatus, t]` dep + a `window.history.replaceState`), and the `ShoppingCart` icon import + the Buy `<Button>` subtree (incl. a per-render `Intl.NumberFormat` price-format IIFE). Fewer state vars = fewer re-render triggers; fewer effects = less mount work. React #185 `useDisplayCapability` snapshot-stability invariant is untouched (not re-litigated per instruction).

### Concern 5 — process-image.ts Sharp pipeline — CLEAN (byte-unchanged behavior)
`process-image.ts` lost 6 lines, **100% docblock comment** (the `stripGpsFromOriginal` header dropped the "paid-download endpoint streams" wording for "the original is retained"). Verified: filtering the diff for non-comment code lines returns "ALL changed lines are comments." The Sharp pipeline, per-format fresh-decode parallel fan-out (`Promise.all`), 10-bit AVIF probe Promise-singleton, and 50 MP `WIDE_GAMUT_MAX_SOURCE_PIXELS` OOM guard are behaviorally identical. The 6-line delta was pipeline-adjacent COMMENT, not pipeline logic.

### Concern 6 — standard hot-path sweep (N+1 / missing-index scan / unbounded loop / blocking sync) — CLEAN
Full TS/TSX diff sweep for newly-added `for (`, `.map(`, `.forEach(`, `await ... .map`, `Promise.all`, `while (` (`+` lines, comments excluded): **NONE added**. Every such construct touched by the diff is a DELETION (e.g. `LICENSE_TIERS.map` in the bulk-edit dialog, the `licensePrices` object build in `gallery-config.ts`). No new N+1, no scan, no unbounded loop, no blocking sync work on any request path.

Additional positives observed on adjacent request paths:
- **`p/[id]/page.tsx`** (the most-trafficked detail page) removed the `searchParams` prop + its `await searchParams` and the `?checkout=` parse. One fewer async hop on the SSR render path. `revalidate = 0` and dynamic rendering are intact (page already dynamic) — no caching regression.
- **`gallery-config.ts` `getConfig()`** (on every public-page SSR path) does 3 fewer `validatedNumber` calls + drops the `licensePrices` object construction per resolve.
- **`bulkUpdateImages` (`actions/images.ts`)** — admin path — dropped an `isTriState` check, an enum-validation branch, and a `setClause` assignment. Cheaper per bulk edit.

## INFO observations (non-actionable; recorded so next cycle doesn't re-investigate)

- **INFO-R8C1-P1** — `migrate.js reconcileLegacySchema` now calls `dropTableIfPresent('entitlements')` + `dropColumnIfPresent('images','license_tier')` on every reconcile invocation, adding ~2 `INFORMATION_SCHEMA` lookups (`columnInfo`) + idempotent DROP DDL to the reconcile path **permanently**. This is the legacy-baseline/startup-reconcile path (runs at most once per DB to converge schema), NOT a per-request hot path. Mirrors the existing `ensureColumn` ADD pattern in reverse; the authoritative drop for already-provisioned DBs MUST live here because the .sql DROP is baselined-not-run. Negligible, correct, and the only place the drop can live. No action.
- **INFO-R8C1-P2** — `dropTableIfPresent` is a thin wrapper over `DROP TABLE IF EXISTS` (valid MySQL 8.0) kept "for symmetry + a single drop log site" per its comment. One extra unconditional `DROP TABLE IF EXISTS` per reconcile (no-op once gone). Same reconcile-path-only scope as P1. No action.

## Re-file guard compliance
Did NOT re-file: R7C1-CR-02 unconditional-prune latency class; MED-R7C2-01 histogram clip; REJ-R7C3-01 gps-exif indexSize; NCLX matrix/transfer pin class; React #185 snapshot-stability (untouched by removal).
