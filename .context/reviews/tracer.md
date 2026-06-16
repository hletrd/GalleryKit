# Tracer Report — CLIP Semantic-Search Surface (US-P51)

**Date:** 2026-06-16
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16.2 / React 19 / TS6)
**Scope:** Evidence-driven causal tracing of the four CLIP flows added this session by fast-model subagents. All four validated against committed code in `apps/web`.

**Hard guard honored:** CLIP was NOT activated. The mode was NOT flipped. No weights downloaded. No backfill run. This report only TRACES whether the dark gating can be bypassed.

---

## Observation (grounded, no interpretation)

1. The CLIP surface is larger than the 7 named files: `lib/clip-model.ts` (real jina-clip-v2 encoder), `lib/clip-inference.ts` (stub), `lib/clip-embeddings.ts` (pure utils + constants), `lib/clip-model-id.ts` (pinned revision), `app/actions/embeddings.ts` (stub backfill action), `scripts/backfill-clip-embeddings.ts` (sidecar; stub+production), `scripts/download-clip-models.ts`, and the two routes.
2. **Git timeline:** the entire production wiring landed **2026-06-15** in three commits:
   - `bb06caad` "feat(search): allow semantic_search_mode=production in the validator"
   - `7f70a2ee` "fix(search): harden CLIP image preprocessing — sRGB 3-channel + EXIF autoOrient"
   - `4bbcaaea` "feat(search): serve real CLIP results in production mode + model_version filter"
   All CLIP files are committed and clean in the working tree.
3. DEFAULT of `semantic_search_mode` is `'disabled'` (`gallery-config-shared.ts:108`). Both routes 503 unless the DB-stored mode is `'stub'`/`'production'` (semantic) or `'production'` (similar).
4. The admin settings dropdown (`settings-client.tsx:662-663`) offers ONLY `disabled` and `stub`. There is NO `production` `<SelectItem>`. Inline comments at `settings-client.tsx:656-658` and `:668-670` assert production is "not storable" and "heals to disabled."
5. The validator (`gallery-config-shared.ts:170`) and resolver (`gallery-config.ts:128-136`) BOTH now accept and pass `'production'` through unchanged. CLAUDE.md's serving-gate docstring narrative (CRT-R5C1-01 "only 'stub' is the current encoder", "healed to disabled") matches the OLD pre-2026-06-15 design, not the current code.
6. `image_embeddings` has a **single-column PRIMARY KEY on `image_id`** (`schema.ts:265`; migration `0012`), `model_version varchar(32)`, `ON DELETE CASCADE` to `images.id`. Column is MEDIUMBLOB on disk; the lib layer base64-encodes on write and base64-decodes on read.

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Status |
|------|------------|------------|-------------------|--------|
| 1 | The "dark" narrative in CLAUDE.md + settings-client comments is STALE; production is now a fully-wired, test-locked serving mode gated only by the DB setting | High | Strong (git + tests + 3 code layers) | CONFIRMED (doc/honesty defect, not runtime bypass) |
| 2 | An authenticated same-origin admin can store `production` despite the missing dropdown item (server validates via validator, not UI whitelist) | High | Strong (settings.ts:63 + validator:170) | CONFIRMED (intended activation path; admin-gated) |
| 3 | Stub and production embeddings can coexist / be cross-compared in one ranking | High (refuted) | Strong (single-col PK + model_version filter) | REFUTED — physically impossible |
| 4 | Embedding failure blocks the queue or prevents `processed=true` | High (refuted) | Strong (fire-and-forget void IIFE after commit) | REFUTED |
| 5 | Unprocessed / private images can leak into search/similar results | High (refuted) | Strong (write-gating + processed filter + no private concept) | REFUTED |
| 6 | similar/[id] is an IDOR oracle exposing private image existence | High (refuted) | Moderate (404 indistinguishable; no private images exist) | REFUTED |
| 7 | The download-script SHA-256 check is a real trust boundary on a request path | High (refuted) | Strong (post-load verify; admin-run offline script) | REFUTED (integrity check only, off request path) |
| 8 | Public/anonymous caller can flip the mode or reach the production branch when DB mode is disabled | High (refuted) | Strong (server re-reads mode; disabled→503) | REFUTED |

---

## Flow 1 — UPLOAD → EMBED

**Path:** `uploadImages()` → `enqueueImageProcessing` (`image-queue.ts:230`) → Sharp `processImageFormats` → conditional `UPDATE processed=true` (`:369-371`) → **fire-and-forget** embedding IIFE (`:433-470`) → `image_embeddings` upsert.

**Evidence:**
- Embedding runs in `void (async () => {...})()` (`:433`) AFTER `processed=true` is committed (`:369`). Documented "MUST NOT block the queue job" (`:411`).
- Mode gate: `if (semanticMode === 'disabled') return;` (`:441`). Default `disabled` → hook is a no-op; **no embedding row is written by default.** (High)
- `production` → `embedImageReal(originalPath)` writing `PRODUCTION_MODEL_VERSION` (`:445-447`); `stub` → `embedImageStub(job.id)` writing `CLIP_MODEL_VERSION='stub-sha256-v1'` (`:448-451`). Production source is the PRIVATE original (`resolveOriginalUploadPath`, `:292`), correct server-side.
- Embed failure: caught and logged only (`catch (embedErr) { console.warn(...) }`, `:467-469`). Does NOT touch `processed`, does NOT retry, does NOT block. (High)
- **Coexistence — REFUTED:** PK is `image_id` alone (`schema.ts:265`). The `onDuplicateKeyUpdate` keyed on `imageId` (`:454-465`) OVERWRITES, replacing `model_version`. At most ONE embedding row per image ever exists; stub and production cannot coexist, cannot be compared in one ranking. Even transiently, each route filters `model_version`. (High)
- model_version provenance consistent across all writers: queue hook (`:447/:450`), stub action (`embeddings.ts:94/99`), sidecar (`backfill-clip-embeddings.ts:78`).

**Conclusion (High):** Deferred/async, never blocks the queue, never gates `processed`. Default `disabled` writes nothing. Stub/production physically mutually exclusive per image. No bug.

---

## Flow 2 — SEARCH QUERY → RESULTS

**Path:** `search.tsx performSearch` (`:152`) → `POST /api/search/semantic` → gates → embed (`embedTextStub` or `embedTextReal`) → cosine over `image_embeddings` filtered by active `model_version` → `topK` → enrich (`processed=true`).

**Evidence:**
- `disabled` → **503 "Semantic search is not fully configured"** (`route.ts:227-233`) after rolling back the rate-limit counter. No embedding, no scan. (High)
- Production branch executes ONLY when `config.semanticSearchMode === 'production'` (`:234`). Server reads mode authoritatively via `getGalleryConfig()` every request (`:222`), fails closed on config error (`:224-226`). The client toggle (`search.tsx:414` gates UI on `!== 'disabled'`) is cosmetic — server is authority. NO path runs the production branch while DB mode is `disabled`. (High)
- model_version segregation: scan filters `eq(imageEmbeddings.modelVersion, activeModelVersion)` (`:254`); `activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : CLIP_MODEL_VERSION` (`:235`). Stub never pollutes production results, vice-versa. (High)
- **Unprocessed/private leak — REFUTED:** enrich query filters `eq(images.processed, true)` (`:303`). Embeddings exist only for processed images (Flow 1). The scan `rows` query (`:251-256`) does not filter `processed`, but: (a) embeddings exist only for processed images by construction; (b) FK `ON DELETE CASCADE` removes embeddings on image delete; (c) the enrich `processed=true` is a second backstop. There is no `private`/`unlisted`/visibility column on `images` (`is_public` exists only on `smart_collections`, `schema.ts:307`). Every processed image is already public at `/p/[id]`. Returning IDs is not a privacy escalation. (High)
- Hardening present: same-origin (`:100`), restore-maintenance 503 (`:104`), strict `application/json` prefix check (`:116-125`), chunked reject (`:128-131`), content-length + 8 KiB body cap (`:135-163`), codepoint-aware min-length 3 (`:185`), rate-limit pre-increment + rollback (`:209`, Pattern 2). `clampSemanticTopK` rejects non-number topK (`:88-92`).

**Conclusion (High):** Disabled → 503, no work. Production branch unreachable unless DB mode is production. No unprocessed/private leak. No bug.

---

## Flow 3 — SIMILAR (`GET /api/search/similar/[id]`)

**Path:** `similar-photos.tsx handleToggle` (`:63`) → `GET /api/search/similar/[id]` → gates → load target embedding for `(id, PRODUCTION_MODEL_VERSION)` → cosine scan (exclude self) → topK → enrich (`processed=true`).

**Evidence:**
- **Production-ONLY** gate: `if (semanticMode !== 'production')` → 503 (`route.ts:102-108`). Stub does NOT serve similar (correct — stub vectors random). Default `disabled` → always 503. (High)
- **IDOR — REFUTED as vuln.** Any caller can pass any positive int `id` (`:74-78`). But (a) no private/unlisted image concept (`schema.ts`); every processed image already public at `/p/[id]`; (b) nonexistent id, unprocessed id, and (hypothetical) private id ALL return the same 404 "No embedding found" (`:122-125`) because embeddings exist only for processed images. No oracle distinguishing "exists but private" from "does not exist." (High; "no private images" is Moderate-strength, corroborated by full schema grep.)
- id with no embedding → 404 (`:122-125`); corrupt embedding (wrong byte length) → 404 (`:128-131`); both roll back the rate-limit counter. (High)
- Self-exclusion: `row.imageId !== id` in scan filter (`:154`). model_version pinned to `PRODUCTION_MODEL_VERSION` for target lookup (`:118`) and scan (`:145`). Enrich filters `processed=true` (`:205`). (High)
- Client returns null on any non-200/network error (`similar-photos.tsx:64-79`) — disabled/stub/404 produce no broken UI.

**Conclusion (High):** Production-only, no IDOR escalation, self-excluded, model-version-pinned, processed-filtered. No bug.

---

## Flow 4 — MODEL DOWNLOAD (`scripts/download-clip-models.ts`)

**Path:** idempotency pre-check → (if needed) `env.cacheDir` set → `AutoModel.from_pretrained` (downloads) → `model.dispose()` → post-download SHA-256 manifest verify → `process.exit(1)` on any mismatch.

**Evidence:**
- SHA-256 verification (`:112-135`) runs AFTER `from_pretrained` already loaded/instantiated the ONNX session (`:97-106`). A corrupt cached file is read by `from_pretrained` BEFORE the checksum is computed. The hash check is an INTEGRITY/operability gate, NOT a pre-execution trust boundary. (High)
- Idempotency pre-check (`:73-85`) DOES verify the existing ONNX checksum and re-downloads on mismatch — a stale/corrupt cache from a prior run is caught on the next invocation before being trusted as "up to date". (High)
- MANIFEST hard-coded (`:41-46`); revision pinned (`clip-model-id.ts:25`), both from the 2026-06-15 spike. Runtime loader (`clip-model.ts:61`) sets `env.allowRemoteModels = false` (offline; pre-seeded volume only). The downloader intentionally allows remote (it IS the downloader).
- Admin-run, offline prep step. NOT on any HTTP request path; runs only when an operator explicitly activates CLIP (forbidden this session).

**Conclusion (Medium-High):** The hash check verifies integrity but is not a strict pre-load trust boundary (model instantiated before verification on a fresh download). Given admin-run/offline/off-request-path and CLIP dark, practical risk LOW. A corrupt file on a FRESH download is loaded once before the post-verify aborts; a corrupt file on a SUBSEQUENT run is caught by the pre-check. Hardening (not required while dark): verify the artifact checksum BEFORE the first `from_pretrained` / before any inference call.

---

## Rebuttal Round

**Best challenge to leader (Hypothesis 1 — "stale docs, not a runtime bypass"):** "If the validator now accepts `production` and the only thing between a deployed gallery and live real-CLIP search is a DB string the admin UI can't even set, isn't the dark gate effectively broken — couldn't a stale `production` row silently activate it?"

**Why the leader still stands:** (a) DEFAULT is `disabled`; a missing/invalid row resolves to `disabled` (`gallery-config.ts:134`). (b) Reaching `production` requires the literal DB string `production`, only written by an authenticated same-origin admin (intended switch), a direct DB write (operator), or the `--production` sidecar — none reachable by an anonymous/public actor. (c) Even if `production` were set, serving requires production embeddings to exist (model_version-filtered scan) AND weights present on the volume; `embedTextReal` throws → semantic 503 (`route.ts:242-245`) and similar 503 if weights absent — a half-activated environment fails closed, not open. (d) Routes are test-locked: `semantic-route-production.test.ts` asserts `disabled → 503`, and `gallery-config-semantic-production.test.ts` asserts the validator accepts disabled/stub/production and rejects anything else. The GATE is intact; what is broken is the DOCUMENTATION describing it.

**Down-ranked:** the "silent activation" framing — it requires an admin-authenticated write, which is the designed switch, not a bypass.

---

## Convergence / Separation Notes

- Hypotheses 1 and 2 converge on one mechanism: **the gate is the DB `semantic_search_mode` value, validated server-side by `isValidSettingValue` (which accepts `production`), independent of the UI dropdown.** Two views (doc-honesty vs activation-path) of the same fact.
- Hypothesis 3 + the Flow-1 coexistence question converge on the **single-column PK** as the physical invariant making stub/production mutually exclusive per image.
- Hypotheses 5 and 6 converge on the **absence of any private/visibility concept on `images`** plus write-gating — both "leak" framings dissolve because there is nothing private to leak.

---

## Current Best Explanation (High confidence)

The CLIP production pipeline (real text + image encoder, model_version-segregated storage, production-gated routes) was deliberately and fully wired on 2026-06-15 and is test-locked. The runtime dark gate is intact and fails closed: default `disabled` → both routes 503, the upload hook writes nothing. Activation requires an admin-authenticated, same-origin write of `semantic_search_mode='production'` (or `'stub'`) — the intended switch, not reachable by any public/anonymous path. There is **no runtime code path that bypasses the dark gating for an unauthenticated actor**, and **no path leaks unprocessed/private images** (no private-image concept; processed-filter + write-gating + FK cascade backstop it).

The one genuine defect is **documentation drift**: CLAUDE.md (CRT-R5C1-01 serving-gate narrative) and `settings-client.tsx` inline comments (`:656-658`, `:668-670`) and the amber legacy-warning logic (`:672+`) still describe the pre-2026-06-15 design ("production not storable", "heals to disabled"), which the validator/resolver/routes now contradict. A future reader trusting those comments would wrongly believe production cannot be activated, and the admin UI gives no in-product way to enable the now-shippable feature.

---

## Critical Unknown

The actual `semantic_search_mode` value in the **deployed production DB** (`gallery.atik.kr`). The code default and all repo artifacts point to `disabled`, but the live row value was not inspected (connecting to prod is outside this read-only trace and the hard guard). If a stale `production` row existed in prod from pre-heal experimentation, the routes would now SERVE it (the resolver no longer heals it) — but only if production embeddings + weights are also present; otherwise it fails closed to 503.

## Discriminating Probe

Read-only check of the deployed setting (no mutation):
```sql
SELECT value FROM admin_settings WHERE `key` = 'semantic_search_mode';
```
Expected `disabled` (or no row). If it returns `stub` or `production`, the dark assumption in CLAUDE.md is violated in that environment and the routes are live — then investigate whether weights/embeddings are present. This single read collapses the only remaining uncertainty.

---

## Uncertainty Notes

- "No private images exist" rests on a full grep of `schema.ts` (only `smart_collections.is_public`; no image visibility column). Confidence High but it is an absence-of-evidence argument — if a future migration adds image-level visibility, Flows 2/3 must add a visibility filter to BOTH the scan and the enrich queries.
- The MEDIUMBLOB-stores-base64-ASCII detail (write base64 text into a binary column; ~2732 on-disk bytes vs 2048 logical) is internally consistent across the traced read/write paths but would break any future consumer reading the column as raw binary. Out of scope for the four flows; flagged for completeness.
- The download-script verification-ordering is Low practical risk only because the script is admin-run/offline/off-request-path AND CLIP is dark; it becomes more relevant if CLIP is ever activated.

---

## Actionable Findings (for aggregator)

- **[MED / High-confidence] Documentation drift — CLAUDE.md + `settings-client.tsx` falsely claim `semantic_search_mode='production'` is unstorable / heals to disabled.** Reality (since 2026-06-15, commits `bb06caad`/`4bbcaaea`): the validator (`gallery-config-shared.ts:170`) accepts it, the resolver (`gallery-config.ts:128-136`) passes it through, and both routes serve real CLIP in production mode (test-locked). Fix: update the CRT-R5C1-01 narrative in CLAUDE.md and the inline comments at `settings-client.tsx:656-658, 668-670`; reconcile the amber legacy-warning logic (`settings-client.tsx:672+`) that still treats a `production` row as a stale/unstorable error.
- **[LOW / High-confidence] Admin UI cannot enable the now-shippable production mode.** The dropdown (`settings-client.tsx:662-663`) offers only `disabled`/`stub`; `production` is reachable only via a crafted same-origin admin request, direct DB write, or the sidecar. If operator-enablement is intended, add a `production` `<SelectItem>` (gated on weights present); if intentionally hidden until weights ship, document that explicitly rather than via the now-false "not storable" comment.
- **[LOW / Medium-High-confidence] `download-clip-models.ts` verifies the ONNX SHA-256 AFTER `from_pretrained` already loads/instantiates it** (`:97-106` before `:112-135`). On a FRESH download a corrupt artifact is loaded once before the post-verify aborts. Practical risk LOW (admin-run, offline, off request-path, CLIP dark; a corrupt cache is re-checked by the idempotency pre-check on the next run). Hardening: verify the checksum before the first model instantiation/inference.
- **[INFO / High-confidence] No runtime dark-gating bypass found.** Default `disabled` → semantic 503, similar 503, upload-embed hook no-op. Production branch unreachable without an admin-authenticated `production` write; routes fail closed on config error and on missing weights (`embedTextReal` throw → 503). No unauthenticated path activates CLIP.
- **[INFO / High-confidence] No unprocessed/private/IDOR leak.** Stub vs production embeddings are physically mutually exclusive per image (single-column PK on `image_id`, `schema.ts:265`). Both routes filter `model_version` on the scan and `processed=true` on the enrich; FK `ON DELETE CASCADE` removes embeddings for deleted images. No private/visibility concept on `images`, so returned IDs are already-public photos. similar/[id] 404 is uniform across nonexistent/unprocessed → no oracle.
- **[INFO / pre-existing, non-CLIP] No new findings on the non-CLIP surface;** prior cycles 1-9 converged to 0 there and this trace did not re-open it.
