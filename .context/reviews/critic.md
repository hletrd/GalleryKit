# Critic Review — Cycle 14 (GalleryKit, HEAD 39cfa889)

**Agent:** critic (opus) · **Angle:** skeptical multi-perspective critique of the whole change surface, lifecycle/process-boundary bugs, "marquee fix silently defeated" patterns.

## Severity table
| ID | Sev | Status | File:line | One-line |
|----|-----|--------|-----------|----------|
| **C14-01** | **MEDIUM** | Confirmed (consequence timing-dependent) | `node_modules/next/dist/server/lib/start-server.js:388-390,375-376` ↔ `apps/web/src/instrumentation.ts:73-80` | Next 16 standalone server registers its OWN `SIGTERM`→`process.exit(143)` handler that races the app's `gracefulShutdown`; `NEXT_MANUAL_SIG_HANDLE` is unset, so the cycle-13 `exec` fix delivers SIGTERM to a process with TWO competing handlers — the marquee shutdown fix is silently defeated one layer deeper. |
| **C14-02** | LOW | Confirmed | `apps/web/src/components/lightbox-color-pip.tsx:44,173,179` | Cycle-13's `isAdmin &&` color guard (`8613e36f`) fixed `color-details-section.tsx` but missed the sibling lightbox component — identical unguarded admin-only `transfer_function`/`color_pipeline_decision` reads remain. |
| **C14-03** | INFO | Confirmed | `apps/web/Dockerfile:130` | SIGTERM during the migrate window still hits `sh` (PID-1 until `exec` runs). Benign (no buffer to flush pre-server; migrate is idempotent). Noted for completeness. |

## C14-01 — MEDIUM (HEADLINE): Next.js standalone registers a competing SIGTERM handler

**Evidence (read from source):** `node_modules/next/dist/server/lib/start-server.js` (Next 16.2.9):
```
388  if (!process.env.NEXT_MANUAL_SIG_HANDLE) {
389      process.on('SIGINT', cleanup);
390      process.on('SIGTERM', cleanup);   // Next installs its OWN handler
```
…and `cleanup` ends in `case 'SIGTERM': process.exit(143);` (line 375-376). `apps/web/src/instrumentation.ts:73-80` installs a SECOND SIGTERM handler whose `gracefulShutdown` ends in `process.exit(0|1)` after draining the queue + `flushBufferedSharedGroupViewCounts()`. `NEXT_MANUAL_SIG_HANDLE` is NOT set anywhere in the repo (grep over the whole tree excluding `node_modules` → 0 matches; not in Dockerfile/compose/entrypoint).

**Failure scenario:** after the cycle-13 `exec` fix node IS PID-1 and DOES receive Docker's SIGTERM on every per-iteration deploy. That SIGTERM now fires BOTH listeners concurrently; whichever reaches `process.exit()` first terminates the process and truncates the other.
- If Next wins: `flushBufferedSharedGroupViewCounts()` and the queue drain are cut off — exactly the data loss cycles 12-13 invested in preventing — and the orchestrator sees exit 143, overriding the `C4-A3` exit-code logic (`instrumentation.ts:57`).
- If the app wins: Next's `server.close()` in-flight-HTTP drain is cut off.
The race is nondeterministic (DB latency / connection state). The cycle-13 acceptance check ("container exits cleanly, no 30 s SIGKILL wait") CANNOT detect it — both handlers exit promptly; only `docker inspect --format '{{.State.ExitCode}}'` discriminates (0 = app won, 143 = Next won).

**Fix:** `ENV NEXT_MANUAL_SIG_HANDLE=true` in the Dockerfile runner stage (or compose `environment:`). With it set, `start-server.js:388` skips its handler and only `instrumentation.ts`'s `gracefulShutdown` runs → the view-count flush and exit code are honored deterministically.
**Trade-off (record, not blocker):** suppressing Next's handler also removes its `server.close()` in-flight-HTTP drain; in-flight requests are dropped at deploy instead of drained — consistent with the app's existing "flush then exit promptly" design.
**Confidence:** HIGH on the double-registration + unset env var (both read from source). MEDIUM on which side wins any given deploy.

## C14-02 — LOW: color guard missed the sibling `lightbox-color-pip.tsx`
Cycle-13 commit `8613e36f` guarded `color-details-section.tsx`; the parallel lightbox component still reads admin-only `transfer_function` (L44, L77, L173) and `color_pipeline_decision` (L44, L179) without an `isAdmin` guard. Same "safe today (fields undefined for public), trap for a future `isAdmin={false}` admin-data call site" status the cycle-13 fix carried. **Fix:** mirror the sibling — wrap the admin-only reads in `isAdmin && …`. **Confidence:** HIGH.

## C14-03 — INFO: residual SIGTERM-during-migration gap
`Dockerfile:130` — `exec` only replaces `sh` after `migrate.js` returns. A SIGTERM during migration hits `sh`, not the migrator. Negligible: HTTP server not started (no buffer to flush), `migrate.js` idempotent + hash-post-conditioned + `restart: always`. Flagged so it isn't mistaken for full coverage.

## Confirm/refute on cycle-13 fixes
| Fix | Verdict |
|---|---|
| #1 `exec node server.js` | CONFIRMED correct, but INSUFFICIENT → C14-01 (Next's competing handler races it). |
| #2 `bfree`→`bavail` (`images.ts:211`) | CONFIRMED correct (`bavail` excludes root-reserved blocks). |
| #3 password-change copy (`auth-rate-limit.ts:118`) | CONFIRMED correct. |
| #4 color-details guard | CONFIRMED correct, but INCOMPLETE → C14-02 (sibling missed). |
| #5 Atom feed username (`data.ts:798`) | CONFIRMED clean; both feed routes fall through to feed-level `<author>`; join/import dropped cleanly. |
| #6 aria-describedby (`photo-viewer.tsx:575`) | CONFIRMED correct (`sr-only md:not-sr-only`). |
| #7 load-more `min-h-11` | CONFIRMED correct. |
| #8 CLAUDE.md admin-token doc | CONFIRMED correct. |
| #9 line-cite/comment drift | Doc-only, not re-derived. |

**Config-drift sweep (no findings):** nginx body caps all match CLAUDE.md; cache policy `public, max-age=3600, must-revalidate` consistent across `next.config.ts:71`/nginx/serve-upload; `stop_grace_period: 30s` > 15 s shutdown timer; SW stamp clean.

**Verdict:** The cycle-13 implementation is clean and all nine fixes hold individually. But the headline fix closed the Docker half of the shutdown boundary and left the framework half open — Next's competing SIGTERM handler nondeterministically defeats the flush the last two cycles were built to guarantee. That is the cycle-14 finding: **C14-01 (MEDIUM)**, with **C14-02 (LOW)** as a second instance of the same recurring incompleteness pattern.
