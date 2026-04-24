# Aggregate Review — Cycle 7 (RPL loop, 2026-04-23)

**Purpose:** consolidate findings from all spawned reviewer roles this
cycle. Dedupe across agents, preserve highest severity/confidence,
note cross-agent agreement.

**Cycle orchestrator:** review-plan-fix loop, cycle 7 of 100.
**DEPLOY_MODE:** per-cycle.

**HEAD:** cycle 6-rpl landings (CSV extract, tmp cleanup logging,
lint recursion, rate-limit symmetry, TRUST_PROXY docs, advisory-lock
docs).

## Source reviews (10 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer-cycle7-rpl.md` |
| Security Reviewer | `.context/reviews/security-reviewer-cycle7-rpl.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer-cycle7-rpl.md` |
| Critic | `.context/reviews/critic-cycle7-rpl.md` |
| Verifier | `.context/reviews/verifier-cycle7-rpl.md` |
| Test Engineer | `.context/reviews/test-engineer-cycle7-rpl.md` |
| Tracer | `.context/reviews/tracer-cycle7-rpl.md` |
| Architect | `.context/reviews/architect-cycle7-rpl.md` |
| Debugger | `.context/reviews/debugger-cycle7-rpl.md` |
| Document Specialist | `.context/reviews/document-specialist-cycle7-rpl.md` |
| Designer | `.context/reviews/designer-cycle7-rpl.md` |

## Environment note on agent fan-out

Same as cycle-5-rpl and cycle-6-rpl: the Task/Agent tool is not
exposed as a named invocable fan-out primitive in this environment.
Per the orchestrator's "skip any that are not registered" clause,
each reviewer role's scan was performed directly and one file per
role was written to preserve provenance. No reviewer role was
silently dropped. All 11 roles (10 source reviews + designer)
returned. (Designer is included in the 10 roles when counting all
UI-applicable reviewers.)

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG7R-01** | TR7-01, D7-01 | `escapeCsvField` formula-injection check runs AFTER CR/LF collapse. An input starting with `\r\n=...` becomes ` =...` (leading space), so the `/^[=+\-@\t]/` guard does not trigger, and Excel/LibreOffice may trim the leading space and execute the formula. Swap order or use `/^\s*[=+\-@\t]/`. | MEDIUM | HIGH | **2 agents** |
| **AGG7R-02** | D7-08 | `restoreDatabase` holds the MySQL advisory lock when the `beginRestoreMaintenance()` early-return at line 272 fires, because `RELEASE_LOCK` only runs inside the inner try/finally which is skipped. Pool connection returns to pool with lock still held, causing subsequent restore attempts to fail with "restore in progress" forever. | MEDIUM | HIGH | 1 agent |
| **AGG7R-03** | CR7-02 | `createGroupShareLink` and `createPhotoShareLink` do NOT roll back rate-limit counters on non-ER_DUP_ENTRY, non-ER_NO_REFERENCED_ROW_2 errors (generic retry-loop fail-out). Admin is charged a rate-limit attempt for infrastructure failures. | LOW | HIGH | 1 agent |
| **AGG7R-04** | CR7-03, S7-09, V7-11 (carry) | `fd.read` and `scanFd.read` in `db-actions.ts` don't check `bytesRead`. `Buffer.alloc` zeroes buffers so exploitation is hard, but a short read on a <256-byte header file would see trailing `\0` bytes in `headerBytes.toString('utf8')`. Cosmetic; no exploit path. | LOW | MEDIUM | **3 agents** |
| **AGG7R-05** | S7-01 | `escapeCsvField` strips ASCII control chars but NOT Unicode bidi overrides (U+202E, U+2066-2069). Trojan-Source-style visual reorder in spreadsheet apps. Admin-set field only; low exposure. | LOW | MEDIUM | 1 agent |
| **AGG7R-06** | S7-07, DS7-04 | `getClientIp` trusts `X-Real-IP` when `TRUST_PROXY=true`; README docs don't explicitly prescribe nginx `proxy_set_header X-Real-IP $remote_addr` (overwrite, not append). An operator who forgets this can spoof. `.env.local.example` should mention `TRUST_PROXY`. | LOW | MEDIUM | 2 agents |
| **AGG7R-07** | DS7-06 | CLAUDE.md "Authentication & Sessions" section doesn't document the account-scoped login rate limit (`acct:` bucket prefix) added earlier. | LOW | HIGH | 1 agent |
| **AGG7R-08** | DS7-10 | CLAUDE.md says "100 files max (configurable via `UPLOAD_MAX_TOTAL_BYTES`)". The 100-file cap is actually `UPLOAD_MAX_FILES_PER_WINDOW`, not `UPLOAD_MAX_TOTAL_BYTES`. Variable name mismatch. | LOW | HIGH | 1 agent |
| **AGG7R-09** | T7-01 | No unit test for `requireSameOriginAdmin` in isolation. Tested only transitively via e2e. | LOW | HIGH | 1 agent |
| **AGG7R-10** | T7-05 | No unit test asserts `cleanOrphanedTmpFiles` logs AFTER unlink (the cycle-6-rpl invariant). | LOW | HIGH | 1 agent |
| **AGG7R-11** | T7-06 | `check-action-origin.test.ts` does not assert that `discoverActionFiles` recursion walks subdirectories (fixture test). | LOW | HIGH | 1 agent |
| **AGG7R-12** | P7-01 | `escapeCsvField` runs two sequential regex passes per field. At 50k × 8 cols = 800k invocations. Merging to a single pass with replacer function halves per-field CPU. Micro-optimization. | LOW | MEDIUM | 1 agent |
| **AGG7R-13** | P7-02 | `cleanOrphanedTmpFiles` scans dirs sequentially (for loop + await). Could parallelize via `Promise.all` over dirs. ~10-30ms savings at bootstrap. | LOW | HIGH | 1 agent |
| **AGG7R-14** | P7-04 | `FLUSH_CHUNK_SIZE = 20` is double the connection-pool size (10). Chunk size should track pool to avoid queuing overhead. | LOW | HIGH | 1 agent |
| **AGG7R-15** | P7-10 | `purgeOldBuckets` unbatched DELETE could hold a long table lock on a multi-year deployment with millions of expired rows. Add `LIMIT 10000` per pass. | LOW | MEDIUM | 1 agent |
| **AGG7R-16** | DE7-01 | No verification that admin CSV export UI surfaces the `warning: csvTruncated` value when row count hits 50k. | LOW | MEDIUM | 1 agent |
| **AGG7R-17** | DE7-05 | `searchImagesAction` returns `[]` on rate-limit — indistinguishable from "no matches". Users can't tell they're throttled. | LOW | HIGH | 1 agent |
| **AGG7R-18** | D7-07 | `bootstrapImageProcessingQueue` fires `purgeExpiredSessions()` without `.catch()` (siblings have it). Cosmetic inconsistency. | LOW | HIGH | 1 agent |
| **AGG7R-19** | S7-10 | `updatePassword` doesn't rotate the current session cookie after password change. A previously-leaked session cookie remains valid for its own session until expiry. Tradeoff: keeps admin logged in. | LOW | HIGH | 1 agent |
| **AGG7R-20** | CR7-05 | `cleanOrphanedTmpFiles` logs at `console.info` for successful non-zero removals; other queue module logs use `console.debug` for routine success. Inconsistent log level. | LOW | MEDIUM | 1 agent |
| **AGG7R-21** | CR7-12 | `settleUploadTrackerClaim` called in two branches of `uploadImages`. Could unify via `finally`. | LOW | HIGH | 1 agent |

## Carry-forward (unchanged — existing deferred backlog)

From cycle 6-rpl and earlier cycles:
- All cycle-6-rpl deferred items in `plan/plan-220-cycle6-rpl-deferred.md`
  (AGG6R-05, 07, 12-21) remain deferred with original severity/confidence.
- Cycle-5-rpl deferred items in `plan/plan-218-cycle5-rpl-deferred.md`.
- Older backlog: D1-01/D2-08/D6-09 CSP, D2-01/D1-03 admin mobile nav,
  D2-02 uploadImages dead `replaced: []`, D2-03/D6-05 CSV streaming,
  D2-04 duplicate rate-limit Maps, D2-05/PERF-02 search sequential,
  D2-06/PERF-03 bootstrap unpaginated SELECT, D2-07 session clock-drift,
  D2-09 updatePassword concurrent test, D2-10 settings-client coupling,
  D2-11 data.ts mutable view buffering, D6-01 cursor pagination,
  D6-02 scoped topic/tag nav, D6-03 visual regression, D6-04 public
  photo ISR/auth boundary, D6-06 sitemap partitioning, D6-10 durable
  view counts, D6-11 tag metadata, D6-12 split mutable buffering,
  D6-13 single-process runtime, D6-14 test surface, OC1-01/D6-08
  historical secrets (acknowledged), font subsetting, Docker
  node_modules, PERF-UX-01/02 blur placeholder/variable font,
  AGG3R-06 footer contrast.

## Severity distribution

- MEDIUM: 2 (AGG7R-01 CSV leading-CRLF bypass, AGG7R-02 restore
  advisory-lock leak)
- LOW: 19

## Recommended cycle-7 implementation priorities

1. **AGG7R-01** — swap CSV formula-check order (security, 2 agents).
2. **AGG7R-02** — fix restore advisory-lock leak on early-return path
   (correctness, latent deadlock).
3. **AGG7R-03** — symmetric rollback on generic-error return paths in
   `sharing.ts`.
4. **AGG7R-04** — check `bytesRead` in `fd.read`/`scanFd.read`.
5. **AGG7R-07/08/10** — doc fixes (CLAUDE.md account-scope, file-count
   var name).
6. **AGG7R-09/10/11** — unit test additions.
7. **AGG7R-13** — parallelize `cleanOrphanedTmpFiles` dirs.

Items 1-2 are the highest-priority for this cycle. The rest are
polish/hardening.

## Cross-agent agreement highlights

- AGG7R-01 (CSV leading-CRLF formula bypass): 2 agents (tracer +
  debugger).
- AGG7R-04 (bytesRead check): 3 agents (code-reviewer + security +
  verifier carry-forward).
- AGG7R-06 (TRUST_PROXY hardening docs): 2 agents (security + docs).

## AGENT FAILURES

None — all 10+1 reviewer roles returned.
