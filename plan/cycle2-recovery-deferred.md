# Cycle 2 recovery — deferred findings

Status: active
Created: 2026-04-24
Source aggregate: `.context/reviews/_aggregate.md` (Cycle 2 / Prompt 1 Recovery)

## Repo-policy inputs consulted

- `CLAUDE.md`, `AGENTS.md`, `.context/**`, root `plan/**`.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/**` style/policy files are absent.
- No repo rule authorizes deferring confirmed security/correctness/data-loss findings.

## Master disposition map

| Finding | Citation | Original severity / confidence | Disposition |
|---|---|---|---|
| AGG2C2-01 | `apps/web/src/app/actions/images.ts:367-427`, `apps/web/src/app/actions/images.ts:461-555` | HIGH / High | Scheduled in C2REC-01 |
| AGG2C2-02 | `apps/web/src/app/actions/auth.ts:108-141`, `apps/web/src/app/actions/auth.ts:320-337` | MEDIUM / High | Scheduled in C2REC-02 |
| AGG2C2-03 | `apps/web/src/app/[locale]/admin/db-actions.ts:127-140`, `apps/web/src/app/[locale]/admin/db-actions.ts:396-408` | MEDIUM / High | Scheduled in C2REC-03 |
| AGG2C2-04 | `apps/web/src/app/actions/settings.ts:72-103` | MEDIUM / Medium-High | Scheduled in C2REC-04 |
| AGG2C2-05 | `README.md:87-115`, `apps/web/README.md:7-14` | MEDIUM / High | Scheduled in C2REC-05 |

## Deferred items

No current cycle-2 recovery aggregate finding is deferred. Existing carry-forward deferrals from earlier cycles remain in their existing plan files and are not contradicted by this plan.

## Gate warning carry-forward

1. **Next.js edge runtime static-generation warning for OG route**
   - Citation: `apps/web/src/app/api/og/route.tsx:1-6`; `npm run build` and `npm run test:e2e` emitted `Using edge runtime on a page currently disables static generation for that page`.
   - Original severity/confidence: LOW / High (tool warning; not a test/build failure).
   - Reason for deferral: The route uses Next's `ImageResponse`, which requires/targets edge runtime in this app. Removing the edge runtime would be a framework/API compatibility change and is already carried forward in `plan/plan-232-cycle1-deferred.md`.
   - Exit criterion: Next.js supports this OG route under Node runtime without the warning, the route is rewritten to a Node-compatible renderer, or the warning becomes a CI failure.
