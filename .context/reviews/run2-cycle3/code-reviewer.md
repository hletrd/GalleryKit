# Code Reviewer — Run-2 Cycle 3 (HEAD 420b7852)

Angle: code quality, logic, SOLID, maintainability. Lens widened per cycle
context to under-reviewed surfaces (serve-upload, image-queue, share routes,
SEO/OG, auth/rate-limit, DB restore) plus a re-examination of the cycle-1/2
backfill fixes for third-order effects.

## Files examined
- `src/lib/serve-upload.ts` (ETag/cache/304/HEAD/TOCTOU)
- `src/lib/image-queue.ts` (claim/retry/bootstrap/restart races)
- `src/app/[locale]/(public)/s/[key]/page.tsx`, `g/[key]/page.tsx`
- `src/app/feed.xml/route.ts`, `sitemap.ts`, `robots.ts`
- `src/app/api/og/route.tsx`, `api/og/photo/[id]/route.tsx`
- `src/app/[locale]/admin/db-actions.ts` (backup/restore)
- `src/app/api/admin/db/download/route.ts`
- `src/app/actions/auth.ts`, `src/lib/rate-limit.ts`, `src/lib/auth-rate-limit.ts`
- `src/app/api/stripe/webhook/route.ts`
- `src/lib/admin-backfill-runner.ts`, `scripts/backfill-color-pipeline.ts` (cycle-1/2 fix re-examination)

## Findings
NONE actionable (no CRIT/HIGH/MED/LOW net-new).

### Verified-clean highlights
- `serve-upload.ts`: ETag composed from `(pipeline_version, mtimeMs, size, settingsHash)`; 304 short-circuit parses comma-separated If-None-Match and `*`; HEAD returns headers-only; streams from `realpath`-resolved path (TOCTOU-safe); symlink + containment checks correct. Logic clean.
- `image-queue.ts`: the claim-retry path (258-280) sets `claimRetryScheduled` and returns; the `finally` (492-505) deletes `enqueued` (so the retry timer's `enqueueImageProcessing` is NOT short-circuited by the `enqueued.has` guard at 244) while preserving `claimRetryCounts` — correct. Conditional `WHERE processed = false` UPDATE + orphan cleanup on `affectedRows === 0` correct. Bootstrap cursor + `permanentlyFailedIds` FIFO eviction with paired retry-map cleanup correct.
- Share routes: rate-limit enforced once in page body (not metadata, avoiding double-increment); metadata stays generic/noindex (no enumeration oracle). Correct.
- Backfill cycle-1/2 fixes: `admin-backfill-runner.ts` detection-failure branch (252-273) and `backfill-color-pipeline.ts` derivative-only branch (181-192 / 326-333) now persist the SAME column set (`was_downscaled`, `avif_10bit`) without bumping `pipeline_version`. `void path` import removed (AGG2-03 done). No third-order divergence found against `image-queue.ts:368` (the queue additionally clears `processing_error`/`failed_at`, but those are only set on `processed=false` rows, which backfill never selects — not reachable).

Confidence: High. The codebase is in a highly-converged state; every surface
carries documented rationale + contract tests.
