# Cycle 73 Test Engineer / Verifier Review

HEAD reviewed: `96459b7a`. Scope: gate wiring, recent regression tests, custom lint scripts, restore/sidecar/OG/settings coverage, and deferred coverage gaps.

## Findings

### C73-03 - Sidecar derivative write-boundary guard is source-locked, not behavior-proven

- Severity/confidence: Medium / Medium.
- File/line: `apps/web/src/lib/process-image.ts:1187`, `apps/web/src/lib/process-image.ts:1417`, `apps/web/src/lib/process-image.ts:1472`, `apps/web/src/__tests__/cycle-72-source-contracts.test.ts:17`.
- Problem: the Cycle 72 sidecar write-boundary contract is protected by source-order checks, not a behavior test that proves rollback/restoration when a guard throws after final writes begin.
- Failure scenario: a refactor leaves a source string in place while removing a critical pre-rename/fallback guard or rollback path, letting sidecars rewrite derivatives during restore maintenance.
- Plan: deferred this cycle; needs a focused Sharp/filesystem behavior test.

### C73-04 - Per-photo OG temporary fallback cache header is not route-behavior tested

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/api/og/photo/[id]/route.tsx:127`, `apps/web/src/app/api/og/photo/[id]/route.tsx:283`, `apps/web/src/__tests__/og-photo-fallback.test.ts:88`.
- Problem: Cycle 72 added `no-store` for all-derivative-miss redirects, but only source-grep coverage proved the behavior.
- Failure scenario: future route changes preserve the string but pass the success cache policy to `buildFallbackResponse()`.
- Plan: scheduled.

### C73-05 - Settings backfill warning persistence is only source-wired at the component boundary

- Severity/confidence: Low / High.
- File/line: `apps/web/src/lib/settings-backfill-warning.ts:40`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:254`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:10`.
- Problem: pure transition tests exist, but the live Settings UI integration is covered by source-grep rather than component/e2e behavior.
- Failure scenario: the component can call the transition with the wrong baseline or render the wrong predicate while pure tests still pass.
- Plan: deferred this cycle; needs a scoped admin UI/component smoke.

## Evidence

- Targeted reviewer run passed restore-maintenance, OG fallback, settings-warning, and SW template tests.
- Full required gates remain pending for Prompt 3.
