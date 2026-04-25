# Aggregate — Cycle 1 review-plan-fix loop (2026-04-25)

## Run context

- **HEAD:** `8d351f5 fix(seo): emit hreflang alternates on topic and photo pages`
- **Cycle:** 1/100
- **Diff scope:** 11 UI/UX fix commits (`e3c1dd3..8d351f5`), 17 files, +237 / -47.
- **Reviewers:** code-reviewer, security-reviewer, perf-reviewer, critic, architect, verifier, test-engineer, tracer, debugger, document-specialist, designer.

## Aggregate verdict

**Zero new MEDIUM or HIGH findings.**

All 11 reviewers agree the fix wave is correct in intent. No regressions broke the build, the gates, or the existing test suite. Production verification confirms F-1, F-2, F-3, F-6, F-7, F-13, F-15 are deployed and rendering correctly. F-17 is in HEAD locally and will deploy this cycle.

## Cross-reviewer LOW findings (deduplicated)

| ID | Description | Severity | Confidence | Reviewers |
|---|---|---|---|---|
| **AGG1L-LOW-01** | Underscore normalization scattered across 4 sites; JSON-LD `name` emits raw underscores while UI normalizes. Consolidate into `getPhotoDisplayTitleFromTagNames`. | LOW | High | code-reviewer (CR1-LOW-01), critic, architect (A1-INFO-02), tracer (TR1-LOW-01) |
| **AGG1L-LOW-02** | `useColumnCount` JS thresholds don't include the new `2xl:columns-5` breakpoint; 5th above-the-fold image loads lazily. | LOW | High | perf (P1-LOW-02), critic (F-15), tracer (TR1-LOW-02) |
| **AGG1L-LOW-03** | Skeleton-shimmer animation runs forever; dark-mode gradient is nearly invisible. | LOW | High | perf (P1-LOW-01), critic (F-23), designer (DSGN1-LOW-01, DSGN1-LOW-02) |
| **AGG1L-LOW-04** | Hreflang `alternateLanguages` map hard-codes `en`/`ko`/`x-default`; should iterate `LOCALES`. Also missing on home page `(public)/page.tsx`. | LOW | High | architect (A1-LOW-01), critic (F-17), tracer (TR1-LOW-03) |
| **AGG1L-LOW-05** | `focus-visible:ring-*` vs `focus-visible:outline-*` inconsistency: only `image-zoom` switched. | LOW | High | critic (F-8) |
| **AGG1L-LOW-06** | Login form's `aria-pressed` + dynamic `aria-label` may double-cue state in some screen readers. | LOW | Medium | security (S1-LOW-02), critic (F-12/F-13), designer |
| **AGG1L-LOW-07** | Photo-viewer toolbar inconsistency: Back/Info `h-11`, Share/Lightbox-trigger ~32px. | LOW | Medium | designer (DSGN1-LOW-03) |
| **AGG1L-LOW-08** | Search dialog visual asymmetry: input `h-8`, close `h-11`. | LOW | Medium | designer (DSGN1-LOW-04), critic (F-3) |
| **AGG1L-LOW-09** | Photo container `min-h-[40vh]` may be too small in landscape mobile. | LOW | Medium (debunked partially — image inside still grows the container due to existing landscape rule) | critic (F-10), debugger (H7) |
| **AGG1L-LOW-10** | `--muted-foreground` light-mode change may regress nav link hierarchy. | LOW | Medium | critic (F-11), designer (DSGN1-LOW-05) |
| **AGG1L-LOW-11** | `getOpenGraphLocale` admin "OG locale" setting now silently dead on supported routes; UI/docs unchanged. | LOW | Medium | code-reviewer (CR1-LOW-03), architect (A1-LOW-02), document-specialist (DS1-LOW-01) |
| **AGG1L-LOW-12** | Underscore normalization not unit-tested for the new branch in `photo-title.ts`. | LOW | High | test-engineer (TE1-LOW-01) |
| **AGG1L-LOW-13** | Login password-toggle behavior not e2e-tested. | LOW | Medium | test-engineer (TE1-LOW-04) |
| **AGG1L-LOW-14** | Submitting login with `showPassword=true` may suppress browser "save password" prompt. | LOW | Medium | debugger (D1-LOW-01) |
| **AGG1L-LOW-15** | F-* policy (44x44 AAA target) not documented in CLAUDE.md / design docs. | LOW | Medium | document-specialist (DS1-LOW-02), designer, critic |
| **AGG1L-LOW-16** | Touch-target gaps not closed: `info-bottom-sheet` close, `image-manager` checkbox, `upload-dropzone` focus, footer `admin` link. | LOW | Medium | critic (wave-missed list) |

## Cross-reviewer agreement summary

The strongest cross-agent signal is on **AGG1L-LOW-01** (underscore normalization scattered, 4 reviewers) and **AGG1L-LOW-02** (`useColumnCount` mismatch, 3 reviewers). Both are mechanical fixes with high-confidence remediation paths.

Next strongest: **AGG1L-LOW-03** (shimmer issues, 3 reviewers) and **AGG1L-LOW-04** (hreflang LOCALES iteration, 3 reviewers).

## Quality-gate evidence

| Gate | Result |
|---|---|
| `npm run lint --workspace=apps/web` | exit 0 |
| `npm run lint:api-auth --workspace=apps/web` | exit 0 |
| `npm run lint:action-origin --workspace=apps/web` | exit 0 |
| `npm test --workspace=apps/web` | 60 files / 394 tests passed |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | exit 0 |
| `npm run build --workspace=apps/web` | exit 0; all routes compiled |

Playwright e2e gate to be exercised in implementation phase.

## Convergence verdict

Cycle 1 fresh review surfaces **16 LOW findings**, **0 MEDIUM, 0 HIGH**. Per orchestrator guidance, LOW-only cycles can either close convergence or implement the highest-cross-agreement items.

The strongest cross-agent items (AGG1L-LOW-01 underscore consolidation, AGG1L-LOW-02 column-count mirror, AGG1L-LOW-04 hreflang LOCALES + home, AGG1L-LOW-12 underscore normalization unit test) are mechanical, low-risk, high-value. **Recommendation:** schedule a small fix plan addressing those four items; defer the rest to a deferred-cycle1 plan.

## Agent failures

None. All eleven reviewer lenses produced a review file under `./.context/reviews/<lens>.md`.
