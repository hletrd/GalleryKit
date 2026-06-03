# Aggregate Review — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator deep review across all reviewer angles. Task-based
subagent fan-out is unavailable in this nested execution context
(`No such tool available: Task` — same constraint hit in run-2 cycles 1-4).
Every angle was executed directly by the orchestrator with one provenance file
per angle. No angle was silently dropped.

Per-angle provenance files:
- `test-engineer.md`
- `code-reviewer.md`
- `security-reviewer.md`
- `perf-reviewer.md`
- `architect.md`
- `designer.md`
- `critic-verifier-tracer-debugger-document-specialist.md` (critic, verifier,
  tracer, debugger, document-specialist consolidated)

Baseline: 156 test files / 1481 tests (NON-DETERMINISTIC — see F1); lint 0
errors; lint:api-auth OK; lint:action-origin OK. The diff since the last
reviewed HEAD (`420b7852..HEAD`) is docs-only; this cycle applied a fresh,
independent lens to the under-reviewed surfaces flagged in the run context
(serve-upload/ETag, image-queue, share/SEO/feed/sitemap routes, Stripe webhook,
entitlement download, admin-tokens / Lightroom PAT, smart-collections,
auth/rate-limit, i18n parity, backfill runner).

## Headline

**2 net-new actionable findings (CRIT 0 / HIGH 1 / MED 1 / LOW 0).**

| ID | Sev | Conf | Angles agreeing | Title |
|----|-----|------|-----------------|-------|
| F1 | HIGH | High | test-engineer, debugger | Vitest discovers stale `.next/standalone` test copies → non-deterministic `ERR_MODULE_NOT_FOUND` gate failures |
| F2 | MED | High | code-reviewer, security-reviewer, architect, tracer, verifier, document-specialist | Lightroom PAT upload route bypasses the default-off `allow_hdr_ingest` gate the browser path enforces |

### F1 — Flaky test gate via build-artifact test copies (HIGH)

`apps/web/vitest.config.ts` defines `include` but no `exclude`, inheriting
vitest defaults that do NOT cover `.next`. `next build` (`output: 'standalone'`)
emits 156 gitignored copies of the test files under
`apps/web/.next/standalone/apps/web/src/__tests__/`. Depending on vitest's
project-root resolution at invocation, those copies get discovered and fail with
`ERR_MODULE_NOT_FOUND` (the `@/` alias does not resolve in the standalone tree).
Confirmed reproducible: a bare `vitest run src/__tests__/serve-upload.test.ts`
ran the standalone copy (10 tests, all failing); the same with `--root` ran the
real file (5 tests, all passing). The cycle gate runs both `build` and `test`,
so this is a live flakiness hazard. **Fix:** add
`exclude: [...configDefaults.exclude, '**/.next/**', '.next/**']` to
`vitest.config.ts`. Zero downside (`.next` is a gitignored build artifact).

### F2 — Lightroom ingest bypasses `allow_hdr_ingest` (MED)

`app/api/admin/lr/upload/route.ts` fetches `getGalleryConfig()` but never reads
`config.allowHdrIngest`; it unconditionally stores `is_hdr` /
`transfer_function` and enqueues. The browser path (`app/actions/images.ts:295`)
rejects HDR sources when `allowHdrIngest` is false (the default). The R8 plan
explicitly predicted this drift and recommended a shared insert/gate helper that
was never extracted. **Honesty rule held** (HDR fields admin-only; derivatives
encoded SDR) so this is admin-intent drift, not public dishonesty → MEDIUM.
**Fix:** mirror the browser HDR gate in the LR route (reject 422 + delete
original when `isHdr && !config.allowHdrIngest`). Secondary: add a
source-contract test for the LR route (currently zero coverage — test-engineer
F2 sub-item).

## Severity tally
- CRIT: 0 | HIGH: 1 (F1) | MED: 1 (F2) | LOW: 0
- Carryover LOW deferrals (DEF-01..09 from run-2 cycle-2 ledger
  `.context/plans/run2-cycle2/_deferred.md`): re-verified, severity preserved,
  none of their exit criteria fired. No new deferral added (both new findings
  are scheduled for fix this cycle, not deferred).

## Cross-angle agreement
- F1: 2 angles (test-engineer + debugger) — high signal.
- F2: 6 angles (code-reviewer, security, architect, tracer, verifier,
  document-specialist) — high signal; severity unanimously MEDIUM after the
  verifier confirmed the honesty rule is not breached.

## AGENT FAILURES

Task-based subagent fan-out unavailable in this nested execution context (same
as run-2 cycles 1-4); all angles executed directly by the orchestrator and
written to per-angle provenance files. No angle dropped; no retry needed.
