# Cycle 13 — Critic Review (Adversarial, Multi-Perspective)

**Date:** 2026-06-27
**HEAD:** 80145992 (post cycle-12 fixes: ee9b2a7d shutdown, 7f969d64 avif-partial-read, 2b0a7799 db-timer, ff3f0720 queue-guard, 43f36c20 audit-test, 247382d8 docs)
**Reviewer mode:** Started THOROUGH, escalated to ADVERSARIAL on the shutdown/lifecycle subsystem after finding a MEDIUM that nullifies the cycle-12 headline fix in production.
**Method:** Verified every cycle-12 fix landed correctly; re-verified the core CLAUDE.md guarantees against installed code; then hunted the deployment/runtime boundary that 12 cycles of source-level review never crossed.

---

## Pre-commitment predictions (made before deep investigation)

1. The new `process.exit()` in the shutdown handler would either (a) truncate the flush it is meant to enable, or (b) interact badly with stdout buffering. → (a) FALSE (flush is awaited); (b) TRUE (R13-02).
2. ETag 9-key / image_sizes-sort claims would be intact. → TRUE (verified, no finding).
3. Privacy-field omission would be compile-time-guarded and sound. → TRUE (verified, no finding).
4. A recently-landed "fix" would be subtly incomplete. → The cycle-12 fixes are all correct; the gap is one level UP, at the Docker signal boundary (R13-01).
5. The XFF / rate-limit path would have an exploitable spoof. → FALSE — nginx replace-mode + from-the-right anchoring defang it (verified, no finding). This is the cycle-12 lesson paying off: I almost asserted a HIGH here.

---

## Verified guarantees that HOLD (acknowledged, not findings)

- **Shutdown CODE is correct**: `gracefulShutdown` awaits `Promise.all([shutdownImageProcessingQueue(), flushBufferedSharedGroupViewCounts()])` BEFORE `process.exit()`; sentinel timer captured, `.unref()`'d, `clearTimeout`'d in `finally` (`instrumentation.ts:18-66`). The flush completes before exit — no data truncation from the exit itself.
- **db init timer** captured / `.unref()`'d / `clearTimeout`'d in `finally` (`db/index.ts:94-112`). Correct.
- **ETag / settings-hash**: `COLOR_IMPACTING_KEYS` is exactly 9 entries; `image_sizes` sorted ascending before hashing (`settings-hash.ts:42-54, 99`); compile-time `_ColorKeysAreSettingKeys` guard present; serve-upload ETag folds it in (`serve-upload.ts:214-215`). Correct.
- **Privacy omission**: `publicSelectFields`/`publicMapSelectFields` derived from `adminSelectFields` by destructure-omit; `_privacyGuard` / `_mapPrivacyGuard` / `_largePayloadGuard` compile-time assertions over the canonical `PrivacySensitiveKeys` union (`data.ts:410-458`). `image_embeddings.imageId` is `onDelete:'cascade'` (`schema.ts:272`) — no orphan embeddings for deleted photos. Correct.
- **Auth lockdowns** (cycle-9 b22fa85e) present in current code: `isAdmin()` gate in `createLrToken` (`lr-tokens.ts:36`) and the deleteAdminUser path. Correct.
- **Rate-limit buckets**: opportunistic prune on each request (no standalone leaked timers); `getClientIp` anchors from the right of XFF and `nginx/default.conf` uses `X-Forwarded-For $remote_addr` (REPLACE, locked by `nginx-config.test.ts:27`), so client-spoofed XFF is overwritten. Correct.
- **Semantic-search production gate**: resolver heals stored `'production'`→`'disabled'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in BOTH the DB-row path (`gallery-config.ts:141`) and the DEFAULTS fallback (`gallery-config.ts:196`); the route reads the healed `getGalleryConfig()`. Correct.
- **cycle-12 fixes**: `_verifyAvifNclx` partial-read (`process-image.ts:251-264`), queue runtime-shape guard (`image-queue.ts:186-194`), per-job retryTimer `.unref()`'d (`image-queue.ts:326`), view-count flush timers `.unref()`'d (`data.ts:60,90`), queue-shutdown clears gcInterval + bootstrapRetryTimer (`queue-shutdown.ts:26-36`). All correct.

The codebase is genuinely mature and well-hardened. The findings below are concentrated at the ONE boundary prior cycles did not examine: the container's process/signal topology.

---

## R13-01 — [MEDIUM] SIGTERM never reaches `node server.js` in the shipped Docker container → the entire graceful-shutdown subsystem AND the cycle-12 headline fix are inert in production

**Confidence:** HIGH on the architecture (textbook signal-swallowing topology, every link verified from the Dockerfile/compose/entrypoint). **NEEDS empirical confirmation** of the signal NOT being delivered (cannot run Docker in this review env — exact commands below).

**Files / evidence:**
- `apps/web/Dockerfile:121` `ENTRYPOINT ["entrypoint.sh"]`
- `apps/web/Dockerfile:124` `CMD ["sh", "-c", "node apps/web/scripts/migrate.js && node apps/web/server.js"]`
- `apps/web/scripts/entrypoint.sh` (last line) `exec gosu node "$@"`
- `apps/web/Dockerfile:1,10` base image `node:24-slim` (Debian → `/bin/sh` = **dash**)
- `apps/web/docker-compose.yml:13` `stop_grace_period: 30s`; **no** `init: true`, no tini/dumb-init, no `STOPSIGNAL` anywhere.
- `apps/web/scripts/migrate.js` exits (`process.exit` / `connection.end`), so `node server.js` runs as a **separate** child after migrate.

**Runtime process tree (derived):**
`entrypoint.sh` (PID 1) `exec gosu node "$@"` → gosu execs (replaces itself) → **PID 1 = `sh -c "node migrate.js && node server.js"` (dash)** → `node server.js` is a **child** of dash. The `&&` makes the `-c` body a compound list, which disables dash's single-simple-command exec-optimization, so node is NOT exec'd into PID 1.

**Why it breaks:** `docker stop` / `docker compose down` (and the per-iteration `deploy.sh` rebuild) deliver SIGTERM to PID 1 only = dash. Non-interactive dash does not trap or forward SIGTERM to a foreground child; node keeps running until Docker's 30s `stop_grace_period` elapses, then the container is SIGKILLed (exit 137). **`process.on('SIGTERM', gracefulShutdown)` in `instrumentation.ts:73` never fires.**

**This directly nullifies cycle-12's headline fix (AGG-R12-01).** That fix's stated trigger is *"Every per-iteration `npm run deploy` (Docker restart sends SIGTERM)"* — the one scenario where SIGTERM does not reach node. The cycle-12 reviewers verified Next.js registers no competing SIGTERM handler, but did **not** verify the signal is *delivered to node at all* through the `gosu … sh -c "A && B"` wrapper. The observed symptom (linger → exit 137 at stop-timeout) is equally explained by "node never gets SIGTERM" as by "handler runs but never exits." The `exec gosu` + `&&` topology makes the former the more likely production mechanism. (The cycle-12 fix IS still correct and useful for the *direct-node* path — `next dev` Ctrl+C / SIGINT — where node receives the signal directly.)

**CLAUDE.md guarantee broken:** *"The shared-group view-count buffer ... flushed on graceful SIGTERM, lost on SIGKILL."* In the shipped Docker topology the SIGTERM path is never taken, so the buffer is lost on **every** deploy (the SIGKILL path), and the "flushed on graceful SIGTERM" half is never exercised.

**Realist check (severity):** Blast radius is contained — view counts are best-effort analytics (documented), in-flight Sharp encodes are restart-recoverable (per-image advisory-lock claim + `WHERE processed=false` + atomic temp-rename + bootstrap re-scan), no corruption, no security impact. Net effect: lost best-effort view increments per deploy + every deploy stalls up to 30s then logs a confusing exit-137. For a single-instance personal gallery this is annoying-not-catastrophic → **MEDIUM**, but it is the single highest-value finding because it silently defeats an entire documented subsystem and the prior cycle's headline work, which a maintainer urgently needs to know before trusting the shutdown path.

**Fix (one-line, minimal):** make node replace the shell so it becomes PID 1 and receives SIGTERM directly:
`CMD ["sh", "-c", "node apps/web/scripts/migrate.js && exec node apps/web/server.js"]`
(the `exec` before the long-running server is the whole fix; migrate still runs as a short-lived child first). Alternatively set `init: true` in `docker-compose.yml` (Docker injects tini, which forwards signals), or add `tini`/`dumb-init` as ENTRYPOINT. Prefer the `exec` form — zero new dependency.

**Empirical verification (run on the deploy host; READ-ONLY):**
1. `docker exec gallerykit-web cat /proc/1/cmdline | tr '\0' ' '; echo` → if it prints `sh -c node ... && node ...` (not `node ... server.js`), node is NOT PID 1 → finding confirmed.
2. `docker exec gallerykit-web sh -c 'ps -o pid,ppid,args'` → confirm `node ... server.js` has PPID = the `sh` PID, not 0/1.
3. `docker stop --time 35 gallerykit-web` while tailing `docker logs -f gallerykit-web` → **absence** of `[Shutdown] SIGTERM received, draining queue...` confirms the handler never ran.

---

## R13-02 — [LOW] `process.exit()` truncates buffered stdout/stderr on a pipe (Docker), losing the shutdown diagnostic logs the exit-code change exists to support

**Confidence:** MEDIUM (documented Node behavior; whether the specific small writes flush synchronously is runtime-dependent — needs-verification).
**File:** `apps/web/src/instrumentation.ts:44-65`.

When the handler DOES run (dev/SIGINT path today; the Docker path once R13-01 is fixed), `console.debug('[Shutdown] In-flight queue work drained, exiting.')` / `console.error('[Shutdown] In-flight queue work was NOT fully drained...')` are emitted immediately before `process.exit(exitCode)`. Node does not flush async stdout/stderr writes to a **pipe** (Docker captures stdout via a pipe, not a TTY) before `process.exit()` — the trailing line can be dropped. This undercuts the stated intent of the exit-code change ("lets the orchestrator see a prompt, intentional exit code") because the *explanation* of why the code is 0 vs 1 is exactly the line at risk. **No data loss** — the MySQL flush is awaited and complete before exit.

**Fix:** write the final status line synchronously (`fs.writeSync(2, ...)`), or defer the exit one tick (`setImmediate(() => process.exit(exitCode))`) so the libuv write queue drains, or accept the cosmetic loss and drop the trailing log. Low priority; only matters once R13-01 is fixed.

---

## R13-03 — [LOW] Detached caption/embedding `void`-IIFE hooks are not part of the queue drain; `process.exit()` shrinks their shutdown completion window to ~0

**Confidence:** HIGH (structural).
**File:** `apps/web/src/lib/image-queue.ts:460` (caption) and `:498` (embedding); drain at `queue-shutdown.ts:38-41` awaits only `queue.onIdle()`.

The caption and embedding writes are fired as detached `void (async () => {…})()` from within a queue job, **after** `processed=true` is committed. They are not tracked by `PQueue`, so `queue.onIdle()` resolves without awaiting them. Pre-cycle-12, the process lingered (up to stop-timeout) and these detached writes often completed during that window. The new `process.exit()` (when the handler runs) terminates immediately after `onIdle()`, dropping the caption/embedding for any image whose Sharp pass just committed. **Mitigated:** writes are idempotent (`onDuplicateKeyUpdate`), regenerable via `backfill-clip-embeddings.ts` / caption backfill, and only the last-processed image(s) are affected. **Masked today** by R13-01 (the handler doesn't run in Docker at all). Worth noting because the shutdown comment claims "In-flight queue work drained" while these hooks are, by construction, outside the drain.

**Fix (optional):** track the detached hooks in a module-level `Set<Promise>` and `await Promise.allSettled([...])` inside `drainProcessingQueueForShutdown` after `onIdle()` (bounded by the 15s sentinel). Or accept it as documented best-effort and reword the "drained" comment.

---

## R13-04 — [LOW, carry-over] `lib/storage/*` is dead code (referenced only by its own test)

**Confidence:** HIGH.
**Files:** `apps/web/src/lib/storage/{index,local,types}.ts`; only importer outside the dir is `apps/web/src/__tests__/storage-local.test.ts:10`.

CLAUDE.md explicitly says the storage backend is "Not Yet Integrated / local filesystem only." The abstraction + its test are pure carrying cost and a trap for a new maintainer who assumes S3/MinIO switching is wired. Deferred in cycle 12 (AGG-R12 "quarantine decision deferred to a product call"). Re-affirming: either quarantine behind a clearly-labeled `experimental/` path or delete until the pipeline is wired end-to-end. No action required this cycle if the product call is still pending — just don't let it keep accreting tests that imply it works.

---

## R13-05 — [INFO] cycle-12 plan Task 5 bullet 1 (`image-queue.ts:87` "Map.keys()→Set") was correctly NOT applied; the convergence trail could mislead

**Confidence:** HIGH (code is correct).
The cycle-12 plan asked to reword `image-queue.ts:87` from "insertion-order via Map.keys()" to "Set iteration (.values())". The implementer (correctly) did not touch it: line 87 documents `pruneRetryMaps`, which operates on `retryCounts`/`claimRetryCounts`/`lastErrors` — genuine `Map`s iterated via `map.keys()` (`image-queue.ts:98-110`). The plan misidentified a Map as a Set; applying the "fix" would have made a correct comment wrong. The `:159` half of that task (permanentlyFailedIds "Set with no eviction") WAS correctly fixed (ff3f0720). No code defect — flagged only so a future maintainer auditing the plan-vs-commit trail does not "re-fix" the accurate comment.

---

## What's missing / gaps (not separately scored)

- **No deployment-topology test or doc** asserts node is PID 1 / receives SIGTERM. The graceful-shutdown subsystem (instrumentation.ts, queue-shutdown.ts, the view-count flush, the 15s sentinel, the exit-code contract) is substantial code with **zero** end-to-end signal-delivery coverage. There is a `nginx-config.test.ts` that source-locks the proxy config; there is no equivalent "Dockerfile CMD uses exec / node is PID 1" guard. A one-line fixture (`expect(dockerfile).toMatch(/exec node .*server\.js/)` or asserting `init: true` in compose) would prevent regression once R13-01 is fixed.
- **`stop_grace_period: 30s` + restart:always** means until R13-01 is fixed, every per-iteration deploy pays up to 30s of dead-wait per restart. Not a correctness bug, but it compounds with the documented "disk hygiene / per-deploy prune" cadence.
- The shutdown handler races `shutdownImageProcessingQueue()` and `flushBufferedSharedGroupViewCounts()` in one `Promise.all`; on a >15s drain the sentinel wins and `process.exit(1)` truncates whichever is still in flight. Documented best-effort; fine — only noting that the 15s ceiling silently caps the flush.

## Multi-perspective notes

- **Ops engineer:** R13-01 is the one that bites — "my deploys take 30s and log exit 137 every time, and my shutdown logs never appear" is the exact lived symptom; the cycle-12 commit message will make an operator believe it's fixed when (in Docker) it isn't.
- **New maintainer:** `lib/storage/*` (R13-04) and the plan-vs-comment trail (R13-05) are the surprises. The shutdown code reads as airtight at the source level — the trap is that it's wired to a signal it never receives.
- **Skeptic:** The strongest case that R13-01 is wrong is "maybe dash forwards SIGTERM" — it does not by default, and the `&&` defeats the exec-optimization, so node stays a child. The honest residual uncertainty is purely empirical (I could not run Docker here), hence the explicit verification commands and MEDIUM (not HIGH) severity.

## Verdict

**REVISE.** Codebase is mature and the cycle-12 fixes are individually correct. One MEDIUM (R13-01) is high-value because it silently defeats the entire graceful-shutdown subsystem and the prior cycle's headline fix in the shipped Docker deployment; it has a one-line fix (`exec node …`) and concrete read-only verification steps. The rest are LOW/INFO polish. No CRITICAL/HIGH, no security or data-corruption blockers. Schedule R13-01 (with the empirical verification) for cycle 13; R13-02/03 are cheap follow-ons that only matter once R13-01 lands; R13-04/05 are carry-over/INFO.
