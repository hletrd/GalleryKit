# Consolidated: Critic / Verifier / Tracer / Debugger / Document-Specialist — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator review (Task fan-out unavailable; see
test-engineer.md preamble). Five angles consolidated; no angle dropped.

## Debugger — latent failure surface

### F1 (debugger angle) — confirmed reproducible flaky gate

Reproduced the `serve-upload.test.ts` `ERR_MODULE_NOT_FOUND` failure by running
vitest without explicit `--root` while `.next/standalone/.../src/__tests__/`
exists. Competing hypotheses considered:
1. Real regression in `serve-upload.ts` — REJECTED: file unchanged; explicit
   `--root` run is 5/5 green.
2. Module-resolution / alias breakage in source — REJECTED: same.
3. Stale build-artifact test copy discovered by vitest — CONFIRMED: failing path
   is `apps/web/.next/standalone/apps/web/src/__tests__/serve-upload.test.ts`
   (gitignored, build output) where `@/` does not resolve.
Root cause = missing `.next` exclude in vitest config. See test-engineer.md F1.

## Tracer — causal flow of F2

Traced the HDR signal from `saveOriginalAndGetMetadata` →
`data.colorSignals.isHdr`. Browser path (`images.ts`) branches on
`!uploadConfig.allowHdrIngest` and aborts; LR path
(`lr/upload/route.ts`) has no branch — `isHdr` flows straight into the DB insert
`is_hdr` column and the enqueue `colorSignals`. The `config` object IS fetched
(line 104) so `config.allowHdrIngest` is available but unread. Single missing
guard; no deeper systemic cause. See code-reviewer.md F2.

## Verifier — evidence-based correctness checks

- HDR honesty rule (CLAUDE.md): VERIFIED held even with F2 present —
  `process-image.ts` has no HDR-reject path; it encodes SDR derivatives for all
  sources, and `is_hdr`/`transfer_function`/`matrix_coefficients` are admin-only
  (matched against `_PrivacySensitiveKeys`). So F2 cannot surface a public HDR
  badge. F2 is admin-intent drift, not public dishonesty — severity MEDIUM
  confirmed (not HIGH).
- i18n parity: VERIFIED 812/812 both directions via flatten-diff.
- Single-use download claim: VERIFIED atomic UPDATE-WHERE-NULL ordering and
  file-check-before-claim.
- Stripe idempotency: VERIFIED SELECT-by-sessionId + ON DUPLICATE KEY UPDATE
  belt-and-suspenders.

## Critic — multi-perspective

The codebase is at a high maturity plateau (3 full review runs + 29
photographer passes). The two findings this cycle are both "fresh-eyes on
under-reviewed surfaces" wins flagged in the run context (LR route + test
infra), not regressions. F1 is the higher-value find: a non-deterministic gate
silently erodes trust in the whole test signal and points triage at phantom
files. F2 is a genuine but bounded contract gap. No invented findings; no
cosmetic churn proposed.

## Document-Specialist — doc/code mismatch check

- CLAUDE.md states `allow_hdr_ingest` default-false "rejects PQ/HLG sources at
  upload." This is TRUE for the browser path and FALSE for the Lightroom path
  (F2). Once F2 is fixed in code, the doc becomes accurate on all paths; no doc
  edit needed beyond the fix. If F2 were instead *deferred*, CLAUDE.md would
  need a caveat — but it is being fixed this cycle.
- No other doc/code drift surfaced. The CLAUDE.md migration runbook, advisory-
  lock scope note, and backfill sidecar pattern all match the code.
