# Cycle 95 Security Review

Review target: `750729ada2403c0c01267670b9552a05e0ead217`.

## Scope

Reviewed the Cycle 94 token/auth changes, security-relevant guards, and release evidence state:

- `apps/web/src/app/actions/lr-tokens.ts`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`
- `apps/web/src/__tests__/lr-tokens-action.test.ts`
- `apps/web/src/__tests__/client-source-contracts.test.ts`
- `.context/reviews/cycle-94-2026-07-01/security-reviewer.md`
- `.context/plans/cycle-94-2026-07-01-plan.md`
- `AGENTS.md`
- `CLAUDE.md`

## Confirmed Findings

No new confirmed security vulnerability was found.

## Security Checks

- `createLrToken()` still returns early during restore maintenance, then enforces same-origin admin provenance before admin/user lookup.
- Invalid Lightroom token labels are rejected server-side and now preserve structured field metadata instead of leaking raw DB/driver text.
- Token persistence failures still log server-side and return the generic `lrTokenCreateFailed` key.
- PAT route and broader auth/rate-limit findings from Cycle 94 remain in deferred ledgers where they require wider route-level harnesses or architecture changes.
- The only Cycle 95 confirmed item is the release-ledger stale-state issue recorded as `C95-01` in the aggregate. It is a process/evidence issue, not an auth, data exposure, or injection vulnerability.

## Validation

Static source review. Full security guard gates are scheduled after the docs/artifact update:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
