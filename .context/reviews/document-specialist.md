# Cycle 7 Documentation Review

Date: 2026-07-18 KST
Review HEAD: `ec7fc46f`

## Inventory

I read `AGENTS.md`, all of `CLAUDE.md`, the current plan index, Cycle 6 plan
and aggregate, responsive code comments/tests, deployment documentation, and
the consolidated deferred register. I cross-checked claims against Git and
deployed behavior.

## Findings

### DOC-01 — Cycle 6 plan/index contradict the signed remote frontier

- Severity / confidence / status: **Low / High / Confirmed**
- Regions: `.context/plans/cycle-6-2026-07-18-plan.md:3-5,43-45,65-73`;
  `.context/plans/README.md:34-40`
- Problem: Cycle 6 is described as active with signed push/deploy pending,
  although the implementation/test/docs commits are GPG-valid and
  `master == origin/master == ec7fc46f`; the orchestrator recorded successful
  per-cycle deployment and production exposes the policy.
- Failure scenario: recovery work repeats already-finished release steps or
  treats the wrong plan as authoritative.
- Fix: record the evidence, mark all terminal checkboxes complete, archive
  Cycle 6, and update the index. Do not invent an exact deployed SHA because
  the public surface does not expose it.

### DOC-02 — The rendered-width comment overstates what the prop represents

- Severity / confidence / status: **Low / High / Confirmed adjunct to runtime issue**
- Regions: `apps/web/src/components/masonry-card.tsx:23-25`;
  `apps/web/src/components/home-client.tsx:237-249`;
  `apps/web/src/app/[locale]/(public)/layout.tsx:17-20`
- Problem: the prop is documented as an estimate of rendered card width, but
  its numerator is quantized viewport width and ignores both the public
  container's 32 px horizontal padding and its 1,536 px desktop cap. At 320
  px it represents 336 px while the card is 288 px; at 2,560 px a two-column
  card is 744 px while the estimate is 1,264 px.
- Fix: make the implementation container-derived, then document the actual
  measurement/bucketing contract. If the implementation intentionally remains
  approximate, document its maximum error instead of calling it rendered card
  width.

## Final sweep

No additional mismatch was found across environment variables, deployment,
schema/migration policy, color/HDR, CLIP, storage, or deferred-policy docs.
