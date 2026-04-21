# Code Review — Cycle 9 (code-reviewer)

## Scope / inventory
I built a repo-wide inventory first and examined every **review-relevant tracked text/code file** under the workspace, excluding generated/runtime/vendor artifacts (`.next/`, `node_modules/`, `test-results/`, `.omx/`, `.omc/`, binary assets).

**Examined file inventory:** 227 files total
- Root/docs/config/scripts: 16
- `apps/web/src/app`: 54
- `apps/web/src/components`: 44
- `apps/web/src/lib`: 40
- `apps/web/src/db` + `src/i18n` + `src/instrumentation.ts` + `src/proxy.ts`: 6
- `apps/web/src/__tests__`: 22
- `apps/web/scripts`: 10
- `apps/web/e2e`: 5
- Migrations/messages/config/support files: remainder

## Verification / diagnostics
- `npm test --workspace=apps/web` ✅ (`22` test files, `131` tests passed)
- `npx tsc -p apps/web/tsconfig.json --noEmit` ✅
- `cd apps/web && npx eslint src scripts e2e --ext .ts,.tsx,.js,.mjs` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- Attempted OMX code-intel `lsp_diagnostics_directory` / `ast_grep_search`, but the MCP transport was closed during this review, so I used CLI fallback (`tsc`, `eslint`, targeted `rg`, full-file reads).

## Verdict
**REQUEST CHANGES**

## Findings

### 1) [HIGH] [Confirmed] New topic creation can silently hijack an existing alias route
**Confidence:** High

**Evidence**
- `apps/web/src/app/actions/topics.ts:58-87` validates slug format/reserved segments, then inserts directly, but never checks `topic_aliases` for collisions.
- `apps/web/src/app/actions/topics.ts:15-31` already has the shared `topicRouteSegmentExists()` helper.
- `apps/web/src/app/actions/topics.ts:158-160` uses that helper for `updateTopic()`.
- `apps/web/src/app/actions/topics.ts:319-320` uses that helper for `createTopicAlias()`.
- `apps/web/src/lib/data.ts:612-644` resolves **direct topic slugs before aliases**.

**Failure scenario**
1. Existing alias `sunset` points to topic `portfolio`.
2. Admin creates a new topic with slug `sunset`.
3. The insert succeeds because there is no cross-table collision check.
4. Public requests to `/sunset` now resolve to the new direct topic instead of the old alias target, breaking bookmarked/shared URLs and silently retargeting traffic.

**Why this matters**
The repo already treats topic slugs and aliases as one public route namespace everywhere else. `createTopic()` is the one write path that does not enforce that invariant.

**Fix**
Before inserting in `createTopic()`, call `topicRouteSegmentExists(slug)` and reject when either a topic slug **or alias** already occupies that route segment. Add a regression test covering “create topic with existing alias”.

---

### 2) [HIGH] [Confirmed] Completed background image processing never revalidates the public caches that actually depend on `processed=true`
**Confidence:** High

**Evidence**
- Upload-time invalidation happens only in `apps/web/src/app/actions/images.ts:337-338`.
- At that point new rows are inserted with `processed: false` in `apps/web/src/app/actions/images.ts:221-226`.
- The queue flips rows to processed later in `apps/web/src/lib/image-queue.ts:234-237`.
- Immediately after success, `apps/web/src/lib/image-queue.ts:250-254` explicitly says per-job revalidation was removed and assumes the upload-time revalidation is sufficient.
- Public reads filter on processed rows only:
  - `apps/web/src/lib/data.ts:262-264`
  - `apps/web/src/lib/data.ts:298-300`
  - `apps/web/src/lib/data.ts:395-398`
  - `apps/web/src/lib/data.ts:503-506`
  - `apps/web/src/lib/data.ts:564-567`
- Public pages are ISR-cached for long periods:
  - home: `apps/web/src/app/[locale]/(public)/page.tsx:16`
  - topic: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:16`
  - photo page: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:21`

**Failure scenario**
1. Admin uploads a photo.
2. `uploadImages()` revalidates while the row is still `processed=false`, so home/topic/photo pages still render without it.
3. Background processing later marks the row `processed=true`.
4. No revalidation occurs at that state transition.
5. Result: home/topic pages can stay stale for up to 1 hour, and a photo detail URL that was hit early can cache a 404 for up to 1 week.

**Why this matters**
This is a cross-file regression between the upload action, the async queue, the data-layer `processed` filters, and ISR TTLs. The current invalidation point is attached to the wrong lifecycle event.

**Fix**
Trigger revalidation **after** the queue successfully marks the image processed, using the affected paths (`/`, topic page, photo page, admin dashboard, and any other dependent surfaces). If per-job invalidation volume is a concern, batch post-processing invalidations rather than removing them entirely.

---

### 3) [MEDIUM] [Likely / manual-validation risk] Restore-mode write blocking is process-local, so multi-instance deployments can still mutate data during a restore
**Confidence:** Medium

**Evidence**
- Restore maintenance state lives only in a process-local global symbol in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- `restoreDatabase()` sets that flag in `apps/web/src/app/[locale]/admin/db-actions.ts:249-286`.
- Mutation entry points rely on that same process-local flag, for example `apps/web/src/app/actions/images.ts:86-89`, `apps/web/src/app/actions/topics.ts:37-38`, `apps/web/src/app/actions/tags.ts:46-47`, `apps/web/src/app/actions/sharing.ts:65-66`.
- Shared-group view buffering also skips increments only via the same local flag in `apps/web/src/lib/data.ts:27-40`.

**Failure scenario**
If the app is ever run with more than one Node process/container:
1. Instance A starts a restore and sets its local maintenance flag.
2. Instance B does not see that flag and continues accepting uploads/tag edits/topic changes/share view increments.
3. The DB advisory lock prevents only concurrent restore calls, not normal writes from other instances.
4. Restore can finish with writes interleaved against the restored dataset, producing lost or inconsistent state.

**Why this matters**
The current implementation is safe only for a single-process deployment model. The checked-in Docker docs lean that way, but the code itself does not enforce it, so this remains an operational correctness trap.

**Fix**
Move restore-maintenance state to a shared coordination surface (DB row, Redis, filesystem lock visible to all instances, etc.) and make write gates consult that shared state. At minimum, document single-instance restore as a hard requirement and validate it operationally.

## Missed-issues sweep
I did a final targeted sweep after the main read-through:
- route-namespace collision sweep (`topicRouteSegmentExists`, topic/alias creation paths)
- cache invalidation sweep (`revalidate*` usage vs. async queue state transitions)
- restore/maintenance/auth/path-safety hotspots
- typecheck/lint/test reruns already noted above

No additional higher-severity issues surfaced beyond the three listed here.
