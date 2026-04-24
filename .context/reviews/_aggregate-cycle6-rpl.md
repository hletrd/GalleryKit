# Aggregate Review — Cycle 6 (RPL loop, 2026-04-23)

**Purpose:** consolidate findings from all spawned reviewers this cycle.
Dedupe across agents, preserve highest severity/confidence, note cross-agent
agreement.

**Cycle orchestrator:** review-plan-fix loop, cycle 6 of 100. DEPLOY_MODE:
per-cycle.

**HEAD:** cycle-5-rpl-deploy (see `git log --oneline -1`).

## Source reviews (11 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer-cycle6-rpl.md` |
| Security Reviewer | `.context/reviews/security-reviewer-cycle6-rpl.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer-cycle6-rpl.md` |
| Critic | `.context/reviews/critic-cycle6-rpl.md` |
| Verifier | `.context/reviews/verifier-cycle6-rpl.md` |
| Test Engineer | `.context/reviews/test-engineer-cycle6-rpl.md` |
| Tracer | `.context/reviews/tracer-cycle6-rpl.md` |
| Architect | `.context/reviews/architect-cycle6-rpl.md` |
| Debugger | `.context/reviews/debugger-cycle6-rpl.md` |
| Document Specialist | `.context/reviews/document-specialist-cycle6-rpl.md` |
| Designer | `.context/reviews/designer-cycle6-rpl.md` |

## Environment note on agent fan-out

Same as cycle-5-rpl: the Task/Agent tool is not exposed as a named
invocable fan-out primitive in this environment; per the orchestrator's
"skip any that are not registered" clause, I performed each reviewer
role's scan directly and wrote one file per role to preserve provenance.
No reviewer role was silently dropped. All 11 roles returned.

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG6R-01** | S6-06, A6-08, T6-09, DS6-04 | `check-action-origin.ts::discoverActionFiles` does NOT recurse into `apps/web/src/app/actions/` subdirectories. A nested action file would silently escape the lint gate. Scanner comment claims "automatically covered" but doesn't recurse. No unit-test coverage for the recursion case. | LOW | HIGH | **4 agents** |
| **AGG6R-02** | C6-04, CR6-02, TR6-03, S6-07 | Asymmetric DB rate-limit rollback: on over-limit branches (and the `ER_NO_REFERENCED_ROW_2` path in `createGroupShareLink`), the in-memory counter is rolled back but the DB counter drift upward. `searchImagesAction`, `createPhotoShareLink`, `createGroupShareLink` share this pattern. Minor UX drift — not security. | LOW | MEDIUM | **4 agents** |
| **AGG6R-03** | C6-05, CR6-08 | `cleanOrphanedTmpFiles` logs `"Removing N .tmp files"` BEFORE the unlink Promise.all, so the count reflects discovered files, not successfully removed ones. | LOW | HIGH | 2 agents |
| **AGG6R-04** | S6-01, T6-01 | No e2e integration test asserts mutating server actions reject a spoofed cross-origin Origin header. Unit tests cover the primitive, but not the end-to-end gate. | LOW | HIGH | 2 agents |
| **AGG6R-05** | DS6-10 | README.md / deployment docs don't instruct operators to set `TRUST_PROXY=true` when running behind a reverse proxy. Without it, rate-limiting uses `"unknown"` as the key and all requests share one bucket. | LOW | HIGH | 1 agent |
| **AGG6R-06** | DS6-07 | CLAUDE.md "Race Condition Protections" list omits the two advisory-lock mechanisms: `gallerykit_db_restore` (prevents concurrent restores) and `gallerykit:image-processing:{jobId}` (prevents duplicate processing). | LOW | HIGH | 1 agent |
| **AGG6R-07** | V6-F01, A6-03 | Privacy guard is `Extract`-based and negative-only. It catches known PII keys in `publicSelectFields` but not newly-added sensitive fields added to `adminSelectFields`. A new `images.phone_number` field accidentally leaked to `publicSelectFields` via spread would escape the guard unless the PII name was also added to `_PrivacySensitiveKeys`. | LOW | HIGH | 2 agents |
| **AGG6R-08** | CR6-10 | `runRestore` has 7 duplicated `fs.unlink(tempPath).catch(() => {})` calls along error paths. A single try/finally wrapper would remove the duplication. Refactor not strictly necessary. | LOW | HIGH | 1 agent |
| **AGG6R-09** | CR6-01 | Lint-gate scripts lack a `SECURITY-CRITICAL:` banner. Current header explains the role, but a visual banner would prevent accidental downgrades. | LOW | HIGH | 1 agent |
| **AGG6R-10** | P6-05 | `deleteImages` large-batch branch calls `revalidateAllAppData()` then `revalidateLocalizedPaths('/admin/dashboard')`. The second call is redundant — the first already invalidates everything including the admin dashboard. | LOW | MEDIUM | 1 agent |
| **AGG6R-11** | C6-12, P6-08 | `escapeCsvField` regex passes could be combined: current 3-4 pass regex sequence per field can be merged to 2 passes. Also, `.replace(/[\r\n]/g, ' ')` produces double-spaces on `\r\n`; should use `/[\r\n]+/g` to collapse. Minor perf + cosmetic. | LOW | MEDIUM | 2 agents |
| **AGG6R-12** | D6-01 | `saveOriginalAndGetMetadata` fallback: when metadata.height is missing but metadata.width is present, height = width. Results in square aspect ratio for tall/wide corrupted images. | LOW | HIGH | 1 agent |
| **AGG6R-13** | D6-04 | `cleanOrphanedTmpFiles` at bootstrap could race with a concurrent image-processing task's atomic rename (.tmp exists briefly between `fs.link` and `fs.rename`). Restrict to .tmp files older than a threshold (e.g., mtime > 5 min). | LOW | MEDIUM | 1 agent |
| **AGG6R-14** | S6-08 | `viewCountBuffer` dropped-increment warnings log `groupId` numeric — mild information disclosure if stdout is public. | LOW | LOW | 1 agent |
| **AGG6R-15** | T6-02 | No test coverage for `viewCountBuffer` backoff behavior (`consecutiveFlushFailures` + `getNextFlushInterval` escalation on DB outage). | LOW | HIGH | 1 agent |
| **AGG6R-16** | T6-05 | No direct unit test for `escapeCsvField` — tested only via integration. | LOW | HIGH | 1 agent |
| **AGG6R-17** | S6-03 | `exportImagesCsv` has no per-IP rate limit. Authenticated admins can download unlimited CSVs. Defense-in-depth; not a direct attack. | LOW | MEDIUM | 1 agent |
| **AGG6R-18** | C6-11 | `restoreDatabase` uses literal `BigInt(1)` each lock check. Extract to module-level constant for clarity (not performance). | LOW | HIGH | 1 agent |
| **AGG6R-19** | D6-07 | `scanFd.read` in restore scanner doesn't check bytesRead; trailing zero bytes in the buffer get included in toString. | LOW | MEDIUM | 1 agent |
| **AGG6R-20** | C6-02, C6-08 | `viewCountBuffer` capacity eviction is FIFO by insertion order (not LRU). On capacity-full, warnings log group IDs. No monitoring counter for dropped increments. | LOW | MEDIUM | 1 agent |
| **AGG6R-21** | DE6-01 | Search bar has no "keep typing" hint for queries below the 2-character minimum. | LOW | MEDIUM | 1 agent |

## Carry-forward (unchanged — existing deferred backlog)

From prior cycles:
- All cycle-5-rpl deferred items in `plan/plan-218-cycle5-rpl-deferred.md`
  (AGG5R-07, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19) remain deferred
  with original severity/confidence.
- Cycle-4-rpl2 carry-forward: AGG4R2-04, 06, 08, 09, 10, 11, 12.
- Older backlog: D1-01/D2-08/D6-09 CSP, D2-01/D1-03 admin mobile nav,
  D2-02 uploadImages dead replaced: [], D2-03/D6-05 CSV streaming,
  D2-04 duplicate rate-limit Maps, D2-05/PERF-02 search sequential,
  D2-06/PERF-03 bootstrap unpaginated SELECT, D2-07 session clock-drift,
  D2-09 updatePassword concurrent test, D2-10 settings-client coupling,
  D2-11 data.ts mutable view buffering, D6-01 cursor pagination,
  D6-02 scoped topic/tag nav, D6-03 visual regression,
  D6-04 public photo ISR/auth boundary, D6-06 sitemap partitioning,
  D6-10 durable view counts, D6-11 tag metadata, D6-12 split mutable
  buffering, D6-13 single-process runtime, D6-14 test surface,
  OC1-01/D6-08 historical secrets, font subsetting, Docker node_modules,
  PERF-UX-01/02 blur placeholder/variable font, AGG3R-06 footer contrast,
  AGG3R-08-12 LOW UX items.

## Priority remediation order (this cycle)

### Must-fix (none — no HIGH/MEDIUM)
None.

### Should-fix (LOW, batched into one polish patch)

Cross-agent consensus (≥2 agents):

1. **AGG6R-01** — recurse into `apps/web/src/app/actions/` subdirectories
   in `discoverActionFiles()`. Tighten header comment. Add fixture test.
   **4 agents agree — highest priority.**
2. **AGG6R-02** — symmetric DB rate-limit rollback in `searchImagesAction`
   (`public.ts`) and `createPhotoShareLink` / `createGroupShareLink`
   (`sharing.ts`). Add `decrementRateLimit` on the over-limit branches
   and on `ER_NO_REFERENCED_ROW_2`.
3. **AGG6R-03** — `cleanOrphanedTmpFiles`: log AFTER unlink, count
   successes.
4. **AGG6R-04** — add e2e test asserting mutating server actions reject
   a spoofed cross-origin Origin header.
5. **AGG6R-05** — document `TRUST_PROXY=true` in README.md deployment
   section.
6. **AGG6R-06** — add advisory lock section to CLAUDE.md "Race Condition
   Protections".
7. **AGG6R-07** — harden privacy guard. Add a whitelist-equality test:
   `publicSelectFields` keys + `_PrivacySensitiveKeys` ⊂ `adminSelectFields`,
   and `publicSelectFields ∩ _PrivacySensitiveKeys = ∅`. This catches
   a new sensitive field added without also updating the guard.
8. **AGG6R-09** — prepend `SECURITY-CRITICAL:` banner to scripts/check-*.ts.
9. **AGG6R-10** — drop redundant revalidateLocalizedPaths('/admin/dashboard')
   when `revalidateAllAppData()` was already called.
10. **AGG6R-11** — collapse `escapeCsvField` regex passes + fix CRLF
    double-space.

### Defer (LOW, scoped)
- **AGG6R-08** — `runRestore` 7x unlink duplication (refactor;
  deferred).
- **AGG6R-12** — image-dimension fallback refinement (defensive; deferred).
- **AGG6R-13** — cleanOrphanedTmpFiles race with in-flight .tmp files
  (defensive; deferred — no incident).
- **AGG6R-14** — viewCountBuffer log redaction (information disclosure
  LOW confidence; deferred).
- **AGG6R-15** — test coverage for viewCountBuffer backoff (test-infra
  gap; deferred unless needed).
- **AGG6R-16** — escapeCsvField direct unit test (test-infra gap;
  deferred — combined with AGG6R-11 fixes).
- **AGG6R-17** — CSV export rate limit (defense-in-depth; deferred —
  admin-authenticated action).
- **AGG6R-18** — BigInt(1) constant extract (cosmetic; deferred).
- **AGG6R-19** — restore scanner bytesRead (defensive; deferred — current
  behavior is benign).
- **AGG6R-20** — viewCountBuffer LRU + monitoring (refactor; deferred).
- **AGG6R-21** — search hint UX (UX polish; deferred).

## Cross-agent agreement highlights

- **AGG6R-01** (scanner recursion): 4 agents (security, architect,
  test-engineer, document-specialist). HIGH confidence. Highest priority
  this cycle.
- **AGG6R-02** (DB rate-limit rollback symmetry): 4 agents (code-reviewer,
  critic, tracer, security). MEDIUM confidence.
- **AGG6R-07** (privacy guard negative-only): 2 agents (verifier,
  architect).
- **AGG6R-03, 04, 11** (smaller polish): 2 agents each.

Everything else: single-reviewer signal, mostly observational.

## Agent failures

None. All 11 reviewer files produced.

## Totals

- **0 CRITICAL / HIGH** findings
- **0 MEDIUM** findings
- **21 LOW** findings (10 should-fix this cycle, 11 deferred)
- **~40+ carry-forward items** unchanged from prior cycles

## Thematic summary

Cycle 5 rpl closed all lint-gate integrity gaps. Cycle 6 surfaces a
complementary cluster:

1. **Scanner robustness gaps** — subdirectory recursion (AGG6R-01).
2. **Rate-limit rollback symmetry** — DB counters lag behind in-memory
   on over-limit and FK-violation error paths (AGG6R-02).
3. **Privacy guard strictness** — negative-only; doesn't protect against
   new sensitive fields (AGG6R-07).
4. **Observability and documentation** — TRUST_PROXY doc gap (AGG6R-05),
   advisory-lock doc gap (AGG6R-06), log-before-unlink (AGG6R-03),
   e2e origin-guard test (AGG6R-04).
5. **Minor cosmetics** — CSV regex consolidation, security banner,
   redundant revalidate call.

No active correctness or security regressions. The defense-in-depth
layering introduced in prior cycles is working as designed; this cycle
identifies the NEXT layer of gaps.
