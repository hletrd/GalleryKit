# Aggregate Review — Cycle 4 (review-plan-fix loop, 2026-04-25)

Review pass executed by a single subagent (the Task fan-out tool is not callable inside this nested subagent context); per-perspective files written for provenance under `.context/reviews/{security-reviewer,code-reviewer,perf-reviewer,architect,critic,test-engineer,tracer,debugger,document-specialist,verifier}.md`.

## Gate baseline (before fixes)

- ESLint: clean (exit 0)
- Typecheck: clean (exit 0)
- lint:api-auth: clean (exit 0)
- lint:action-origin: clean (exit 0)
- Vitest: 372/372 (exit 0)
- Build: previously clean (Cycle 3 baseline)

## New findings (deduplicated)

### C4L-SEC-01 — `isValidTagName` permits Unicode bidi/invisible formatting characters [LOW] [Medium confidence]

**File:** `apps/web/src/lib/validation.ts:43-46`

`isValidTagName` blocks `<>"'&\x00` and commas but does NOT reject the high-codepoint formatting characters that:
- C3L-SEC-01 closed in `isValidTopicAlias`,
- CSV export (C7R-RPL-11 / C8R-RPL-01) strips before producing CSV,
- `getTagSlug` already strips during slug derivation.

The stored tag **name** (varchar 255) carries the chars through to admin UI rendering (`/admin/tags`, photo pill chips, image manager). React HTML-escapes special characters but does not strip Unicode bidi / invisible chars, so visual reordering / spoofing is possible in admin UI.

Cross-agent agreement: security-reviewer (SEC-01), code-reviewer (CR-01 cleanup), critic (CRIT-01), tracer (path 1), test-engineer (TE-01 coverage gap), architect (ARCH-01 shared-module recommendation), document-specialist (DOC-01 comment update).

**Fix plan:**
1. Export `UNICODE_FORMAT_CHARS` as a shared named constant in `validation.ts`.
2. Apply it in `isValidTagName`.
3. Add `validation.test.ts` parallel coverage to the existing `isValidTopicAlias` Unicode-formatting cases.
4. Update the inline comment to reference C4L-SEC-01.

### Deferred / informational

- **C4L-CR-01 / ARCH-01** — folded into the C4L-SEC-01 fix (shared constant).
- **C4L-CR-02** — case-insensitive tag-name uniqueness is intentional; no action.
- **C4L-DOC-01** — inline comment update bundled with C4L-SEC-01 fix.

## Cross-agent agreement

- C4L-SEC-01 confirmed by 7 perspectives (security, code-reviewer, critic, tracer, test-engineer, architect, document-specialist).

## AGENT FAILURES

The Task fan-out tool is not available inside this nested subagent context, so all agent perspectives were authored sequentially by the orchestrating agent. This is recorded for provenance per the cycle protocol; per-perspective files exist under `.context/reviews/`.

## Recommended priority

1. Implement C4L-SEC-01 with shared `UNICODE_FORMAT_CHARS` export and test parity.
2. Defer all INFO/LOW Cycle-3 carry-forwards (already documented in `.context/plans/233-deferred-cycle3-loop.md`).

## Deferral plan reference

See `.context/plans/235-deferred-cycle4-loop.md` (created in PROMPT 2).
