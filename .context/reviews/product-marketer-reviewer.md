# Cycle 32 Product Marketer Review

Custom reviewer prompt was readable at `/Users/hletrd/.codex/agents/product-marketer-reviewer.md`. The prompt is BurstPick-specific, so this pass uses only its strategic reviewer lens: claims must be code/doc verified, trust gaps matter more than generic marketing polish, and product positioning should not imply unshipped capabilities. GalleryKit code and docs were reviewed read-only except for this report.

## Executive Summary

GalleryKit's public positioning is mostly honest and stronger than a generic gallery pitch: "self-hosted finished-photo publishing with color-managed delivery, private originals, and operator-controlled search" is backed by implementation and by unusually careful README caveats. I found no critical false claims. The main trust risk is that privacy-sensitive operators can still miss the first-upload GPS/original-retention decision because the top-level "private originals" promise appears before the docs explain that GPS stripping is off by default. Market/readiness score: 7.5/10 for a self-hosted operator audience, with doc tightening needed before broader public positioning.

## Scope And Evidence

- Required context read: `AGENTS.md`, `CLAUDE.md`, and the local product-marketer reviewer profile.
- Public/product surfaces reviewed: root README, app README, public privacy copy, search UI, semantic/similar routes, settings UI, token/upload API UI, data selectors, map GPS gate, package metadata.
- No code was changed. Only this file was updated.

## Findings

### PM-32-01: "Private originals" is true, but the GPS-retention default is not front-loaded

- Severity: Medium
- Confidence: High
- Evidence: The README leads with "private originals" and "without handing originals or AI features to a hosted SaaS" at `README.md:8` and `README.md:29`, and lists GPS under EXIF extraction at `README.md:40`. The actual default is `strip_gps_on_upload: 'false'` in `apps/web/src/lib/gallery-config-shared.ts:93` through `apps/web/src/lib/gallery-config-shared.ts:105`. The app README warns operators to decide before real upload because GPS stripping locks once photos exist at `apps/web/README.md:24`. Settings copy says stripping only happens when enabled and existing images are unchanged at `apps/web/messages/en.json:739` through `apps/web/messages/en.json:745`. Upload copy warns that if GPS stripping is off, first-upload originals retain location metadata at `apps/web/messages/en.json:173` through `apps/web/messages/en.json:177`.
- Consequence: A privacy-sensitive photographer/operator can reasonably read "private originals" as "safe originals" and only later discover that retained originals may still contain GPS unless the setting was enabled before the first real upload. That is not a code defect, but it is a trust and onboarding-risk defect.
- Fix: In the root README opening or immediately after the For/Not-for block, add a short "First upload privacy decision" note: private originals are not publicly served, but GPS stripping is off by default and must be enabled before uploading location-sensitive originals. Keep the existing app README and settings warnings.

### PM-32-02: External upload API is accurately bounded, but the legacy `lr` namespace can imply Lightroom feature parity

- Severity: Low
- Confidence: High
- Evidence: Public docs correctly say the route is an API contract, not a bundled Lightroom Classic plugin at `README.md:207` and `README.md:212` through `README.md:216`, and the app README repeats that the route accepts only `file`, `topic`, optional `title`, and optional `description` at `apps/web/README.md:87` through `apps/web/README.md:96`. The route itself is named `POST /api/admin/lr/upload` and describes "Lightroom-compatible implementations" while explicitly saying no plugin is bundled at `apps/web/src/app/api/admin/lr/upload/route.ts:1` through `apps/web/src/app/api/admin/lr/upload/route.ts:19`. The token model still exposes `lr:upload`, `lr:read`, and `lr:delete` scopes, with only `lr:upload` shipped today, at `apps/web/src/lib/admin-tokens.ts:25` through `apps/web/src/lib/admin-tokens.ts:29`. The admin token UI creates only `lr:upload` tokens at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:58` through `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:62`, while visible copy says no Lightroom plugin is distributed at `apps/web/messages/en.json:837` through `apps/web/messages/en.json:839`.
- Consequence: The copy is honest, but the path/scope namespace can still lead integrators to expect Lightroom-specific metadata handling or read/delete client APIs that do not exist yet. That is a support and expectation-setting risk more than a product readiness blocker.
- Fix: Document `lr` as a legacy namespace for external publish clients, not a promise of Lightroom feature parity. Consider a future alias such as `/api/admin/upload` and neutral scopes (`upload:write`) before wider API marketing. Until then, keep "no bundled Lightroom Classic plugin" and "only these fields are consumed" close to every endpoint example.

### PM-32-03: Semantic search positioning is implementation-backed and should stay operator-first

- Severity: Positive finding
- Confidence: High
- Evidence: The root README states that semantic search is self-hosted, disabled by default, requires model download/backfill/env opt-in, and scans bounded newest-first embeddings rather than a vector index at `README.md:42`. The app README gives the same constraints plus model/version, mode, offline weights, concurrency, and no-empty-production honesty gates at `apps/web/README.md:60` through `apps/web/README.md:81`. The public route returns 503 unless mode is `stub` or `production` at `apps/web/src/app/api/search/semantic/route.ts:186` through `apps/web/src/app/api/search/semantic/route.ts:204`; production rows are filtered by model version at `apps/web/src/app/api/search/semantic/route.ts:247` through `apps/web/src/app/api/search/semantic/route.ts:287`. Similar photos are production-only at `apps/web/src/app/api/search/similar/[id]/route.ts:110` through `apps/web/src/app/api/search/similar/[id]/route.ts:126`. The public search UI shows the semantic toggle only when not disabled and displays stub/production caveats at `apps/web/src/components/search.tsx:491` through `apps/web/src/components/search.tsx:527`. The admin settings UI exposes Disabled/Stub only and warns on stored production values at `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:748` through `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:797`.
- Consequence if regressed: If future copy markets "AI search" without these gates, photographers/operators will infer hosted AI, magic recall, or default readiness that the product deliberately avoids.
- Fix: Keep "operator-controlled search" as the primary positioning phrase. Use "AI" only after the setup caveat, model identity, local/offline inference boundary, and newest-first scan limitation.

### PM-32-04: Public privacy claims match implementation and are a differentiator

- Severity: Positive finding
- Confidence: High
- Evidence: Public selectors omit GPS, original filenames, internal processing state, ICC profile names, source bit depth, and other admin-only fields at `apps/web/src/lib/data.ts:368` through `apps/web/src/lib/data.ts:408`, with compile-time privacy guards at `apps/web/src/lib/data.ts:459` through `apps/web/src/lib/data.ts:488`. Public search uses a narrow result shape and guards against privacy-sensitive additions at `apps/web/src/lib/data.ts:1490` through `apps/web/src/lib/data.ts:1554`; the query searches public metadata and tags/topics at `apps/web/src/lib/data.ts:1565` through `apps/web/src/lib/data.ts:1641`. The public map is the only GPS exposure path and requires `topics.map_visible = true` plus a runtime guard at `apps/web/src/lib/data.ts:1669` through `apps/web/src/lib/data.ts:1717`. Photo viewer GPS display is admin-gated at `apps/web/src/components/photo-viewer.tsx:875` through `apps/web/src/components/photo-viewer.tsx:895`. Privacy page copy discloses first-party analytics, optional GA, GPS map gating, and rate-limit IP buckets at `apps/web/messages/en.json:806` through `apps/web/messages/en.json:814`.
- Consequence if regressed: The product would lose its strongest operator-trust wedge against hosted gallery SaaS: private originals, explicit metadata boundaries, and no surprise GPS exposure.
- Fix: Preserve this as a positioning pillar. In public docs, say "private originals and explicit metadata boundaries" rather than only "self-hosted"; the implementation supports the stronger trust claim.

### PM-32-05: README feature copy has minor polish debt that weakens an otherwise precise positioning surface

- Severity: Low
- Confidence: High
- Evidence: The feature list includes both "Categories & Sharing" and a separate "Sharing" bullet at `README.md:39` and `README.md:44`. The "not a photo editor, culler, or scoring tool" sentence is excellent, but it is placed between feature bullets before "Internationalization" and "Docker Support" at `README.md:45` through `README.md:49`, making the list read like an interrupted edit.
- Consequence: This does not mislead users, but it makes the top-level positioning look less curated than the underlying implementation. For a trust-led self-hosted tool, README clarity is part of the product surface.
- Fix: Merge the two sharing bullets, keep the Not-for sentence as its own short "Boundaries" paragraph, and keep feature bullets strictly feature-shaped.

## Positioning Verdict

Recommended positioning: "GalleryKit is a self-hosted publishing gallery for finished photography where originals stay private, color delivery is explicit, and search/AI features remain operator-controlled."

The code supports that sentence. The docs should keep avoiding claims around editing, culling, scoring, payment, hosted SaaS workflows, S3/MinIO switching, full offline sync, and bundled Lightroom plugins. The next marketing improvement is not louder copy; it is tighter operator onboarding around first-upload privacy, semantic-search activation, and external-upload expectations.
