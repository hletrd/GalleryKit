# Security Review — GalleryKit (cycle 8, run-6)

**HEAD:** 1a325fa6 · **Reviewer:** security-reviewer · **Date:** 2026-06-17
**Scope:** Whole repo from a security angle, PRIORITY on the three now-live CLIP activation commits (e0da12ee, b1d6331c, 1a325fa6) and the production CLIP/semantic-search surface.
**Risk Level:** LOW (clean)

## Summary — findings by severity

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 0 actionable (1 informational note recorded, NOT a vulnerability)

**Verdict: honest convergence.** The only non-test, non-doc source delta since the last converged review (e8e61c5d) is exactly three files — `apps/web/src/lib/clip-paths.ts` (new), `apps/web/src/lib/clip-model.ts` (server-only removed), `apps/web/scripts/download-clip-models.ts` (absolute-root + revision-subdir verify). All three were given hard, fresh scrutiny. The now-LIVE production CLIP paths (semantic route, similar route, upload-hook embed, backfill) were re-reviewed end-to-end with the production branches treated as exercised. No real, HEAD-verified, worth-fixing security issue was found.

---

## What changed since last converged review (attack-surface delta)

`git diff --stat e8e61c5d..HEAD` — non-test/non-doc source files:
- `apps/web/src/lib/clip-paths.ts` (NEW, 80 lines)
- `apps/web/src/lib/clip-model.ts` (+22/-3: `server-only` import removed, shared resolver adopted)
- `apps/web/scripts/download-clip-models.ts` (+30/-15: absolute-aware root, revision-subdir manifest verify)

Everything else in the range is `__tests__/`, `.context/`, `plan/`, or `*.md`. The semantic/similar routes, embed hooks, `embeddings.ts`, and `backfill-clip-embeddings.ts` were unchanged at the source level but are now LIVE (the prod env carries `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` + the DB `semantic_search_mode='production'` row), so I re-walked their production branches.

---

## Priority review: the three activation-fix commits

### e0da12ee — `clip-paths.ts` absolute-root + revision-subdir verify (CLEAN)

`resolveClipModelsRoot()` (clip-paths.ts:60-66) uses `path.isAbsolute()` to honor an absolute `CLIP_MODELS_ROOT` verbatim and resolve a relative/unset value against cwd. `clipModelArtifactDir()` (clip-paths.ts:77-80) joins the resolved root with `JINA_CLIP_MODEL_ID.split('/')` + `JINA_CLIP_REVISION`.

- **Path-traversal:** Both `JINA_CLIP_MODEL_ID` (`'jinaai/jina-clip-v2'`) and `JINA_CLIP_REVISION` (40-hex SHA, clip-model-id.ts:13/25) are hardcoded constants — no user/env input feeds the join, so no `..`/absolute-escape is constructible. `CLIP_MODELS_ROOT` is an operator-controlled env value (trust boundary is the operator, not a request).
- **Downloader/loader agreement:** The shared resolver is the whole point — `env.cacheDir` is set to the SAME `resolvedRoot` in both the downloader (download-clip-models.ts:85) and the loader (clip-model.ts:86), so the seed-write key and offline-read key cannot diverge. No security impact; correctness fix.

### e0da12ee — checksum-manifest verification (REAL post-download integrity gate, honestly documented)

`verifyAndCleanArtifacts()` (clip-model-manifest.ts:62-97) streams SHA-256 over each on-disk artifact under the revision subdir, compares to the hardcoded `CLIP_MODEL_MANIFEST`, and `rmSync()`-deletes any mismatching file before the caller aborts non-zero (download-clip-models.ts:106-116).

- **Is it a real trust boundary or post-parse?** It is correctly and explicitly documented as a **post-download integrity check, NOT a pre-parse trust boundary** (download-clip-models.ts:19-24): Transformers.js `from_pretrained` downloads AND instantiates the ONNX session in one call, so the bytes are parsed before the checksum runs. This is the honest and correct framing. The PRIMARY protections are the pinned immutable `JINA_CLIP_REVISION` + HTTPS to the HF hub, and the fact that the runtime NEVER downloads (`allowRemoteModels = false`, clip-model.ts:88). The checksum's job is to stop a poisoned/partial file from being LEFT ON DISK for the next run / runtime loader to trust — and the delete-on-mismatch achieves exactly that. No weakening proposed; this is the established, sound rationale.
- The download script is operator-run from a trusted network (documented), so the parse-before-verify window is not a request-reachable surface.

### 1a325fa6 — `import 'server-only'` removed from clip-model.ts (CLEAN — no client-leak risk)

The removal is required so the tsx backfill (`scripts/backfill-clip-embeddings.ts`) can import the module under plain Node/tsx, where `server-only` resolves to its throwing `default` condition (identical to the `@/db` constraint). **This is a HARD GUARD I was asked not to re-introduce — confirmed correct.**

Critically, removing the sentinel does **not** open a client-leak vector, because the client→server-only boundary test (`client-server-only-boundary.test.ts`) was widened to treat `sharp` and `@huggingface/transformers` native imports as server-only-equivalent (`hasNativeModuleImport`, lines 263-268; `reachesServerOnly`, line 270-272). The test walks every `'use client'` module's transitive `@/lib`/`@/db` VALUE-import closure (following dynamic `import()` and import-equals forms, AGG-C6-02) and would fail RED if any client component value-imported `@/lib/clip-model`. clip-model.ts unambiguously imports `sharp` (line 29) and `@huggingface/transformers` (line 28, type-only — but the regex also matches `import type`), so it is flagged. A non-vacuous pin (lines 394-410) proves the guard recognizes clip-model.ts as server-only-equivalent. The compensating control is in place and tested.

---

## Now-live production-path re-review (fresh eyes, all CLEAN)

### `POST /api/search/semantic` (semantic/route.ts)
- **Auth posture:** Intentionally public + same-origin (`hasTrustedSameOrigin`, line 99) — correct for a visitor search box; not an admin surface. Fails closed (403) on missing/mismatched Origin/Referer (`hasTrustedSameOriginWithOptions` defaults `allowMissingSource=false`, request-origin.ts:90-94).
- **Fail-closed mode gate:** Server authoritatively re-reads `semanticSearchMode` (line 221) and 503s unless `'stub'`/`'production'` (line 226). On config-read throw it stays `'disabled'` (line 223-224). `'production'` only resolves when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` (gallery-config.ts:143-145) — the operator opt-in I was told not to weaken.
- **Rate limit (Pattern 2):** `preIncrementSemanticAttempt` consumed AFTER cheap validation, BEFORE the embedding work (line 208); rolled back on every early return that never reached the guarded CPU (lines 227, 242, 257). 30/min/IP. The `unknown`-bucket fail-safe (lines 197-205) keeps the control applied even without TRUST_PROXY (a fail-open semantic endpoint would be a DoS amplifier) — correct.
- **Input hardening:** Content-Type prefix+param check (lines 114-124), chunked-TE rejection (127-130), Content-Length guard + post-read body cap at 8 KiB (133-162), JSON shape validation (168-174), codepoint min-length (184), `clampSemanticTopK` rejects non-number raw and clamps to [1,50] (87-91). No ReDoS (`countCodePoints` is `[...s].length`, utils.ts:18-20; the only regex is the anchored `^[\s;]` Content-Type check).
- **Vector query construction:** `embedTextReal(query)` returns a fixed 512-dim Float32Array; the DB scan is a Drizzle parameterized `eq(modelVersion, activeModelVersion)` + `desc(updatedAt)` + `limit(SEMANTIC_SCAN_LIMIT=5000)` (lines 250-255). Cosine is computed in JS over decoded buffers (`decodeEmbeddingColumn` returns null for malformed rows). No SQL injection; no unbounded scan; the user query never reaches SQL.
- **No PII leak:** Enrichment SELECT (lines 284-306) is title/description/filename_jpeg/width/height/topic/topic_label/camera_model/lens_model/capture_date — all public (already returned by keyword search), none in `_PrivacySensitiveKeys`. `processed=true` filter applied. Grep confirmed zero latitude/longitude/filename_original/user_filename/uploaded_by/ICC/HDR fields selected.

### `GET /api/search/similar/[id]` (similar/[id]/route.ts)
- Same-origin (line 62) + maintenance gate (67) + positive-int id validation (74-77) + Pattern-2 rate limit shared with semantic (83, rolled back at 102/122/129/134/149) + **production-only** gate (101) + target-embedding lookup with model_version filter (112-119) → 404 on absent/corrupt (121-131).
- **IDOR check:** `id` is the auto-increment image PK; an embedding exists only for processed images; the returned fields are public (grep confirmed NO private fields in the enrichment SELECT, lines 185-201). Returning "similar public photos" for any public photo id is the intended product behavior — no authorization object to enforce, no private data exposed. Not an IDOR.
- Scan is the same bounded Drizzle parameterized query; self excluded (line 154).

### Upload-hook embed path (image-queue.ts:412-478) + backfill (backfill-clip-embeddings.ts) + embeddings.ts action
- Fire-and-forget, fully wrapped in try/catch, never blocks the queue job; `'disabled'` short-circuits (image-queue.ts:442). `originalPath` is `resolveOriginalUploadPath(job.filenameOriginal)` (image-queue.ts:293) where `filename_original` is a server-generated `randomUUID()` derivative (process-image.ts:812) joined under a fixed dir — no user-controlled path reaches `sharp(imagePath)` (clip-model.ts:161).
- Write path stores the raw 2048-byte little-endian float32 buffer to the MEDIUMBLOB (cast through `unknown` at the single write site); `modelVersion` is one of two hardcoded constants. mysql2 inserts Buffer bytes verbatim — no injection.
- model_version partitioning (`STUB_MODEL_VERSION` vs `PRODUCTION_MODEL_VERSION`) keeps stub and production vectors from ever co-ranking — the isolation I was told not to weaken is intact across writer (queue/backfill) and reader (both routes).

---

## Informational note (NOT a vulnerability — recorded for completeness)

`apps/web/src/app/actions/embeddings.ts` (`backfillClipEmbeddings`) selects pending images with `notExists(... eq(imageEmbeddings.imageId, images.id))` (lines 92-96) — i.e. images with NO embedding row at ANY model_version — whereas the canonical sidecar (`backfill-clip-embeddings.ts`) correctly scopes the `notExists` by `TARGET_MODEL_VERSION` (lines 125-131), so the sidecar re-embeds stub→production rows while this action would skip a row that already has a stub embedding when running in production mode. This is a **correctness/completeness gap, not a security issue** (no auth, injection, or data-exposure consequence — the action is fully auth-gated via `isAdmin()` + `requireSameOriginAdmin()` + per-admin rate limit, lines 50-59), and the action is **explicitly unwired** — no UI calls it; the sidecar is the canonical entry point (documented at lines 70-73). It cannot be triggered by any request today. Out of scope for a security report; flagged only so a future wiring effort matches the sidecar's model_version-scoped selection. No action required from a security standpoint.

---

## Cross-cutting verifications (all PASS)

- **SSRF / model download:** Runtime `env.allowRemoteModels = false` (clip-model.ts:88) — never hits the network. Grep confirmed NO `allowRemoteModels = true` anywhere. The only network fetch is the operator-run download script over HTTPS to the pinned HF revision. (The pre-existing OG-photo origin-pinning SSRF defense is unchanged.)
- **Secrets:** No `HF_TOKEN`/`hf_`/`Authorization`/`apiKey`/`accessToken` in any clip file or script; `git log -S "hf_"` over apps/web returns nothing; `.env*.example` carry no CLIP/HF secret. Model download is anonymous (public model). No hardcoded secrets introduced.
- **Path traversal / symlink:** Unchanged whitelist + `SAFE_SEGMENT` + `lstat` posture on serving paths; the new CLIP path math uses only hardcoded constants + operator env. No request-reachable traversal.
- **Command/SQL injection:** No `exec`/`eval`/`new Function` in the new code; all DB access is Drizzle-parameterized; the user query never reaches SQL (embedded to a vector first).
- **Client→server-only boundary:** Widened and pinned (above). Removing `server-only` from clip-model.ts is fully compensated by native-import detection.
- **Regex DoS:** Validation regexes (`validation.ts`) are anchored with linear quantifiers (`[a-zA-Z0-9._-]*`, `[\p{Letter}\p{Number}-]+`) — no nested/ambiguous quantifiers. `countCodePoints` is spread-based, not regex.
- **Error-path info leak:** All route catch blocks return generic `{error}` JSON with `NO_STORE_HEADERS`; detail goes to server logs only (embeddings.ts:153, image-queue.ts:476).
- **Prior closed items (NOT re-reported):** bidi/invisible-char rejection (UNICODE_FORMAT_CHARS), Argon2id, timing-safe HMAC sessions, dual login rate buckets, advisory locks, GPS byte-strip, CSV formula-injection, smart-collection AST allowlist, `withAdminAuth`/`requireSameOriginAdmin` lint gates, paid-download token IDOR defense, postcss transitive (build-time only), single-writer topology — all verified DONE in cycles 1-7 and the cycle-7 security-reviewer record; re-confirmed unchanged.

## Security Checklist
- [x] No hardcoded secrets (clip files + scripts + git history + env examples clean)
- [x] All inputs validated (Content-Type/Length/body caps, codepoint length, topK clamp, JSON shape)
- [x] Injection prevention verified (Drizzle params; query embedded before SQL; no exec/eval)
- [x] Authentication/authorization verified (semantic/similar are intentionally public+same-origin; embeddings action auth-gated; production mode operator-gated, fail-closed)
- [x] SSRF — runtime allowRemoteModels=false; no request-reachable outbound host
- [x] Path traversal — CLIP path math uses hardcoded constants + operator env; sharp path is server-generated UUID
- [x] Integrity gate on model weights — present, honestly documented as post-download (not pre-parse); delete-on-mismatch prevents trusting poisoned bytes
- [x] Client→server-only boundary — server-only removal compensated by native-import detection (tested non-vacuous)
- [x] Rate limits on public search routes (Pattern 2, fail-safe on unknown IP)
- [x] No private-field leakage in enrichment SELECTs (grep-verified)
- [x] No ReDoS in validation/length helpers
