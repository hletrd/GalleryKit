# Code Review — code-reviewer (current checkout only)

## Scope and inventory covered
Reviewed the current checkout at `/Users/hletrd/flash-shared/gallery` only.

Review-relevant files examined across:
- root workspace/config/deploy: `package.json`, `README.md`, `scripts/deploy-remote.sh`
- app config/runtime: `apps/web/package.json`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`
- server code: `src/app/**`, `src/lib/**`, `src/db/**`, `src/i18n/**`, `src/proxy.ts`, `src/instrumentation.ts`
- client code/components: `src/components/**`
- scripts/migrations/seeding: `apps/web/scripts/**`
- tests: `src/__tests__/**`, `e2e/**`

Generated/vendor/artifact files were excluded from deep review where not behavior-bearing (`node_modules`, build artifacts, drizzle snapshots/journals, binary assets).

## Verification run
- `npm run lint --workspace=apps/web` ✅
- `npm run test --workspace=apps/web` ✅ (32 files / 176 tests)
- `npm run build --workspace=apps/web` ✅
- `npm run test:e2e --workspace=apps/web` ✅ (12 passed, 3 skipped opt-in admin specs)
- `npm run lint:api-auth --workspace=apps/web` ✅

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 1
- Risks Requiring Manual Validation: 1

---

## Confirmed Issues

### 1) [MEDIUM] Topic/alias validation still allows locale-reserved route segments (`en`, `ko`)
**Files / regions**
- `apps/web/src/lib/validation.ts:1-16`
- `apps/web/src/app/actions/topics.ts:15-31`
- `apps/web/src/app/actions/topics.ts:58-65`
- `apps/web/src/app/actions/topics.ts:145-163`
- `apps/web/src/app/actions/topics.ts:332-336`
- `apps/web/src/lib/constants.ts:2-4`
- `apps/web/src/app/[locale]/layout.tsx:69-71`

**Why this is a problem**
The reserved topic-route check only blocks `admin`, `g`, `p`, `s`, and `uploads`. It does **not** block the active locale prefixes from `LOCALES` (`en`, `ko`). Because the app router reserves `/{locale}` and `/{locale}/...`, a topic slug or alias that matches a locale creates a route-space collision.

**Concrete failure scenario**
An admin creates topic slug `en` or alias `ko`. The record is accepted, but the public route `/en` or `/ko` is already consumed by the locale segment and resolves to the locale homepage/layout instead of the topic page. The topic/alias becomes unreachable through its intended URL even though admin creation succeeded.

**Suggested fix**
Treat locale codes as reserved topic route segments. The safest fix is to derive reserved segments from `LOCALES` instead of maintaining a separate hardcoded list. Add regression coverage for both topic creation and alias creation with locale values.

**Confidence**: High

### 2) [MEDIUM] Histogram worker requests can resolve with the wrong image’s data during fast navigation
**File / region**
- `apps/web/src/components/histogram.tsx:28-63`

**Why this is a problem**
`computeHistogramAsync()` adds a new `message` listener for each request, but worker responses are not correlated with request IDs. If multiple histogram jobs are in flight on the shared worker, **every pending listener fires on the first worker message**. That lets a later request resolve with an earlier image’s histogram payload.

**Concrete failure scenario**
A user opens a photo, then quickly navigates to the next photo before the first histogram computation returns. Both requests are now waiting on the same worker. When the first worker response arrives, both promises resolve from that same event, so the second photo can render the first photo’s histogram. The real second response then has no listener left to consume it.

**Suggested fix**
Add request IDs to worker messages and keep a pending-request map keyed by ID, or create a dedicated one-shot worker/request channel per histogram job. Also add a client test that navigates rapidly between two images and asserts histogram state stays bound to the active image URL.

**Confidence**: High

---

## Likely Issues

### 3) [MEDIUM] Database restore maintenance mode blocks writers, but public reads still appear live against a partially restoring database
**Files / regions**
- `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`
- `apps/web/src/app/actions/public.ts:10-23`
- `apps/web/src/lib/data.ts` (public query paths; maintenance only gates buffered share-count writes at `28-31`)
- `apps/web/src/lib/restore-maintenance.ts:21-26`

**Why this is likely a problem**
The restore flow sets a process-wide maintenance flag and correctly blocks many mutating admin/server actions. But current public read paths (`loadMoreImages`, search, page-level data fetches) do not check that flag. During a long `mysql` restore, readers can still hit tables while data is being dropped/recreated/reinserted.

**Concrete failure scenario**
An admin starts a restore in production. While the import is replaying DDL/DML, visitors continue loading `/en`, topic pages, search, and share pages. They may see empty/partial galleries, inconsistent pagination totals, or transient SQL failures depending on restore timing.

**Suggested fix**
Decide on explicit restore semantics and enforce them consistently. The cleanest option is to gate public read surfaces during restore (maintenance page / 503 / read-only fallback) rather than only blocking writes.

**Confidence**: Medium

---

## Risks Requiring Manual Validation

### 4) Restore behavior under live traffic needs end-to-end validation, not just unit coverage
**Files / regions**
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- public read paths under `apps/web/src/lib/data.ts` and `apps/web/src/app/[locale]/(public)/**`

**Why manual validation is needed**
The automated suite passes, but it does not simulate a real restore running concurrently with public traffic. Given the current split between writer blocking and reader availability, the correctness risk is operational and cross-process, not something the existing unit/e2e coverage proves away.

**Manual validation scenario**
Run a sizeable restore against a staging deployment while continuously requesting homepage, topic, search, and share URLs from another client. Verify whether users see partial data, 500s, or stale cache artifacts.

**Suggested follow-up**
Add a staging runbook and one explicit restore-during-traffic validation pass before relying on this workflow operationally.

**Confidence**: Medium

---

## Final sweep notes
- Re-checked current tests/build/lint/e2e on the current checkout only.
- Did **not** carry forward any previously fixed findings.
- Current report reflects only issues still observable from the present repository state.
