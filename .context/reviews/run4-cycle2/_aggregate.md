# Aggregate review — Run-4 Cycle 2

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md` (code-reviewer + debugger + tracer)
- `security-reviewer.md` (security + critic + verifier)
- `test-engineer.md` (test-engineer + verifier on gates)
- `perf-architect-docs-designer.md` (perf-reviewer + architect + document-specialist + designer)

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested Agent/Task
spawning is unavailable in this context (same documented constraint as run2/run3/run4-c1 —
see `run4-cycle1/_aggregate.md`). Each angle was executed as a distinct full-inventory
pass in-context; no angle sampled. Inventory: 14 action files, 10 API routes, lib/ (83
files — deep reads on queue/tokens/limits/data/analytics surfaces, spot re-audit on
fixture-locked color surfaces), 54 components (deep reads on tokens/dashboard/viewer
nav), schema, proxy, instrumentation, 25 scripts (deep: migrate.js diff,
check-action-origin, build-sw), e2e helpers + 6 specs, docs (CLAUDE.md/AGENTS.md),
messages spot-check.

## Context
Run-4 cycle 1 closed the LR-PAT cluster + two live-discovered migrate/viewer HIGHs. This
cycle's pass prioritized (1) regression review of those 9 fresh commits, (2)
failure-path behavior validated against LIVE MySQL 8 strict mode (a first for this loop —
the running `gk-e2e-mysql` container was used to test datetime literal acceptance), (3)
the security gates' own integrity, (4) a clean gate baseline (vitest 1564/1564 PASS,
eslint 1 warning, typecheck PASS, 3 scanners PASS).

## Cross-angle agreement
- **COR-R4C2-01** (dead failed-image persistence) was independently surfaced by the
  debugger angle (live MySQL repro) and the test-engineer angle (missing format
  contract); the designer angle's UX-R4C2-03 sits in the SAME dead panel — three angles,
  one cluster: **highest-signal finding this cycle**.
- **SEC-R4C2-02** (exempt-comment bypasses scanner) was flagged by security and confirmed
  non-breaking-to-harden by the verifier sweep over every exempt body in the repo.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C2-01 | HIGH/High | `image-queue.ts:477` writes ISO-8601 `Z` string into `datetime(mode:'string')` `failed_at`; MySQL strict mode rejects (ER 1292, reproduced live) → `processing_error`+`failed_at` never persist → R10-H2 admin failed-images panel + retry action dead, masked by own catch | debugger, tracer, test-engineer |
| SEC-R4C2-02 | MED/High | `createLrToken` carries `@action-origin-exempt` though MUTATING; scanner honors exemption before mutation analysis so the CSRF gate no longer verifies this action; harden scanner to fail exempt-on-mutating-body (verified non-breaking for all existing exemptions) | security, critic, verifier |
| UX-R4C2-03 | MED/Medium | Failed-images panel `<img>` requests `_64.jpg` derivative that failed images typically lack (no onError fallback); also the repo's only eslint `no-img-element` warning — replace with deterministic ImageOff icon tile | designer, test-engineer (gate) |
| COR-R4C2-04 | LOW-MED/High | `admin-tokens.ts:204` label `.trim().slice(0,128)` silent truncation + surrogate bisection on credential-management surface — diverges from countCodePoints policy (C7-AGG7R-02 lineage) | code-reviewer, security |
| SEC/COR-R4C2-05 | LOW/High | Stripe webhook `[manual-distribution]` log prints `customerEmail` (empty when missing) instead of `resolvedEmail` sentinel — operator loses reconciliation pointer in exactly the sentinel's case | security |
| ARCH-R4C2-06 | LOW/High | `MAX_FILE_SIZE` (process-image.ts:332, enforcement) duplicates `MAX_UPLOAD_FILE_BYTES` (upload-limits.ts:3, UI hint + body-cap derivation) — single-source-of-truth violation, drift would desync advertised vs enforced limit | architect, document-specialist |
| COR-R4C2-07 | LOW/Medium | `recordTopicView` lacks `isValidSlug` pre-check (sibling `loadMoreImages` has it); FK backstops integrity today but every junk call costs a doomed INSERT and the asymmetry is a refactor trap | code-reviewer |
| COR-R4C2-08 | LOW/Medium | Checkout `titleForStripe` UTF-16 `.slice(0,199)` can bisect a surrogate pair → U+FFFD on the customer's Stripe receipt | code-reviewer |
| TEST-R4C2-09 | HIGH-gap/High | No value-format contract on failure-path persistence (enabled COR-R4C2-01 to survive ~18 cycles) — add format assertion + helper unit test with the fix | test-engineer |
| TEST-R4C2-10 | MED-gap/High | Scanner fixture suite lacks exempt-on-mutating-body cases — add with SEC-R4C2-02 hardening | test-engineer |
| DES-OBS-R4C2-11 | LOW/Low | Tokens UI always grants all 3 scopes (no least-privilege choice) — product decision, deferred with exit criterion | designer |

All HIGH/MED items are scheduled in this cycle's plan; DES-OBS-R4C2-11 is the sole
deferral (explicit ledger entry with exit criterion).

## Gate baseline (clean tree)
- vitest: PASS 160/160 files, 1564/1564 tests
- eslint: PASS, 1 warning (no-img-element — removed at root by UX-R4C2-03 fix, no suppression)
- typecheck: PASS · lint:api-auth: PASS · lint:action-origin: PASS ·
  lint:public-route-rate-limit: PASS
- build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset/tone-authoring features. Nothing dropped.

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context (documented constraint,
same as run2/run3/run4-c1); all angles executed in-context with full inventory and
per-angle provenance files above.
