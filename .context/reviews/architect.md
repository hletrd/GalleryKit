# Architect Review — CLIP semantic-search surface + topology fit
Date: 2026-06-16 · Scope: architectural / design-risk · READ-ONLY · Agent: architect (Opus)

CLIP feature is intentionally DARK (`semantic_search_mode` default `'disabled'`). All
"when enabled" risks are labelled DEFERRED. No finding proposes activating it.

## Summary
The CLIP feature is, on the whole, well-isolated: pure helpers (`clip-embeddings.ts`) are
DB-free, model identity is pinned in a shared shim, the encoder is a lazy singleton, weights
are volume-mounted not baked, and the queue hook is fire-and-forget and gated. But three
CONFIRMED issues bite even while dark or on the next build: (1) `@huggingface/transformers`
(which pulls `onnxruntime-node` native binaries) is a STATIC import in `clip-model.ts`, which
is statically imported by `image-queue.ts` — the core upload pipeline — yet it is NOT listed
in `serverExternalPackages`; (2) the admin UI and i18n assert that `'production'` is rejected /
healed to `'disabled'`, but the config validator + resolver actually ACCEPT and pass
`'production'` through — a direct in-repo contradiction that strands a large production code
surface behind a hand-edited DB row; (3) stale provenance comments across `clip-inference.ts`,
`caption-generator.ts`, and two route docstrings describe a design (ViT-B/32, "once
onnxruntime-node is added", threshold `0.25`) that no longer matches the shipped code
(jina-clip-v2, transformers already pulls onnxruntime, threshold `0.22`).

## Analysis

### CONFIRMED-1 — Native-runtime dependency not externalized; coupled into core pipeline graph
- `apps/web/src/lib/clip-model.ts:19` — `import { env, AutoModel, AutoTokenizer, Tensor } from '@huggingface/transformers'` (top-level static).
- `apps/web/src/lib/image-queue.ts:23` — `import { embedImageReal } from '@/lib/clip-model'` (top-level static). `image-queue.ts` is imported at boot by `src/instrumentation.ts` (`bootstrapImageProcessingQueue`) and by every upload action.
- `apps/web/next.config.ts:45` — `serverExternalPackages: ['drizzle-orm', 'sharp']` — `@huggingface/transformers` is absent.
- `package-lock.json` — `@huggingface/transformers@3.8.1` declares `onnxruntime-node@1.21.0` (native `.node` addon), `onnxruntime-web`, and its own `sharp@^0.34.1` as dependencies.
- Architectural risk: in `output: 'standalone'`, packages that ship native addons must be externalized (kept in `node_modules`, not bundled by the Next/Webpack server trace) the same way `sharp` is. Leaving transformers un-externalized risks the Next build attempting to bundle/trace a package with native `.node` binaries and a WASM backend — at best bloating the standalone trace, at worst a build/runtime failure when the bundled copy can't resolve its platform addon. Because the import chain is `instrumentation → image-queue → clip-model → transformers`, the ONNX runtime is pulled into the always-loaded server graph for EVERY request path, not just the dark search routes.
- Concrete consequence (DEFERRED to next clean build / image rebuild): larger standalone image; possible `Could not load ... runtime`-class failures analogous to the Sharp linux-arm64 note already in the Dockerfile; the `prod-deps` tree must now carry onnxruntime-node native binaries for the runtime container, which the Dockerfile does not special-case the way it does for `@img/sharp-*`.
- Recommended direction: add `@huggingface/transformers` (and likely `onnxruntime-node`) to `serverExternalPackages`; and convert the encoder import to a lazy `await import('@huggingface/transformers')` inside `getModelBundle()` so the native runtime is only resolved when the dark feature is actually switched on, fully decoupling it from the boot/upload path. Mirror the per-arch native-binary install the Dockerfile already does for sharp if onnxruntime-node fails to materialize in-container.
- Confidence: High (dependency graph + config verified). Build-break severity itself: Medium-High (depends on Next's tracer tolerance for the current transformers version).

### CONFIRMED-2 — Config layer accepts `'production'`; UI + i18n claim it is rejected/healed
- `apps/web/src/lib/gallery-config-shared.ts:170` — validator: `v === 'disabled' || v === 'stub' || v === 'production'` → `'production'` is VALID.
- `apps/web/src/lib/gallery-config.ts:128-136` — resolver passes a valid raw value through unchanged: `return raw as 'disabled' | 'stub' | 'production'`. It does NOT heal `'production'` to `'disabled'`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:655` — Select value clamped to `['disabled','stub']`; lines 664-669 comment: "no 'production' item — the validator rejects that value and the resolver heals it to 'disabled'". `messages/en.json:732 semanticSearchProductionWarning` tells the admin the production value is "no longer valid and is being treated as Disabled."
- The full production path IS live code: `semantic/route.ts:227-241` serves `'production'` via `embedTextReal`; `similar/[id]/route.ts` is production-ONLY (Gate 5 returns 503 unless `'production'`); `image-queue.ts:445-447` writes real embeddings in `'production'`; and `semantic-route-production.test.ts` / `gallery-config-semantic-production.test.ts` assert this behavior.
- Architectural risk: the UI layer's documented invariant is FALSE at the config layer — classic contract drift between two layers' mental models. The settings-client comment reflects an earlier plan state (CRT-R5C1-01) that Task 5/6 deliberately reversed (see `gallery-config.ts:64-68,130-131`), but the UI comment + i18n string were never updated.
- Concrete consequence: production semantic search and the entire similar-photos endpoint are reachable only by a human directly setting `admin_settings.semantic_search_mode='production'` in MySQL — there is no supported UI affordance. An operator reading the admin UI is actively told production "isn't valid," while the code will happily run it. This is a maintainability and operational-clarity hazard: the feature's true activation surface is undocumented-by-the-UI and contradicts it.
- Recommended direction: pick ONE source of truth. Either (a) if production is genuinely not ready, make the resolver heal `'production' → 'disabled'` so the validator/resolver match the UI's claim (and the similar route can never serve); or (b) if the production path is intended to be operator-activatable, correct the stale settings-client comment + `semanticSearchProductionWarning` i18n and document the DB-edit (or add a gated UI affordance). Today the layers disagree.
- Confidence: High (all three layers read directly).

### CONFIRMED-3 — Stale provenance comments / docstrings contradict shipped design
- `apps/web/src/lib/clip-inference.ts:4-17,56-76` — describes "CLIP ViT-B/32", "onnxruntime-node adds ~750 MB ... once onnxruntime-node is added as a dependency". Shipped encoder is jina-clip-v2 (1024→512 Matryoshka) and transformers ALREADY pulls onnxruntime-node transitively. `caption-generator.ts:1-19` carries the same stale "once onnxruntime-node is added" framing.
- `apps/web/src/app/api/search/semantic/route.ts:9,25,189` — docstring says `COSINE_THRESHOLD (0.18)` and `PRODUCTION_COSINE_THRESHOLD (0.25)` and "only 'stub' mode is the current encoder"; actual constants are `0.18` and `0.22` (`clip-embeddings.ts:11,103`), and the route serves BOTH stub and production. CLAUDE.md likewise omits the CLIP feature entirely (caption stub US-P52 and embeddings US-P51 are mentioned only as a schema stub / "CLIP embeddings (stub)").
- `clip-embeddings.ts:10` — `CLIP_MODEL_VERSION = 'stub-sha256-v1'` coexists with `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'`. The dual-version scheme itself is sound (it cleanly partitions stub vs real rows), but the naming `CLIP_MODEL_VERSION` for the STUB identity is misleading — a future reader expects that to be the real model version.
- Architectural risk: low blast radius but high confusion cost; these are the exact comments a future implementer would trust when wiring real inference, and they point at the wrong model, wrong dependency status, and wrong thresholds.
- Recommended direction: refresh the four docstrings/comments to match jina-clip-v2 + transformers-bundled-onnx + thresholds; consider renaming `CLIP_MODEL_VERSION` → `STUB_MODEL_VERSION`; add a short CLIP section to CLAUDE.md so the dark feature's topology (volume weights, dual model_version, dark-by-default, native-dep externalization need) is documented like the rest of the system.
- Confidence: High.

### CONFIRMED-4 — `embedImageReal` re-decodes the original separately from the main Sharp pipeline
- `apps/web/src/lib/image-queue.ts:446` — embedding hook calls `embedImageReal(originalPath)`; `clip-model.ts:124-139` opens a FRESH `sharp(imagePath)` and decodes the full-resolution original to 512×512.
- The main pipeline (`processImageFormats`) has already decoded the same original moments earlier. The embedding decode is an independent second full decode of a file up to 200 MB.
- Architectural risk (DEFERRED, production only): on the documented single-writer topology with `QUEUE_CONCURRENCY=1`, the embedding decode runs fire-and-forget AFTER `processed=true` is committed, so it overlaps the NEXT queued job's Sharp work plus the ONNX session — two libvips decodes + an ONNX inference concurrently, all CPU/RAM-bound, on a box sized for one. The 50 MP wide-gamut OOM guard in `process-image.ts` does NOT cover this path (it resizes to 512 fill, so pixel count is bounded — good — but peak memory during decode of the original is not).
- Concrete consequence: when production is enabled, per-image steady-state CPU/RAM roughly doubles during the overlap window; on the 16 GB Mac mini this is a real contention risk under batch upload. It does not violate single-writer correctness (the lazy singleton is per-process and the hook is detached), but it is a capacity-planning coupling that isn't documented.
- Recommended direction: acceptable for a personal gallery, but document the CPU/RAM expectation when `'production'`, and consider deriving the embedding from an already-produced derivative (e.g. the largest WebP/JPEG) rather than re-decoding the original, to reuse pipeline work. Lower priority than 1-3.
- Confidence: Medium (behavioral reasoning; not load-tested).

## Judgment-call tradeoffs (NOT defects)

- TRADEOFF-A — Search business logic lives in the route handlers (`semantic/route.ts`,
  `similar/[id]/route.ts`) rather than a `lib/semantic-search.ts`. The two routes duplicate
  ~80 lines: the scan→cosine→topK→enrich pipeline, the identical enrichment SELECT/JOIN, and
  the model-version/threshold selection. For two endpoints this is tolerable, but the
  duplication means a change to the enrichment shape or scan strategy must be made twice
  (drift risk). Direction: if a third consumer appears, extract `scanAndScore(modelVersion,
  threshold, queryEmbedding, opts)` + `enrichResults(ids, scores)` into lib; the routes keep
  only HTTP concerns (origin/rate-limit/validation). Confidence: Medium. Not blocking.

- TRADEOFF-B — Brute-force linear scan (`SEMANTIC_SCAN_LIMIT=5000`, cosine in JS per row) with
  no vector index. This is the RIGHT call for the stated topology: it respects single-instance
  Docker + MySQL with no external vector DB, and 5000×512 float ops is sub-100ms. It correctly
  does NOT assume pgvector/Pinecone/etc. The only caveat is the implicit scale ceiling: beyond
  ~5000 embeddings the scan silently truncates to the 5000 most-recently-updated rows
  (`orderBy(desc(updatedAt)).limit(5000)`), so older photos become unsearchable without any
  signal. That's a reasonable bound for a personal gallery; just note it is a hard recall cliff,
  not a soft degradation. Confidence: High this is the right architecture for the constraints.

- TRADEOFF-C — Embedding stored as base64 TEXT of a 2048-byte buffer, with the Drizzle schema
  typing it `text("embedding")` while the real column is `MEDIUMBLOB` (`schema.ts:264-268`,
  documented). Base64 inflates 2048 bytes → ~2731 chars and the route does
  `Buffer.from(row.embedding, 'base64')` per row per query. Storing raw BLOB and reading the
  Buffer directly would avoid the base64 round-trip and the schema/reality mismatch. The
  current form is functional and the mismatch is documented, but it's a small abstraction leak
  (the lib layer must know "text column actually holds base64 of a blob"). Confidence: Low
  (cosmetic/perf-minor). Not blocking.

- TRADEOFF-D — Two independent fire-and-forget background config reads per processed image
  (caption hook + embedding hook each call `getGalleryConfig()`), and `getGalleryConfig` is
  React `cache()`-wrapped, which is REQUEST-scoped — these run in detached `void` IIFEs outside
  any request, so the cache never dedupes them. That's 2 extra `admin_settings` SELECTs per
  image when either feature is on (0 when both disabled, which is the default). Fine at personal
  scale; noting the cache() gives no benefit on these background paths. Confidence: High
  (mechanism verified), impact Low.

## Topology-fit verdict (the explicit ask)
The CLIP design RESPECTS the single-instance / single-writer constraints: the encoder is a
per-process lazy singleton (no shared-state assumption), the scan is in-MySQL with no external
vector service, weights are a host-seeded bind mount (`docker-compose.yml:24` `./data:/app/data`,
`Dockerfile:90` `CLIP_MODELS_ROOT`), and the queue hook is detached and gated. It does NOT
assume horizontal scaling, a vector DB, or the not-yet-integrated `@/lib/storage` backend — it
reads the original via `resolveOriginalUploadPath` (local FS), consistent with the rest of the
app. The model-weights-on-disk approach fits the single-instance Docker model cleanly. The real
topology gaps are the build-time externalization (CONFIRMED-1) and the capacity coupling of the
second decode (CONFIRMED-4), not a distributed-systems mismatch.

## Compact list for aggregator
- [CONFIRMED-1][High] `@huggingface/transformers` (pulls native onnxruntime-node) is a static import in clip-model.ts → image-queue.ts (boot/upload graph) but absent from `serverExternalPackages`; standalone-build/bundling risk + couples native runtime into always-loaded path. Fix: externalize + lazy-import. (DEFERRED: bites on next clean build / when enabled.)
- [CONFIRMED-2][High] Config validator+resolver ACCEPT `'production'` (gallery-config-shared.ts:170, gallery-config.ts:128-136) but settings-client.tsx:655-669 + i18n `semanticSearchProductionWarning` claim it's rejected/healed-to-disabled. Live production path (incl. production-only similar route) reachable only via hand-edited DB row, contradicting the UI. Pick one source of truth.
- [CONFIRMED-3][High] Stale comments/docstrings: clip-inference.ts + caption-generator.ts say "ViT-B/32 / once onnxruntime-node is added" (shipped: jina-clip-v2, transformers already bundles onnxruntime); semantic route docstring says threshold 0.25 (actual 0.22) and "only stub" (serves both). CLAUDE.md omits the feature. Refresh + rename CLIP_MODEL_VERSION→STUB_MODEL_VERSION.
- [CONFIRMED-4][Medium] Embedding hook re-decodes the full original via a second fresh Sharp instance (clip-model.ts:124) overlapping the next job's pipeline + ONNX on a single-writer box; ~2x peak CPU/RAM during overlap when production. Document or derive from an existing derivative. (DEFERRED: production only.)
- [TRADEOFF-A][Medium] ~80 lines of scan/enrich logic duplicated across the two search routes; extract to lib if a 3rd consumer appears.
- [TRADEOFF-B][High-confidence-correct] Brute-force 5000-row linear cosine scan = right choice for the no-vector-DB single-instance topology; note the hard recall cliff past 5000 most-recent embeddings.
- [TRADEOFF-C][Low] Embedding stored as base64 TEXT over a MEDIUMBLOB (schema/reality mismatch is documented); raw BLOB would drop the per-row base64 decode.
- [TRADEOFF-D][Low] Caption + embedding background hooks each call request-scoped `getGalleryConfig()` from detached IIFEs, so cache() never dedupes → 2 extra admin_settings SELECTs/image when enabled.
- [TOPOLOGY][verdict] CLIP design respects single-instance/single-writer + local-FS-only constraints; no vector-DB/horizontal-scale/storage-abstraction assumptions. Real gaps are build externalization + decode capacity coupling, not distributed-systems fit.
