# Cycle 7 Verifier Review

Date: 2026-07-18 KST
Review HEAD: `ec7fc46f`

## Inventory

I traced the Cycle 6 claims from `responsive-masonry.ts` through
`home-client.tsx`, `masonry-card.tsx`, public layout padding, CSS containment,
unit/E2E tests, Git signatures/remote state, and the deployed public app. I
also checked the maintained route/action/schema/script surfaces and current
deferred register for contradictions or silently reopened invariants.

## Evidence-backed results

### VER-01 — Item-count alignment is correct, but rendered-width alignment fails outside the container boundary

- Severity / confidence / status: **Medium / High / Confirmed**
- Regions: `apps/web/src/components/home-client.tsx:231-249`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`;
  `apps/web/src/components/masonry-card.tsx:60-76`
- Verified good: at 1,536 px production renders five columns for the normal
  gallery, uses matching `20vw` source hints, and selects the 640w candidate.
  The two-item seeded contract is covered at the same breakpoint.
- Verified failure: at 320 px production the gallery content box is 288 px,
  while the estimator uses the 336 px quantized viewport. Computed values were
  224 px intrinsic versus 192.05 px rendered for landscape and 504 px versus
  431.75 px for portrait (16.7% high). At 2,560 px, a live two-photo filter
  rendered a 1,504 px grid and 744x496 cards while the viewport estimator
  emitted `auto 843px` (70% high). This disproves the effective claim that
  `estimatedCardWidth` estimates rendered card width.
- Failure scenario: these lengths are the cold fallback for
  `content-visibility:auto`; browsers may retain actual size after rendering,
  but first-time skipped geometry is still materially oversized and contracts
  when activated.
- Suggested fix: drive the estimate from measured container width and add 320
  px plus above-container-cap browser assertions.

### VER-02 — Cycle 6 release-state claims are stale

- Severity / confidence / status: **Low / High / Confirmed**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:5,43-45,65-73`;
  `.context/plans/README.md:34-40`
- Evidence: `git verify-commit` reports good signatures for `fcbce386`,
  `03a96a3d`, and `ec7fc46f`; local and remote master both resolve to
  `ec7fc46f`; production serves the item-count-capped code behavior. The plan
  nevertheless records push/deploy as pending.
- Suggested fix: archive the reconciled plan and move Cycle 7 to the active
  frontier, preserving the normal caveat that production does not expose an
  exact Git SHA.

## Final sweep

I rechecked source assertions against behavior rather than trusting comments
or tests. No further candidate had enough evidence to report as a new issue.
