# Aggregate — Cycle 2 review-plan-fix loop (2026-04-25)

## Run context

- **HEAD:** `707ea70 docs(plan): mark plan-301 as DONE`
- **Cycle:** 2/100
- **Diff scope since cycle 1:** 5 commits (`3dd50cd refactor`, `4026ffc useColumnCount`, `21bedb8 hreflang`, `707ea70 plan-301 DONE`, plus `8d351f5 hreflang topic+photo` already in master before plan-301).
- **Reviewers:** code-reviewer, architect, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, debugger, document-specialist, designer.

## Aggregate verdict

**Zero MEDIUM/HIGH findings.**

Plan-301 is mostly correct. Three new LOW findings surfaced where plan-301's caller-inventory was incomplete:

| ID | Description | Severity | Confidence | Reviewers |
|---|---|---|---|---|
| **AGG2L-LOW-01** | `humanizeTagLabel` not applied at `photo-viewer.tsx:395` and `info-bottom-sheet.tsx:243`; chips render `#Music_Festival` while masonry shows `#Music Festival`. Plan-301-A's "single source of truth" DOD is unfulfilled here. | LOW | High | code-reviewer (CR2L-LOW-02), architect (A2L-LOW-02), critic (C2L-01), verifier, tracer (Trace 3, Trace 4), debugger (H1, H4), test-engineer (TE2L-LOW-01), designer (DSGN2L-LOW-01), document-specialist (DS2L-INFO-01) |
| **AGG2L-LOW-02** | `[locale]/layout.tsx:28-34` still hardcodes `'en' / 'ko' / 'x-default'` hreflang instead of using `buildHreflangAlternates`. Plan-301-C's forward-compat promise broken. `x-default` also disagrees: helper → `…/en`, layout → bare `seo.url`. | LOW | High | code-reviewer (CR2L-LOW-01), architect (A2L-LOW-01), critic (C2L-02), verifier, tracer (Trace 8), debugger (H3), test-engineer (TE2L-LOW-02), document-specialist (DS2L-INFO-02) |
| **AGG2L-LOW-03** | Group-page masonry stays at `xl:columns-4` while home/topic widened to `2xl:columns-5`. Possibly intentional density choice; record only. | LOW | Medium | code-reviewer (CR2L-INFO-01), designer (DSGN2L-INFO-01) |

## Cross-reviewer agreement

- **AGG2L-LOW-01:** Nine reviewers agree (code-reviewer, architect, critic, verifier, tracer, debugger, test-engineer, designer, document-specialist). Highest cross-reviewer signal in the cycle.
- **AGG2L-LOW-02:** Eight reviewers agree (code-reviewer, architect, critic, verifier, tracer, debugger, test-engineer, document-specialist). Second strongest.
- **AGG2L-LOW-03:** Two reviewers (code-reviewer, designer). Tracking-only.

## Quality-gate evidence

| Gate | Result |
|---|---|
| `npm run lint --workspace=apps/web` | exit 0 |
| `npm run lint:api-auth --workspace=apps/web` | exit 0 |
| `npm run lint:action-origin --workspace=apps/web` | exit 0 |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | exit 0 |
| `npm test --workspace=apps/web` | 60 files / 402 tests passed (6.32s) |
| `npm run test:e2e --workspace=apps/web` | 20 passed / 1 skipped (37.5s) |
| `npm run build --workspace=apps/web` | exit 0; all routes compiled |

All cycle-2 baseline gates green at HEAD.

## Convergence verdict

Cycle 2 fresh review surfaces **3 LOW findings**, **0 MEDIUM, 0 HIGH**.

AGG2L-LOW-01 and AGG2L-LOW-02 are the natural close-out of the cycle-1 consolidation work — same intent (single helper, every consumer migrated), small mechanical surface (3 files: photo-viewer.tsx, info-bottom-sheet.tsx, [locale]/layout.tsx). These are exactly the items the orchestrator guidance asks us to complete now: small, mechanical, low-risk follow-ups that close the loop on a refactor.

AGG2L-LOW-03 is design polish; defer to plan-303-deferred.

**Recommendation:** Schedule plan-303 (cycle-2 fixes) implementing AGG2L-LOW-01 and AGG2L-LOW-02. Defer AGG2L-LOW-03 with explicit re-open criterion.

## Agent failures

None. All eleven reviewer lenses produced a review file under `./.context/reviews/<lens>-cycle2-loop.md`.
