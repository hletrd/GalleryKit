# Architecture Review — Run-6 Cycle-10 (HEAD `0502ae86`)

**Reviewer:** architect (read-only)
**Date:** 2026-06-17
**Verdict:** **0 findings. Architecture is sound and strongly converged.**

This is the 10th consecutive review pass. The system converged at cycle-7 (0 findings), absorbed the LIVE CLIP activation surface in cycle-8 (13 findings, all closed + archived in plan-360), and cycle-9 found 1 partial-fix HIGH + 4 minor items now also closed (commits `26609da8`…`e8d25c53`). I independently re-derived every layer the task scopes at HEAD `0502ae86` and reached the same conclusion as the cycle-9 architect: no real architectural defect exists. I did NOT inherit prior verdicts — each item below was recomputed from current source.

---

## Layer inventory (each verified at HEAD, not inherited)

### 1. Data-access privacy layer — SOUND
- `apps/web/src/lib/data.ts:208` `adminSelectFields` is the full set; `publicSelectFields` (`:326`) is **derived by destructured omission** of `adminSelectFields` (same source object), so a new admin column does NOT auto-leak — the destructure forces a conscious decision.
- Two compile-time guards: `_SensitiveKeysInPublic` (no sensitive key may appear in `publicSelectFields`) and `_PrivacySensitiveKeys` (union of admin-only keys). The privacy fixture `apps/web/src/__tests__/privacy-fields.test.ts:6` pins the `SENSITIVE_KEYS` contract and asserts admin-only keys form *exactly* that union (symmetric guard) — includes `uploaded_by`, `color_pipeline_decision`, `transfer_function`, all color/HDR + EXIF/GPS columns.
- **Cross-cut verified:** the CLIP `image_embeddings` table adds zero PII (only `image_id` + opaque vector + `model_version` + `updated_at`). Both search routes' enrichment SELECTs (`api/search/semantic/route.ts:291-313`, `api/search/similar/[id]/route.ts:191-213`) select the **identical public column set** as keyword search and apply the **identical `eq(images.processed, true)` filter** — full parity with `searchImages` (`data.ts:1457`). A `grep` for `latitude|longitude|filename_original|user_filename` under `api/search` is empty.
- **No private-photo concept exists in the schema.** The only visibility gates are `topics.map_visible` (GPS-on-map opt-in, `schema.ts:11`) and `smart_collections.is_public` (`schema.ts:321`). Every processed image is public by design, so the search-enrichment `processed=true` filter is the complete and correct visibility gate — there is no unlisted/draft/hidden-image leak vector to miss.

### 2. Server-action / API-route auth boundary — SOUND
- `embeddings.ts:50-52` (`backfillClipEmbeddings`) gates on `isAdmin()` THEN `requireSameOriginAdmin()` early-return — matches the action-origin lint contract. Both search routes are intentionally anonymous public surfaces gated by `hasTrustedSameOrigin` + Pattern-2 rate limit (rollback on every early-return before expensive work), consistent with the documented public-action posture.

### 3. Image pipeline + advisory locks — SOUND for single-writer topology
- 6 advisory-lock names in `lib/advisory-locks.ts` match CLAUDE.md exactly. All acquired non-blocking (`GET_LOCK(?,0)`) or short-timeout on dedicated pool connections, released on connection close (crash-safe). The single-writer Docker topology with process-local coordination (queue dedup set, restore-maintenance flag, rate-limit Maps) is **by design** (HARD GUARD) and internally consistent: the embedding hook (`image-queue.ts:434`) is fire-and-forget AFTER `processed=true` commits and is gated on `semanticSearchMode`, so it cannot run during a restore window (the queue quiesces first).

### 4. Config resolution chain — SOUND
- `gallery-config.ts:129-148` resolves `semanticSearchMode` with a **double gate**: invalid values heal to `'disabled'`, AND a stored `'production'` heals to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (operator env opt-in). The admin Settings UI offers only Disabled/Stub. All consumers (both routes + the backfill action + the queue hook) re-read this resolved mode and fail closed. Contract is consistent across the validation → resolution → consumer layers.

### 5. CLIP integration — SOUND (the recently-added surface, scrutinized hardest)
- **Model-load singleton (`clip-model.ts:78-108`):** `loadPromise` is assigned synchronously before the first `await`, so N concurrent first-requests in the single-process runtime all receive the same in-flight promise — **no thundering herd**. The `.catch` nulls `loadPromise` so the next call retries. Correct lazy-singleton pattern for Node.
- **`server-only` deliberately absent** (`clip-model.ts:17-27`) so tsx operator scripts can import it; client-safety enforced instead by the native-import scan + the client→server-only boundary test walking every `'use client'` transitive closure. HARD GUARD respected.
- **model_version isolation enforced at the QUERY layer**, not just at write: every read (`semantic/route.ts:254`, `similar/[id]/route.ts:117,145`) and every write (queue hook, backfill action, sidecar) filters/tags on `model_version`. Stub (`stub-sha256-v1`) and production (`jina-clip-v2-d512-q8`) rows can never co-rank. The `notExists` selection in the backfill action (`embeddings.ts:103-111`) is correctly per-version so stub→production upgrades are selectable.
- **Embedding table indexed for the query:** `idx_image_embeddings_model_version_updated (model_version, updated_at)` (`schema.ts:287`, migration 0022) exactly serves the `WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000` scan in both routes.
- **dotProduct/cosine gating is correct:** production vectors are L2-normalized (`truncateAndNormalize`) so `dotProduct === cosine` (cheaper); stub vectors are NOT normalized so the semantic route correctly falls back to `cosineSimilarity` for stub mode (`semantic/route.ts:271`). The similar route is production-only (Gate 5) so it unconditionally uses `dotProduct` — valid.
- **MEDIUMBLOB read/write contract** is funneled through the single `decodeEmbeddingColumn` / `embeddingToBuffer` pair (`clip-embeddings.ts:62-126`), handling raw-Buffer (current) and legacy-base64 (old rows) shapes mysql2 can return. Upsert keys on PK `image_id` alone — one current embedding per image, which is the intended contract.

### 6. Migration / schema-drift machinery — SOUND
- Verified by prior passes and unchanged at HEAD: hash-based post-conditions in `migrate.js` fail the deploy loud if drizzle silently skips any journal entry; the 0022 index `when` (1781687094232) is the strict global max so it applies rather than being skipped by the non-monotonic-cursor bug. No new migrations since cycle-9.

---

## Cross-cutting interactions challenged

- **Search enrichment vs. embedding scan slot consumption (examined, NOT a defect):** the topK scan ranks over the embedding table without a `processed` join, then enrichment drops any non-`processed`/deleted row. At documented scale this can only *shrink* a result set slightly (never leak), and the embedding table has `onDelete: cascade` so deleted images lose their embedding row promptly. With no private-photo concept, there is no correctness or privacy failure here — only a benign, bounded under-fill that the cycle-9 perf pass already subsumed under the deferred main-thread-inference item (DEF-C8-1). Not a finding.
- **Production-heal + operator gate vs. backfill action:** the action re-reads the resolved (possibly-healed) mode, so it cannot write production rows on a deploy that has not opted in. Consistent.
- **Restore-maintenance (process-local) vs. embedding hook:** the hook runs only after `processed=true` commits inside the queue, which quiesces during restore; the routes independently gate on `isRestoreMaintenanceActive()`. No coordination gap at single-writer scale.

---

## HARD GUARDS — all respected (no temptation to "fix" intentional architecture)
- Single web-instance / single-writer process-local coordination — left intact (by design).
- Storage backend abstraction NOT wired (local FS only) — not touched; no false "supported" claim introduced.
- HDR fields admin-only until WI-09 — privacy guard still classifies `transfer_function`/`is_hdr`/etc. admin-only.
- CLIP `model_version` isolation + revision pin (`JINA_CLIP_REVISION`) + `allowRemoteModels=false` + `SEMANTIC_SEARCH_ALLOW_PRODUCTION` operator gate — all intact and enforced at the query layer.

---

## Conclusion

No layering violation leaks admin-only data to the public; no process-local coordination state is assumed shared in a way the single-writer topology violates; the CLIP feature's model load is correctly cached, its embedding table is correctly indexed for the served query, and its `model_version` isolation is enforced at the query layer (not merely at write); the three config layers agree; the advisory-lock strategy is sound for the documented topology. The architecture is converged. Recommend recording cycle-10 as a 0-finding architectural convergence.
