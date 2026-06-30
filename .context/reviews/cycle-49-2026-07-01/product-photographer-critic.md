# Cycle 49 Product / Photographer / Critic Review

Date: 2026-07-01
Head: `dc4f4acf`
Scope: review-only; no application source files edited.
Perspective: critic + photographer-facing product reviewer + product risk reviewer.

## Inventory Examined

Required context:

- `AGENTS.md` - git/deploy rules, privacy-field checklist, quality gates, color/HDR convention, no edit/culling/scoring product rule.
- `CLAUDE.md` - product overview, security/privacy model, Color & HDR Pipeline, share semantics, service-worker/PWA contract, operational/deferred context.
- `.context/plans/README.md` - active/recent cycle state and carry-forward guidance.
- `.context/reviews/_aggregate.md` and `.context/reviews/cycle-48-2026-07-01/_aggregate.md` - latest aggregate, Cycle 48 scheduled item, carried-forward deferred items.
- Cycle 49 sibling artifacts: `code-security-performance.md`, `docs-deploy-drift.md`, `verifier-test-debugger.md`.

Product/source files:

- `README.md` - public product positioning: finished-photo publishing, no editing/culling/scoring/proofing.
- `apps/web/messages/en.json`, `apps/web/messages/ko.json` - photographer/admin copy for uploads, color/HDR, semantic search, privacy, sharing.
- `apps/web/src/lib/data.ts` - public/admin select fields, map-visible GPS exception, share and smart-collection data access.
- `apps/web/src/lib/search-enrichment-fields.ts` - public semantic/similar search enrichment select.
- `apps/web/src/__tests__/privacy-fields.test.ts` - symmetric privacy guard fixture.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` - public photo page metadata, JSON-LD, viewer props, view recording.
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` - single-photo share noindex metadata and rate-limited key lookup.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` - shared group noindex metadata, rate-limited key lookup, group view semantics.
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` - public smart collection visibility, metadata, JSON-LD.
- `apps/web/src/app/[locale]/(public)/map/page.tsx` - explicit public GPS map exception.
- `apps/web/src/app/actions/sharing.ts` - admin-only share creation/revocation, share-key rate limits, audit fingerprints.
- `apps/web/src/app/actions/images.ts` - metadata-only image updates, bulk metadata/tag/alt-hint operations.
- `apps/web/src/app/actions/collections.ts` and `apps/web/src/lib/smart-collections.ts` - smart-collection write validation and allowlisted public compiler.
- `apps/web/src/app/api/search/semantic/route.ts` and `apps/web/src/components/search.tsx` - public semantic search gating, rate limits, setup/stub hints.
- `apps/web/src/components/photo-viewer.tsx`, `info-bottom-sheet.tsx`, `lightbox-color-pip.tsx`, `color-details-section.tsx`, `wide-gamut-hint.tsx`, `home-client.tsx`, `image-manager.tsx`, `bulk-edit-dialog.tsx` - photo viewing, color/HDR audit, public/admin download labels, admin metadata UI.
- `apps/web/src/lib/download-labels.ts`, `image-url.ts`, `use-display-capability.ts`, `gallery-config-shared.ts` - color/download/display/config helpers.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` - admin color/HDR/search/privacy settings UI.
- `apps/web/src/app/[locale]/globals.css` - P3/HDR chip visibility CSS.
- `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/__tests__/sw-template-contract.test.ts` - shipped service-worker route classification and tests.
- Focused tests: `photo-viewer-no-hdr-download.test.ts`, `lightbox-color-pip-hdr.test.ts`, `download-labels.test.ts`.

I did not re-raise carried-forward deferred items `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`; this pass found no new evidence changing their severity or scheduling.

## Findings

### C49-PPC-01 - Public photo pages are excluded from the documented offline fallback

Severity: Medium
Confidence: High

Evidence:

- `CLAUDE.md:422` says dynamic public gallery/photo pages are deliberately cached by `networkFirstHtml()` as an offline-only 24 h fallback, while excluding admin routes, revocable share pages (`/s`, `/g`), smart collections (`/c`), and `/map`.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42` marks the photo page dynamic, matching that documented fallback rationale.
- `apps/web/public/sw.template.js:59-64` and generated `apps/web/public/sw.js:59-64` classify `/p/<id>` as `isRevocableShareHtmlRoute`.
- `apps/web/public/sw.template.js:456-463` bypasses matching HTML requests before they can reach `networkFirstHtml(request)`.
- `apps/web/src/__tests__/sw-template-contract.test.ts:71-75` locks the current mismatch by expecting `p\/\d+` under a test named "bypasses revocable share pages".

Failure scenario:

A visitor opens `/p/123` online, then loses network and returns to that already-visited photo within the 24 h HTML fallback window. The product contract says core gallery/photo pages should have an offline shell; the current service worker bypasses `/p/123`, so the browser falls through to a failed network navigation. That is a trust hit on the main photographer-facing viewing surface, even though cached image derivatives may still exist.

Suggested fix:

Remove the `/p/\d+` branch from `isRevocableShareHtmlRoute` so normal photo pages flow through `networkFirstHtml()`. Keep `/s`, `/g`, `/c`, and `/map` bypassed. Update `sw-template-contract.test.ts` to assert `/p/<id>` and `/{locale}/p/<id>` are not bypassed, then regenerate `apps/web/public/sw.js`. If the actual product decision is that deleted photo pages must never have a 24 h offline fallback, update `CLAUDE.md` and test names to say photo pages are intentionally excluded.

### C49-PPC-02 - "Force Show Color Chips" copy overpromises public HDR badge visibility

Severity: Low
Confidence: High

Evidence:

- The admin Settings UI renders the force-show help text from i18n at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:563-577`.
- English copy says the P3 gamut badge and HDR badge are always visible "regardless of the visitor's display" at `apps/web/messages/en.json:768-769`; Korean says the same visitor-facing promise at `apps/web/messages/ko.json:768-769`.
- The setting only forces display of existing badge elements via CSS (`apps/web/src/app/[locale]/globals.css:160-162`); it does not create HDR metadata or override render gates.
- HDR render points are intentionally admin-gated: `apps/web/src/components/color-details-section.tsx:544-558` and `apps/web/src/components/lightbox-color-pip.tsx:188-194`. The mobile peek chip is also admin-gated at `apps/web/src/components/info-bottom-sheet.tsx:276-280`.
- Public image selects omit the required HDR/source fields (`apps/web/src/lib/data.ts:383-388`, `apps/web/src/lib/data.ts:459-473`), and the focused HDR/download tests passed, confirming the current honesty invariant stays in force.

Failure scenario:

An admin enables "Force Show Color Chips" expecting a public share recipient or Firefox visitor to see HDR metadata. P3 chips can appear, but public HDR badges remain absent because GalleryKit still delivers SDR bytes and intentionally keeps HDR/source fields admin-only. The behavior is correct for color/HDR honesty, but the setting copy makes the product feel inconsistent and can push admins toward the wrong operational expectation.

Suggested fix:

Keep the public HDR gate. Change both locale strings and nearby comments to distinguish the two effects: force P3 gamut chips visible for visitors regardless of display detection, and force admin-only HDR audit badges visible on non-HDR displays. A possible shape: "Shows P3 badges on all displays. For admins, also shows HDR audit badges on non-HDR displays; public HDR badges stay hidden until HDR delivery is supported."

## Validation Evidence

- `npm test --workspace=apps/web -- privacy-fields.test.ts photo-viewer-no-hdr-download.test.ts lightbox-color-pip-hdr.test.ts download-labels.test.ts` passed: 4 files, 33 tests.
- `npm test --workspace=apps/web -- sw-template-contract.test.ts` passed: 1 file, 24 tests, but currently locks the `/p/<id>` bypass behavior described in `C49-PPC-01`.
- Source review found public/share metadata using noindex generic metadata for share keys, rate-limited body lookups for share validity, public select-field privacy guards, admin-only HDR/source metadata gates, and no edit/culling/scoring workflow beyond metadata/tag/share/admin organization actions.

## Findings Count

2
