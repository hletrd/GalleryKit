# Aggregate Review — Cycle 8 (RPL loop, 2026-04-23)

**Purpose:** consolidate findings from all spawned reviewer roles this
cycle. Dedupe across agents, preserve highest severity/confidence,
note cross-agent agreement.

**Cycle orchestrator:** review-plan-fix loop, cycle 8 of 100.
**DEPLOY_MODE:** per-cycle.

**HEAD:** `000000053 docs(plan): 📝 record cycle 7 rpl plan + deferred items`
(cycle 7-rpl landings: CSV leading-whitespace guard, bidi strip,
restore advisory-lock release on early-return, bytesRead capture,
share rollback symmetry on generic-error paths, CLAUDE.md
clarifications, parallel orphan cleanup, purge catch).

## Source reviews (10 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer-cycle8-rpl.md` |
| Security Reviewer | `.context/reviews/security-reviewer-cycle8-rpl.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer-cycle8-rpl.md` |
| Critic | `.context/reviews/critic-cycle8-rpl.md` |
| Verifier | `.context/reviews/verifier-cycle8-rpl.md` |
| Test Engineer | `.context/reviews/test-engineer-cycle8-rpl.md` |
| Tracer | `.context/reviews/tracer-cycle8-rpl.md` |
| Architect | `.context/reviews/architect-cycle8-rpl.md` |
| Debugger | `.context/reviews/debugger-cycle8-rpl.md` |
| Document Specialist | `.context/reviews/document-specialist-cycle8-rpl.md` |
| Designer | `.context/reviews/designer-cycle8-rpl.md` |

## Environment note on agent fan-out

Same as cycle 5/6/7-rpl: the Task/Agent tool is not exposed as a
named invocable fan-out primitive in this environment. Per the
orchestrator's "skip any that are not registered" clause, each
reviewer role's scan was performed directly and one file per role
was written to preserve provenance. All 11 reviewer roles returned
(10 source reviews + designer).

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG8R-01** | CRIT8-01, S8-03, DBG8-01, Trace-1, T8-02 | `escapeCsvField` bidi-strip covers U+202A-202E and U+2066-2069 but NOT zero-width characters (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM, U+2060 WJ, U+180E MVS). A field starting with `​=...` (ZWSP + formula) survives all four strips because `\s` in JS regex does NOT match U+200B. Spreadsheet apps strip leading invisible chars on import, then interpret the formula. Admin-only input surface. | LOW | HIGH | **5 agents** |
| **AGG8R-02** | CR8-01, S8-01, DBG8-02, Trace-2, T8-01 | `uploadImages` upload-tracker first-insert race. When `uploadTracker.get(uploadIp)` returns `undefined`, two concurrent requests each build fresh `{count:0,bytes:0,windowStart:now}` objects. Both pass the `tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW` check. Last `set` wins, erasing the earlier claim. Bypasses cumulative-across-calls limit on a cold IP. | LOW | HIGH | **5 agents** |
| **AGG8R-03** | CRIT8-02 | Cycle-7-rpl `RELEASE_LOCK` early-return uses `.catch(() => {})` — silently swallows errors. Operator can't debug a lock-release failure if the DB hiccups at that instant. | LOW | MEDIUM | 1 agent |
| **AGG8R-04** | A8-01 | Rate-limit machinery duplicated across 4 domains (login/search/share/upload). Each has its own in-memory Map shape, prune throttling, eviction cap, and rollback semantics. Previous cycles (4-7) cascaded symmetric-rollback fixes one Map at a time. Consolidation would reduce future-regression risk. Carry-forward AGG2-04. | MEDIUM | HIGH | 1 agent |
| **AGG8R-05** | DS8-01, S8-05 | CLAUDE.md advisory-lock section doesn't document that lock NAMES (`gallerykit_db_restore`, `gallerykit:image-processing:*`) are DB-server-scoped, not database-scoped. Two GalleryKit instances on one MySQL server would serialize restores across tenants. Docs-only fix for now; multi-tenant deployment rare. | LOW | MEDIUM | 2 agents |
| **AGG8R-06** | DS8-04 | Custom lint gates `lint:api-auth` and `lint:action-origin` are enforced by the orchestrator but NOT documented in CLAUDE.md "Testing" section. Future contributors miss them. | LOW | HIGH | 1 agent |
| **AGG8R-07** | DS8-03 | CLAUDE.md "Database Security" CSV bullet doesn't mention the cycle-7-rpl Unicode bidi strip. Operators auditing posture miss this layer. | LOW | LOW | 1 agent |
| **AGG8R-08** | DBG8-08 | `cleanOrphanedTmpFiles` broad `catch` at line 48-50 swallows all errors (not just ENOENT). EACCES silently skips; no operator log. | LOW | HIGH | 1 agent |
| **AGG8R-09** | CR8-05 | `runRestore` file-size check (`file.size > MAX_RESTORE_SIZE_BYTES`) runs AFTER advisory-lock acquisition + `beginRestoreMaintenance()`. An attacker could repeatedly upload oversized dummies to briefly block restores. Move size check to `restoreDatabase` before `GET_LOCK`. | LOW | MEDIUM | 1 agent |
| **AGG8R-10** | CR8-02 | CSV formula-prefix regex `/^\s*[=+\-@\t]/` includes `\t`, but the control-char strip (line 25) removes `\x09` before the formula check sees it. Dead-code branch; no functional issue. | LOW | HIGH | 1 agent |
| **AGG8R-11** | P8-01 | `Buffer.alloc(readSize)` per chunk in SQL-scan loop zero-fills every 1 MiB. For a 250 MiB restore that's ~250 MiB of zero-fill writes. Reuse a `Buffer.allocUnsafe(CHUNK_SIZE)` across iterations. | LOW | MEDIUM | 1 agent |
| **AGG8R-12** | P8-05 | `pruneUploadTracker` runs on every upload call, iterating the full Map. Throttle similar to `pruneSearchRateLimit`. | LOW | MEDIUM | 1 agent |
| **AGG8R-13** | CR8-08 | `pruneShareRateLimit` hard-cap eviction walks `.keys()` in insertion order, which may evict fresh entries over old ones after a restart. LRU by `resetAt` would be more correct. | LOW | MEDIUM | 1 agent |
| **AGG8R-14** | CRIT8-03 | `sharing.ts` "DB-pre-increment then rollback" pattern (line 123-128) has no inline comment. Readability concern. | LOW | HIGH | 1 agent |
| **AGG8R-15** | CRIT8-06 | `pruneUploadTracker` uses `UPLOAD_TRACKING_WINDOW_MS * 2` as expiry cutoff. Why `* 2`? Arbitrary grace factor. Either drop or document. | LOW | LOW | 1 agent |
| **AGG8R-16** | A8-02 | Two `globalThis` singletons (image-queue + restore-maintenance) duplicate Symbol.for boilerplate. Factor into `@/lib/process-singleton.ts`. | LOW | HIGH | 1 agent |
| **AGG8R-17** | A8-03 | Restore lifecycle orchestration spans 3 modules (db-actions, restore-maintenance, image-queue, data). Extract RestoreLifecycle helper or ASCII diagram. | LOW | MEDIUM | 1 agent |
| **AGG8R-18** | DS8-06 | `plan/plan-222-cycle7-rpl-deferred.md` lists AGG7R-05 under "Deferred findings" but states "NOT deferred" — inconsistent organization. | LOW | HIGH | 1 agent |
| **AGG8R-19** | D8-03 | No UI indicator for "restore maintenance mode". Admin sees consecutive `restoreInProgress` errors across unrelated actions without context. Would benefit a `/api/admin/restore-status` poll + banner. | LOW | MEDIUM | 1 agent |
| **AGG8R-20** | T8-08 | `decrementRateLimit` atomic behavior (`GREATEST(count - 1, 0)`) under concurrent calls has no regression test. | LOW | MEDIUM | 1 agent |
| **AGG8R-21** | T8-04 | `beginRestoreMaintenance` early-return + `RELEASE_LOCK` path has no unit test. Plan-221 T7R-02 explicitly noted this was hard to test. | LOW | HIGH | 1 agent |

## Carry-forward (unchanged — existing deferred backlog)

From cycle 7-rpl (`plan/plan-222-cycle7-rpl-deferred.md`):
- AGG7R-06 (X-Real-IP nginx doc hardening).
- AGG7R-12 (escapeCsvField regex pass merge).
- AGG7R-14 (FLUSH_CHUNK_SIZE track pool size).
- AGG7R-15 (purgeOldBuckets unbatched DELETE).
- AGG7R-16 (CSV truncation warning UI verification).
- AGG7R-17 (searchImagesAction rate-limit UX sentinel).
- AGG7R-19 (updatePassword session rotation).
- AGG7R-20 (cleanOrphanedTmpFiles log-level inconsistency).
- AGG7R-21 (settleUploadTrackerClaim double-call refactor).

From cycle 6-rpl and earlier: all items in
`plan/plan-220-cycle6-rpl-deferred.md` and
`plan/plan-218-cycle5-rpl-deferred.md` remain deferred with original
severity/confidence.

Older backlog: D1-01/D2-08/D6-09 CSP, D2-01/D1-03 admin mobile nav,
D2-02 uploadImages dead `replaced: []`, D2-03/D6-05 CSV streaming,
D2-04 duplicate rate-limit Maps (overlaps AGG8R-04), D2-05/PERF-02
search sequential, D2-06/PERF-03 bootstrap unpaginated SELECT,
D2-07 session clock-drift, D2-09 updatePassword concurrent test,
D2-10 settings-client coupling, D2-11 data.ts mutable view buffering,
D6-01 cursor pagination, D6-02 scoped topic/tag nav, D6-03 visual
regression, D6-04 public photo ISR/auth boundary, D6-06 sitemap
partitioning, D6-10 durable view counts, D6-11 tag metadata, D6-12
split mutable buffering, D6-13 single-process runtime, D6-14 test
surface, OC1-01/D6-08 historical secrets (acknowledged), font
subsetting, Docker node_modules, PERF-UX-01/02 blur
placeholder/variable font, AGG3R-06 footer contrast.

## Severity distribution

- MEDIUM: 1 (AGG8R-04 rate-limit consolidation — architectural debt).
- LOW: 20.

## Recommended cycle-8 implementation priorities

1. **AGG8R-01** — extend CSV bidi-strip regex to include zero-width
   chars (5-agent agreement; simple one-line regex extension + test).
2. **AGG8R-02** — fix upload-tracker first-insert race (5-agent
   agreement; set Map before first await).
3. **AGG8R-06** — document custom lint gates in CLAUDE.md.
4. **AGG8R-08** — narrow `cleanOrphanedTmpFiles` catch to ENOENT.
5. **AGG8R-10** — drop unreachable `\t` from formula-prefix char
   class (or add comment).
6. **AGG8R-05** — document advisory-lock DB-scoping in CLAUDE.md.
7. **AGG8R-07** — mention bidi strip in CLAUDE.md "Database Security".
8. **AGG8R-18** — reorganize plan-222 so AGG7R-05 isn't in deferred
   heading.
9. **AGG8R-03** — change `.catch(() => {})` to `.catch(err => console.debug(...))`
   in RELEASE_LOCK early-return.

Items 1 and 2 are the priority — real bugs with concrete exploit/
bypass paths. The rest are polish/docs.

## Deferred this cycle

- **AGG8R-04** (rate-limit consolidation): architectural refactor,
  out of scope for a polish cycle. Carry-forward to architectural
  backlog. Preserve MEDIUM severity.
- **AGG8R-09** (restore size-check-before-lock): low severity,
  requires careful refactor of `restoreDatabase` entry flow.
- **AGG8R-11** (Buffer.allocUnsafe reuse): micro-opt.
- **AGG8R-12** (pruneUploadTracker throttle): micro-opt.
- **AGG8R-13** (pruneShareRateLimit LRU by resetAt): micro-opt.
- **AGG8R-14** (inline comment for DB-pre-increment pattern):
  optional; no behavior change.
- **AGG8R-15** (document `* 2` grace factor): optional.
- **AGG8R-16** (singleton helper factor-out): refactor.
- **AGG8R-17** (RestoreLifecycle extraction): refactor.
- **AGG8R-19** (restore-status UI banner): UI task, scope beyond
  RPL polish.
- **AGG8R-20** (decrementRateLimit concurrent test): defensive test.
- **AGG8R-21** (beginRestoreMaintenance early-return test):
  defensive test, hard-to-mock.

All will be recorded in the cycle-8-rpl deferred plan with exit
criteria.

## Cross-agent agreement highlights

- AGG8R-01 (zero-width CSV bypass): 5 agents (critic, security,
  debugger, tracer, test-engineer).
- AGG8R-02 (upload-tracker first-insert race): 5 agents
  (code-reviewer, security, debugger, tracer, test-engineer).
- AGG8R-05 (advisory-lock DB-scoping): 2 agents (doc-specialist,
  security).

## AGENT FAILURES

None — all 10+1 reviewer roles returned.
