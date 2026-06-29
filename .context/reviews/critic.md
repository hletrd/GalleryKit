# Cycle 15 Critic Review

Review target: current HEAD `e87d1bc2` in `/Users/hletrd/flash-shared/gallery`.

Role: cycle 15/100 reviewer lane, critic. I reviewed the repository for product invariants, architecture, operational risk, UX, tests, docs, and maintainability. I did not modify source code, migrations, runtime data, dependencies, or deployment configuration. This file is the requested review artifact.

## Inventory First

Required guidance read:
- `AGENTS.md` from the task prompt.
- `CLAUDE.md`.
- Code-review skill instructions.

Repository inventory before findings:
- `git ls-files`: 2554 tracked paths.
- Current source footprint inspected by category: 506 files under `apps/web/src`; 275 test/E2E files under `apps/web/src/__tests__` and `apps/web/e2e`; Drizzle schema/migrations; root and app package/config files; deploy/nginx/Docker scripts; README/CLAUDE docs; current `.context/reviews/*` summaries.
- Working-tree note: other review-lane artifacts were dirty during this pass (`.context/reviews/security-reviewer.md` and `.context/reviews/verifier.md` are currently modified). I did not edit them. Source/docs/tests relevant to the findings were inspected at the current HEAD/worktree state, and source code was otherwise not edited.

Primary source/docs/tests examined:
- Data/query layer: `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, Drizzle migrations.
- Admin recovery and delete paths: `apps/web/src/app/[locale]/admin/(protected)/dashboard/*`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/process-image.ts`, failed-image and cleanup tests.
- Public map path: `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/*`, map privacy tests.
- Search/semantic path: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, CLIP constants/tests, i18n strings, semantic docs.
- Safety surfaces swept: public/admin action exemptions, public route rate-limit annotations, dangerous HTML sinks, test skips/only markers, original upload path helpers, restore scanner, deploy docs, CI workflow.

Validation evidence:
- Static source/doc/test inspection and pattern sweeps only.
- I did not run full lint/typecheck/build/test gates because this was a read-only critique pass with no production code change.

## Findings

Finding count: 4 total.
- Confirmed: 3
- Risk: 1

### CRIT15-01 - Admin failed-image recovery can become unbounded and unindexed

Severity: Medium

Confidence: High

Status: Confirmed

Category: Operational recovery / UX / performance / tests

Code regions:
- `apps/web/src/lib/data.ts:999-1013` defines `getFailedImages()` with `processed = false`, `processing_error IS NOT NULL`, `ORDER BY failed_at DESC`, and no `LIMIT` or pagination.
- `apps/web/src/db/schema.ts:114-120` indexes `images` by processed/capture date, processed/created date, topic, user filename, and uploader, but not by the failed-image recovery predicate/order.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:19-27` fetches `getFailedImages()` in the initial dashboard `Promise.all`.
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:73-120` renders every failed image row and retry button in one panel.
- `apps/web/src/__tests__/failed-image-retry.test.ts:55-68` only source-pins the existence, predicate, and ordering of `getFailedImages`; it does not pin a limit, pagination, count, or index contract.

Failure scenario:
A bad import, unsupported format batch, missing original directory, or corrupted processing setting can permanently fail thousands of rows. The admin dashboard then has to load the full failed set, sort it without a recovery-specific index, serialize all rows to the client, and render one retry control per row before the operator can recover. The page most needed for recovery becomes slow or unusable exactly when failure volume is high.

Fix:
Make failed-image recovery paginated or capped. Return a bounded first page plus a total failed count, add a "view more" or dedicated failed-images route, and add a migration-backed index that supports the predicate and ordering after checking `EXPLAIN` on MySQL. A practical first index to validate is `(processed, failed_at)` or a more selective equivalent that fits MySQL's handling of `processing_error IS NOT NULL`. Add tests that fail if `getFailedImages` loses the limit/pagination contract.

### CRIT15-02 - Public map still ships and mounts up to 10,000 markers in one request

Severity: Medium

Confidence: High

Status: Confirmed

Category: Public UX / architecture / operational risk

Code regions:
- `apps/web/src/lib/data.ts:1640-1649` documents `MAP_MAX_MARKERS = 10000` as a personal-gallery cap and says viewport filtering/clustering is out of scope.
- `apps/web/src/lib/data.ts:1658-1676` queries all map-visible GPS images up to that cap, joining topics, filtering processed/GPS/map-visible rows, sorting by capture/created/id, and returning the full result.
- `apps/web/src/db/schema.ts:114-120` has no GPS/map-oriented image index and no index that directly serves the joined map predicate/order.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50` loads all map images and maps the entire result into marker props during the RSC render.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:67-79` server-renders one list link per marker below the map.
- `apps/web/src/components/map/map-client.tsx:76-93` computes fit bounds over every marker, and `apps/web/src/components/map/map-client.tsx:119-143` mounts one Leaflet `Marker` and `Popup` per marker.
- `apps/web/src/__tests__/map-privacy.test.ts:1-90` verifies privacy filtering but does not exercise the marker-count, payload-size, or DOM-mount budget.

Failure scenario:
If a travel/event gallery opts a large GPS-bearing topic into the public map, every `/map` hit can perform an expensive query/sort, ship a large marker payload, server-render thousands of fallback links, then mount thousands of Leaflet markers on the client. On mobile this can look like a blank or frozen page; on the server it is a public unauthenticated route that can generate repeated DB and rendering pressure.

Fix:
Move from "all public markers at once" to a viewport/bounds API with clustering or tile-like pagination. Keep an explicit small SSR fallback list, and fetch markers for the visible bounds client-side with a hard per-request cap. Add database support for the chosen access pattern, such as a denormalized map-visible image projection or indexes validated with `EXPLAIN`. Add tests/source contracts that pin the lower SSR payload cap and clustering/bounds behavior so the route cannot silently return to a 10k all-at-once model.

### CRIT15-03 - Batch delete repeats full derivative-directory scans per image and format

Severity: Medium

Confidence: High

Status: Confirmed

Category: Maintainability / filesystem operations / admin UX

Code regions:
- `apps/web/src/lib/process-image.ts:586-627` performs a full `fs.opendir` scan whenever `sizes` is empty, collecting old size variants by filename prefix.
- `apps/web/src/lib/process-image.ts:632-643` documents that empty `sizes` intentionally triggers the full directory scan to catch orphaned variants from old configurations.
- `apps/web/src/app/actions/images.ts:688-698` passes `[]` for webp, avif, and jpeg cleanup after a single delete, causing three directory scans for one image.
- `apps/web/src/app/actions/images.ts:807-845` batch deletion bounds image concurrency, but each image still runs three full derivative directory scans; the comments acknowledge the fan-out but only reduce concurrency.

Failure scenario:
An admin selects 200 old images for deletion from a gallery with thousands of derivative files. The batch path can run 600 full directory scans across the derivative directories, plus unlink work. Bounded concurrency protects the host from a total stampede, but it does not reduce the repeated O(selected images * directory size) work. On the documented disk-constrained/NAS-style deployment this can make a routine admin cleanup slow, tie up the Next worker, and increase I/O contention with uploads or image processing.

Fix:
Batch derivative cleanup by directory. For `deleteImages`, scan each derivative directory once, build the selected base-name prefixes for all images in the batch, and unlink matching files with bounded unlink concurrency. Keep the strict failure aggregation semantics. For single delete, either keep the current simple scan or route through the same batch helper with one image. Add a unit/source test that batch delete does not call the per-image full-scan helper once per image/format.

### CRIT15-04 - Production semantic search silently searches only the newest capped embedding window

Severity: Medium

Confidence: High

Status: Risk

Category: Product invariant / UX honesty / architecture

Code regions:
- `apps/web/src/lib/clip-embeddings.ts:36-44` defaults `SEMANTIC_SCAN_LIMIT` to 2000 and clamps it to a hard max of 25,000.
- `apps/web/src/app/api/search/semantic/route.ts:261-273` explicitly scans only the most-recent embeddings for the active model and applies `.limit(SEMANTIC_SCAN_LIMIT)` before scoring.
- `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-56` source-pins the scan cap as a DoS/performance protection, not a recall guarantee.
- `apps/web/src/components/search.tsx:460-494` shows a semantic-search toggle and only displays the honesty disclaimer in `stub` mode; production mode has no UI signal that the search scope may be partial.
- `apps/web/messages/en.json:401-416` presents search generally as "Search photos..." and the semantic toggle simply as "Semantic search"; no production string indicates "newest N photos" or incomplete recall.
- `CLAUDE.md:537` documents the runtime limit as a capped newest-first brute-force vector scan, but that operational caveat is not surfaced to visitors or admins at query time.

Failure scenario:
Once the gallery has more production embeddings than `SEMANTIC_SCAN_LIMIT`, a visitor searches for an older photo by concept. The photo can be correctly embedded and public, but it is outside the newest capped scan window, so it is impossible for the semantic route to return it. The UI presents production semantic search as real semantic search, not as a bounded newest-window search, so users and operators can misinterpret missing results as "the gallery does not contain this" or "CLIP failed." This weakens the photographer-facing invariant that search should faithfully retrieve already-delivered work.

Fix:
Either make the production behavior match the product promise or make the scope visible. The stronger fix is a vector index/candidate store that searches the full embedded corpus within a bounded budget. The incremental fix is to return scan metadata (`scanned`, `totalEmbeddings`, `scanLimit`, maybe `partial: true`) and show a production-mode note when the corpus exceeds the scan window. Add a route test for metadata and a client/i18n test that production mode communicates partial scope when applicable.

## Final Missed-Issues Sweep

Checked and not promoted:
- Original upload path containment: current `apps/web/src/lib/upload-paths.ts` now validates filenames and proves realpath containment before returning originals; the older traversal finding is not current.
- Semantic request admission: current semantic POST handling checks content type/length/transfer-encoding and rate-limits before body materialization; I did not find a current body-admission regression.
- Restore SQL scanning: current restore scanner handles comment-removal and comment-as-space forms; no new restore bypass was promoted.
- Public/admin auth wrappers: custom lint scripts and source sweeps show the expected guard model and explicit read-only/public exemptions; no new auth-wrapper finding was promoted in this lane.
- HTML sinks: `dangerouslySetInnerHTML` usages found in public pages are JSON-LD patterns, not arbitrary user HTML sinks.
- Privacy projection: public selectors, map GPS selectors, and search enrichment fields are guarded by source/type tests; no new PII leak was promoted.
- Test hygiene: no `.only` markers found. Existing skips are environment/model gated (`admin`, `origin-guard`, CLIP model weights) and are known coverage risks, but not stronger than the findings above for this cycle.
- Recent cycle fixes: LR upload semantic-mode forwarding, semantic body caps, upload path containment, and SQL restore scanner hardening all appear present at HEAD.

Residual gaps:
- I did not run production-scale `EXPLAIN ANALYZE`, browser performance profiling, or full CI gates.
- I did not line-read every historical `.context/reviews/**` archive artifact; archives were used for context and pattern sweeps, while direct inspection focused on current source, tests, docs, and operational playbooks.
