# Code Review Summary

**Files Reviewed:** 247 (repo-wide: docs, manifests, config, app/src, scripts, tests, and e2e)
**Total Issues:** 4

## By Severity
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 4
- LOW: 0

## Verification
- `npm run lint --workspace=apps/web` ✅
- `npx tsc -p apps/web/tsconfig.json --noEmit` ✅
- `npx tsc -p apps/web/tsconfig.scripts.json --noEmit` ✅
- `npm test --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅

## Issues

### [MEDIUM] Infinite scroll hard-stops after 10,000 rows, making older photos unreachable
- **File / region:** `apps/web/src/app/actions/public.ts:11-28`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** `loadMoreImages()` returns an empty page once `offset > 10000`. The homepage/topic UI uses this action for all subsequent paging, so the gallery silently becomes incomplete for larger libraries.
- **Concrete failure scenario:** A gallery with 15,000 photos loads normally until the client reaches offset 10,020. From that point on, `hasMore` becomes false and the oldest ~5,000 photos are no longer browseable through the public UI.
- **Suggested fix:** Replace the hard offset cutoff with cursor/keyset pagination (preferred), or at minimum raise/remove the cap and enforce cost limits with indexed cursor fields instead of a silent functional ceiling.

### [MEDIUM] Sitemap silently omits images beyond 24,000, so large galleries become partially undiscoverable
- **File / region:** `apps/web/src/app/sitemap.ts:14-22`, `apps/web/src/lib/data.ts:835-844`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** The sitemap intentionally truncates image entries to 24,000 to stay below the single-file 50,000-URL limit after locale expansion, but there is no sitemap index or pagination to cover the remainder.
- **Concrete failure scenario:** Once the gallery grows past 24,000 images, every image above that threshold disappears from `sitemap.xml`, so crawlers lose a primary discovery path for a large part of the site.
- **Suggested fix:** Generate paginated sitemaps plus a sitemap index (for example, chunk image IDs and emit `/sitemap-images/1.xml`, `/2.xml`, etc.) instead of hard-truncating the dataset.

### [MEDIUM] CSV export silently truncates at 50,000 rows and still builds the whole file in memory
- **File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-104`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** `exportImagesCsv()` limits the query to 50,000 rows, warns only after the fact, and then concatenates the entire CSV into one string before returning it. That means large galleries get incomplete exports, while memory use still grows with the full exported payload.
- **Concrete failure scenario:** An admin with 80,000 photos exports CSV expecting a full inventory, but receives only the first 50,000 rows. On a large-but-allowed export, the action also allocates one large in-memory string before the browser download starts.
- **Suggested fix:** Stream the CSV (or page it) instead of materializing it in one string, and either export the full dataset or make truncation explicit up front with a hard product limit surfaced in the UI/docs.

### [MEDIUM] Restore maintenance is process-local, so multi-instance deployments can keep serving writes during a restore
- **File / region:** `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`
- **Status:** Likely risk
- **Confidence:** Medium
- **Why this is a problem:** The restore guard lives in `globalThis`, so only the process handling the restore flips into maintenance mode. Any second Node process or horizontally scaled replica will not see that flag.
- **Concrete failure scenario:** In a multi-instance deployment behind a reverse proxy, instance A starts `restoreDatabase()` and quiesces its queue, but instance B still accepts uploads/admin mutations because `isRestoreMaintenanceActive()` remains false there. The restore then races with live writes.
- **Suggested fix:** Move restore-maintenance state to a shared coordination layer (database flag, Redis, filesystem lock visible to all workers, etc.) and have all mutating paths consult that shared state.

## Missed-Issues Sweep
I did a final pass over hard caps, export/indexing surfaces, and process-local coordination state. I did not find additional confirmed logic/maintainability issues beyond the items above.

## Recommendation
**REQUEST CHANGES**
