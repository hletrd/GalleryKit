# Run-10 Cycle 4/100 — Architect Lane Review (2026-07-07)

Start HEAD: `ec433dc4` (terminal cycle-3 commit; clean tree). Angle: architectural /
design risk, coupling, layering, state ownership, operational topology. Cycle-3 fix
range assessed: `e08b6f97..ec433dc4` (17 commits). Read first: cycle-3 `_aggregate.md`
(ARCH3-01..06), `deferred-carry-forward.md` (C3-35 / C3-36 governed), CLAUDE.md
"Runtime topology". No repo files modified.

Verdict headline: the cycle-3 fixes are individually SOUND — every one is a genuine
net improvement over what it replaced, and the client/server boundary + lib import
spine are verified clean. The architectural risk this cycle is not a regression; it is
an **ownership-diffusion trend**: process-lifetime concerns (singleton liveness, the
maintenance cron, growing queue state) keep getting bolted onto whatever module
happens to already own a timer, with no single lifecycle owner. That is the
highest-leverage investment (§3).

Severity legend: sev = blast radius if the erosion scenario fires; conf = confidence in
the mechanism. Status ∈ {open, erosion-trend, minor, verified-clean, reaffirm-deferred}.

---

## §1 — Assessment of the cycle-3 fixes (primary scope)

### ARCH4-01 — single-writer guard: keepalive mechanism is right; the "warn-once, never re-acquire" ownership model is the fragile part
`lib/single-writer-guard.ts:39-125`, `:100-123` (keepalive), `:61-68` (warnLapse).
Sev LOW-MED · Conf High · Status erosion-trend (tested-as-intended, not a regression)

- **Mechanism choice is correct.** A dedicated held connection with a `SELECT 1`
  keepalive is *structurally required*: `GET_LOCK` is SESSION-scoped, so a pool-level
  ping over rotating connections cannot hold the lock. A self-healing interval on a
  pinned connection is the right tool; a pool ping would be wrong. C3-02 fixes the real
  `wait_timeout` reap.
- **The gap is the failure model, not the timer.** On ANY connection disruption the
  keepalive catch (`:115-122`) and the `conn.on('error')` handler (`:100-109`) both do
  the same thing: warn ONCE (`lapseWarned` latches, `:61-63`), null `heldConnection`,
  clear the timer, end the socket — and **never re-acquire**. This is locked as intended
  by `single-writer-guard.test.ts:244` ("warns once, stops the keepalive, and closes the
  connection when the keepalive query fails").
- **Erosion scenario.** A MySQL restart / failover / proxy idle-kill / network blip
  releases ALL server-side advisory locks — which is *precisely* the "second instance
  boots later and silently acquires the lock" window the guard exists to catch. After
  the first such event the guard is silently disabled for the entire remaining process
  lifetime; the only trace is one `console.warn` that has long scrolled out of the log
  by the time a second instance is added. The reprobe machinery that already exists for
  the boot-contention path (`:147-170`) is exactly what a post-lapse re-acquire would
  reuse, but it is wired only to startup.
- **Why it's LOW-MED not higher:** the shipped topology is single-writer + per-iteration
  deploy (frequent restarts), so the practical exposure window is bounded. But CLAUDE.md
  claims the guard covers the "scale-up-after-running-solo path," and after any DB
  restart it does not.
- **Recommendation (cheap):** on keepalive/error lapse, schedule a bounded re-acquire
  using the existing `reprobeOnce`/`holdConnection` path (unref'd, backoff-capped)
  instead of latching off permanently — OR narrow the CLAUDE.md claim to "detects
  co-boot contention only; does not survive a mid-life DB restart." Either closes the
  doc-vs-behavior gap.

### ARCH4-02 — `getGalleryConfigUncached` is now a misnomer; the dual-cache LAYERING is coherent but the NAME is a drift trap
`lib/gallery-config.ts:211-239` (2 s TTL micro-cache), `:242` (React cache), `:182-184`
(strict). Sev LOW-MED · Conf High · Status open (naming/coherence)

- **The three-accessor layering is sound.** Request path → `getGalleryConfig` (React
  request-scoped `cache()`); detached background → `getGalleryConfigUncached`; ingest /
  write → `getGalleryConfigStrict` (fail-closed, bypasses BOTH caches by calling
  `getSettingsMap` directly). Three contracts, three call-site classes, cleanly
  separated. Consumers traced: image-queue (3 detached sites — embedding bootstrap
  `:514`, config-load gate `:787`, embedding side-effect gate `:905`), admin-backfill
  `runBackfill` (`:698`), serve-upload uses the CACHED accessor on the request path
  (`:85`) — every consumer gets the freshness class it needs.
- **The trap:** C3-16 gave `getGalleryConfigUncached` a 2 s module-level TTL cache +
  in-flight dedupe. Its freshness contract silently changed from "always re-reads" to
  "eventually within 2 s," but the NAME still asserts "Uncached." A future author who
  needs a genuinely-current detached read — e.g. re-reading `semantic_search_mode`
  immediately after an operator flip to make a gating decision — will trust the name and
  receive up-to-2 s-stale data. The correctness of the current 3 consumers rests on the
  fact that they each tolerate the skew (backfill reads config ONCE at run start, so the
  TTL never even engages for it), not on the name being honest.
- **Recommendation:** rename to `getGalleryConfigDetached` (or `…FreshWithin2s`), state
  the skew in the identifier, and keep a deprecated re-export for one cycle. Pure
  clarity; no behavior change. Covered by `gallery-config-uncached-microcache.test.ts`
  so a rename is mechanically safe.

### ARCH4-03 — image-queue `ProcessingQueueState` is a growing god-object; each new field is an un-enforced O(4)-site reset obligation
`lib/image-queue.ts:317-359` (17-field state), reset fan-out at `:374-414`
(defensive re-init), `:638-650` (shutdown), `:1250-1297` (restore quiesce), `:383-394`
(hot-reload survival backfill). Sev LOW-MED · Conf High · Status erosion-trend

- The state now carries ~17 fields (queue, enqueued, retryCounts, claimRetryCounts,
  lastErrors, permanentlyFailedIds, bootstrapped, shuttingDown, shutdownPromise,
  gcInterval, bootstrapRetryTimer, bootstrapContinuationScheduled, bootstrapCursorId,
  sideEffects, embeddingBootstrapInFlight, embeddingScanCursorId, retryTimers). Adding a
  field imposes a fan-out obligation across FOUR lifecycle sites that must each remember
  to clear/reset/re-arm it, with **no compile-time check** that all four handle it.
- **This is already leaking, historically:** `retryTimers` (`:388-390`),
  `embeddingScanCursorId` (`:391-393`), and `sideEffects` (`:383-385`) each needed a
  retroactive "defensive backfill" patch in `getProcessingQueueState` because older
  global-symbol states survived a hot reload WITHOUT the field. The C2-33 re-init had to
  grow explicit `clearInterval(gcInterval)` + `clearTimeout(retryTimers)` blocks
  (`:406-414`) one field at a time. Each is the same class: a new timer/cursor added,
  then a later cycle discovering a lifecycle site that forgot it.
- **Coherence with single-writer topology (the team-lead question): YES, coherent.** The
  process-local state is optimization over DB-backed authority, not correctness: the
  per-image `gallerykit:image-processing:{id}` advisory lock is the real double-encode
  fence, and `permanentlyFailedIds` is a fast-path over the durable
  `isNull(processing_error)` bootstrap filter (`:1096`). `embeddingScanCursorId` is
  purely process-local but embeddings are idempotent (`onDuplicateKeyUpdate`, `:502`), so
  a second process merely repeats work. The topology assumption holds; the risk is
  maintainability, not correctness.
- **Recommendation:** define a single `resetTransientQueueState(state, reason)` helper +
  partition the type into `{durable}` vs `{transient}` so the reset set is declared once;
  every lifecycle site calls the helper. Folds into §3.

### ARCH4-04 — the maintenance cron is parasitic on the image-queue's `gcInterval`; it has no owner and dies if queue bootstrap never completes
`lib/image-queue.ts:1229-1239` (hourly `gcInterval`), `:1209-1220` (one-shot boot
purge). Sev LOW-MED · Conf High · Status open (coupling / topology)

- Session purge, rate-limit bucket purge, audit-log retention (`purgeOldAuditLog`), AND
  view-event retention (`purgeOldViewEvents`, the AGG-H2 unbounded-growth bound on the
  single MySQL writer) all execute inside the image-queue module's hourly timer, armed
  only *inside* `bootstrapImageProcessingQueue`. They are orthogonal to image processing
  and ride the queue's process-lifetime timer purely because it exists.
- **Erosion scenario:** the timer is armed only after bootstrap reaches `:1229`. If
  bootstrap is stuck in its ECONNREFUSED retry loop (`:1241-1246`), or held off by
  restore maintenance (`:1084`), OR if a future refactor gates/defers queue bootstrap,
  then NONE of the four retention sweeps run — `audit_log` and the `*_views` tables grow
  unbounded on the single writer, re-opening exactly the class AGG-H2 was written to
  close. The "cron owner" is also invisible: an engineer editing the queue can silently
  delete four retention jobs.
- **Recommendation:** extract `startMaintenanceScheduler()` owned by
  `instrumentation.ts` (sibling to the single-writer guard start at `:25-29`),
  independent of queue-bootstrap success and stopped in the same graceful-shutdown
  drain. Folds into §3.

### ARCH4-05 — serve-upload's 3-path split is sound; the ETag is templated inline twice (drift risk) and the resource still has 2 ETag SCHEMES
`lib/serve-upload.ts:217` (path-stat), `:254` (304/HEAD etag), `:296-302` (fd-stat +
GET etag). Sev LOW · Conf High · Status minor/cleanup

- **The fd-free HEAD/304 split (C3-29) is correct.** Bodyless responses (If-None-Match
  match `:263-273`, HEAD `:280-290`) are served from a path `stat` with no fd open/close
  pair, while the GET body path still opens the fd FIRST and stats THROUGH it (`:296-302`)
  to preserve the rename-after-validation race safety. Contract intact.
- **Two nits, both drift risks:** (a) the ETag template `W/"v${VER}-${mtime}-${size}-${hash}"`
  is written inline TWICE — `:254` (drives 304 + HEAD) and `:302` (drives GET). A future
  format change must touch both or the 304 short-circuit compares against a stale format
  and forces full re-fetches. (b) The 304/HEAD ETag derives from `stat(resolvedPath)`
  while GET derives from `fileHandle.stat()`; during a backfill rewrite these can
  momentarily disagree (harmless — worst case a redundant 200 — but it means "same
  resource, two stat sources").
- **Standing context (not this cycle's doing):** the resource is served by up to FOUR
  paths — Next's static server plus these three — under TWO ETag schemes (static
  `W/"{size-hex}-{mtime-hex}"` vs serve-upload's version+hash form). A client bouncing
  between the static path and the route-handler fallback always mismatches ETags. This is
  documented in CLAUDE.md's ETag section; noted here only as the layering reality behind
  ARCH4-05.
- **Recommendation:** a single `buildDerivativeEtag(stats, settingsHash)` helper used by
  all three branches.

### ARCH4-06 — migrate.js baseline machinery: C3-01 fix is correct; complexity is still accreting around the non-monotonic-journal root cause
`scripts/migrate.js:747-781` (maxFolderMillis guard), `:783-871`
(prepareLegacyDatabaseIfNeeded, now 4 branches), `:873-894` (post-condition).
Sev LOW · Conf Med · Status reaffirm-deferred (C3-35)

- **The fix is sound.** `baselineAllJournalMigrations` now refuses to baseline any entry
  above the caller's cursor (`:760-770`), and `prepareLegacyDatabaseIfNeeded` splits
  `missing` into `trueDrift` (≤ cursor) vs `pendingTail` (> cursor), baselining only the
  former and passing `maxFolderMillis` (`:857-870`). The loud-fail net (`:885-892`) is
  re-armed for the mixed-batch case that 4 lanes reproduced in cycle-3. Belt-and-braces
  guard is defensively redundant with the caller split — correct.
- **Trend evidence for C3-35 (governed-deferred redesign):** the function is now a
  4-branch decision tree (fresh DB / journal-covered / all-above-cursor pending /
  mixed drift), and the fix trades a silent SQL drop for a documented sharp edge — in the
  mixed state, drizzle applying the un-baselined above-cursor tail can fail LOUDLY on
  duplicate DDL because `reconcileLegacySchema` already mirrored it, requiring manual
  operator resolution (`:850-856`, `:861-868`). That is strictly better than silent
  loss, but the machinery keeps growing compensations for the root cause (non-monotonic
  journal `when`).
- **Disposition:** do NOT re-raise as a new item — C3-35 governs this with exit criterion
  "migration-machinery incident OR dedicated maintenance window." This cycle adds
  concrete new evidence (branch-count + manual-resolution edge) to that deferred row's
  file; the honest one-time journal-`when` rewrite remains the real fix.

---

## §2 — Whole-repo layering sweep

### Verified-clean (do not re-derive)
- **Client/server boundary is well-maintained.** The "client-safe" leaf modules named in
  CLAUDE.md are genuinely leaf: `gallery-config-shared.ts` (0 server-only / `@/db` / fs /
  sharp deps — true leaf, imported 49×), `color-primaries.ts` (imported by 8 `'use
  client'` components + the upload server action, no server-only import — the earlier
  "server-only" grep hits were COMMENT text "free of server-only imports", not
  directives), `color-label.ts`, `color-pipeline-decisions.ts`. The ONLY actual
  `import 'server-only'` in `lib/` is `caption-generator.ts:17`. `settings-hash.ts`
  imports `@/db` but is consumed solely by the OG photo *route* (`api/og/photo/[id]`),
  never a client component — correct.
- **lib import spine is acyclic.** `gallery-config-shared` (leaf) ← `process-image`
  (`:13-14`) ← `image-queue` (`:8-9`), one-way; `process-image` imports NO server config /
  data / queue module (no back-edge). No god-module import cycle on the hot path.
- **app router structure is clean:** one `[locale]` segment, a `(public)` route group vs
  `admin/(protected)`, and the non-locale `app/uploads/[...path]` twin for SW HEAD
  revalidation. No structural drift.

### Findings (in addition to ARCH4-03 / ARCH4-04, which are layering findings)
- **Two 1800-LOC god modules, not one.** `data.ts` (1860) is governed by C3-36; but
  `process-image.ts` is now 1829 LOC and is NOT under any deferral, with `image-queue`
  (1309) and `admin-backfill-runner` (930) close behind. New evidence for the C1-32
  incremental-drainage policy: the module-size frontier is *widening past data.ts*, not
  confined to it. Disposition: fold into the C1-32/C3-36 policy surface, not a new item —
  peel one concern from `process-image.ts` (e.g. the ICC/NCLX bridge, or the 10-bit AVIF
  probe) opportunistically on the next color-touching cycle.
- **Background-job ownership overlap is bounded and coherent.** Three encode owners exist
  — the upload PQueue (`image-queue`), the in-app re-encode PQueue
  (`admin-backfill-runner`), and the sidecar script — and they are correctly fenced from
  each other: both in-process paths take the per-image
  `gallerykit:image-processing:{id}` claim (backfill at `:363-379` mirrors queue at
  `:609-626`), and the whole-run `gallerykit_color_pipeline_backfill` lock serializes the
  two backfill entry points. No double-encode path. The only ownership GAP is the
  maintenance cron (ARCH4-04), which is a DIFFERENT job class with no owner at all.

---

## §3 — The ONE highest-leverage architectural investment for the next 3 cycles

**Extract a single "process singleton lifecycle" owner, rooted in `instrumentation.ts`,
that owns every process-lifetime concern the single-writer topology depends on.**

Rationale: `instrumentation.ts` is ALREADY the de-facto lifecycle root (it wires queue
bootstrap, the single-writer guard, and the shutdown drain), but the actual ownership is
scattered and each cycle bolts one more process-local thing onto an ad-hoc host: the
image-queue module secretly owns the maintenance cron (ARCH4-04), the single-writer guard
owns its own fragile one-shot liveness (ARCH4-01), and queue-state reset is duplicated
across four sites with no enforcement (ARCH4-03). These are three faces of one gap: **no
module explicitly owns "things that live for the process and must be started, kept alive,
and torn down as a set."** This is the single place the single-writer topology's
coordination actually lives, so consolidating it has the widest blast radius per unit
effort and it directly retires ARCH4-01, -03, -04.

Concrete steps (sized for 3 cycles, each independently shippable):
1. **Cycle A — maintenance scheduler.** Extract `startMaintenanceScheduler()` /
   `stopMaintenanceScheduler()` (sessions + buckets + audit + view retention + retry-map
   prune) out of `image-queue.ts:1229-1239` into a `lib/maintenance-scheduler.ts`. Start
   it from `instrumentation.ts` next to the guard (`:25-29`), stop it in the
   graceful-shutdown `Promise.all` (`:51-57`). Independent of queue-bootstrap success.
   Closes ARCH4-04; add a test that retention runs even when queue bootstrap is stuck.
2. **Cycle B — queue-state lifecycle contract.** Introduce a typed
   `{durable | transient}` partition of `ProcessingQueueState` + one
   `resetTransientQueueState(state, reason)` helper called by all four lifecycle sites;
   delete the per-field defensive-backfill blocks. Closes ARCH4-03; a compile-time
   exhaustiveness check (mapped type over the transient keys) enforces future fields.
3. **Cycle C — guard self-healing + naming.** Wire the single-writer guard's lapse path
   to a bounded, unref'd re-acquire via the existing `reprobeOnce` machinery (ARCH4-01),
   and rename `getGalleryConfigUncached` → `getGalleryConfigDetached` (ARCH4-02) as a
   trivial rider. Both are small and land the "process singleton" theme end-to-end.

Net: after 3 cycles, `instrumentation.ts` names one explicit set of process-lifetime
services (guard, maintenance scheduler, queue) with symmetric start/stop and a single
state-reset contract — and the recurring "we added a timer/field and a later cycle found
the lifecycle site that forgot it" class stops recurring.

---

## Summary ledger
| ID | Sev/Conf | Location | Status |
|----|----------|----------|--------|
| ARCH4-01 | LOW-MED/High | single-writer-guard.ts:100-125 | erosion (guard never re-acquires after any DB-connection lapse; doc claim overstates coverage) |
| ARCH4-02 | LOW-MED/High | gallery-config.ts:211-239 | open (`getGalleryConfigUncached` now 2 s-cached — name lies; layering itself coherent) |
| ARCH4-03 | LOW-MED/High | image-queue.ts:317-414 | erosion (17-field god-state; O(4)-site un-enforced reset obligation) |
| ARCH4-04 | LOW-MED/High | image-queue.ts:1229-1239 | open (retention cron parasitic on queue timer; dies if bootstrap stalls) |
| ARCH4-05 | LOW/High | serve-upload.ts:254,302 | minor (3-path split sound; ETag templated inline twice + 2 stat sources) |
| ARCH4-06 | LOW/Med | scripts/migrate.js:783-871 | reaffirm-deferred C3-35 (fix correct; complexity still accreting) |
