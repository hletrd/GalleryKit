# Run-20 Cycle-20 — Aggregated Review

**Date:** 2026-06-27
**HEAD:** 9af705f4 (cycle-19 fixes + SW stamp landed)
**Agents:** 11/11 completed (code-reviewer, security-reviewer [opus], perf-reviewer [via general-purpose], critic [opus], verifier, test-engineer, tracer, architect [opus], debugger, document-specialist, designer)
**Agent Failures:** 0
**Baseline gates (verifier-confirmed at HEAD):** eslint exit 0, tsc exit 0, vitest **2155 pass / 4 skip** (236 files), lint:api-auth / lint:action-origin / lint:public-route-rate-limit all exit 0. `npm audit --omit=dev` 0 vulns.

---

## Convergence summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 0 | No exploitable vulnerabilities. Security-reviewer: 0 confirmed-exploitable NEW. |
| HIGH | 0 | None runtime. |
| MEDIUM | ~6 | **Env-parse scientific-notation bug class (2-agent, CQ20-01/02 + debugger F1/F2)** — `parseInt(env,10)` mis-parses `'1e3'`/`'256e6'`; cycle-19 fixed ONLY `view-retention`, 6-7 siblings remain. Two MEDIUM instances: `audit.ts` AUDIT_LOG_RETENTION_DAYS (audit log purged to 1-day) + `process-image.ts` IMAGE_MAX_INPUT_PIXELS (ALL uploads fail). Plus: A3 upload single-settle (critic reclassifies → now-actionable; architect says still-deferrable — split decision); designer focus-visible siblings D20-01/02/03 (3 fresh, MAJOR-2 exit criterion now MET); architect N2 data.ts boundary degrading; test FINDING-1 OG-budget deadline behaviorally untested; doc GAP-1 og-photo-fetch budget undocumented. |
| LOW (actionable) | ~16 | CQ20-03/04/05/08 + debugger F4 (more env-parse siblings); CQ20-06/critic/tracer (gps-strip walkAborted not honored on items-found path — privacy consistency); CQ20-07/critic (bounded-map `.data` live-ref accessor); debugger F3 (audit.ts unbounded DELETE, no chunk LIMIT); PERF-C20-01 (OG per-attempt timeout == total budget); A2 stale "in lib/data.ts" comments in both search routes; designer D20-04/05; doc GAP-2/3/4/5; architect N1 (PrivacySensitiveKeys hand-union — EVALUATE, see note); test FINDING-2 tryFetchPhotoBuffer NaN path. |
| STRUCTURAL/DEFER | ~8 | MAJOR-2 general focus-visible scanner (exit criterion now MET — schedule/evaluate); A1 topics.slug cascade (exit UNMET); A3 full try/finally restructure if not landed; A4 restore-maintenance scale-out fence (exit UNMET); A5 storage dead-module (fencing STRENGTHENED by storage-quarantine test); A6 view-buffer extraction; PERF-C20-02/03 + PERF-C19-01..05 scale-gated; test FINDING-2/3/4. |
| DOC | 5 gaps | document-specialist: 25 MATCH, 0 hard MISMATCH, 5 GAPS (all additive — missing Key-Files rows + 2 minor column-desc inconsistencies). |
| FALSE-POSITIVE / BENIGN | 2 | SEC-20-INFO gps walkAborted partial path (security-reviewer: verified non-exploitable — found item's GPS IS neutralized; real HEIF carries one Exif item). deleteOriginalUploadFile never-throws (tracer: comment-only contract, no live leak). |

**Verdict:** Mature, well-hardened. Zero new live CRIT/HIGH. The headline signal: (1) the env-parse `parseInt`→`Number` bug class is the cycle-19 "fix one sibling, miss the next" pattern playing out in env parsing — 2-agent agreement, cheap, two real MEDIUM correctness instances; (2) a fresh focus-visible sibling cluster (designer D20-01/03/04) that formally trips the MAJOR-2 scanner exit criterion; (3) the gps-strip `walkAborted` doctrine inconsistency (3-agent: code-reviewer CQ20-06 + critic + tracer) — cheap privacy-consistency fix; (4) the recurring structural roots (A3 single-settle now split-decision; N1/N2 derive-don't-fan-out).

---

## Cross-agent agreement (higher signal)

- **Env-parse scientific-notation bug class** — **2 agents** (code-reviewer CQ20-01..05/08, debugger F1/F2/F4). `Number.parseInt(env,10)` truncates `'1e3'`→1, `'256e6'`→256. Sites: `audit.ts:111` (AUDIT_LOG_RETENTION_DAYS, MED — 1-day audit purge), `process-image.ts:330/339` (IMAGE_MAX_INPUT_PIXELS[_TOPIC], MED/LOW — all uploads fail), `process-image.ts:45` (SHARP_CONCURRENCY), `actions/images.ts:796` (IMAGE_CLEANUP_CONCURRENCY), `rate-limit.ts:144` (TRUSTED_PROXY_HOPS), `upload-limits.ts:11` (parsePositiveIntEnv helper → UPLOAD_MAX_TOTAL_BYTES + UPLOAD_MAX_FILES_PER_WINDOW). Fix: `Number(env)` — the existing `Number.isFinite(x) && x > 0` guards already reject NaN/Infinity. Unanimous root: cycle-19's view-retention fix should have swept all siblings.
- **gps-exif-strip `walkAborted` doctrine inconsistency** — **3 agents** (code-reviewer CQ20-06, critic, tracer F3-gap). The cycle-19 F2 flag is checked ONLY on the zero-items branch (`gps-exif-strip.ts:461-467`); a partial-walk abort AFTER ≥1 Exif item is found bypasses the re-encode fallback. All three agree very-low-probability (single-Exif-item is standard HEIF) and security-reviewer confirms the *found* item's GPS IS neutralized — so non-exploitable — but it violates the module's own "null on ANY anomaly" doctrine. Cheap one-liner privacy-consistency fix.
- **A3 upload single-settle — SPLIT DECISION** — critic reclassifies MAJOR-1 now-actionable (the `finally` already exists; deletes 2 comment-only invariants; 3 cycles of symptomatic patching); architect says still-deferrable (exit criterion "new await between claim and settle" is UNMET). Treat as EVALUATE-then-implement-if-clean.
- **bounded-map `.data` live-ref** — code-reviewer CQ20-07 + critic latent-trap. After CQ19-02 made `get()`/`entries()` copy, `.data` is the lone live-ref path; a future upload-tracker→BoundedMap migration would silently break in-place window mutation. No live caller. Fix: copy-on-read or a load-bearing doc warning.
- **OG budget == per-attempt timeout** — perf-reviewer PERF-C20-01 + critic + test-engineer FINDING-1. One hung connection burns the whole 10s budget (no fallback attempts fit). Lower OG_PHOTO_FETCH_TIMEOUT_MS to ~3-4s + add a fake-timers test for the deadline (currently behaviorally untested).
- **MAJOR-2 focus-visible scanner exit criterion MET** — designer found ≥3 fresh `<Link>`/`<a>` siblings (D20-01/03/04) lacking focus-visible. The recorded re-open trigger ("≥3 fresh siblings in one cycle") is now satisfied.

---

## Lead triage (implement vs defer this cycle)

### IMPLEMENT (high-value, low-risk, actionable now)
1. **Env-parse sweep (CQ20-01..05/08 + debugger F1/F2/F4, 2-agent)** — switch every `Number.parseInt(env,10)` integer env site to `Number(env)` (keep existing finite/positive guards). Fix the shared `parsePositiveIntEnv` helper in `upload-limits.ts`. Add a focused test. **Two MEDIUM correctness/data-retention instances — not deferrable.**
2. **gps-strip walkAborted on items-found path (CQ20-06/critic/tracer, privacy)** — honor `walkAborted` even when ≥1 item was found (return null → re-encode). Add a test. Cheap privacy consistency.
3. **Designer focus-visible siblings D20-01/02/03/04** — add `outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the unfixed `<Link>`/`<a>` siblings (nav-client topic pills, admin-nav, timeline year scrubber, g/[key] back-link); fix lightbox-color-pip inner buttons `ring-white`→`ring-ring ring-offset`. Extend the focus-visible frozen-pin test.
4. **A2 stale comments (critic)** — both search routes' comments still say "in lib/data.ts"; correct to point at `lib/search-enrichment-fields.ts`.
5. **OG cold-path bound + test (PERF-C20-01 + FINDING-1)** — lower per-attempt timeout to ~3-4s; export OG_PHOTO_TOTAL_BUDGET_MS + fake-timers deadline test.
6. **bounded-map `.data` (CQ20-07/critic)** — copy-on-read or a clear doc warning to prevent the future migration footgun.
7. **Doc gaps GAP-1..5 (document-specialist)** — add Key-Files rows for og-photo-fetch.ts / color-label.ts / search-enrichment-fields.ts; fix `has_gain_map` (add `infe`) + add `was_downscaled` to the column table.

### EVALUATE-THEN-IMPLEMENT-OR-DEFER
- **A3 single-settle (critic MAJOR-1 vs architect defer)** — attempt the idempotent settle-in-`finally` (guard a `claimSettled` boolean) with the upload test suite as the safety net; land only if the diff is clean and all upload tests pass, else defer.
- **debugger F3 audit.ts unbounded DELETE** — mirror the view-retention chunked-DELETE (LIMIT + max-batches) for lock-duration consistency; implement if clean, else defer.
- **MAJOR-2 focus-visible scanner** — exit criterion MET. Either build a conservative narrow scanner (Link/a/button in public route group + nav lacking focus-visible, KNOWN_VIOLATIONS-seeded like touch-target-audit) OR extend per-control pins this cycle and commit the scanner to next cycle (CLAUDE.md warns the touch-target scanner took many cycles to stabilize — regex churn risk).
- **N1 PrivacySensitiveKeys derived union (architect, LOW-MED)** — CAUTION: naively replacing the hand-typed union with `Exclude<keyof admin, keyof public>` would make the `_SensitiveKeysInPublic` compile guard tautological (loses the independent second-opinion). Prefer an ADDITIVE bidirectional type assertion (hand-list MUST equal admin-minus-public diff) so drift is caught both ways — or defer. Do NOT do the naive replace.

### DEFER (structural / scale-gated — see cycle-20-deferred.md)
- A1 topics.slug cascade (exit UNMET); A4 restore-maintenance scale-out fence (exit UNMET); A5 storage dead-module (fencing STRENGTHENED); A6 view-buffer extraction; N2 data.ts extract `lib/image-select-fields.ts` (bundle with A6); PERF-C20-02/03 + PERF-C19-01..05 scale-gated/micro; test FINDING-2/3/4; designer D20-05 reduced-motion belt-and-braces (global catch-all covers).

## AGENT FAILURES
None. All 11 agents completed; each per-agent file is fresh (cycle-20). The cycle-19 per-agent files were archived to `.context/reviews/archive/cycle-19/` for provenance before this run overwrote them.
