# Run-10 Cycle 4/100 — Code-Reviewer Lane (2026-07-07)

Start/current HEAD: `ec433dc4` (clean tree, == origin/master, deployed).
Reviewed surface: the 17 cycle-3 commits `e08b6f97..ec433dc4` (primary) + a
targeted logic-bug sweep of untouched `lib/` and `app/actions/` files (secondary).

Method: read the FULL current state of every touched primary-scope file (not just
diffs), traced each fix against its stated finding, constructed adversarial failure
scenarios, and validated the three most behaviorally-subtle fixes by running their
tests (`image-queue-embedding-bootstrap-cap`, `optimistic-image-retry`,
`migrate-pending-migrations` — 18 passed). Verified `public/sw.js` is regenerated in
lockstep with the template (`SW_VERSION=26516421-p7`, `await touchMeta` present at
both confirmed-fresh branches).

## Headline

**No CRIT / HIGH / MED regression found.** All 11 cycle-3 CODE commits are correct,
complete, and introduce no regression I could construct a failure for. The 6 non-code
commits (tests/docs/plan) are consistent with the code. The findings below are LOW/INFO
observations and deliberate-tradeoff notes — none block; several are pre-existing and
out of cycle-3 scope, recorded for lineage only.

## Findings table

| ID | Sev/Conf | Status | Location | Title |
|----|---------|--------|----------|-------|
| CR4-01 | INFO/High | confirmed (by-design) | `public/sw.template.js:368,387` | `await touchMeta` serializes meta writes on the image DISPLAY path; a large warm masonry paint now waits its turn through `metaMutationQueue` before returning cached bytes (deliberate durability tradeoff, negligible cost) |
| CR4-02 | LOW/Med | confirmed | `lib/settings-hash.ts:73 vs 92` | No-arg fallback hash vs config-arg hash disagree on `image_sizes` ordering; only reachable during a DB-outage cold start, causes a transient extra 304→200 cycle (pre-existing, not cycle-3) |
| CR4-03 | INFO/High | confirmed (by-design) | `scripts/migrate.js:857-870` | The C3-01 fix intentionally converts a previously-silent mixed-drift boot (dropped DML) into a LOUD `ER_TABLE_EXISTS` deploy failure when reconcile already mirrored the pending tail's DDL — correct, but an operator-visible behavior change worth flagging in the ledger |
| CR4-04 | INFO/Med | needs-validation | `lib/single-writer-guard.ts:147-170` | Reprobe-in-flight during `stopSingleWriterGuard()` could `holdConnection()` + arm keepalive AFTER shutdown requested — benign in practice because `instrumentation.ts` calls `process.exit()` immediately after the drain race, killing any leaked state |

## Per-finding detail

### CR4-01 — SW `await touchMeta` serializes the display path (INFO, by-design)
`public/sw.template.js` (and the regenerated `sw.js`) now `await touchMeta(...)` on the
304 and same-ETag confirmed-fresh branches inside `staleWhileRevalidateImage`
(lines 368, 387). This is the correct C3-10 fix — the meta timestamp is the sole recency
authority after C2-11, so a fire-and-forget write outside `respondWith`'s lifetime froze
recency on SW termination. Awaiting keeps the write lifetime-covered; the `.catch(()=>{})`
still serves cached bytes on write failure.

Observation (not a bug): `touchMeta` chains through the module-global
`metaMutationQueue`, so every cached tile in a warm masonry paint now serializes its
meta write and does not return `cached` until that write lands. The HEAD probes run in
parallel (bounded by `HEAD_REVALIDATE_TIMEOUT_MS`=300ms), but the post-probe meta writes
are serial. Cost is bounded and tiny (the meta blob is a few tens of KB of JSON at
personal-gallery scale; parse+stringify+put is sub-ms, ~single-digit ms for 50 serialized
tiles). The plan explicitly chose durability over this latency; no action needed. Flagged
only so a future large-cache perf trace knows the display path is now write-serialized.

### CR4-02 — settings-hash no-arg vs config-arg `image_sizes` ordering (LOW)
`buildHashFromConfig` (line 92) sorts `image_sizes` ascending before joining:
`[...config.imageSizes].sort((a,b)=>a-b).join(',')`. The no-arg DB path (`buildHash` over
raw `values`, line 73) uses the raw stored `image_sizes` string verbatim. If the admin UI
persists sizes in display order (e.g. `"1536,640"`), the two paths produce DIFFERENT
8-char hashes for the SAME settings.

Failure scenario: `serve-upload.ts` ALWAYS uses the config-arg path
(`getColorSettingsHash(config)`), so this asymmetry is only observable during a cold-start
DB-unreachable window when `getServingColorSettingsHash` falls through to the no-arg
`getColorSettingsHash()` FALLBACK_HASH path. During that transient window the ETag hash
differs from the steady-state hash, causing one extra 304→200 revalidation per client
until the DB recovers. No stale-bytes / no data-integrity impact — purely a brief cache
churn during a DB outage.

Suggested fix (optional, low priority): in the no-arg/DB path, normalize `image_sizes`
via `parseImageSizes(...)` (sorted) before hashing so both paths agree. Pre-existing (not
introduced this cycle); recording for completeness since `serve-upload.ts` (a cycle-3
file) is the consumer.

### CR4-03 — migrate.js mixed-drift now fails loud instead of silently booting (INFO, by-design)
The C3-01 fix (`285a4538`) is correct: `prepareLegacyDatabaseIfNeeded`'s drift-repair path
now baselines ONLY at/below-cursor `trueDrift` entries and leaves the above-cursor
`pendingTail` for `drizzle.migrate()` to apply (with a belt-and-braces throw in
`baselineAllJournalMigrations` if a caller ever passes an above-cursor entry).
`cursor === null` (empty `__drizzle_migrations` + gallery tables = pure legacy) correctly
still baselines all (guard skipped when `maxFolderMillis` is null); the normal single-new-
migration deploy takes the early pending-return at line 831 and is unaffected.

Observation (documented trade-off, verified correct): in the mixed drift+pending case
where `reconcileLegacySchema` has ALREADY mirrored the pending tail's DDL (which it does
per the migration-authoring contract — CREATE TABLE IF NOT EXISTS / guarded ensureColumn),
`drizzle.migrate()` will then re-issue the tail's plain `CREATE TABLE x`/`ALTER` and throw
`ER_TABLE_EXISTS`/duplicate-DDL — a LOUD deploy failure. This is strictly better than the
old silent-DML-drop and is the plan's stated intent, but it is a behavior change: a DB in
this specific mixed state that previously "booted" (with hidden data loss) now hard-fails
the deploy and requires manual operator reconciliation. The CLAUDE.md runbook note
covers this; flagging for ledger-honesty visibility.

### CR4-04 — single-writer-guard reprobe-vs-stop shutdown ordering (INFO, benign)
`startSingleWriterGuard` on initial contention closes its probe connection and arms an
unref'd 25 s `reprobeTimer`. `stopSingleWriterGuard` calls `clearReprobe()` +
`clearKeepalive()`. If a SIGTERM lands after the timer FIRES (so `reprobeOnce` is already
in-flight, having set `reprobeTimer=null` at its start), `clearReprobe()` is a no-op and
`stopSingleWriterGuard` returns early (`heldConnection` still null). `reprobeOnce` may then
`holdConnection()` and arm a fresh keepalive AFTER shutdown was requested — a momentarily
leaked connection + interval.

Why benign: `instrumentation.ts:82` calls `process.exit(exitCode)` synchronously right
after the shutdown `Promise.race` resolves, terminating the process (and any leaked
interval/connection) before it can matter. `process.exit` does not wait for pending
timers. So there is no real-world leak. Recorded as INFO; if the shutdown sequence ever
stops calling `process.exit` (e.g. moves to a graceful-drain-then-return model), revisit —
`stopSingleWriterGuard` would then want an `stopping` flag that `reprobeOnce`/`holdConnection`
check before taking ownership.

## Verified-clean (constructed adversarial scenarios, found sound)

Primary-scope CODE commits:
- **`285a4538` migrate.js drift-only baseline (C3-01)** — trueDrift/pendingTail partition
  correct across all cursor cases (null / all-below / all-above / mixed); belt-and-braces
  guard unreachable-but-correct; post-condition net restored on the ambiguous branch.
  Mixed-batch test passes.
- **`3f8b6c88` single-writer guard keepalive + DB-scope (C3-02/C3-03)** — 60 s unref'd
  `SELECT 1` defeats `wait_timeout`; `on('error')` + keepalive-catch double-handling is
  idempotent (`lapseWarned` guard, `heldConnection===conn` check, `clearKeepalive`
  idempotent); `getSingleWriterLockName` sha256-folds DB name under the 64-char cap;
  quiet 25 s reprobe absorbs rolling-deploy drain. (see CR4-04 for the benign shutdown note)
- **`cc869996` admin-backfill detached uncached config (C3-04)** — `getGalleryConfigUncached()`
  swap at `admin-backfill-runner.ts:698`; config snapshotted once per run; the
  state.running-vs-advisory-lock handoff window is closed by the held lock (concurrent
  trigger → `already_running`). Pinned by `detached-uncached-config-wiring.test.ts`.
- **`d6b2b82c` 404 robots single-signal (C3-05)** — removing the explicit
  `robots:{index,follow}` from the locale layout is correct; Next elides the default on
  valid pages and injects `noindex` on 404s; no other robots surface regressed.
- **`0ae67c25` SW touchMeta durability + size-0 (C3-10/C3-22)** — `await` keeps the write
  in `respondWith` lifetime; lazy `resolveSize` + skip-on-0 prevents size-0 LRU occupants;
  no double-body-consumption (`responseSize` clones); sw.js regenerated in sync.
- **`9c45e933` swipe visual reset (C3-13/C3-14)** — success branches reset before
  `goToPhoto`; `useLayoutEffect` keyed on `[prevId,nextId]` fires on every in-place switch
  (prev/next always change in a linear gallery); belt-and-braces with the direct reset.
- **`200a74bf` embedding-scan cursor persistence (C3-07)** — cursor persists on cap-trip,
  resets to 0 only on clean completion; a stuck prefix ≥ SEMANTIC_SCAN_LIMIT no longer
  starves newer rows (verified the >cap-prefix case advances past a chunk per invocation);
  in-flight guard prevents concurrent cursor races; restore resets it (line 1291). Test passes.
- **`1dff18d6` queue operability batch (C3-15/16/20/21)** — clamp warn correct;
  `retryTimers` Set cleared on shutdown/re-init/restore; the "up to 25s"→"10s" comment
  corrected; the 2 s micro-cache + in-flight dedupe in `getGalleryConfigUncached` is
  race-free (finally clears inflight; TTL honored) and preserves the detached freshness
  contract within an accepted 2 s skew.
- **`c7f32eef` similar-route defensive copy (C3-06)** — `targetEmbedding = new Float32Array(decoded)`
  copies the RETAINED vector off the mysql2 wire buffer before the later scan query; the
  transient scan `.map()` decodes are consumed synchronously (rows materialized, no
  intervening await), so keeping their zero-copy fast path is safe.
- **`fc9e4407` OptimisticImage fallback-retry base + serve-upload fd-free HEAD/304
  (C3-24/C3-29)** — `retryBaseRef` switches to fallback and the `retryBaseRef.current !==
  fallbackSrc` guard ALSO closes a latent infinite fallback-reset loop; serve-upload
  caches `realpath(UPLOAD_ROOT)` on success only, 304/HEAD stat-only (no fd), GET body
  keeps fd-stat coherence; no false-403 (ENOENT-root window has no servable files). Both
  tests pass.
- **`1baeb3fe` nginx nextimage zone (C3-09/C3-12 doc)** — dedicated `zone=nextimage`
  30r/s burst 120 on `^~ /_next/image`, kept off `zone=public`; realip caveat documented;
  correctly recorded as INERT-until-operator-applies.

Secondary-scope files (read full current state, no new logic bug):
- `lib/rate-limit.ts` — XFF hop selection, pre-increment/rollback patterns, MySQL bucket
  upsert/decrement transaction, bounded purge all sound. (XFF-vs-realip topology is the
  deferred C1-11/C3-12op item, not re-reported.)
- `lib/background-db-writes.ts` — drain loop terminates; the only callers (audit-log +
  view-event inserts) do NOT self-spawn, so no infinite drain during shutdown; restore-gate
  double-checked (entry + inside closure).
- `lib/settings-hash.ts` — parameterized, compile-guarded key set, 5 s cache + inflight
  dedupe correct. (see CR4-02 for the fallback-ordering nit)
- `lib/smart-collections.ts` — fully parameterized (Drizzle binding + `containsLike`),
  column allowlist, per-column operator narrowing, scalar-value enforcement, depth/node/
  children budgets all enforced at validation; tag subquery parameterized; `remapTopicSlugInQuery`
  conservative (eq/in only). No injection, no unbounded recursion.
- `lib/view-retention.ts` — negative/non-finite retention falls back to default (no future
  cutoff), chunked bounded DELETE. Clean.
- `lib/upload-tracker.ts` — `settleUploadTrackerClaim` `Math.max(0, …)` reconciliation clean.

## Summary (<=8 lines)
- No CRIT/HIGH/MED regression across the 17 cycle-3 commits; all 11 code fixes verified
  correct against constructed failure scenarios, and the 3 subtlest have passing tests.
- CR4-01 (INFO): SW `await touchMeta` now serializes meta writes on the image display path
  — deliberate durability tradeoff, negligible cost; flag for future perf traces only.
- CR4-02 (LOW): settings-hash no-arg fallback disagrees with the config path on
  `image_sizes` ordering — transient extra revalidation only during a DB-outage cold start.
- CR4-03 (INFO): migrate.js C3-01 correctly converts a silent mixed-drift boot into a LOUD
  ER_TABLE_EXISTS deploy failure — right call, operator-visible behavior change.
- CR4-04 (INFO): single-writer reprobe-vs-stop race is benign because instrumentation
  `process.exit()`s immediately after the drain; revisit only if that changes.
- Secondary sweep (rate-limit, background-db-writes, settings-hash, smart-collections,
  view-retention, upload-tracker) clean.
