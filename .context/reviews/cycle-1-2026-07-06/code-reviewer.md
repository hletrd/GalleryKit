# Cycle 1 (2026-07-06) — Code Quality Review

Reviewer angle: code quality, logic bugs, missed edge cases, error-handling problems,
invalid assumptions, invariant violations, data-flow/state-consistency, SOLID,
maintainability. Priority areas: `apps/web/src/lib/`, `.../app/actions/`, `.../app/api/`,
`.../components/`, `.../scripts/`.

HEAD reviewed: `657eb024` (== `origin/master`, clean tree). Read-only: no source files
modified; the only write is this review file.

## Executive summary

This is a very mature codebase after ~99 review cycles, and it shows: the load-bearing
subsystems I traced end-to-end — the image-queue permanently-failed/claim/retry state
machine, the `process-image` atomic write/backup/rollback machinery, the shared-group
view-count buffer with its swap/re-buffer/backoff/drain lifecycle, the timeline privacy
guards, and `background-db-writes` — are all correct and defensively written. I found
**no new CRITICAL or HIGH runtime defect**, which is consistent with the critic and
security lanes this cycle.

The genuine new findings are all LOW / LOW-MEDIUM: one real cache-invalidation asymmetry
in the topic OpenGraph route, one error-handling gap on the PAT upload path that can turn
a *successful* upload into a client-visible 500 (and thus a duplicate), one missing
timeout on the optional DB health probe, and two maintainability/consistency issues
(a misleading rate-limit comment and an inconsistent error message). None block release;
CR-01 and CR-02 are the two worth scheduling.

I explicitly did NOT re-file the already-known/deferred items I re-encountered during the
sweep (zoomed-photo touch-pan → nav = deferred `C96-14`; `COUNT(*) OVER()` listing path =
critic `CRIT-05`; over-limit rate-limiter DB rollback = architect cycle-99; restore
foreground mutation fence = `C77-ARCH-01`; embeddings single-model-version PK = deferred
`C94-10`). Those are noted under "Confirmed-but-not-new" so the ledger sees they were
re-validated, not missed.

---

## Findings

### CR-01 | LOW-MEDIUM | High | confirmed
**Topic OpenGraph route ETag omits a pipeline/template version component, so a card
redesign never invalidates crawler/CDN caches.**

File: `apps/web/src/app/api/og/route.tsx:130-133`.

```ts
const etag = '"' + createHash('sha256')
  .update(`${topicRecord.slug}|${topicLabel}|${tagList.join(',')}|${siteTitle}`)
  .digest('hex').slice(0, 32) + '"';
```

Why it's a problem: the ETag input covers only the *content* strings (slug, label, tags,
site title). It does NOT include any encoder/template version. The sibling per-photo OG
route deliberately folds `settingsHash` **and** `pipelineVersion` into its ETag
(`apps/web/src/app/api/og/photo/[id]/route.tsx:70-77`, `createPhotoOgEtag`), precisely so
a code-level change to the rendered card invalidates cached crawler results. The topic
route is the one OG surface missing that guard — an asymmetry, not an intentional policy
(the code comment `AGG8F-01` only claims the ETag "covers the inputs that drive the
rendered image", which is exactly the incorrect assumption, because the JSX/layout/gradient/
fonts also drive the image).

Failure scenario: a developer restyles the topic OG card (new gradient, font, logo, layout)
and deploys. Every crawler/CDN holding a prior `If-None-Match` for an unchanged topic
(same slug/label/tags/title) gets a `304` and keeps serving the OLD card image
indefinitely — the redesign is invisible on social shares until the underlying topic text
happens to change. `OG_SUCCESS_CACHE_CONTROL` makes this a long-lived stale window.

Suggested fix: fold a version token into the hash input, e.g.
`.update(`${OG_TEMPLATE_VERSION}|${IMAGE_PIPELINE_VERSION}|${topicRecord.slug}|${topicLabel}|${tagList.join(',')}|${siteTitle}`)`,
mirroring the per-photo route. A single `OG_TEMPLATE_VERSION` constant bumped on any card
layout change is enough.

---

### CR-02 | LOW | Medium | confirmed
**PAT/Lightroom upload route's outer block has `finally` but no `catch`; a throw from
post-commit work escapes as a non-JSON 500 after the image is already committed.**

File: `apps/web/src/app/api/admin/lr/upload/route.ts:281` (outer `try`), `:587-591`
(`finally` releasing the contract lock), with the committed side effects at `:500-501`
(DB insert), `:516` (`settleTrackerToActual(true, fileSize)`), `:518` (`enqueueImageProcessing`),
`:581` (`revalidateAllAppData()`).

Why it's a problem: the inner `try/catch` at `:495-510` only guards the file-save +
`db.insert`. Everything AFTER the successful insert — `settleTrackerToActual(true, …)`,
`enqueueImageProcessing(…)`, `logAuditEvent(…).catch(…)`, and crucially
`revalidateAllAppData()` — runs inside the outer block that has ONLY a `finally`. If any
of that post-commit work throws (`revalidateAllAppData()` calling `revalidatePath` is the
realistic candidate; `enqueueImageProcessing` returns a bool and does not throw), the
throw propagates past the `finally` (which correctly releases the lock) straight to
Next.js, which returns a generic non-JSON 500. The DB row is already committed and the
queue job may already be enqueued, so the upload actually *succeeded*.

Failure scenario: an external publish client (Lightroom-style, the documented consumer)
receives a `500` with an unparseable body for an upload that in fact landed. Its retry
logic re-POSTs the same photo. `user_filename` dedup mitigates exact-name collisions but
the second attempt still does full multipart parse + file write + a duplicate DB row if
the filename differs, and the client surfaces a spurious error to the photographer.

Suggested fix: wrap the post-insert region (`:511-586`) in its own `try/catch` that logs
and returns a JSON success (the row is committed) or at worst a JSON-shaped 500, so the
external client always receives a parseable, accurate response. The `finally` lock release
stays as-is.

---

### CR-03 | LOW | Medium | confirmed (operational)
**`/api/health` DB readiness probe has no timeout; a hung (not-refused) DB hangs the
endpoint and pins a pool connection instead of failing to 503.**

File: `apps/web/src/app/api/health/route.ts:29-35`.

```ts
try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
} catch { /* DB unreachable */ }
```

Why it's a problem: the probe distinguishes "DB down" (fast `ECONNREFUSED` → catch → 503)
from "DB reachable" (200), but not "DB reachable-but-wedged" (e.g., MySQL accepting the
connection but blocked on a lock/GTID/replication stall, or the pool queue saturated). In
that state `db.execute` neither resolves nor rejects promptly, so the readiness endpoint
hangs for as long as the query blocks, holding one of the 10 pool connections. This
undermines the endpoint's own purpose — a readiness probe that hangs cannot report
un-readiness — and, when the pool is already contended, the probe competes for the last
connection it is trying to measure. Scope-limited to `HEALTH_CHECK_DB=true` deployments;
`/api/live` (the documented liveness probe) is unaffected.

Failure scenario: MySQL is up but wedged; the orchestrator's readiness GET to
`/api/health` hangs past its own HTTP timeout instead of getting a clean `503`, so
orchestration decisions (drain, restart) are delayed, and the probe itself consumes a pool
slot during the incident.

Suggested fix: bound the probe, e.g.
`await Promise.race([db.execute(sql\`SELECT 1\`), new Promise((_, r) => setTimeout(() => r(new Error('health probe timeout')), 2000))])`
(or an `AbortSignal.timeout`-driven connection), and treat timeout as `dbOk = false` → 503.

---

### CR-04 | LOW | High | confirmed (maintainability)
**Rate-limit comment in the similar-photos route claims a rollback that does not exist;
the actual, correct behavior is charge-and-never-refund.**

File: `apps/web/src/app/api/search/similar/[id]/route.ts:98-99`.

```ts
// Gate 4: rate-limit pre-increment (Pattern 2 — rollback on all subsequent
// early-return paths before expensive embedding/DB work begins).
```

Why it's a problem: the comment describes "Pattern 2 — rollback on all subsequent
early-return paths", but there is NO rollback anywhere in the file (no `decrement`/`refund`
import or call). The `429` return (`:104-108`) and the `503` disabled/stub return
(`:121-126`, which the comment at `:110-113` even correctly describes as "keep the
pre-incremented budget") both leave the increment charged. The *behavior* is right and
matches the semantic route's documented charge-and-keep posture; the *comment* is a
false contract. This is exactly the kind of stale doc that induces a real bug: a future
maintainer adding an early-return between `:102` (pre-increment) and `:116` (DB lookup)
will trust the comment, assume the framework refunds on early return, and mis-account the
limiter (or add a bogus refund that double-decrements).

Failure scenario: a later edit inserts an early `return` "relying on the documented
rollback"; because no rollback exists, the request is silently over- or under-charged, and
the divergence from the semantic route's accounting goes unnoticed since both comments now
disagree.

Suggested fix: rewrite the comment to state the actual posture ("pre-increment is charged
and never refunded on early return; protected DB/embedding work is intentionally counted"),
matching the semantic route (`AGG-12`).

---

### CR-05 | LOW | Medium | confirmed (consistency)
**`updateTag` maps a slug collision to the generic `failedToUpdateTag` message, unlike the
add/batch tag paths which surface the specific `tagSlugCollision`.**

File: `apps/web/src/app/actions/tags.ts:89-92` (the `updateTag` catch that returns
`failedToUpdateTag` for the whole error class, including `ER_DUP_ENTRY`), vs the
`addTagToImage` / `batchAddTags` paths that already special-case slug collisions with
`tagSlugCollision`.

Why it's a problem: renaming a tag to a display name whose derived slug collides with a
*different* existing tag fails with a generic "failed to update tag" toast, giving the
admin no actionable signal that the real cause is a slug clash. The sibling code paths
already have the precise message, so this is an inconsistency, not a missing capability.
No data corruption — the DB unique constraint correctly rejects the write; only the error
surfaced to the admin is wrong.

Failure scenario: an admin renames "Sunset" → "Sun Set" where a "Sun-Set" tag already
exists; both slugify to `sun-set`; the update fails with a generic error and the admin
cannot tell why without inspecting the tag list for the hidden collision.

Suggested fix: in `updateTag`, catch `ER_DUP_ENTRY` (direct + `.cause.code`) and return
`tagSlugCollision`, matching `addTagToImage`/`batchAddTags`.

---

## Confirmed-but-not-new (re-validated deferred/filed items, recorded so the ledger sees
they were checked, not missed)

- **Zoomed-photo touch-pan can trigger prev/next navigation** — a components sub-sweep
  independently reproduced this (native swipe listeners on `mediaContainerRef` in
  `photo-navigation.tsx` fire in the bubble phase before `image-zoom.tsx`'s
  `stopPropagation`, and `PhotoNavigation.disabled` never tracks zoom state). This is the
  already-deferred `C96-14` (`photo-viewer.tsx:667`, `photo-navigation.tsx:72`,
  `image-zoom.tsx:232`). Not re-filed as new; confirmed still current at HEAD.
- **`COUNT(*) OVER()` on the first-page listing path** (`data.ts:914`, `:1498`) — confirmed
  current; already filed as critic `CRIT-05` this cycle and carry-forward `C94-11`.
- **Over-limit `load_more`/`view_record` still do persistent limiter DB work then roll
  back** (`actions/public.ts`) — confirmed; already filed by the cycle-99 architect lane.
- **Restore maintenance does not fence in-flight non-upload admin mutations** — confirmed
  current in `collections.ts`/`tags.ts`/`topics.ts`/`settings.ts` (start-of-action
  `getRestoreMaintenanceMessage()` check only); deferred `C77-ARCH-01` / `C94-09`.
- **`image_embeddings` PK is `image_id`-only** — cannot stage multiple model versions;
  deferred `C94-10`. (The queue's `onDuplicateKeyUpdate` at `image-queue.ts:397-408`
  overwrites in place, consistent with that limitation.)

## Non-findings / refutations (validated from code, not comments)

- **`process-image` atomic write/backup/rollback** (`:1167-1225`, `:1433-1482`): the
  `backupExistingFinalPath` → `writeFinalPathAtomically` → `restorePreviousFinalPaths` /
  `removeBackupFinalPaths` sequence is correct. On the error path, `restorePreviousFinalPaths`
  renames each `.bak` back over the original, and the subsequent `finally`
  `removeBackupFinalPaths` `safeUnlink`s the (now-moved) backups idempotently. The
  age-gated startup cleanup (`image-queue.ts:35-92`, `.tmp`+`.bak`, ≥1h) correctly avoids
  deleting a sidecar-in-flight backup during a web restart. No orphan/rollback defect.
- **`getYearInReviewImages` month bucketing** (`data-timeline.ts:243`): `new Date(capture_date)`
  on the space-separated MySQL datetime is parsed as local time by V8, so
  `.getMonth()+1` equals MySQL's `MONTH()` literal — no cross-month mis-bucketing on the
  Node runtime. (Latent fragility only: `seed-e2e.ts:247` shows the maintainers know the
  space-form needs `.replace(' ','T')+'Z'` to be spec-valid; not worth a finding since the
  runtime behavior is correct and grouping is intra-year cosmetic.)
- **`data-display-gamut` / `data-force-show-color-chips` ownership**: both `HomeClient`
  (`home-client.tsx:135-141`) and `PhotoViewer` (`photo-viewer.tsx:329-347`) set AND clean
  up the attributes symmetrically. React 19 runs all passive-effect cleanups before setups
  within a commit, so a home→photo soft navigation cannot leave the photo page with the
  attributes stripped. No FOUC/consistency bug.
- **`background-db-writes.ts`**: returns the raw write promise to the caller while the
  tracked wrapper swallows errors and self-removes; restore short-circuits new tracking
  before draining. Correct.
- **View-count buffer** (`data.ts:16-234`): swap-then-drain, re-buffer-with-cap,
  retry-count eviction (R15C15/R21C21/C5-AGG-02), backoff, and the shutdown
  `currentFlushPromise` await are all internally consistent. No lost-increment or
  unbounded-growth path survives.
- **`collections.ts`**: origin/auth/maintenance gate order, `affectedRows===0` not-found
  branch, `ER_DUP_ENTRY` localized mapping, and validated-then-stored `query_json` are all
  correct (test coverage gap is filed by the test-engineer lane, not a code defect).
- **JSON.parse call sites**: `admin-tokens.ts:124`, `image-queue.ts:194`,
  `smart-collections.ts:322` are each wrapped and fail closed.
- **Topic feed route** (`[topic]/feed.xml/route.ts`): locale self-validation, restore-503,
  rate-limit-before-work, size-aware media derivative, and content-derived ETag are all
  correct; `feedUpdated` string-max over ISO timestamps is lexicographically valid.

## Files / areas examined

- lib: `image-queue.ts` (full), `process-image.ts:1040-1485` (atomic write/rollback +
  format loop), `data.ts:1-234` (view-count buffer) + listing/count regions, `data-timeline.ts`
  (full), `background-db-writes.ts` (full), `admin-tokens.ts` (parse/verify),
  `smart-collections.ts` (parse/validate), `restore-maintenance` usage, `advisory-locks`
  cross-refs.
- actions: `collections.ts` (full), `images.ts` delete-cleanup region, plus a delegated
  full-read sweep of `admin-users.ts`, `sharing.ts`, `tags.ts`, `topics.ts`, `seo.ts`,
  `settings.ts`, `lr-tokens.ts`, `admin-backfill.ts`, `embeddings.ts`.
- api: all 8 route files read in full (`og`, `og/photo/[id]`, `search/semantic`,
  `search/similar/[id]`, `health`, `live`, `admin/lr/upload`, `uploads/[...path]`).
- components: delegated full-read sweep of all 34 `.tsx` under `components/`, plus direct
  reads of `home-client.tsx` and `photo-viewer.tsx` gamut-attribute effects.
- scripts: `backfill-color-pipeline.ts` / `admin-backfill-runner.ts` pixel-cap change
  (`baefb427`), `seed-e2e.ts` date handling.
- Recent commits re-examined for regression: `750729ad`, `33eca7b5`, `baefb427`,
  `061c1c81`, `6f40f66d`, `d6912560` (source-touching diffs).
- Context: `CLAUDE.md`; deferred registers `cycle-96`/`cycle-98`; cycle-99 architect +
  perf reviews; this cycle's critic/security/test-engineer/verifier lanes.

## Commonly-missed-issues sweep

- Off-by-one / pagination: timeline `limit+1` lookahead (correct), bootstrap
  cursor advance + `pending.length < BATCH_SIZE` end detection (correct), OG tag parse
  bounded before split (correct). No off-by-one found.
- Null/undefined flow: `?? / ||` audited on the reviewed action + queue paths; `|| 1`
  concurrency coercions are intentional; no `0`/`''`/`false`-eating bug found.
- Async races / unhandled rejections: queue side-effect tracking, `Promise.allSettled`
  usage in cleanup, and background-write drain are correct; the only fire-and-forget escape
  is CR-02 (post-commit throw with no catch).
- Resource leaks: image-queue lock connections released in `finally`; the one un-timed
  connection risk is CR-03 (health probe).
- Locale/encoding: `countCodePoints` used consistently for name caps; MySQL-datetime →
  `new Date` parse validated (V8 local-parse, non-defect).
- Cache-invalidation correctness: per-photo OG ETag versioned, topic OG ETag NOT — CR-01.
- Stale/misleading comments that could seed a future bug — CR-04.

## Caveats

- All findings are LOW/LOW-MEDIUM and static-analysis-derived; I did not run lint/typecheck/
  build/tests (the loop's gate step owns that). CR-02's trigger depends on
  `revalidateAllAppData()` actually being able to throw at runtime under Next 16 — rated
  Medium confidence for that reason. CR-03's severity is deployment-dependent
  (`HEALTH_CHECK_DB=true` only).
