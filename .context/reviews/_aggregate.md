# Aggregate Review — Cycle 5 (review-plan-fix loop, 2026-04-25)

Review pass executed by a single subagent (the Task fan-out tool is not callable inside this nested subagent context). Per-perspective files written for provenance under `.context/reviews/{security-reviewer,code-reviewer,perf-reviewer,architect,critic,test-engineer,tracer,debugger,document-specialist,verifier}.md`. Designer perspective skipped — no UI/UX changes since cycle 4.

## Gate baseline (before fixes)

- ESLint: clean (exit 0)
- Typecheck: clean (exit 0)
- lint:api-auth: clean (exit 0)
- lint:action-origin: clean (exit 0)
- Vitest: 376/376 passing across 59 files (exit 0)
- Build: previously clean (Cycle 4 baseline)

## New findings (deduplicated)

### C5L-SEC-01 — `topics.label`, `images.title`, `images.description` permit Unicode bidi/invisible formatting characters [LOW] [Medium confidence]

**Files:**
- `apps/web/src/app/actions/topics.ts:73-76, 170-175` (createTopic / updateTopic — `label`)
- `apps/web/src/app/actions/images.ts:642-707` (`updateImageMetadata` — `title`, `description`)

`UNICODE_FORMAT_CHARS` (introduced for CSV in C7R-RPL-11 / C8R-RPL-01, extended to topic aliases in C3L-SEC-01 and tag names in C4L-SEC-01) is **not** applied to the remaining admin-controlled persistent string fields. These render in admin UI tables, public photo viewer, lightbox, info bottom sheet, OG image, and SEO description. React HTML-escapes special characters but does NOT strip Unicode bidi/invisible chars, so visual reordering / spoofing is possible.

Cross-agent agreement: security-reviewer (SEC-01), code-reviewer (CR-01 inconsistency), critic (CRIT-01 piecemeal), tracer (TRACE-01/02), test-engineer (TE-01 coverage), architect (ARCH-01 shared seam), document-specialist (DOC-01/DOC-02 docs).

**Fix plan:**
1. In `topics.ts` (`createTopic` and `updateTopic`): after `stripControlChars`, return `{ error: t('invalidLabel') }` when `UNICODE_FORMAT_CHARS.test(label)` is true. Match the existing `if (label !== rawLabel) return { error: t('invalidLabel') }` ordering.
2. In `images.ts` (`updateImageMetadata`): after `stripControlChars`/`trim`, return `{ error: t('invalidTitle') }` / `{ error: t('invalidDescription') }` when `UNICODE_FORMAT_CHARS.test(...)` is true on the sanitized value.
3. Update lineage comment in `validation.ts:30-32` to extend through C5L-SEC-01.
4. Add tests:
   - `topics-actions.test.ts`: createTopic/updateTopic reject RLO-bearing label.
   - `images-actions.test.ts`: updateImageMetadata rejects RLO title and ZWSP description.
5. Add new i18n keys (`invalidLabel`, `invalidTitle`, `invalidDescription`) in `en.json` and `ko.json` if not already present (only the missing ones).

### Informational / deferred

- **C5L-CR-02** (sanitization comment text drift) — bundle into the same fix commit by polishing the comment.
- **C5L-DBG-01** (label-vs-title strip-vs-reject asymmetry) — INFO only; no behavioural change recommended; document in commit body.
- **C5L-PERF-01** — no actionable item.

## Cross-agent agreement summary

C5L-SEC-01 confirmed by 8 perspectives (security, code-reviewer, critic, tracer-A, tracer-B, test-engineer, architect, document-specialist). Verifier and debugger record no blockers.

## AGENT FAILURES

The Task fan-out tool is not available inside this nested subagent context, so all agent perspectives were authored sequentially by the orchestrating agent. Designer was skipped (no UI/UX-affecting changes since cycle 4 design pass). This is recorded for provenance per the cycle protocol; per-perspective files exist under `.context/reviews/`.

## Recommended priority

1. Implement C5L-SEC-01 by extending Unicode-formatting rejection to `topics.label`, `images.title`, `images.description`.
2. Bundle C5L-CR-02 / C5L-DOC-02 (lineage comment update) into the same commit.
3. Defer all INFO findings.

## Deferral plan reference

PROMPT 2 will create a plan under `.context/plans/` and a deferred-findings record for any items not in scope.
