# Aggregate Review — Cycle 1/100 (review-plan-fix loop, 2026-05-02)

## Review method

Comprehensive review of the GalleryKit repository by a single coordinating
reviewer (no project-local `.claude/agents/` directory exists, so the
multi-agent fan-out fell back to a single multi-perspective review pass
covering: code-reviewer, perf-reviewer, security-reviewer, critic,
verifier, test-engineer, tracer, architect, debugger, document-specialist,
and designer angles).

Files inspected for fresh findings this cycle (the historical hot-spots and
all newly-touched modules):

- `apps/web/src/lib/blur-data-url.ts` — blur data URL contract enforcement
- `apps/web/src/lib/csv-escape.ts` — CSV formula-injection / Trojan-Source guard
- `apps/web/src/lib/validation.ts` — `UNICODE_FORMAT_CHARS`, slug/alias/tag validators, `safeInsertId`
- `apps/web/src/lib/sanitize.ts` — `stripControlChars`, `sanitizeAdminString`, `sanitizeStderr`
- `apps/web/src/lib/safe-json-ld.ts` — JSON-LD script-tag escaping
- `apps/web/src/lib/auth-rate-limit.ts` — IP + account-scoped login rate limiting
- `apps/web/src/lib/session.ts` — HMAC-SHA256 session tokens, `getSessionSecret` policy
- `apps/web/src/lib/process-image.ts` — Sharp pipeline, ICC parsing, blur producer
- `apps/web/src/lib/action-guards.ts` — `requireSameOriginAdmin`
- `apps/web/src/lib/request-origin.ts` — `hasTrustedSameOrigin`, proxy-header normalization
- `apps/web/src/lib/rate-limit.ts` — three rollback patterns, OG/share/search/login buckets
- `apps/web/src/app/actions/sharing.ts` — share-key creation/revocation flow

Cross-referenced findings against:
- `.context/reviews/_aggregate-c4-rpl.md` (most recent prior aggregate)
- 130+ historical aggregates documenting cycle-by-cycle convergence
- `CLAUDE.md` security architecture / deferred-fix policy

## Convergence assessment

This is the **sixth consecutive cycle** producing 0 genuinely new findings.
The recent finding-count trajectory (per the prior aggregate's tail):

24→12→6→4→3→7→10→7→4→5→9→6→7→14→5→9→5→5→2→4→3→2→0→0→0→0→0→**0**

All HIGH and MED severity categories are exhausted. Every code path inspected
this cycle was already covered by an existing rule, lineage comment, or
fixture-locked test. The codebase has reached steady-state convergence at the
current threat model and scale.

Specifically re-verified:

- **Blur producer/consumer symmetry** (cycle 4 RPF AGG4-L01): `process-image.ts`
  wraps the producer-side literal through `assertBlurDataUrl`; the consumer
  in `actions/images.ts` and reader in `photo-viewer.tsx` consult the same
  validator. Locked by fixture tests.
- **Unicode formatting policy lineage** (C7R-RPL-11 → C8R-RPL-01 → C3L-SEC-01
  → C4L-SEC-01 → C5L-SEC-01 → C6L-SEC-01): every admin-controlled string
  surface rejects bidi overrides + zero-width / invisible chars. Single
  canonical regex at `validation.ts:57`. CSV path uses the `/g` variant
  derived from the same source.
- **CSV defenses** (C7R-RPL-01 / C8R-RPL-05 / AGG7R-05 / AGG8R-01): C0/C1
  controls, Unicode formatting chars, CRLF collapse, formula-prefix guard
  with leading-whitespace tolerance. Tab is pre-stripped, justifying its
  removal from the formula char class.
- **Rate-limit rollback patterns** (`rate-limit.ts` docstring): three
  documented patterns (no-rollback for security-critical writes, rollback
  for public reads, rollback-on-no-execute for admin writes). Sharing
  actions follow pattern 3, with both in-memory + DB symmetric rollback
  via `rollbackShareRateLimitFull`.
- **Same-origin guard** (`hasTrustedSameOrigin`): fail-closed default,
  default-port stripping for proxy-host normalization, opt-in legacy
  `allowMissingSource`. `requireSameOriginAdmin` centralizes the policy.
- **Session secret policy**: production refuses DB fallback (forgery on
  DB compromise mitigation); dev-only path uses INSERT IGNORE + re-fetch
  for multi-process safety.
- **Image processing race protections**: per-image MySQL advisory lock
  + conditional UPDATE + orphan cleanup; documented advisory-lock-scope
  caveat (C8R-RPL-06) for multi-tenant MySQL.
- **`safeInsertId` (C20-MED-01)**: applied at every insertId consumer
  (sharing.ts, admin-users.ts, images.ts).

## Findings (summary)

| ID | Description | Severity | Confidence | Disposition |
|----|-------------|----------|------------|-------------|
| (none) | No new actionable findings this cycle | — | — | — |

## Deferred items

No new deferrals. All historical deferred items are catalogued under
`.context/plans/388-deferred-cycle2-rpl.md` and `.context/plans/387-deferred-cycle25.md`
plus the per-cycle deferred lists. Re-opening criteria are recorded in
each deferred file and remain valid.

## Gate results (this cycle, baseline)

- `npm run lint --workspace=apps/web` — PASS
- `npm run lint:api-auth --workspace=apps/web` — PASS
- `npm run lint:action-origin --workspace=apps/web` — PASS
- `npm test --workspace=apps/web` — PASS (84 files, 586 tests)
- `npm run build --workspace=apps/web` — running
- `npm run test:e2e --workspace=apps/web` — running

## Agent failures

None. (Single-agent review pass; no fan-out failures to record.)
