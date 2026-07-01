# Cycle 62 Photographer Product / Critic Review

Reviewer: photographer-product/critic
Date: 2026-07-01
Scope: read/review subtask for the review-plan-fix workflow.

## Required Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-61-2026-07-01-plan.md`
- `.context/plans/cycle-61-2026-07-01-deferred.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/cycle-61-2026-07-01/_aggregate.md`
- Current Cycle 62 peer reviews present in `.context/reviews/cycle-62-2026-07-01/`

Cycle 61 deferred only broad test-depth gaps (`C61-06`, `C61-07`) plus carry-forward items. I did not re-raise those without new severity evidence.

## Product-Facing Inventory

- Public gallery/photo/share: `app/[locale]/(public)/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, `components/home-client.tsx`, `components/photo-viewer.tsx`, `components/lightbox.tsx`, `components/info-bottom-sheet.tsx`, `components/photo-navigation.tsx`, `lib/data.ts`.
- Color/HDR intent surface: `components/color-details-section.tsx`, `components/lightbox-color-pip.tsx`, `components/wide-gamut-hint.tsx`, `components/histogram.tsx`, `lib/process-image.ts`, `lib/color-detection.ts`, `lib/color-primaries.ts`, `lib/color-pipeline-decisions.ts`, `lib/gallery-config*.ts`, `lib/settings-hash.ts`.
- Search/discovery: `components/search.tsx`, `components/similar-photos.tsx`, `app/actions/public.ts`, `app/api/search/semantic/route.ts`, `app/api/search/similar/[id]/route.ts`, `lib/search-enrichment-fields.ts`, `lib/clip-*`.
- Admin operator settings/upload: `app/[locale]/admin/(protected)/settings/*`, `app/actions/settings.ts`, `app/actions/images.ts`, `app/actions/embeddings.ts`, `app/api/admin/lr/upload/route.ts`, `scripts/download-clip-models.ts`, `scripts/backfill-clip-embeddings.ts`, `scripts/backfill-color-pipeline.ts`.
- Copy/docs/i18n/runbooks: `apps/web/messages/{en,ko}.json`, `apps/web/README.md`, `CLAUDE.md`.

## Findings

### C62-PPC-01 - Public keyword search returns a generic failure state on normal deployed queries

- Severity: Medium
- Confidence: High for deployed user-visible failure; Medium for root cause because this review lane did not inspect production server logs.
- File/line: `apps/web/src/components/search.tsx:240`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:473`, `apps/web/src/app/actions/public.ts:305`, `apps/web/src/app/actions/public.ts:315`, `apps/web/src/lib/data.ts:1521`, `apps/web/src/lib/data.ts:1576`, `apps/web/messages/ko.json:425`, `apps/web/messages/en.json:425`.
- Evidence: Headless Playwright against `https://gallery.atik.kr/ko` opened the public search dialog, typed `TWS`, and captured the server-action response from `https://gallery.atik.kr/ko` as `{"status":"error","results":[]}`. The dialog rendered `검색을 잠시 사용할 수 없습니다. 나중에 다시 시도해 주세요.` twice: once in the polite live region and once in the visible status block.
- Scenario: A visitor or client searching for a performer, tag, camera, or title on the public gallery receives a system-failure message instead of either matching photos or an honest no-results state. For a photographer-facing gallery, this makes discovery look broken even while the photo grid and semantic-search toggle are visible.
- Suggested fix: Inspect the production `searchImagesAction failed:` log and fix the underlying `searchImages()` query/runtime failure. Add a regression that exercises a known public fixture/query through `searchImagesAction()` or the rendered search flow and asserts `{ status: 'ok' }` with results. After the functional fix, dedupe the status announcement so the same error is not exposed twice in the dialog accessibility tree.

## Confirmed Non-Findings

- No product edit/culling/scoring feature was found. The surfaced "bulk edit" strings and components are metadata-management only, while semantic scores stay internal and are stripped from public responses (`app/api/search/semantic/route.ts:313`, `app/api/search/semantic/route.ts:363`).
- Public/private metadata separation remains explicit: public selects omit GPS, original filenames, ICC profile names, HDR internals, processing state, and pipeline internals (`lib/data.ts:375`, `lib/data.ts:406`, `lib/data.ts:473`, `lib/data.ts:476`). Semantic/similar result enrichment uses a separate compile-guarded public shape (`lib/search-enrichment-fields.ts:29`, `lib/search-enrichment-fields.ts:43`).
- Color/HDR public honesty is preserved in reviewed render paths: public rows can show primaries and delivered-bit-depth info, while HDR badges, transfer function, gain-map, source bit depth, and pipeline decision stay admin-gated (`components/color-details-section.tsx:201`, `components/color-details-section.tsx:544`, `components/color-details-section.tsx:568`; `components/lightbox-color-pip.tsx:51`, `components/lightbox-color-pip.tsx:84`).
- Admin/operator UX for HDR and semantic search remains honest: HDR ingest copy says public derivatives are still SDR (`messages/en.json:771`, `messages/ko.json:771`), and Settings renders production semantic search as operator-enabled or stored-inactive rather than a one-click UI mode (`settings-client.tsx:791`, `settings-client.tsx:827`, `app/actions/settings.ts:66`, `apps/web/README.md:74`).
- Share pages keep key validity and image-specific metadata out of unthrottled metadata generation, rate-limit the body lookup once, and render shared views without admin-only controls (`s/[key]/page.tsx:44`, `s/[key]/page.tsx:98`, `g/[key]/page.tsx:49`, `g/[key]/page.tsx:104`, `photo-viewer.tsx:770`).

## Validation

- Browser replay: `https://gallery.atik.kr/ko` mobile viewport, search query `TWS` -> server-action HTTP 200 payload `{"status":"error","results":[]}` and visible Korean generic failure copy.
- Source review only for color/HDR/share/admin settings; no local full test suite was run in this reviewer lane.
