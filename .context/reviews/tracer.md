# Tracer Review — Run-8 Cycle-3 follow-on (post-fix verification)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `ce0029aa` — working tree CLEAN (only `.context/reviews/*.md` peer outputs modified; no source residue).
**Angle:** evidence-driven causal tracing with competing hypotheses. The run-8 c3 MED batch (AGG-R8c3-01..05) was just fixed in commits `0017a34e`..`ce0029aa`. My job: independently re-trace each suspicious end-to-end flow against HEAD code (not the plan's word), confirm the fixes actually close the gaps without new drift, and hunt for genuine bugs the fan-out missed.

**Bottom line:** **No new confirmed bug.** All five target flows trace clean at HEAD. The five just-landed fixes each verified CLOSED with the evidence chain below. The one finding I can add is a documentation-honesty note on the JSON-LD sanitizer scope (LOW, non-exploitable) — every other suspicious path refuted.

---

## Flow 1 — Backfill re-encode → affectedRows check → delete-vs-reencode race (AGG-R8c3-03)

**Hypothesis under test:** does the AGG-R8c3-03 fix (`0017a34e`) actually close the orphaned-derivative leak when a `deleteImage` races an active backfill re-encode of the same id, or is there a residual orphan window?

**VERDICT: REFUTED (fix is real and complete). The race is closed with no residual orphan window. Confidence: High.**

**Evidence chain (the interleaving timeline):**

The backfill holds the per-image processing advisory lock (`admin-backfill-runner.ts:486`) for its whole `processImageFormats` → `detectColorSignals` → `UPDATE WHERE id=?` window. `deleteImage` does NOT take that lock (`images.ts:538-632` — no `getImageProcessingLockName` acquire). `deleteImage`'s two phases are ORDERED: DB-delete transaction first (`images.ts:598-602`), file-unlink second (`images.ts:613-620`). That ordering is the load-bearing invariant. Enumerate the interleavings of `deleteImage` against the backfill's write(T1)/UPDATE(T3):

| Case | Sequence | Backfill UPDATE affectedRows | Outcome |
|---|---|---|---|
| A | delete-row + unlink both complete before backfill writes | 0 | `cleanupDeletedMidReencodeVariants` removes backfill's fresh files (`:573-576`). Clean. |
| B | backfill UPDATE commits before delete-row | 1 | version bumped, files kept; then deleteImage deletes row + unlinks all (`sizes=[]` scans every `{uuid}_*` derivative). Clean. |
| C | backfill writes(T1) → delete-row commits(T2) → backfill UPDATE(T3) | 0 | backfill cleanup(T4) + deleteImage unlink(T5) BOTH unlink the same files. `deleteImageVariants` uses `fs.unlink(...).catch(()=>{})` (`process-image.ts:525`) — ENOENT-tolerant, so the loser's unlink is a swallowed no-op. Clean. |

Because delete-row PRECEDES unlink in `deleteImage`, **if the row is still present when the backfill UPDATE runs, deleteImage has not started unlinking yet** — so the "files gone but row present → UPDATE matches → orphan" failure mode is structurally impossible. Every interleaving terminates with zero orphans.

- **Fix present, both branches:** the success branch (`:557-577`) and the detection-failed-but-encoded branch (`:594-608`) BOTH read `affectedRows` and call `cleanupDeletedMidReencodeVariants` on 0. Symmetric with `image-queue.ts:372-381` (the upload-queue sibling).
- **`sizes=[]` cleanup is safe across images:** filenames are `${randomUUID()}.{ext}` (`process-image.ts:800-804`); the scan matches `entry.name.startsWith('${uuid}_') && endsWith(ext)` (`process-image.ts:511`). Distinct UUIDs → the `{uuid}_{size}.{ext}` namespace is per-image; no cross-image cleanup risk.
- **Counter partition stays exact:** `deleted-mid-reencode` is its own tally (`:720-726`, `:750`), NOT counted as `encode-failed`, and explicitly excluded from the WITH-FAILURES banner (`:787-792` — `hadFailures = encodeFailures||detectionFailures||errors`, deletedMidReencode absent). Correct: a deliberate concurrent delete is not an operator-actionable failure.
- **Best-effort cleanup doesn't escalate:** `cleanupDeletedMidReencodeVariants` wraps the `Promise.all` in `.catch` + warn (`:435-439`), so a stray unlink failure cannot turn a deleted-mid-reencode into a fatal per-row `error`.
- **Test:** `admin-backfill-runner-deleted-mid-reencode.test.ts` forces `affectedRows:0` and asserts cleanup fires for all 3 dirs with `sizes=[]`, the row counts as `deleted-mid-reencode`, run not flagged failed. Mock-driven (not a real DB interleaving), but pins the exact contract.

**Evidence against (where I tried to break it):** I looked for a window where backfill writes AFTER deleteImage's unlink but the UPDATE still matches `affectedRows=1`. Refuted by the delete-row-before-unlink ordering. I looked for the cleanup unlinking a live image's files via prefix collision. Refuted by UUID filenames.

---

## Flow 2 — Color detection precedence (NCLX → ICC chromaticity → ICC name) → encoder decision → delivered bytes → admin audit columns

**Hypothesis under test:** does the admin audit (`color_primaries` / `color_pipeline_decision` / `transfer_function`) ever DISAGREE with the bytes actually delivered? (The NCLX-first-audit vs ICC-first-delivery precedence inversion is documented-intentional — only genuine drift is a finding.)

**VERDICT: REFUTED (audit and delivery derive from the same inputs via parallel resolvers; they agree by construction). Confidence: High.**

**Evidence chain:**

At upload (`process-image.ts:899-900`):
- `colorSignals = detectColorSignals(...)` — NCLX-first per-field (`color-detection.ts:370-387`), populates the AUDIT `color_primaries` (public) + `transfer_function`/`matrix_coefficients`/`is_hdr` (admin).
- `colorPipelineDecision = resolveColorPipelineDecision(iccProfileName, colorSignals)` — ICC-name-first (`process-image.ts:683-712`), stored as the AUDIT `color_pipeline_decision`.

At encode (`process-image.ts:974`): `processImageFormats` receives the SAME `iccProfileName` + `signals` (= `job.colorSignals` from `image-queue.ts:345`) and calls `resolveAvifIccProfile(iccProfileName, signals)`. The delivered AVIF gamut and the stored `color_pipeline_decision` BOTH key off the same `(iccProfileName, colorPrimaries)` pair. The only way they could disagree is if `resolveColorPipelineDecision` and `resolveAvifIccProfile` mapped the same input to inconsistent gamuts — they don't (both: displayp3/p3d65→P3, adobe/prophoto/rec2020→P3-from-wide, srgb→sRGB). The documented inversion (`process-image.ts:665-682`) is between `color_primaries` (records the CONTAINER's NCLX tag) and `color_pipeline_decision` (records the EDITING working-space ICC) — two different questions, both accurately recorded, NOT a contradiction.

- **AGG-R8c3-01 (NCLX code-2 isHdr side-effect) — fix verified:** the per-field guard (`color-detection.ts:384-386`, `if (nclxTransfer !== undefined) transferFunction = nclxTransfer`) preserves the ICC-name-derived transfer when NCLX transfer is code-2 (Unspecified, absent from `NCLX_TRANSFER_MAP`). The commit (`22387f32`) ADDED the honest doc-comment (`:389-401`) correcting the prior false "no delivered-byte impact" claim: when ICC name asserts PQ/HLG + NCLX transfer is code-2, `isHdr=true` → `images.ts:283` REJECTS the upload when `allow_hdr_ingest=false`. The rejection is correct (an HDR-named source IS HDR for the SDR-only pipeline). Tests present: `color-detection.test.ts:246` (code-2 doesn't erase ICC) + `:266` (code-2 transfer + PQ-named ICC → isHdr true). **CLOSED.**
- **isHdr derivation honest:** `is_hdr = transferFunction === 'pq' || 'hlg'` (`color-detection.ts:401`), admin-only, gates upload at `images.ts:283`. No path delivers an HDR badge whose bytes are SDR (HDR sources are rejected pre-ingest by default).
- **`color_primaries` correctly public, all transfer/matrix admin-only** — consistent with the `_PrivacySensitiveKeys` guard.

**Evidence against:** I looked for a mismatched-container case (sRGB-named ICC inside P3-tagged NCLX) producing a delivery the audit doesn't reflect. The audit row shows `color_primaries=p3-d65` + `srgb`-family decision — an accurate record of the conflict, and delivery follows the ICC-name decision exactly as stored. No drift.

---

## Flow 3 — OG image generation (home + photo route) → sanitizeForOg → ImageResponse

**Hypothesis under test:** any unsanitized rendered string, oversize/blank-image failure mode, or unmetered-amplification path?

**VERDICT: REFUTED for exploitability/failure modes. One LOW doc-honesty observation (TRC-1) on the JSON-LD sanitizer scope. Confidence: High.**

**Evidence chain:**

- **Photo OG route** (`api/og/photo/[id]/route.tsx`): both rendered strings sanitized — `siteTitle` (`:81`) and `displayTitle` (`:83`) via the shared `sanitizeForOg`. The embedded `photoDataUrl` (`:116`) is base64 of an OWN-ORIGIN internal fetch — no injection sink. Every non-success branch is a 302 to the site OG (`:235-259`), never a 404/blank/oversize. Output capped 1200×630; the source photo is byte-capped at `OG_PHOTO_MAX_BYTES = 1MB` per attempt (`og-photo-fetch.ts:31,57,59`) with a 10s `AbortSignal.timeout` (`:53`). Rate-limited 30/60s/IP (`:46`); fallback branches stay CHARGED (`:77,109,217` — no enumeration/amplification oracle).
- **Home/site OG route** (`api/og/route.tsx`): `topicLabel` (`:82`), `siteTitle` (`:83`), and each `tag` (`:88`) all through `sanitizeForOg`. Validator-gated inputs (`isValidSlug`/`isValidTagName`), codepoint-safe clamp (`clampDisplayText`, `:26-31`), ETag short-circuit (`:97`), rate-limited (`:54`). Error branch `no-store` (`:20`).
- **Home `og:image` → `/api/og/photo/${id}`** (AGG-R8-02, `page.tsx:112-118`): 1200×630 per-photo card with the no-404 guarantee preserved by `pickFirstAvailablePhotoBuffer`'s ascending-size fallback → site OG. No oversize-base-JPEG outlier.
- **Shared sanitizer** (`og-sanitize.ts:28-29`): `stripUnicodeFormatting` (GLOBAL replace-all — bidi + zero-width) THEN `OG_C0_CONTROL_CHARS` strip. Correct.

**TRC-1 (LOW, doc-honesty, non-exploitable) — JSON-LD sanitizer scope is partial AND undocumented:** `p/[id]/page.tsx` correctly imports the shared `sanitizeForOg` (AGG-R8c3-02 `0028ede4` CLOSED — no local copy, C0-strip present), but it only applies it to the EXIF-derived JSON-LD fields — `camera_model` (`:222`), `lens_model` (`:223`), `exposure_time` (`:226`). It is NOT applied to `name: displayTitle` (`:217`), `description: image.description` (`:218`), `keywords` (`:219`), or breadcrumb `name: image.topic_label || image.topic` (`:246`). NOT a defect: `safeJsonLd` (`:264,:271`) escapes the entire object, AND title/description/topic_label are `containsUnicodeFormatting`-rejected at write time (`validation.ts`), so they cannot carry bidi/zero-width chars. The EXIF fields get the extra strip precisely BECAUSE they come from the photo file's embedded metadata (not validator-gated). This is the correct security posture — the only gap is that the asymmetry isn't documented, so a future reader could mistake it for an oversight and either over-apply (harmless) or, worse, conclude the validator-gating is unnecessary and loosen it. **Fix (optional):** a one-line comment at `:222` noting "EXIF metadata is not validator-gated, unlike title/description/topic_label which are stripped at write time, hence the extra sanitizeForOg here." No code change required.

**Evidence against:** I checked whether a base-JPEG could still leak into the home OG (the pre-AGG-R8-02 oversize bug). Refuted — `page.tsx:114` points at the per-photo route, not the base file.

---

## Flow 4 — Service worker fetch → ETag HEAD probe (300ms abort) → stale-while-revalidate → LRU evict

**Hypothesis under test:** any hang, lost-update affecting served bytes, or stale-serve bug?

**VERDICT: REFUTED for hangs and served-byte correctness. The LRU meta lost-update (AGG-R8c3-10) is real but served-byte-neutral and best-effort by design. Confidence: High.**

**Evidence chain:**

- **Bounded HEAD (AGG-R8-05, `9b7bb240`):** `staleWhileRevalidateImage` does a synchronous HEAD with `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)` (`sw.template.js:230`). On timeout/abort/network-failure the `catch` (`:245`) falls through to `startRevalidate(); return cached` (`:253-254`) — **no hang**, serves stale immediately, background revalidate self-heals. On `304` → serve cached, touch recency, no body fetch (`:232-236`). On `200` + differing ETag → await revalidate, serve fresh (`:238-243`). Pinned by `sw-template-contract.test.ts` drift guard; the `sw.js` build artifact carries the same `:38,230` per the aggregate.
- **Single body GET:** `startRevalidate` is a lazy single-flight closure (`:179-196`) — the GET fires at most once; the 304 path never issues a GET. No N-concurrent-identical-GET storm.
- **AGG-R8c3-10 lost-update (LOW, served-byte-neutral):** `recordAndEvict` (`:95-122`) and `touchMeta` (`:152-160`) do `getMeta → mutate → setMeta` over a single `/__meta__` doc with no CAS/single-flight. N concurrent masonry tiles drop each other's meta writes. BUT the actual image bytes live in separate `imageCache.put(cacheKey, ...)` entries per URL (`:189`), untouched by the meta race. Only the LRU `total`/timestamps drift → cache may exceed the 50MB cap until browser-quota eviction. No served-byte impact. Documented best-effort cache posture; defensible to DEFER. The `recordAndEvict` `total` adjustment is already quota-aware (`:114` — only decrements when `imageCache.delete` returned true).
- **HTML offline fallback** (`networkFirstHtml:262-284`): caches only `200 && x-gk-admin-render !== '1'` (`:270`) as OFFLINE-ONLY fallback, stamps `sw-cached-at` (`:275`), evicts to `MAX_HTML_ENTRIES` (`:282`). Admin-render personalization decided server-side (SW can't read the Cookie). Correct.

**Evidence against:** I checked whether the HEAD-then-GET path could leave the cache without bytes on a slow revalidate (the `await startRevalidate()` at `:241` could resolve null on network failure → falls through to `return cached`). On the no-cache path (`:258`) a null revalidate returns a 503 Response — correct, never undefined. No lost-update of actual served bytes.

---

## Flow 5 — Upload → quota → advisory lock → Sharp process → conditional UPDATE → serve

**Hypothesis under test:** where could a delivered byte mismatch the photographer's intent, or a race orphan files / double-process?

**VERDICT: REFUTED (no byte-mismatch, no double-process, no orphan on the upload path). Confidence: High.**

**Evidence chain:**

- **Per-image claim + conditional UPDATE:** the queue worker acquires `gallerykit:image-processing:{id}` (non-blocking, `image-queue.ts:193-210`), re-checks `WHERE processed = false` (`:284`), and after encode does a conditional `UPDATE ... WHERE id=? AND processed=false` with `affectedRows===0 → cleanup variants` (`:368-381`). Two workers across a restart boundary cannot both convert the same upload (the loser fails the claim, retries with escalating backoff, MAX_CLAIM_RETRIES=10). Output verification (`:352-364`, all 3 formats non-zero) runs BEFORE the processed flip — so a partial encode never marks the row delivered.
- **Byte-intent integrity:** delivered AVIF gamut keys off `resolveAvifIccProfile(iccProfileName, job.colorSignals)` (`process-image.ts:974`), the same inputs as the stored audit decision (Flow 2). Per-format fresh `sharp(inputPath,…)` (`:1254-1256` `generateForFormat`) eliminates shared-state cross-format contamination. Photographer's working-space → P3 (10-bit when probed) for wide-gamut, sRGB for sRGB — matches the CLAUDE.md decision matrix.
- **HDR honesty gate:** `isHdr && !allowHdrIngest → reject + delete original` (`images.ts:283-289`) BEFORE the row is processed. No HDR-named source delivers SDR bytes under an HDR badge (the badge fields are admin-only AND the source is rejected).
- **GPS strip on the served original:** `stripGpsOnUpload → stripGpsFromOriginal` (`images.ts:311`) neutralizes the on-disk original the paid-download route streams.
- **Orphan cleanup on insert failure:** invalid `insertId` → `deleteOriginalUploadFile` (`images.ts:383`); detection throw → `fs.unlink(originalPath)` before re-throw (`process-image.ts:934-937`).

**Evidence against:** I checked the quota/upload-contract lock for a TOCTOU where `image_sizes` changes mid-upload. The `gallerykit_upload_processing_contract` lock (released in `finally`, `images.ts:533-535`) + the upload-start config snapshot (`uploadConfig`) used for both the HDR gate and GPS strip mean the first committed image can't race a contract change. No byte-mismatch found.

---

## Findings by severity

### LOW
- **TRC-1** — JSON-LD sanitizer scope is partial-by-design but undocumented (`p/[id]/page.tsx:217-219,222-226,246`). Non-exploitable (`safeJsonLd` escapes everything; title/description/topic_label are write-time validator-gated; EXIF fields get the extra strip because they are not gated). Optional one-line clarifying comment. Confidence: High.

### Record-only (confirmed unchanged, not defects)
- AGG-R8c3-10 SW LRU meta lost-update — served-byte-neutral, best-effort by design. DEFER (matches aggregate).

---

## VERIFIED-CLEAN (independently re-traced this cycle, NO action)

- **AGG-R8c3-01** (NCLX code-2 isHdr) — per-field guard preserves ICC transfer; honest doc-comment replaces the false commit claim; 2 tests pin both the no-erase and the isHdr-true branch. `color-detection.ts:384-401`, `color-detection.test.ts:246,266`. CLOSED.
- **AGG-R8c3-02** (third og-sanitize copy) — `p/[id]/page.tsx:14` imports the shared `sanitizeForOg`; no local copy; C0-strip present; lying docstring removed. CLOSED.
- **AGG-R8c3-03** (backfill orphan-on-delete) — both UPDATE branches read `affectedRows`, cleanup on 0 with `sizes=[]`, new `deleted-mid-reencode` tally excluded from the failure banner; interleaving analysis shows zero residual orphan window; UUID filenames preclude cross-image cleanup. CLOSED.
- **AGG-R8c3-05** (home two heavy queries) — `getLatestImageForOgCached` (`data.ts:873,1597`) is a `cache()`-wrapped minimal `SELECT id, title … LIMIT 1` with NO tag JOIN/GROUP_CONCAT/GROUP BY; `page.tsx:93` uses it for the OG card. CLOSED.
- **Audit-vs-delivery consistency** — `color_pipeline_decision` (stored) and the delivered AVIF gamut both derive from `(iccProfileName, colorSignals.colorPrimaries)` via parallel resolvers; the documented NCLX-first/ICC-first inversion is between two different recorded questions, not a contradiction.
- **OG fallback honesty** — `pickFirstAvailablePhotoBuffer` ascending-size chain with per-attempt 10s timeout + 1MB cap → site-OG 302 after all sizes fail; no blank/oversize image escapes; fallback stays rate-charged (no enumeration oracle).
- **SW** — 300ms-bounded HEAD never hangs; single-flight lazy GET; 304 skips body; served bytes are per-URL Cache entries unaffected by the meta race.
- **Upload path** — per-image claim + `WHERE processed=false` conditional UPDATE + `affectedRows===0` cleanup; pre-flip 3-format verification; HDR-reject-before-process; orphan cleanup on insert/detection failure.

---

## Critical unknown / next probe (none blocking)

No flow ended UNCERTAIN. The only residual uncertainty is a non-issue: the AGG-R8c3-03 test is mock-driven (forces `affectedRows:0`) rather than a real concurrent-delete integration test. The causal interleaving analysis (delete-row-before-unlink ordering + ENOENT-tolerant unlink + UUID namespacing) closes the gap deductively, so an integration test would only add belt-and-braces, not change the verdict. If a future change ever makes `deleteImage` unlink files BEFORE deleting the row, that ordering invariant breaks and the orphan window re-opens — that is the single fact to re-probe if the delete path is refactored.
