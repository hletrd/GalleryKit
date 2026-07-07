# Cycle 8 (loop-B) — Aggregated Review Findings (2026-07-07/08)

**Review baseline HEAD:** `6256a988`. **Aggregation HEAD:** `a1863405` (the concurrent
peer loop's cycles 15-17 landed between review and aggregation and independently fixed a
large subset of this cycle's findings — each finding below carries an explicit
disposition verified against the CURRENT tree, not the review baseline).

**Lanes:** code-reviewer, perf-reviewer (reconstructed — see AGENT FAILURES), security-reviewer,
critic, verifier, test-engineer, tracer (partial — see AGENT FAILURES), architect, debugger,
document-specialist, designer. Per-agent files in this directory are provenance.

## AGENT FAILURES

- **perf-reviewer** — the lane's three sub-sweeps (server-actions perf, React component perf,
  SW/analytics/CLIP perf) completed and delivered findings, but the lane process died before
  writing its report. `perf-reviewer.md` in this directory was reconstructed by the
  orchestrator from the delivered sub-sweep results with every citation re-verified against
  source. Findings: PERF-F1, PERF-REACT-01, PERF-REACT-02, PERF8-SW-01, PERF8-BF-01.
- **tracer** — `tracer.md` covers flows 1 and 3 in full but was truncated before its
  delegated sub-traces (flows 2/4/5) were appended. Their one defect finding
  (TRACE8-RST-01, restore-scan short-read byte skip) was delivered mid-session and is
  identical to the verifier's independently-derived VER8-02 — folded below as one
  2-lane-agreement finding. The component sub-sweep's CMP-01 (image-zoom pan unit mixing)
  was likewise delivered mid-session and has been re-verified from source by the
  orchestrator (evidence inline below).

## Cross-lane agreement highlights

- **AGG8b-01** (logout swallow) — code-reviewer CR8-01 + critic CRIT8-01, independent.
- **AGG8b-02** (restore-scan short-read skip) — verifier VER8-02 + tracer sub-trace TRACE8-RST-01.
- **AGG8b-08** (root feed.xml rate-limit asymmetry) — API + page perf sub-sweeps (API-01/PAGE-01).

## Findings (deduped; severity = highest across lanes)

### Fixed at aggregation HEAD by the concurrent peer loop (verified in current tree — no work package needed; listed for lineage)

| ID | Source(s) | Sev/Conf | Finding | Verified fix at HEAD |
|----|-----------|---------|---------|----------------------|
| AGG8b-01 | CR8-01 + CRIT8-01 (2-lane) | HIGH/High | `logout()` set `revoked = true` after a swallowed `db.delete(...).catch(() => {})`, skipping the pending-revocation queue on a genuine DB failure (token verifiable up to 24 h) | `auth.ts` now try/catches the delete; `revoked` only on success (peer commit range `78778dd8..a1863405`) |
| AGG8b-02 | VER8-02 + TRACE8-RST-01 (2-lane) | HIGH(MED-HIGH)/Med | Restore SQL-scan loop advanced `off += CHUNK_SIZE` regardless of `bytesRead` — a legal short read skipped up to CHUNK_SIZE−bytesRead bytes entirely, defeating the scanner for statements in the gap | Loop now `scanOffset += bytesRead` (`db-actions.ts:759-774`); peer added `restore-sql-scan-file-loop.test.ts` pinning it |
| AGG8b-03 | DBG8-01 | MED-HIGH/High (exec-verified) | `ALLOWED_APP_BACKUP_DROP_TABLE_PATTERN` false-positived a legit own-schema `DROP TABLE` when the injected `\n` chunk join landed inside the table identifier — deterministic restore rejection for that dump | `tableNamePatternWithScannerBoundary` + trailing-fragment masking in `sql-restore-scan.ts` |
| AGG8b-04 | DBG8-02 | HIGH/High | `quiesceImageProcessingQueueForRestore` had no timeout race (unlike all 3 sibling drains) — a hung Sharp/CLIP job wedged the restore forever, holding all locks + durable marker | `RESTORE_QUEUE_DRAIN_TIMEOUT_MS` (30 s) `Promise.race`, returns boolean; caller aborts (peer) |
| AGG8b-05 | DBG8-03 | HIGH/High (exec-verified) | Truncated `iinf` (4-7 content bytes) made the ISOBMFF GPS-strip walker return `stripped:false` (clean) instead of failing closed — GPS-bearing original persisted | `entryHeaderBytes` bounds check returns `null` → fail closed (`gps-exif-strip.ts:434-435`) + test |
| AGG8b-06 | DBG8-04 | LOW-MED/High | `reprobeOnce` never re-armed on contended/error/connect-failure — boot-time-failed guard permanently inert; warning text overstated retries | All three branches now `scheduleReacquire()`; message corrected (peer) |
| AGG8b-10 | ARCH8-02 | LOW/High | Restore quiesce reset `embeddingScanCursorId` but not paired `embeddingScanModelVersion` (C4-16 near-miss instance) | `state.embeddingScanModelVersion = null` at `image-queue.ts:1325` |
| AGG8b-11 | CR8-02 | LOW/Med | Stale `claimRetryCounts` carried across a claim-success-then-processing-retry, escalating claim backoff early | `state.claimRetryCounts.delete(job.id)` after successful claim (`image-queue.ts:803`) |
| AGG8b-13 | CRIT8-03 (+ TRACE8-03 adjacent) | LOW/Med | `upload-processing-contract-lock.ts` had one unguarded `conn.release()` sibling; GET_LOCK-throw ambiguity released a possibly-lock-holding connection to the pool | New shared `destroyPooledAdvisoryLockConnectionOnAcquireError` used here and in `image-queue.ts`; helper unit-tested |
| AGG8b-16 | VER8-01 | LOW/High | `migrate.js:769` comment said idx-6 journal entry lands "2026-04" (actual 2026-05) | Comment now reads 2026-05 |
| AGG8b-17 | VER8-03 | LOW/Med | `recordAndEvict` recorded 0-size LRU entries, contradicting CLAUDE.md's "never recorded with size 0" invariant (`touchMeta` guarded, sibling didn't) | `if (newSize <= 0) return` in BOTH `sw.template.js` and `sw-cache.ts` + tests |
| AGG8b-18 | DOC8-01 | LOW-MED/High | Migrations 0028/0029 + `rate_limit_buckets` absent from CLAUDE.md schema/index inventory | Now documented (CLAUDE.md Database Indexes lines ~257, ~266) |
| AGG8b-19 | DOC8-02 | MED/High | Pending-session-revocation queue behavior undocumented in CLAUDE.md | "Pending session revocations" bullet added under Race Condition Protections |
| AGG8b-20 | DOC8-03 | LOW/Med-High | `site-config.json` `copyright` (Atom `<rights>`) undocumented | Documented in CLAUDE.md checklist + example JSON |
| AGG8b-33 | DBG8-05.1 | LOW/Med | `dirname()` in `restore-maintenance-durable.ts` mishandled single-leading-slash paths | `if (slash === 0) return '/'-slice` guard added |
| AGG8b-34 | DBG8-05.2 | LOW/Med | Restore tail-scan fs calls lacked typed-RestoreResult error handling | Scan loop now wrapped with the `failed to scan SQL dump for disallowed statements` catch (source-pinned by peer test) |

### OPEN — scheduled this cycle (see cycle-8b plan)

| ID | Source(s) | Sev/Conf | Finding (evidence re-verified at aggregation HEAD) |
|----|-----------|---------|-----------------------------------------------------|
| AGG8b-07 | CMP-01 (component sub-sweep; orchestrator re-verified) | **HIGH**/High | **Image-zoom drag pan mixes pixel and percentage units.** `positionRef` x/y are percent-of-container (per `clampPan` doc, `image-zoom-math.ts:34-43`, and `applyTransform`'s `translate(${x/level}%, …)` — net visual displacement = x% of container width). But BOTH drag paths feed raw pixel deltas into percent space: `image-zoom.tsx:127-141` (`mouseDragStartRef = e.clientX - positionRef.current.x`, then `clampPan(e.clientX - dragStart.x, …)`) and the touch path (`image-zoom.tsx:299-306`). Effect: pan speed scales with container width (~10× too fast at 1000 px, ~3.7× on a 375 px phone — image never tracks the pointer 1:1), and the fixed ±100 clamp is both over-permissive at low zoom and makes the image corners UNREACHABLE at 5× zoom (max translate 100/5 = 20 % < the 40 % needed). Wheel/pinch/double-tap anchor math is consistently percent-space; only the two drag paths mix units. Fix: convert drag deltas px→percent via container rect and make `clampPan` level-aware (`maxPan = (level-1)*50`). |
| AGG8b-08 | API-01/PAGE-01 (2-lane) | MED/High | Root `app/feed.xml/route.ts:37` carries `@public-no-rate-limit-required` while the same-shaped, same-cost topic feed (`[topic]/feed.xml/route.ts:71`) pre-increments `preIncrementFeedAttempt`. Both hit `getImagesForFeed` (DB). The exemption contradicts the product decision already made for the sibling route; root feed is the MORE crawled URL. Fix: mirror the topic feed's limiter. |
| AGG8b-14 | CRIT8-04 | LOW/Med | `db-child-watchdog.ts:57-62` cleanup detaches settle listeners even when `fired` — a post-timeout cleanup caller would leave the 5 s forceKill grace timer uncancellable on late child exit (SIGKILL to exited/reused PID). Current call sites guard by convention; fix the primitive (only detach when `!fired`) so the next caller can't reintroduce it. |
| AGG8b-15 | CRIT8-05 (residual) | LOW/High | CLAUDE.md now documents pending revocations + watchdog (peer), but the codebase-wide destroy-don't-release advisory-lock discipline (`advisory-lock-release.ts`, its contract test, and the new acquire-error destroy helper) is still absent from the Race Condition Protections section that enumerates every lock by name. One-bullet doc fix. |
| AGG8b-21 | TEST8-01 | HIGH/High | Logout revocation wiring has zero behavioral test — only order-insensitive `toContain` pins. Add behavioral cases in `auth-actions-behavior.test.ts`: restore-window skip, slot-not-acquired, and (new at HEAD) delete-throws → all must enqueue `hashSessionToken(token)`; success path must NOT enqueue. |
| AGG8b-22 | TEST8-02 | HIGH/High | `searchImages` full-tag-set parity pinned only by source-slice. Add a compiled-SQL (`.toSQL()`) assertion that the tag branch's WHERE uses the EXISTS subquery and the aggregation joins stay unfiltered. |
| AGG8b-23 | TEST8-03 | HIGH/High | Upload-quota TOCTOU claim-before-await proven only by `indexOf` position vs two named awaits — a NEW await inserted between check and claim passes today's test. Behavioral concurrency test (or strictly stronger static pin: no `await` token in the check→claim window). |
| AGG8b-24 | TEST8-04 | MED/Med | GPS fail-closed cleanup: `images-action-gps-toggle-wiring.test.ts` never asserts `deleteOriginalUploadFile(...)` inside the `!gpsStripped` block (LR twin covers it at `lr-upload-hdr-gate.test.ts:58`). Add the browser-path assertion. |
| AGG8b-27 | TEST8-07 | LOW/Med | Staged multi-lock releaser's PARTIAL-failure path untested (lock A release fails → lock B still attempted → `finish()` destroys). Add the case. |
| AGG8b-29 | PERF-REACT-01 | LOW-MED/High | `histogram.tsx:555` sets `crossOrigin='anonymous'` unconditionally — different request mode from the gallery's no-CORS `<img>` fetches, so the histogram re-downloads already-cached derivatives. Same-origin canvas reads don't taint; only set crossOrigin for genuinely cross-origin URLs (IMAGE_BASE_URL CDN case). |
| AGG8b-30 | PERF-REACT-02 | LOW/High | `tag-input.tsx:58-70` re-runs NFKC `normalizeTagInputValue` over the whole `availableTags` list (×2) on every keystroke. Memoize normalized forms keyed on `availableTags`. |

### DEFERRED this cycle (see cycle-8b deferred register for full records)

| ID | Source | Sev/Conf | Short reason / exit criterion |
|----|--------|---------|-------------------------------|
| AGG8b-09 | ARCH8-01 | MED/High | LR-upload vs browser-upload duplicated orchestration (drift class already burned twice, both healed). Structural refactor — per the C1-32 incremental-drainage policy, fold into the next upload-flow-touching cycle: extract shared `ingestUploadedImage(...)`. |
| AGG8b-25 | TEST8-05 (residual) | MED/High | File-loop wiring now source-pinned by the peer's `restore-sql-scan-file-loop.test.ts`; the BEHAVIORAL half (real spawn-mock harness driving the 3 `onTimeout` call sites) remains the already-open C6-12 row — do not mark C6-12 closed on the watchdog-primitive tests alone. |
| AGG8b-26 | TEST8-06 | LOW/Med | SW template exec harness — chains the already-open C4-18 (RTL/jsdom harness decision) row. |
| AGG8b-28 | PERF-F1 | LOW/Med | Embedding bootstrap scan shares the live pool without a documented budget — folds into the open C6-04c (shared pool-budget semaphore) row. |
| AGG8b-31 | PERF8-SW-01 | LOW/High | HTML offline-cache eviction is O(N) `match()` per write past cap — SW template changes are high-blast-radius (template+sw.js+contract test+CLAUDE.md cap contract); defer to next SW-touching cycle. |
| AGG8b-32 | PERF8-BF-01 | LOW/High | No `(pipeline_version, id)` index for backfill candidate scans — per the finding's own recommendation, ride the NEXT schema/migration-authoring cycle (do not author a migration solely for a LOW at documented single-admin scale). |

### No-action / informational (recorded, not scheduled)

| ID | Source | Sev | Disposition |
|----|--------|-----|-------------|
| AGG8b-12 | CRIT8-02 | LOW (process) | `f201309c` is an empty commit whose message claims the watchdog refactor (real work in parent `515a25bd`). History is pushed + shared-worktree; rewriting it would violate the repo's git safety rules. Recorded for provenance; the cycle-7b plan already attributes correctly. |
| AGG8b-35 | TRACE8-02 | LOW (info) | Delete-mid-fan-out burns bounded retries (~15-20 s log noise, no correctness impact). Not scheduled. |
| AGG8b-36 | TRACE8-03 | info | GET_LOCK-throw release path — reasoning rested on mysql2 fatal-error pool ejection; SUPERSEDED at HEAD by the peer's `destroyPooledAdvisoryLockConnectionOnAcquireError` (strictly stronger). Closed. |
| AGG8b-37 | CRIT8-06 | INFO | Process/bookkeeping overhead + "cycle 8" name collisions across two loops — acknowledged; this cycle's artifacts disambiguate with the `8b` plan suffix per the cycle-7b precedent. |
| AGG8b-38 | architect inventory | doc-lag | C4-17 (maintenance-scheduler extraction) is IMPLEMENTED (landed cycle 5, `instrumentation.ts` owns it) but still listed as an open carry-forward row — register update scheduled in the plan. |

### Clean lanes

- **security-reviewer:** 0 new findings (traced all 22 baseline commits call-by-call; three lint gates re-run PASS; npm audit 0).
- **designer:** 0 new findings (verified cycle-7 fixes complete at baseline; touch-target/i18n/live-region sweeps clean).
- **verifier:** 9 major CLAUDE.md claims verified accurate (migrate.js guard behavior vs real drizzle internals, COLOR_IMPACTING_KEYS=9, single-writer guard, advisory-lock discipline, mutation barrier, privacy guard, tagNamesAgg, upload TOCTOU, OG SSRF pinning).

## Totals

38 deduped findings: 17 already fixed at aggregation HEAD by the peer loop (verified individually),
11 scheduled, 6 deferred with exit criteria, 4 no-action/informational.
By original severity: 6 HIGH (3 fixed-at-HEAD, 1 scheduled code fix, 3 scheduled test-design), 1 MED-HIGH (fixed),
5 MED (2 fixed, 2 scheduled, 1 deferred), remainder LOW/INFO.
