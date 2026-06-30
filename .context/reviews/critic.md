# Cycle 30 Critic Review

Reviewer: critic
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30
Scope: Prompt 1 review only. No product-code fixes.

## Executive Summary

GalleryKit's core product boundary is strong: it is a self-hosted finished-photo gallery, not an editor, culler, proofing system, payment surface, or hosted SaaS. The main current risks are not conceptual drift; they are reliability and trust gaps in public surfaces that are positioned as product strengths. Live browser inspection of `https://gallery.atik.kr/en` found keyword search returning `{"status":"error","results":[]}` for a normal visible query, while source review confirmed that share links still lack a management/revocation UI and the public map can still serialize/render up to 10,000 GPS items in one request. Overall critic verdict: usable product foundation, but launch/demo trust is weakened by search failure, share lifecycle incompleteness, and scale-sensitive public UI paths.

## Review Evidence

- Read `AGENTS.md`, `CLAUDE.md`, current review aggregate, assigned reviewer prompts, app docs, messages, public/admin routes, data/search/share/map code, and relevant tests/history.
- Used Playwright headless against the live demo for `/en`, `/ko`, `/en/privacy`, `/en/map`, and `/en/timeline` at desktop and mobile sizes.
- Live public pages rendered without page errors. Sampled controls met 44 px targets. `/en/map` currently has zero public GPS markers.
- Live keyword search on `/en` for `JIHOON` posted to `https://gallery.atik.kr/en` and returned a Next server-action payload: `1:{"status":"error","results":[]}`. The dialog displayed "Search failed. Please try again."
- Skipped production admin mutation and login flows to avoid changing live state.

## Findings

### C30-CRIT-01 - Live keyword search fails for normal visible gallery terms

Severity: High
Confidence: High for live symptom, Medium for root cause
Region: `apps/web/src/components/search.tsx:240-248`, `apps/web/src/components/search.tsx:473-476`, `apps/web/src/app/actions/public.ts:305-316`, `apps/web/src/lib/data.ts:1545-1621`, `apps/web/messages/en.json:421-424`

Failure scenario: A visitor opens the live demo, sees many photos titled/tagged with `JIHOON`, searches for `JIHOON`, and receives a generic failure state rather than results. This directly weakens the README feature claim that keyword search covers titles, descriptions, cameras, and tags.

Suggested fix: Inspect production logs for the caught `searchImagesAction failed` error, then add a regression test that exercises `searchImagesAction()` against seeded topic/tag/title data under the deployed SQL mode. Improve the client status mapping so expected setup/DB/query failures return actionable copy instead of a generic retry message.

### C30-CRIT-02 - Public map still has a one-request/one-DOM-node-per-marker scale cliff

Severity: Medium
Confidence: High
Region: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:41-60`, `apps/web/src/app/[locale]/(public)/map/page.tsx:87-99`, `apps/web/src/components/map/map-client.tsx:86-90`, `apps/web/src/components/map/map-client.tsx:119-140`

Failure scenario: An operator enables public GPS on a large topic. `/map` fetches up to 10,000 rows, serializes every marker to the client, computes bounds by materializing latitude/longitude arrays, mounts one Leaflet marker per row, and renders one fallback link per row. A mobile browser or assistive-tech session can freeze even though the live demo currently has zero public markers.

Suggested fix: Add server-side viewport/bounds pagination or marker clustering before raising GPS usage. As a near-term safety step, lower the initial cap and show a truncation notice, then virtualize or paginate the fallback list.

### C30-CRIT-03 - Share links can be created from UI but not listed or revoked from UI

Severity: Medium
Confidence: High
Region: `apps/web/src/components/photo-viewer.tsx:586-618`, `apps/web/src/components/image-manager.tsx:194-210`, `apps/web/src/app/actions/sharing.ts:317-397`, `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:204-235`

Failure scenario: An admin creates a per-photo or group share link, later learns it was forwarded outside the intended audience, and cannot find a production UI to list active links or revoke/delete them. Server actions for revocation/deletion exist, and analytics can deep-link top shared groups, but the creation surfaces only copy URLs and clear selection.

Suggested fix: Add an admin share-management surface that lists active per-photo and group links, created time, view counts, copy/open actions, and revoke/delete actions. Until then, update share toasts/docs to state that UI revocation is not yet exposed.

### C30-CRIT-04 - Semantic and similar search remain request-thread brute-force paths

Severity: Medium
Confidence: High
Region: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:270-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:168-201`, `README.md:41-42`, `apps/web/README.md:60-70`

Failure scenario: An operator markets semantic search, raises `SEMANTIC_SCAN_LIMIT` for recall, and concurrent public requests decode/score thousands of vectors synchronously on the Node request thread. SSR, admin actions, upload polling, and queue timers can see avoidable latency.

Suggested fix: Keep current honesty copy, but add an event-loop-safe scoring path before promoting semantic search as a production differentiator for large galleries: worker thread, ANN/vector index, chunked yielding, or a lower per-request hard cap plus global concurrency gate.

### C30-CRIT-05 - Generic route error shell hides product-specific recovery context

Severity: Low-Medium
Confidence: Medium
Region: `apps/web/src/app/[locale]/error.tsx:22-57`, `apps/web/src/app/[locale]/(public)/page.tsx:161-178`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-94`

Failure scenario: A transient DB failure on a public page drops visitors into a generic "Something went wrong loading this page" shell with only Home/Try Again. They cannot tell whether photos are empty, maintenance is active, search is unavailable, or the gallery is broken.

Suggested fix: Use page-level expected-failure boundaries for public data reads where possible: a localized "gallery temporarily unavailable" state inside the normal public shell, preserving navigation/search/theme/locale when those can be resolved safely.

## Multi-Perspective Critique

- Information architecture: Public browsing is clear for home/topic/photo/timeline/privacy, but share lifecycle IA is incomplete because creation is visible and revocation is hidden.
- Affordances: Search, theme, locale, tags, load-more, photo links, map skip link, and GPS publish confirmation are clear. The generic search error gives no next action.
- Keyboard/focus: Public nav/search/lightbox have visible focus and shortcut affordances. Search results use a combobox/listbox pattern with arrow/Enter instructions, but the current live failure prevents that path from proving value.
- WCAG 2.2: Touch target evidence is good. Map fallback can become an accessibility problem at scale because thousands of links are exposed in one list.
- Responsive states: Desktop/mobile live pages render. The risk is data volume rather than breakpoint layout.
- Loading/empty/error: Map empty state is clear. Search error and route error are too generic.
- Forms: Admin mutation forms were source-reviewed only; no production admin mutation was performed.
- i18n/RTL: English and Korean messages have parity; RTL is not implemented or claimed.
- Perceived performance: Masonry first page is usable on live demo; map and vector search have scale cliffs.
- Product-message alignment: "Not editing/culling/scoring" is aligned. Search/share claims need lifecycle/runtime reliability work.

## Checked Clean / Not Re-filed

- GPS public-map toggle now has an explicit confirmation dialog in `topic-manager.tsx:290-321` and localized consequence copy in `apps/web/messages/en.json:110-113`.
- Privacy copy now discloses short-lived full-IP rate-limit buckets in both English and Korean at `apps/web/messages/en.json:811-812` and `apps/web/messages/ko.json:811-812`.
- Rate-limit cleanup now has a `bucketStart` index at `apps/web/src/db/schema.ts:217-220` and bounded cleanup code in `apps/web/src/lib/rate-limit.ts:522+`.
- The app README now warns to review GPS stripping before any real upload at `apps/web/README.md:24`.

## Skipped Areas

- Did not log into the live admin UI or create/revoke real share links.
- Did not inspect gitignored production env, DB rows, upload files, or server logs.
- Did not run full lint/typecheck/test gates because this turn writes review artifacts only.

## Final Sweep

Final sweep covered public IA, map, search, semantic/similar routes, share actions, admin analytics, privacy copy, README/app README claims, loading/error states, i18n messages, focus/touch affordances, and current review history. Findings above are the confirmed current issues for this perspective.
