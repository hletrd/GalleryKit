# Performance Review — leader fallback because perf-reviewer agent could not be spawned (thread limit)

## Scope and inventory covered
Reviewed current hot paths across public rendering, interactive photo viewing, and dependency/runtime setup:
- public list/data layer: `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/actions/public.ts`
- interactive viewer: `apps/web/src/components/histogram.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- dependency/runtime/config: `apps/web/package.json`, `package-lock.json`

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 1

## Confirmed Issues

### PERF3-01 — Histogram worker requests are not correlated, causing wasted work and wrong UI during fast photo navigation
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/histogram.tsx:21-58`, `apps/web/src/components/photo-viewer.tsx:50-140`
- **Why it is a problem:** Multiple in-flight histogram requests share one worker and every pending promise listens for the next worker `message`. On rapid navigation, stale requests can resolve newer promises, producing incorrect histograms and wasted canvas/worker work.
- **Concrete failure scenario:** The user arrows through photos quickly; the second photo's histogram briefly or persistently shows the first photo's values while an extra unused worker computation also runs.
- **Suggested fix:** Correlate requests with IDs and ignore stale responses.

### PERF3-02 — Public gallery routes still execute exact `count(*)` queries on every request, including tag-filtered views
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:247-269`, `apps/web/src/app/[locale]/(public)/page.tsx:108-113`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:118-123`
- **Why it is a problem:** The public home/topic routes pair the listing query with a second exact-count query on every request. That scales linearly with table/filter cost and becomes the dominant extra DB work on unauthenticated hot paths.
- **Concrete failure scenario:** On a large gallery, each public request performs both the listing query and an exact filtered count just to drive `hasMore` and the header count, increasing latency and DB load under crawler or burst traffic.
- **Suggested fix:** Move to a cheaper `PAGE_SIZE + 1` strategy for `hasMore`, and defer or cache exact counts separately if the UI still needs them.

## Risks Requiring Manual Validation

### PERF3-03 — Restore mode may expose expensive/read-failure churn under concurrent public traffic
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Status:** Risk requiring manual validation
- **Files:** `apps/web/src/app/[locale]/admin/db-actions.ts`, public read paths under `apps/web/src/lib/data.ts`
- **Why it is a problem:** If public readers continue during restore, repeated read failures or partial scans can create both user-visible inconsistency and avoidable load during maintenance.
- **Suggested fix:** Validate on staging and either gate readers or document/monitor the degraded-read path.
