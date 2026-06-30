# Cycle 50 UI / UX / Photographer Review

Review date: 2026-07-01
Lane: UI/UX, accessibility, responsive states, i18n, and photographer-facing product risk.
Baseline: `3a02f7ee` at cycle start; `646d98c9` only added the Cycle 50 perf review artifact.

## Inventory

- Product and UX contracts: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/reviews/cycle-49-2026-07-01/_aggregate.md`, `.context/plans/cycle-49-2026-07-01-deferred.md`.
- Public browsing surfaces: `apps/web/src/app/[locale]/(public)/page.tsx`, `p/[id]/page.tsx`, `g/[key]/page.tsx`, `s/[key]/page.tsx`, `c/[slug]/page.tsx`, `map/page.tsx`, `timeline/page.tsx`, `year/[year]/page.tsx`.
- Core components: `photo-viewer.tsx`, `lightbox.tsx`, `lightbox-color-pip.tsx`, `color-details-section.tsx`, `grid-picture.tsx`, `home-client.tsx`, `load-more.tsx`, `nav.tsx`, `search.tsx`, `wide-gamut-hint.tsx`.
- Admin UI surfaces: dashboard upload, settings, categories, tags, users, tokens, SEO, DB restore pages under `apps/web/src/app/[locale]/admin/(protected)/`.
- UI guard tests: `touch-target-audit.test.ts`, `focus-visible-rings-cycle19.test.ts`, `focus-visible-links-scan.test.ts`, `privacy-page-landmark.test.ts`, `info-bottom-sheet-ia.test.ts`, `search-disclaimer.test.ts`, `free-download-contract.test.ts`, `photo-viewer-no-hdr-download.test.ts`.
- Messages: `apps/web/messages/en.json`, `apps/web/messages/ko.json`.

## Findings

No new actionable UI/UX, accessibility, i18n, or photographer-facing product findings.

## Evidence

- Touch-target policy remains guarded by `apps/web/src/__tests__/touch-target-audit.test.ts`, which recursively scans public/admin TSX surfaces and fails new sub-44 px interactive controls.
- Focus-visible coverage remains source-pinned through `focus-visible-rings-cycle19.test.ts` and `focus-visible-links-scan.test.ts`; I found no new focus-trap or keyboard-only route introduced since Cycle 49.
- Cycle 49 copy changes correctly distinguish public P3 chip visibility from admin-only HDR audit details in `apps/web/messages/en.json` and `apps/web/messages/ko.json`; no contradictory UI text was found in the inspected color/HDR components.
- Photographer product boundaries remain intact: `CLAUDE.md` and `free-download-contract.test.ts` still prohibit paid downloads, and no edit/culling/scoring surface was found in the current public or admin UI inventory.
- The normal public photo route remains eligible for offline HTML fallback in the service worker, preserving photographer-facing browsing continuity. The verifier lane filed a test-strength gap for concrete classifier behavior, so I do not duplicate it here.

## Not Re-raised

The Cycle 49 carry-forward deferred items remain unchanged: `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, and `AGG-C38-08`. None is newly UI/UX-scheduled by this review.

## Validation Limits

This lane used static inspection and existing UI/accessibility guard tests. I did not start a browser server because the only actionable Cycle 50 issue found by the broader review was a source-level service-worker regression test gap, not a rendered UI defect.

## Finding Count

0
