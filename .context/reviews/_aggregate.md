# Aggregate review — latest (cycle 1 rpl)

This file is the orchestrator-requested aggregate. The detailed cycle-1 rpl aggregate is at `.context/reviews/_aggregate-cycle1-rpl.md`; this file duplicates the consolidated findings for discoverability.

Generated: 2026-04-23. HEAD: a308d8c.

Per-agent source files (cycle 1, this run):
- `.context/reviews/code-reviewer-cycle1-fresh.md`
- `.context/reviews/security-reviewer-cycle1-new.md`
- `.context/reviews/perf-reviewer-cycle1-new.md`
- `.context/reviews/critic-cycle1-new.md`
- `.context/reviews/verifier-cycle1-new.md`
- `.context/reviews/test-engineer-cycle1-new.md`
- `.context/reviews/tracer-cycle1-new.md`
- `.context/reviews/architect-cycle1-new.md`
- `.context/reviews/debugger-cycle1-new.md`
- `.context/reviews/document-specialist-cycle1-new.md`
- `.context/reviews/designer-cycle1-new.md`

## Consolidated findings

### AGG1R-01 — `hasTrustedSameOrigin` fails open when origin/referer are missing
- MEDIUM / HIGH. `apps/web/src/lib/request-origin.ts:62-87`; `apps/web/src/app/actions/auth.ts:93,274`.
- Signal: code-reviewer, security-reviewer, verifier, debugger, architect, critic, tracer.
- Action: flip default to fail-closed; keep loose opt-in explicit; update unit tests.

### AGG1R-02 — Password-change rate-limit cleared before DB transaction commits
- MEDIUM / HIGH. `apps/web/src/app/actions/auth.ts:337-371`.
- Signal: code-reviewer, verifier, debugger, tracer.
- Action: move `clearSuccessfulPasswordAttempts` to after the transaction commits.

### AGG1R-03 — Admin layout renders protected chrome for unauthenticated login page
- MEDIUM / HIGH. `apps/web/src/app/[locale]/admin/layout.tsx`; `apps/web/src/components/admin-header.tsx`; `apps/web/src/components/admin-nav.tsx`.
- Signal: code-reviewer, security-reviewer, architect, debugger, designer, tracer, verifier.
- Action: branch layout on auth state; render minimal login shell when unauthenticated.

### AGG1R-04 — Admin UI falls out of sync with server-sanitized values
- MEDIUM / HIGH (images), LOW / HIGH (seo, settings). `apps/web/src/app/actions/images.ts`; `apps/web/src/components/image-manager.tsx`; `apps/web/src/app/actions/seo.ts`; `apps/web/src/app/actions/settings.ts`.
- Signal: code-reviewer, verifier, debugger, designer, critic, architect.
- Action: return normalized persisted values; rehydrate client state from them; add vitest assertions.

### AGG1R-05 — `seed-e2e.ts` hard-codes image sizes
- MEDIUM / HIGH. `apps/web/scripts/seed-e2e.ts:77-100, 142-147`.
- Signal: code-reviewer, verifier, test-engineer.
- Action: iterate over configured/default image sizes in the seed script.

### AGG1R-06 — Legacy `src/db/seed.ts` uses uppercase slugs the current validator rejects
- LOW / HIGH. `apps/web/src/db/seed.ts:4-10`.
- Signal: code-reviewer, verifier, architect, test-engineer, debugger.
- Action: normalize slugs to lowercase.

### AGG1R-07 — Request-origin test does not lock the strict default
- LOW / HIGH. `apps/web/src/__tests__/request-origin.test.ts:94-106`.
- Signal: test-engineer, debugger, critic.
- Action: amend the compatibility test to assert `false` under strict default; keep loose opt-in covered separately.

### AGG1R-08 — E2E admin lane never runs locally by default
- MEDIUM / HIGH. `apps/web/e2e/admin.spec.ts:6-7`; `apps/web/e2e/helpers.ts`.
- Signal: test-engineer, designer.
- Action: auto-enable admin describe when safe local credentials present; keep remote opt-in only.

### AGG1R-09 — Historical example secrets in git history (closed / documented)
- MEDIUM / HIGH (original). Signal: security-reviewer.
- Disposition: operationally closed; current docs warn to rotate.

### AGG1R-10 — CSP `'unsafe-inline'` hardening
- LOW / HIGH. Signal: security-reviewer.
- Disposition: deferred; matches `plan/cycle6-review-triage.md` D6-09.

### AGG1R-11 — Broader server-action provenance audit
- MEDIUM / MEDIUM. Signal: security-reviewer.
- Disposition: deferred; matches `plan/cycle6-review-triage.md` D6-07.

### AGG1R-12 — Admin mobile nav lacks visible scroll affordance
- LOW / MEDIUM. Signal: code-reviewer, designer.
- Disposition: observational.

### AGG1R-13 — Pending cycle-6 plan items on current HEAD
- Signal: document-specialist.
- Disposition: subsumed into `plan/cycle1-rpl-review-fixes.md`.

## Signals of cross-agent agreement
- 7 agents flag AGG1R-01 and AGG1R-03.
- 6 agents flag AGG1R-04.
- 5 agents flag AGG1R-06.
- 4 agents flag AGG1R-02 and AGG1R-05.

## Agent failures
None.
