# Cycle 1 rpl — deferred items

Purpose: capture every cycle-1 rpl review finding that is **not** implemented in `plan/cycle1-rpl-review-fixes.md`, plus map scheduled items so no finding is silently dropped.

Repo-policy inputs consulted: `CLAUDE.md`, `AGENTS.md`, existing plan files under `plan/` and `.context/`. `.cursorrules` and `CONTRIBUTING.md` are absent.

## Master disposition map

| Finding | Citation | Original severity / confidence | Disposition |
|---|---|---|---|
| AGG1R-01 | `apps/web/src/lib/request-origin.ts:62-87`; `apps/web/src/app/actions/auth.ts:93,274` | MEDIUM / HIGH | Scheduled in C1R-01 |
| AGG1R-02 | `apps/web/src/app/actions/auth.ts:337-371` | MEDIUM / HIGH | Scheduled in C1R-02 |
| AGG1R-03 | `apps/web/src/app/[locale]/admin/layout.tsx`; `apps/web/src/components/admin-header.tsx`; `apps/web/src/components/admin-nav.tsx` | MEDIUM / HIGH | Scheduled in C1R-03 |
| AGG1R-04 | `apps/web/src/app/actions/images.ts:546-604`; `apps/web/src/components/image-manager.tsx:226-243`; `apps/web/src/app/actions/seo.ts:51-133`; `apps/web/src/app/actions/settings.ts:36-129` | MEDIUM / HIGH (images); LOW / HIGH (seo, settings) | Scheduled in C1R-04 |
| AGG1R-05 | `apps/web/scripts/seed-e2e.ts:77-100, 142-147` | MEDIUM / HIGH | Scheduled in C1R-05 |
| AGG1R-06 | `apps/web/src/db/seed.ts:4-10` | LOW / HIGH | Scheduled in C1R-06 |
| AGG1R-07 | `apps/web/src/__tests__/request-origin.test.ts:94-106` | LOW / HIGH | Scheduled in C1R-01 |
| AGG1R-08 | `apps/web/e2e/admin.spec.ts:6-7`; `apps/web/e2e/helpers.ts` | MEDIUM / HIGH | Scheduled in C1R-07 |
| AGG1R-09 | `security-reviewer-cycle1-new.md` SEC1-03 | MEDIUM / HIGH (original) | Operationally closed / documented below |
| AGG1R-10 | `apps/web/next.config.ts:72-75` | LOW / HIGH | Deferred below (D1-01) |
| AGG1R-11 | `apps/web/src/app/actions/{images,settings,seo,sharing,tags,topics,admin-users}.ts`; `apps/web/src/app/[locale]/admin/db-actions.ts` | MEDIUM / MEDIUM | Deferred below (D1-02) |
| AGG1R-12 | `apps/web/src/components/admin-nav.tsx:27` | LOW / MEDIUM | Deferred below (D1-03) |

## Deferred items

### D1-01 — CSP `'unsafe-inline'` hardening
- **Citation:** `security-reviewer-cycle1-new.md` SEC1-04; `apps/web/next.config.ts:72-75`.
- **Original severity / confidence:** LOW / HIGH. Preserved; not downgraded.
- **Reason for deferral:** Removing `'unsafe-inline'` requires a broader nonce/hash strategy for inline/bootstrap behavior. This is low-severity hardening, not a same-cycle narrow bug fix; repo rule in `AGENTS.md` is to keep diffs small and reversible.
- **Exit criterion:** Re-open when CSP tightening is prioritized and inline script sources can be converted to nonce/hash-based equivalents.

### D1-02 — Broader same-origin / server-action provenance audit
- **Citation:** `security-reviewer-cycle1-new.md` SEC1-06; mutation actions under `apps/web/src/app/actions/*.ts` + `apps/web/src/app/[locale]/admin/db-actions.ts`.
- **Original severity / confidence:** MEDIUM / MEDIUM. Preserved.
- **Reason for deferral:** This is a framework/deployment-trust audit; cycle 1 fixes the directly confirmed auth provenance gap first (C1R-01) without widening to every mutation surface in one patch. Matches the pre-existing carry-forward `D6-07` in `plan/cycle6-review-triage.md`.
- **Exit criterion:** Re-open when mutation-surface CSRF/origin policy is audited repo-wide or framework/deployment assumptions change.

### D1-03 — Admin mobile nav scroll affordance
- **Citation:** `designer-cycle1-new.md` UX1-02; `apps/web/src/components/admin-nav.tsx:27`.
- **Original severity / confidence:** LOW / MEDIUM. Preserved.
- **Reason for deferral:** Pure UX polish; not a regression, not a correctness issue. Repo rule in `AGENTS.md` to keep diffs small and scoped; bundling this with the auth/test fixes would dilute review of the auth-sensitive paths.
- **Exit criterion:** Re-open during the next UI polish cycle or when admin nav layout is otherwise touched.

## Operationally closed / documented

### OC1-01 — Historical example secrets in git history
- **Citation:** `security-reviewer-cycle1-new.md` SEC1-03; `d7c3279:apps/web/.env.local.example`; current warnings in `README.md`, `CLAUDE.md`, `apps/web/.env.local.example`.
- **Original severity / confidence:** MEDIUM / HIGH. Preserved as operational history issue.
- **Reason:** Current tracked files already use placeholders and explicit rotation warnings. Rewriting public git history is outside the scope of a normal code-fix cycle.
- **Exit criterion:** Re-open if the repo adopts a history-rewrite/security-notice process or if current-head docs regress and stop warning operators to rotate historic values.

## Carry-forward items still active from prior cycles
The following pre-existing deferrals from `plan/cycle6-review-triage.md` remain open and are NOT reintroduced here — see the originating triage file for full detail:

- D6-01 (cursor/keyset public infinite scroll)
- D6-02 (scoped topic/tag photo navigation)
- D6-03 (asserted visual regression workflow)
- D6-04 (public photo ISR/auth-boundary redesign)
- D6-05 (streaming/paged CSV full export)
- D6-06 (sitemap partitioning / index generation)
- D6-07 (broader server-action provenance audit — also represented here as D1-02)
- D6-08 (historical example secrets — also represented here as OC1-01)
- D6-09 (CSP `'unsafe-inline'` hardening — also represented here as D1-01)
- D6-10 (durable shared-group view counts)
- D6-11 (tag-filtered metadata uses canonical names)
- D6-12 (split mutable shared-group view buffering out of `lib/data.ts`)
- D6-13 (codify or redesign single-process runtime assumptions)
- D6-14 (remaining broader test-surface expansions)

None of these are reopened in this cycle; they remain bound by the same exit criteria documented in the prior triage.

## Notes on repo policy compliance for deferrals
- No security, correctness, or data-loss finding is deferred without the quoted repo rule that permits it (`AGENTS.md`: "keep diffs small, reviewable, and reversible"). AGG1R-01, AGG1R-02 (security/correctness) are NOT deferred — both are scheduled in `plan/cycle1-rpl-review-fixes.md`.
- Deferred work, when eventually picked up, remains bound by repo policy: GPG-signed commits, conventional-commit + gitmoji messages, no `--no-verify`, no force-push to protected branches, and the required language/toolchain versions recorded in `CLAUDE.md`.
