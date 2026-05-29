# Aggregate Review — Run-2 Cycle 1 (HEAD eaee58dc)

Date: 2026-05-30
Method: single-orchestrator deep review across 8 specialist angles (Task subagents unavailable in this nested context → executed all angles directly, one provenance file per angle). Baseline: 154 test files / 1478 tests passing (green). Scope: R27/R28/R29 newly-landed surfaces + cross-file second-order effects, per cycle context.

Per-angle files (provenance, kept as-is):
`code-reviewer.md`, `perf-reviewer.md`, `security-reviewer.md`, `architect.md`, `debugger.md`, `test-engineer.md`, `designer.md`, `document-specialist.md`, `critic-verifier-tracer.md`.

## Headline

Two RELATED, CONFIRMED bugs in the new backfill code, both rooted in **contract drift between the in-app runner (`admin-backfill-runner.ts`) and the operator script (`backfill-color-pipeline.ts`)**. Five reviewers independently converged on them. Everything else is LOW/INFO or verified-clean. The R29-CRIT-1 leak fix is verified complete and correct.

## Merged findings (deduped, highest severity/confidence retained)

### AGG-01 — Backfill `pipeline_version` advanced on detection failure → stale color metadata permanently stranded (MED, High) ⭐ multi-agent
Flagged by: debugger (DBG-01), critic-verifier-tracer (CVT-01), code-reviewer (CR-03), document-specialist (DOC-01), test-engineer (TST-03).
- `admin-backfill-runner.ts:253-263`: when `detectColorSignals` throws after a successful re-encode, the runner still UPDATEs `pipeline_version = IMAGE_PIPELINE_VERSION`. Because candidate selection is `pipeline_version < CURRENT`, that row is NEVER re-picked — its color columns keep pre-backfill values forever.
- The operator script (`backfill-color-pipeline.ts`) does the OPPOSITE: it does NOT bump the version on detection failure, so the row is retried next run. The two paths disagree on the resume invariant the comments promise.
- **Fix:** in the runner, do NOT advance `pipeline_version` when `signals === null` (the encode is idempotent; a later run can recover detection). Add a regression test (TST-03). Correct/clarify the comment (DOC-01).

### AGG-02 — Operator script does not persist `avif_10bit`; runner + upload path do → stale PUBLIC field after sidecar backfill (MED, High) ⭐ multi-agent
Flagged by: architect (ARCH-01), code-reviewer (CR-01), test-engineer (TST-01), document-specialist (DOC-02).
- `backfill-color-pipeline.ts` `ReprocessSignals` (66-75) + `flushBatch` UPDATE (262-283) omit `avif_10bit`; `reprocessRow` discards `result.avif10bit`.
- `admin-backfill-runner.ts:199,250,260` and `image-queue.ts:368` both write it. `avif_10bit` is a **public** field (`data.ts:252-254`) shown in the delivered-bit-depth chip.
- Result: the CLAUDE.md-documented production sidecar backfill leaves a public value stale; the in-app button writes it correctly → divergent DB state for identical input.
- **Fix:** add `avif_10bit` to the script's signals + UPDATE (capture `result.avif10bit`). Add a contract test asserting both backfill paths persist the SAME column set as `image-queue.ts` (TST-01). Add CLAUDE.md note that the button == script once unified (DOC-02).

### AGG-03 — Backfill design hardening (LOW, batch of related items)
- ARCH-02: two ~80%-identical backfill implementations with no shared core; ARCH-01/AGG-01 are the first drifts. Consider extracting one shared single-row reprocess + UPDATE-column-set helper. (Defer-eligible.)
- PERF-01: `fetchCandidates` loads ALL candidate rows into memory (no LIMIT). LOW at personal-gallery scale. (Defer-eligible.)
- PERF-02 / CR-02: runner issues per-row UPDATE vs script's batched transaction → pool pressure during a live-process run. LOW. (Defer-eligible; natural to fix during ARCH-02 unification.)
- DBG-02: non-atomic `processed/errors` counters → log-only artifact under `ADMIN_BACKFILL_CONCURRENCY > 1`. LOW, cosmetic.

### AGG-04 — Backfill UX: no completion/error feedback after "queued" (LOW)
Flagged by: designer (UX-01, UX-02), critic-verifier-tracer (CVT-06).
- `settings-client.tsx` toasts "queued" then re-enables the button while the background encode (minutes/hours) runs with no UI signal. `getBackfillStatus` exposes `running`+`candidateCount` but the client never polls. Correctness is safe (advisory lock + `already_running` guard), only UX clarity suffers. (Defer-eligible; plumbing already exists for a follow-up.)

### AGG-05 — `triggerBackfill` returns raw runner error message to admin client (LOW)
Security (SEC-01). Admin-only surface, all-admins-trusted model → not a privilege leak; only CWE-209 hygiene. **Optional:** return a generic localized error, log detail server-side. (Defer-eligible.)

### AGG-06 — `wide-gamut-hint` localStorage stores a single dismissed gamut; second family overwrites the first (LOW)
Debugger (DBG-04). Mild re-nag on share routes; consistent with the existing sessionStorage single-value behavior. (Defer-eligible.)

### AGG-07 — Test coverage gaps (LOW, enabling)
- TST-01: no test locks the backfill UPDATE column set (root cause AGG-02 went unseen). MED-enabling; bundle with AGG-02 fix.
- TST-02: `getTopSharedGroupsByViews` has zero tests. LOW.
- TST-03: runner detection-failure version-bump untested. Bundle with AGG-01 fix.

## Verified-clean (no action) — recorded so the loop doesn't re-litigate
- R29-CRIT-1 leak fix in `triggerAdminBackfill`/`runBackfill`: complete and correct (lock handoff, `lockConn=null`, fire-and-forget `.catch`, finally release). (debugger, critic-verifier-tracer)
- `forceSrgbDerivatives` share-route wiring: config boolean, no admin-only field leaks to public render. (security, tracer)
- analytics queries: no injection, index-backed, NOT NULL columns, correct Number() coercion. (security, perf, code-reviewer)
- lightbox Escape modal-stack ordering + effect deps: correct. (code-reviewer, debugger, designer)
- icc-chromaticity chad path: bounds-checked, det/sum guards, well-tested. (debugger, test-engineer)
- post-encode NCLX verification expected CICP values: correct (all wide-gamut delivered as Display P3). (critic-verifier-tracer)
- histogram RGB clip math (max-of-channels / red-total): arithmetically correct (equal per-channel totals). (code-reviewer)
- i18n: all new keys balanced across en/ko. (designer)
- touch targets on all new UI: 44px-compliant. (designer)
- CLAUDE.md numeric/name claims (pipeline v7, avif_effort 6, max-source-pixels 50M, all 6 advisory lock names, privacy guard union): all accurate. (document-specialist)

## Severity tally
- MED: 2 confirmed (AGG-01, AGG-02) + 1 MED-enabling test (TST-01, folds into AGG-02)
- LOW: AGG-03 (4 items), AGG-04, AGG-05, AGG-06, AGG-07 (TST-02, TST-03)
- INFO / verified-clean: ~12

Total distinct actionable findings: **2 MED + ~9 LOW**. No CRIT/HIGH. No security/data-loss escalation (AGG-02 is data-consistency, not data-loss; AGG-05 is admin-only).

## AGENT FAILURES
None. (Task-based subagent fan-out was unavailable in this nested execution context; all 8 review angles were executed directly by the orchestrator and written to per-angle provenance files. No angle was dropped.)
