# Cycle 91 Product Marketer Reviewer

Perspective: product-marketing and claim-truthfulness review for GalleryKit as a self-hosted finished-photo publishing gallery.

HEAD reviewed: `c648634b666f59c29cfe40ea5bbd547bc98d1885`.

## Executive Summary

No confirmed product-marketing or claim/implementation mismatch was found in this pass. The public README positions GalleryKit narrowly as self-hosted finished-photo publishing, explicitly says it is not editing/culling/scoring software, and treats semantic search as disabled-by-default/operator-enabled. In-app copy mirrors that restraint with stub/production disclaimers. Market-readiness risk is mostly validation and demonstration, not overclaiming.

## Confirmed Findings

No confirmed product-marketing findings.

## Claim-Truthfulness Evidence

Positioning:

- README hero describes a self-hosted gallery for finished photography with color-managed delivery, private originals, and operator-controlled search (`README.md:8`).
- README narrows the target and avoids SaaS/AI overclaiming: originals stay private, semantic search is behind explicit setup, analytics are first-party by default (`README.md:29`).
- README explicitly says "Not for: editing, culling, scoring, proofing, payment, or hosted SaaS workflows" (`README.md:31`, `README.md:32`) and repeats that GalleryKit is not a photo editor/culler/scoring tool (`README.md:46`).

Semantic-search / AI claims:

- README labels semantic search as self-hosted/operator-enabled, disabled by default, requiring model download, backfill, and env opt-in (`README.md:42`).
- App README documents modes and calls stub vectors non-meaningful/demo-only (`apps/web/README.md:67`).
- Admin UI does not offer one-click production activation; production is shown only as operator-gated/read-only (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:806`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:808`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:814`).
- Public search copy shows stub and production limitations when semantic search is enabled (`apps/web/src/components/search.tsx:546`, `apps/web/src/components/search.tsx:550`, `apps/web/src/components/search.tsx:555`).

Lightroom/external-client claims:

- README says the admin dashboard has a PAT-authenticated upload API and no bundled Lightroom Classic plugin (`README.md:44`).
- App README repeats the same API-not-plugin stance (`apps/web/README.md:99`).

Version/platform claims:

- README badges claim Next.js 16, React 19, TypeScript 6 (`README.md:12`, `README.md:13`, `README.md:14`), matching `apps/web/package.json` dependencies/devDependencies (`apps/web/package.json:57`, `apps/web/package.json:61`, `apps/web/package.json:84`).

## Likely / Manual-Validation Risks

### MV-PM-C91-01 - Live demo/current deployment claims were not browser-verified

Severity: LOW
Confidence: Medium

The repository copy is claim-safe from source evidence, but I did not verify the live demo or deployed database/runtime state. The repo itself warns that production semantic search depends on DB row, env opt-in, seeded weights, and embeddings, and that repo code does not prove the current live row count (`CLAUDE.md:159`). A live marketing review should verify the demo’s actual Settings/search state before public copy implies semantic search is active.

Concrete validation follow-up:

In a safe non-production or approved live-demo check, open the public search UI, confirm whether semantic search is disabled/stub/production, and compare visible copy against README language. Do not claim "AI search available" on a specific deployment unless the UI is in production mode with real embeddings.

## Recommendations

- Keep the current "finished-photo publishing, not culling/editing" positioning. It prevents mismatch with the product contract and avoids attracting users expecting Lightroom/Aftershoot-style workflows.
- Preserve the semantic-search honesty hierarchy: disabled by default, stub labelled as non-semantic demo, production operator-gated, bounded newest-first scan disclosed.
- Add launch/demo proof only after live browser validation: short screen recordings of upload, public gallery, color details, sharing, and search state would be stronger than broader feature claims.

## Missed-Issue Sweep

Reviewed README/app README/CLAUDE/site config/messages/search/settings/admin upload language and package metadata. No confirmed marketing/doc claim mismatch found. Browser/live-demo validation was not performed in this bounded lane.
