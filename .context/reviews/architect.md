# Architect Review — Run 6 / Cycle 8 (CLIP activation)

**HEAD:** `1a325fa6`
**Date:** 2026-06-17
**Agent:** architect (read-only; persisted by orchestrator after independent HEAD verification)
**Scope:** Architecture of the now-LIVE CLIP semantic-search feature — the only new code since the cycle-7 converged review (3 activation commits: `e0da12ee`, `b1d6331c`, `1a325fa6`).
**Verdict:** ACCEPT — **1 finding (0 Critical / 0 High / 0 Medium / 1 Low)**

## Summary

The CLIP activation is architecturally coherent and respects every documented boundary. The three "activation" commits did not introduce a new subsystem — they flipped a feature that was already wired dark in run-4 (the `clip-model.ts` real encoder, the `image_embeddings` schema, the two read routes, the three embed writers, the boundary test, and the config heal-down all predate this cycle). The cycle-8 delta is narrow: (1) extracting `CLIP_MODELS_ROOT` path math into a shared `clip-paths.ts` leaf, (2) absolute-aware root resolution + revision-subdir artifact verification, and (3) dropping `server-only` from `clip-model.ts` so the tsx backfill can import it. Each of those is the architecturally *correct* choice, and each is now pinned by a behavioral test (29/29 GREEN at HEAD). The single finding is a LOW latent inconsistency in the (currently unwired) in-app backfill server action's pagination strategy versus the canonical sidecar — not a defect today, but a divergence that would surface incorrect behavior if that action is ever wired to a UI. The HARD GUARDS are all respected and were re-verified.

## Analysis — modules, edges, and evidence

### A. The `clip-paths.ts` seam — CORRECT, not a layering violation

`apps/web/src/lib/clip-paths.ts` is imported by BOTH `apps/web/src/lib/clip-model.ts:32` (server runtime loader) and `apps/web/scripts/download-clip-models.ts:36` (tsx operator script). This is the right seam, for three concrete reasons:

1. **It is a pure leaf.** Its only imports are `node:path` (`isAbsolute`, `join`) and the sibling `clip-model-id.ts` constants (`clip-paths.ts:42,46`). No `@/db`, no `@huggingface/transformers`, no `sharp`, no `server-only`. It can be imported from any layer with zero transitive weight — exactly what a shared path-resolver should be.
2. **The relative-import choice (`./clip-model-id`, not `@/lib/clip-model-id`) is load-bearing, not sloppy** (`clip-paths.ts:43-45`). The tsx scripts run without the `@/` → `src/*` path-alias rewrite that the Next/vitest build provides, so a `@/` specifier here would break `download-clip-models.ts` at runtime. Using a relative specifier for a module that must be tsx-importable is the correct convention (and `clip-model-id.ts` is a sibling in `src/lib/`).
3. **Single-source-of-truth is the whole point and it is achieved.** The download write-key (`env.cacheDir = resolveClipModelsRoot()`, `download-clip-models.ts:50,85`) and the offline read-key (`CLIP_MODELS_ROOT = resolveClipModelsRoot()`, `clip-model.ts:62,86`) are computed by the SAME function, so the seed target and the offline-load source can never diverge — the production "doubled `/app/apps/web/app/...`" and "MISSING onnx" failures the docstring describes are structurally prevented. `clipModelArtifactDir()` (`clip-paths.ts:77-80`) encodes the transformers.js v3 revision-subdir layout so the downloader verifies exactly the bytes the loader reads.

No circular edge: `clip-model-id.ts` imports nothing; `clip-paths.ts` imports only `clip-model-id.ts`; `clip-model.ts` imports both. Strict leaf ← leaf ← consumer. **No layering concern. CONFIRMED CORRECT.**

### B. Client → server boundary enforcement vs the removed `server-only` guard — SOUND

The HARD GUARD "no `import 'server-only'` in clip-model.ts" is correct and necessary: `scripts/backfill-clip-embeddings.ts:66` imports `embedImageReal` from `@/lib/clip-model` under tsx, where `server-only`'s `default` export condition throws (identical constraint to `@/db`, documented at `clip-model.ts:17-27`). The question is whether the *replacement* enforcement is as strong as the compile-time guard it gives up. It is — via two independent mechanisms:

1. **Native-import detection** (`client-server-only-boundary.test.ts:263-268`): `hasNativeModuleImport()` flags any module importing `sharp` or `@huggingface/transformers` as server-only-equivalent. `clip-model.ts:29` imports `sharp` (value) and `:28` imports `@huggingface/transformers` (type) — the regex matches both `import` and `export`, type-or-value, anchored to a quote (negative pins at `:421-424` prevent `sharp-extra` false positives). So a future `'use client'` → `@/lib/clip-model` value edge fails the walk RED.
2. **The transitive closure walk follows VALUE imports only** (`:138-223`), correctly excluding the type-erased `import type * as Transformers` at `clip-model.ts:28` from creating a phantom edge, and the AST full-descent (`:196-218`) catches dynamic `import()` and import-equals forms.

**Empirically verified the boundary is clean at HEAD:** the only `'use client'` module that touches *any* CLIP module is `apps/web/src/components/search.tsx:19`, which value-imports `SEMANTIC_TOP_K_DEFAULT` from `@/lib/clip-embeddings` — and `clip-embeddings.ts:1-6` is a pure math/constants module (no DB, no sharp, no transformers, no `server-only`). That is client-safe by construction. No client component reaches `clip-model.ts`, `clip-inference.ts`, or `clip-paths.ts`. The non-vacuity pin at `:394-410` proves `clip-model.ts` IS recognized as server-only-equivalent. **The test-based enforcement is at least as strong as the compile-time guard, and is the only viable option given the tsx constraint. SOUND.**

### C. Config flow: shared (default) → resolution (heal-down + env gate) → runtime — COHERENT and SAFE

```
gallery-config-shared.ts   (DEFAULTS['semantic_search_mode']='disabled' @:108;
                            VALIDATORS accepts disabled|stub|production @:173; pure leaf)
        ↑ value
gallery-config.ts          (resolver @:129-147: invalid→'disabled'; stored 'production'
                            HEALS to 'disabled' unless SEMANTIC_SEARCH_ALLOW_PRODUCTION==='true')
        ↑ value (getGalleryConfig)
   ┌────────────────┬─────────────────────┬──────────────────────┐
route/semantic   route/similar        image-queue hook       embeddings action / sidecar
(gates mode)     (gates 'production') (gates mode)           (gates mode)
```

- **The default is correct (HARD GUARD respected):** `'disabled'` at `gallery-config-shared.ts:108`. An unset or corrupt row resolves to `'disabled'` (`gallery-config.ts:132`).
- **The heal-down + env gate is coherent and defense-in-depth** (`gallery-config.ts:143-145`): a stored `'production'` value resolves to `'disabled'` UNLESS `process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true'`. This makes the admin-UI invariant ("UI offers only Disabled/Stub", `settings-client.tsx:655,662-663`) structurally TRUE for every normal deploy while preserving a deliberate non-UI operator activation path (env flag + DB row + weights + backfill). The validator deliberately still ACCEPTS `'production'` as type-valid (`:173`) so the stored value round-trips; the *heal* happens at resolution, not validation — correct separation (validation = "is this a legal value", resolution = "is this activatable here"). **HARD GUARD respected — not weakened.**
- **model_version isolation is consistent across ALL serving and writing sites:**
  - Read: `/api/search/semantic` scans `eq(modelVersion, activeModelVersion)` where `activeModelVersion` is `PRODUCTION_MODEL_VERSION` iff `isProd` (`route.ts:234,253`); `/api/search/similar` is hard-pinned to `PRODUCTION_MODEL_VERSION` (`route.ts:117,145`) and 503s in any non-production mode (`:101`).
  - Write: all three writers tag rows with the mode-appropriate version — queue hook (`image-queue.ts:448,451`), server action (`embeddings.ts:103`), sidecar (`backfill-clip-embeddings.ts:77`). Stub rows (`'stub-sha256-v1'`) and production rows (`'jina-clip-v2-d512-q8'`, ≤32 chars for the `varchar(32)` at `schema.ts:279`) can never co-rank. The threshold also forks with the mode (`COSINE_THRESHOLD` 0.18 stub vs `PRODUCTION_COSINE_THRESHOLD` 0.22 prod, `route.ts:235`).
- **Fail-closed on config error:** every consumer wraps `getGalleryConfig()` in try/catch defaulting to `'disabled'`/no-op (`route.ts:219-225`, `similar/route.ts:94-100`, `image-queue.ts:435-441`, `embeddings.ts:74-79`). **COHERENT and SAFE.**

### D. React `cache()` outside a request scope — NOT a defect (verified)

`getGalleryConfig = cache(_getGalleryConfig)` (`gallery-config.ts:222`) is called from the queue hook's fire-and-forget background closure (`image-queue.ts:437`), which runs in a `PQueue` worker callback with NO React request scope. Confirmed against React docs: calling a `cache()`-memoized function outside a component/request render scope does **not throw** — it simply evaluates fresh, reading/updating no cache. This is actually the *desired* behavior for the queue hook (it wants a current read of `semanticSearchMode` at processing time, not a stale render-time snapshot). Inside the two route handlers the per-request dedup still applies normally. No coupling bug, no stale-config hazard.

### E. Runtime topology — the singleton RESPECTS the single-writer model; introduces no new cross-instance state

CLAUDE.md documents a single-web-instance / single-writer topology. The CLIP activation does not violate it:

- **The model singleton is module-scoped per-process** (`clip-model.ts:76`, `let loadPromise: Promise<ModelBundle> | null`). Each Node process lazily builds ONE ONNX session + tokenizer on first real encode (`getModelBundle()`, `:78-108`) and reuses it. This is per-process memory (an ONNX int8 session, hundreds of MB), NOT cross-request shared mutable state that coordination assumes is global. It is the same shape as every other in-process singleton the topology already tolerates (queue state, rate-limit Maps).
- **It introduces no NEW scaling constraint beyond the ones already documented.** The embeddings live in MySQL (`image_embeddings`), which is the shared store; the brute-force scan reads from the DB (`route.ts:250-255`), not from process memory. If the web service were (against policy) horizontally scaled, each instance would independently load its own model copy — wasteful but CORRECT (read-only inference, no shared mutable singleton state to corrupt). The model files are read from a bind-mount volume (`env.cacheDir`), never baked into the image, so every instance reads identical immutable weights. **The singleton is consistent with the topology; it does not add a coordination point that breaks the single-writer assumption.**
- **next.config alignment is correct:** `@huggingface/transformers` + `onnxruntime-node` + `sharp` are in `serverExternalPackages` (`next.config.ts:50`) so the standalone build does not webpack-trace native binaries, and the transformers import is lazy/dynamic (`clip-model.ts:83`) so the boot/upload graph never drags the native runtime into a request path that does not actually encode. Layering of the lazy import is deliberate and documented (`clip-model.ts:34-40`).

### F. Failure-mode design (graceful degradation) — SOUND

- **Missing model files:** `getModelBundle()` rejects; the catch at `clip-model.ts:101-105` NULLS `loadPromise` so the next call retries (no permanently-poisoned singleton). Each consumer degrades gracefully: the semantic route catches the embed throw and returns 503 with a rate-limit rollback (`route.ts:240-244`); the queue hook swallows it as a `console.warn` and the upload still succeeds (`image-queue.ts:475-477` — embedding is explicitly fire-and-forget, "MUST NOT block the queue job"). **A missing/corrupt model never takes down uploads or the gallery — it only disables search results, which is the correct blast radius.**
- **Integrity:** the downloader verifies a hard-coded SHA-256 manifest and DELETES a mismatching artifact before aborting non-zero (`download-clip-models.ts:104-116`), and the runtime is pinned to an immutable revision with `allowRemoteModels=false` (`clip-model.ts:88,93`) so it never silently re-downloads. **HARD GUARDS (revision pin, `allowRemoteModels=false`) respected.**
- **Corrupt embedding rows:** `decodeEmbeddingColumn()` returns null for malformed blobs and the scan skips them (`route.ts:267-272`) rather than throwing — one bad row cannot poison a whole query.

### G. Embed-writer consistency — three writers, one contract; ONE latent inconsistency (Finding L1 below)

There are three embedding writers, all mode-aware and version-correct (verified in §C). Two share the exact keyset-pagination + re-embed-on-version-mismatch contract (sidecar `backfill-clip-embeddings.ts` and the queue hook are the canonical pair). The in-app server action `embeddings.ts` diverges — see Finding L1.

---

## Findings

### L1 (LOW) — `backfillClipEmbeddings` server action uses version-AGNOSTIC selection + unbounded in-memory pagination, diverging from the canonical sidecar contract

- **Module / lines:** `apps/web/src/app/actions/embeddings.ts:84-99` (selection) and `:106-145` (batching).
- **Architectural problem:** This server action is the THIRD embedding writer, but its row-selection predicate differs from the two canonical writers in a way that is incorrect for the production-migration use case:
  1. **Version-agnostic `notExists`** (`embeddings.ts:92-96`): it selects images lacking ANY `image_embeddings` row (`eq(imageEmbeddings.imageId, images.id)` with no `modelVersion` constraint). The sidecar (`backfill-clip-embeddings.ts:125-131`) and its documented migration semantics select images lacking a row AT THE TARGET version, so a stub row gets RE-EMBEDDED to production. This action, by contrast, will SKIP an image that already has a stub row even when running in `production` mode — it cannot perform the stub→production migration the sidecar exists to do. It only ever fills *missing* rows, never upgrades stale-version ones.
  2. **`OFFSET`-free but materialized-all pagination** (`:86-99,106`): it loads up to `SEMANTIC_SCAN_LIMIT` (5000) rows into memory in one `select(...).limit(5000)` then slices in JS. The sidecar deliberately moved to keyset (`id > cursor`) pagination because "each upsert removes its row from the `notExists()` WHERE set" (`backfill-clip-embeddings.ts:104-109` / COR-R4C19-04). The server action does not re-query between batches (it slices a single snapshot), so it avoids the shrinking-filter skip bug — but only because it materializes the entire candidate set up front, which is the memory pattern the sidecar rejected.
- **Why it is LOW, not higher:** This action is **not wired to any UI** — the comment at `embeddings.ts:70-73` explicitly states "no UI currently wires this action; the sidecar script remains the canonical backfill entry point." So neither divergence has any runtime consequence at HEAD. It is dead-but-honest code (it was made mode-aware in run-6 c2 / AGG-L1 precisely to stay honest if surfaced). The defect is latent: it would only produce wrong behavior (silent skip of stub-row upgrades in production) IF someone wires it to an admin control without first reconciling its selection predicate with the sidecar's.
- **Consequence scenario:** A future cycle adds a "Backfill embeddings" admin button bound to `backfillClipEmbeddings`. Operator flips to production mode, seeds weights, clicks the button expecting it to upgrade the existing stub rows (as the documented sidecar does). It reports `processed: 0` because every image already has a (stub) row, and `notExists` is version-agnostic. Production search returns empty results; the operator has no signal why. The divergence from the sidecar's well-documented "re-embed on version mismatch" contract is the trap.
- **Suggested fix (defer until/unless wired):** When (and only when) this action is surfaced, align its `notExists` subquery with the sidecar — add `eq(imageEmbeddings.modelVersion, modelVersion)` to the inner WHERE (`embeddings.ts:93-95`) so it re-selects rows at a different version, matching `backfill-clip-embeddings.ts:128-130`. Consider also adopting keyset pagination for parity. Until wired, a one-line code comment cross-referencing the sidecar's selection contract (so the next editor reconciles them) is sufficient. Do NOT change behavior of dead code speculatively.
- **Confidence:** High (the divergence is real and verified against both files); the *severity* is Low (unwired).

---

## Recommendations

1. **L1:** No action required this cycle (dead code). If a future plan wires `backfillClipEmbeddings` to a UI, reconcile its selection predicate with the sidecar FIRST. A cross-reference comment is a cheap pre-emptive guard.
2. **No other architectural action.** Do not fabricate refactors. The CLIP seam, boundary enforcement, config heal-down, singleton lifecycle, and failure-mode design are all correct.
3. **Keep every HARD GUARD in place:** no `import 'server-only'` in `clip-model.ts` (breaks tsx backfill — the native-import boundary test is the correct substitute); `semantic_search_mode: 'disabled'` default; no `server-only` on `@/db`; do not weaken `SEMANTIC_SEARCH_ALLOW_PRODUCTION` / the revision pin / `allowRemoteModels=false` / `model_version` isolation.

## References

- `apps/web/src/lib/clip-paths.ts:42-80` — pure path-resolver leaf; correct shared seam; relative `./clip-model-id` import is tsx-required (§A).
- `apps/web/src/lib/clip-model.ts:17-32, 76-108` — server-only-absent rationale (HARD GUARD), lazy native import, per-process singleton with retry-on-failure (§B/D/E/F).
- `apps/web/src/lib/clip-embeddings.ts:1-18` — pure constants/math leaf; the ONLY CLIP module a client component reaches, via `search.tsx:19` (§B).
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:263-268, 394-410` — native-import detection + non-vacuity pin for clip-model (§B); 29/29 GREEN at HEAD.
- `apps/web/src/lib/gallery-config-shared.ts:108, 173` — 'disabled' default + production-accepting validator (§C).
- `apps/web/src/lib/gallery-config.ts:129-147, 222` — heal-down + `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env gate; `cache()` wrapper (§C/D).
- `apps/web/src/app/api/search/semantic/route.ts:219-235, 250-255` — mode gate + model_version-scoped scan + threshold fork (§C).
- `apps/web/src/app/api/search/similar/[id]/route.ts:94-101, 117, 145` — production-only gate, hard-pinned PRODUCTION_MODEL_VERSION (§C).
- `apps/web/src/lib/image-queue.ts:434-478` — fire-and-forget mode-aware embed hook; never blocks upload (§D/F/G).
- `apps/web/scripts/backfill-clip-embeddings.ts:104-139` — canonical keyset pagination + re-embed-on-version-mismatch (§G; the contract L1 diverges from).
- `apps/web/src/app/actions/embeddings.ts:84-99, 106-145` — version-agnostic selection + materialized pagination; unwired (Finding L1).
- `apps/web/scripts/download-clip-models.ts:50, 85, 104-116` — shared root resolution + SHA-256 manifest verify/clean before abort (§A/F).
- `apps/web/next.config.ts:50` — `serverExternalPackages` includes transformers/onnxruntime-node/sharp (§E).
- `apps/web/src/db/schema.ts:273-279` — `image_embeddings` MEDIUMBLOB + `model_version varchar(32)` (§C/E).
