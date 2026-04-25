# Cycle 10 Loop — Deferred Findings Record

**Cycle:** 10/100 (review-plan-fix loop)
**HEAD:** `24c0df1 perf(seo): 🧹 skip JSON-LD on noindex page variants`
**Date:** 2026-04-25
**Aggregate:** `.context/reviews/_aggregate-cycle10-loop.md`

## Summary

Third consecutive cycle (cycles 8, 9, 10) returning **zero new
MEDIUM/HIGH findings**. The cycle-8-scheduled-and-unlanded plans
(plan-237, plan-238) were both completed by/in cycle 9. There is no
in-scope new finding to schedule, and no plan to add to the registry.

This file is a deferral record for the 16 LOW informational
observations surfaced this cycle. None are HIGH/MEDIUM. None describe
a security, correctness, or data-loss defect. All are either positive
observations about cycle-9 work, deliberate-design items, or items
already deferred by prior cycles. No silent drops.

## Deferred items

### Code-quality lens

- **CR10-INFO-01** — `(public)/page.tsx:135` calls `getImagesLitePage`
  even on the noindex (filtered) view. Severity LOW. Reason: the DB
  result is required for `HomeClient` render, not for JSON-LD. Not a
  defect. Re-open criterion: `HomeClient` ever stops needing images
  on the filtered view.
- **CR10-INFO-02** — `(public)/page.tsx:152-163` and
  `[topic]/page.tsx:169-180` compute `galleryLd` before the
  `shouldEmitJsonLd && galleryLd` gate. Severity LOW. Reason: array
  is ≤10 items, allocation overhead negligible, readability wins.
  Re-open criterion: profiling shows the closure overhead is material
  on a hot path.

### Security lens

- **S10-INFO-01** — JSON-LD gate driven by `tagSlugs.length` which is
  pre-validated. Severity LOW (informational, not a defect). No
  re-open criterion.
- **S10-INFO-02** — Smaller crawler fingerprint on filtered views.
  Severity LOW (positive observation). No action.

### Perf lens

- **P10-POSITIVE-01** — JSON-LD bytes saved on noindex views.
  Positive observation, no action.
- **P10-INFO-01** — `galleryLd` pre-gate allocation. Severity LOW.
  Re-open criterion: profiling shows it matters.

### Critic lens

- **CRIT10-01** — Periodic triage of the 25-item cycle-8 deferred
  backlog. Severity LOW. Re-open criterion: any item in that backlog
  re-elevates to MEDIUM/HIGH on a future review.

### Verifier lens

- **V10-OBS-01** — Convergence holds. Positive observation.
- **V10-OBS-02** — Gate scripts wired correctly. Positive observation.

### Test-engineer lens

- **T10-INFO-01** — Optional page-level integration test asserting
  JSON-LD is omitted on `?tags=foo` and present on the unfiltered
  home page. Severity LOW. Reason: gate is a 1-token boolean,
  `safe-json-ld.test.ts` covers escape-correctness, no SEO-tag e2e
  suite by convention. Repo policy explicitly allows deferral of
  LOW-coverage tests with documented re-open criterion. Re-open
  criterion: a future change reintroduces JSON-LD on the filtered
  view (e.g., refactor moves `galleryLd` outside the guard) and a
  reviewer flags it.

### Tracer lens

- **TR10-INFO-01** — Reserved-segment short-circuit confirmed safe.
  Positive observation.

### Architect lens

- **A10-INFO-01** — `safeJsonLd`, `getCspNonce`, `localizeUrl`,
  `getOpenGraphLocale`, `parseRequestedTagSlugs`,
  `filterExistingTagSlugs` import-level duplication across
  `(public)/page.tsx` and `(public)/[topic]/page.tsx`. Severity LOW.
  Reason: each route owns its metadata; duplication is small and
  intentional. Re-open criterion: a third public top-level route
  page emerges with the same metadata pattern, at which point a
  shared helper is worth extracting.

### Debugger lens

- **D10-INFO-01** — `images` fetched even when JSON-LD gate is off.
  Severity LOW (deliberate). No re-open criterion.

### Document-specialist lens

- **DS10-INFO-01** — No doc drift. Positive observation.
- **DS10-INFO-02** — Plan-238 archived correctly. Positive
  observation.

### Designer lens

- **DSGN10-INFO-01** — OG `/api/og` topic-label CJK-overflow and
  platform-font fallback. Severity LOW. Carried from cycle 9. Reason
  for deferral: visual fidelity nit for a fallback path; OG image is
  itself a fallback when `seo.og_image_url` is unset, double-fallback
  visual polish is low ROI. Re-open criterion: an admin reports OG
  topic preview overflow on social cards.

## Repo-policy compliance

- **Security/correctness/data-loss not deferrable unless explicitly
  allowed**: none of the items above are security, correctness, or
  data-loss defects. The two security-lens items are positive
  observations on already-validated state.
- **Severity preserved**: all items recorded at original LOW
  severity; none downgraded.
- **Re-open criteria**: every item has either a positive-observation
  classification or an explicit re-open criterion.
- **Citations**: every actionable item carries file+line citations
  pointing at the current HEAD `24c0df1`.

## Status

This is a **record-only** plan file. No implementation work scheduled.
The cycle-10 loop closes with `NEW_FINDINGS: 0`, `COMMITS: 0`,
`DEPLOY: none-no-commits`.
