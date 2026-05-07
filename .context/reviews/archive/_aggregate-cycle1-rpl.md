# Aggregate review — cycle 1 (review-plan-fix)

Generated: 2026-04-23. HEAD: a308d8c.

Per-agent source files:
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

Aggregation rules: (1) Dedupe overlapping findings, preserving highest severity/confidence across agents. (2) Record cross-agent agreement as "Signal". (3) Keep per-agent files untouched for provenance.

## Consolidated findings

### AGG1R-01 — `hasTrustedSameOrigin` fails open when origin/referer are missing
- **Signal:** code-reviewer (CR1F-01), security-reviewer (SEC1-01), verifier (V1-02), debugger (DBG1-02), architect (ARCH1-02), critic (CRIT1-01), tracer (Trace 1).
- **Severity / confidence:** MEDIUM / HIGH.
- **Citation:** `apps/web/src/lib/request-origin.ts:62-87`; `apps/web/src/app/actions/auth.ts:93,274`.
- **Action:** Flip the default of `hasTrustedSameOrigin` to fail-closed, retain the explicit `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` opt-in, and update the companion unit tests to lock the stricter default. The `/api/admin/db/download` route already opts into strict (`hasTrustedSameOriginWithOptions({ allowMissingSource: false })`), so the auth path is the clear outlier.

### AGG1R-02 — Password-change rate-limit cleared before DB transaction commits
- **Signal:** code-reviewer (CR1F-02), verifier (V1-01), debugger (DBG1-01), tracer (Trace 2).
- **Severity / confidence:** MEDIUM / HIGH.
- **Citation:** `apps/web/src/app/actions/auth.ts:337-371`.
- **Action:** Move `clearSuccessfulPasswordAttempts(ip)` to after the transaction commits, mirroring the login path.

### AGG1R-03 — Admin layout renders protected chrome for the unauthenticated login page
- **Signal:** code-reviewer (CR1F-03), security-reviewer (SEC1-02), architect (ARCH1-01), debugger (DBG1-04), designer (UX1-01), tracer (Trace 3), verifier (V1-03).
- **Severity / confidence:** MEDIUM / HIGH.
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx:4-22`; `apps/web/src/components/admin-header.tsx:9-30`; `apps/web/src/components/admin-nav.tsx:10-45`.
- **Action:** Have the top-level admin layout branch on authenticated state. When no current user is present, render a minimal login shell (skip link + children) instead of `AdminHeader`. Keep the `(protected)/layout.tsx` subtree unchanged so authenticated admin routes keep the full chrome.

### AGG1R-04 — Admin UI falls out of sync with server-sanitized values
- **Signal:** code-reviewer (CR1F-04), verifier (V1-05), debugger (DBG1-03), designer (UX1-03), critic (CRIT1-03), architect (ARCH1-03).
- **Severity / confidence:** MEDIUM / HIGH for images; LOW / HIGH for seo, settings.
- **Citation:** `apps/web/src/app/actions/images.ts:546-604`; `apps/web/src/components/image-manager.tsx:226-243`; `apps/web/src/app/actions/seo.ts:51-133`; `apps/web/src/app/actions/settings.ts:36-129`.
- **Action:** Return normalized persisted fields from `updateImageMetadata`, `updateSeoSettings`, and `updateGallerySettings`, and rehydrate client state from those returned values. Add minimal vitest assertions covering the normalization contract per action.

### AGG1R-05 — `seed-e2e.ts` hard-codes image sizes instead of honoring configured list
- **Signal:** code-reviewer (CR1F-06), verifier (V1-04), test-engineer (TE1-04).
- **Severity / confidence:** MEDIUM / HIGH.
- **Citation:** `apps/web/scripts/seed-e2e.ts:77-100, 142-147`.
- **Action:** Import the active/default `image_sizes` list and iterate over it for both generation and cleanup; retain the existing 2048-to-canonical copy behavior and seeded metadata.

### AGG1R-06 — Legacy `src/db/seed.ts` uses uppercase slugs that current validators reject
- **Signal:** code-reviewer (CR1F-05), verifier (V1-04), architect (ARCH1-04), test-engineer (TE1-05), debugger (DBG1-05).
- **Severity / confidence:** LOW / HIGH.
- **Citation:** `apps/web/src/db/seed.ts:4-10`.
- **Action:** Normalize slugs to lowercase (`idol`, `plane`) while preserving labels and order.

### AGG1R-07 — Request-origin test does not lock the strict default
- **Signal:** test-engineer (TE1-01), debugger (DBG1-02), critic (CRIT1-01).
- **Severity / confidence:** LOW / HIGH.
- **Citation:** `apps/web/src/__tests__/request-origin.test.ts:94-106`.
- **Action:** Amend the compatibility test to expect `false` under the new strict default; keep the `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` opt-in path covered by its own assertion.

### AGG1R-08 — E2E admin lane never runs locally by default
- **Signal:** test-engineer (TE1-03), designer (UX1-04).
- **Severity / confidence:** MEDIUM / HIGH.
- **Citation:** `apps/web/e2e/admin.spec.ts:6-7`; `apps/web/e2e/helpers.ts`.
- **Action:** Auto-enable the admin describe when local safe credentials are present (dev environment + plaintext test user), keeping remote admin opt-in only. Add a non-destructive assertion that flipping the GPS toggle in `/admin/settings` changes the hydrated UI.

### AGG1R-09 — Historical example secrets in git history (closed / documented)
- **Signal:** security-reviewer (SEC1-03).
- **Severity / confidence:** MEDIUM / HIGH (original).
- **Disposition:** Operationally closed; current `.env.local.example`, `README.md`, and `CLAUDE.md` explicitly warn operators to rotate historic values. No code change this cycle.

### AGG1R-10 — CSP `'unsafe-inline'` hardening
- **Signal:** security-reviewer (SEC1-04).
- **Severity / confidence:** LOW / HIGH.
- **Disposition:** Deferred; matches `plan/cycle6-review-triage.md` D6-09.

### AGG1R-11 — Broader server-action provenance audit
- **Signal:** security-reviewer (SEC1-06).
- **Severity / confidence:** MEDIUM / MEDIUM.
- **Disposition:** Deferred; matches `plan/cycle6-review-triage.md` D6-07.

### AGG1R-12 — Admin mobile nav lacks visible scroll affordance
- **Signal:** code-reviewer (CR1F-07), designer (UX1-02).
- **Severity / confidence:** LOW / MEDIUM.
- **Disposition:** Observational UX nit; deferrable.

### AGG1R-13 — Pending cycle-6 plan items on current HEAD
- **Signal:** document-specialist (DOC1-06).
- **Severity / confidence:** HIGH priority in orchestrator sense (previously-planned work, never executed).
- **Action:** Subsume the Cycle 6 plan items (C6R-01..C6R-06) into the Cycle 1 plan (see `plan/cycle1-rpl-review-fixes.md`) because every cited finding was re-verified on HEAD a308d8c.

## Agent failures
None.

## Signals of cross-agent agreement
- 7 agents flag AGG1R-01.
- 7 agents flag AGG1R-03.
- 6 agents flag AGG1R-04.
- 4 agents flag AGG1R-02, AGG1R-05.

Items flagged by multiple agents with HIGH confidence are prioritized in the plan.
