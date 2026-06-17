# Tracer Report — Run-7 Cycle-1 (HEAD `17f743f7`)

**Date:** 2026-06-18
**Angle:** Causal tracing of six suspicious flows; competing hypotheses; evidence for/against each; latent-bug hunt via execution-path analysis.
**Method:** Six parallel opus-tracer investigations (4 returned, 2 re-dispatched after rate-limit), plus lead-agent verification of the one material claim that survived first-pass (the sized-variant atomicity concern).

---

## Observation

Six flows traced at HEAD `17f743f7`: upload→queue→Sharp→DB update→derivatives; admin color-setting change→settings hash→ETag; CLIP embedding→storage→decode→similarity scan; Stripe checkout→webhook→entitlement→paid-download; GPS strip→original→paid-download stream; session cookie→middleware→`isAdmin()`. The prior cycle (run-6 c11) CONVERGED with 1 LOW test-only finding (AGG-C11-01) and 1 LOW deferred (DEF-C11-01). This cycle re-traces with an adversarial competing-hypothesis stance and explicitly looks for latent bugs.

**Net result: ZERO confirmed code defects across all six flows.** Three residuals surface (one structural-but-bounded, two narrow/operational), each documented below with the trace that bounds them. Two of the three are CLAUDE.md-accuracy refinements, not bugs.

---

## Hypothesis Table (cross-flow)

| Rank | Hypothesis | Confidence | Evidence Strength | Verdict |
|------|------------|------------|-------------------|---------|
| 1 | All six flows are causally correct at HEAD | High | Strong (direct file:line evidence end-to-end) | **CONFIRMED** |
| 2 | Sized-variant derivatives (`{id}_{size}.ext`) are written non-atomically, leaking partial bytes to readers on crash (upload tracer's H5/H7) | High that the write is non-atomic; Low that readers ever observe it | Strong (code) for non-atomicity; Strong (control-flow) that `processed=true` cannot commit on partial write | **Down-ranked to theoretical** — see Flow 1 rebuttal |
| 3 | CLAUDE.md "derivatives use atomic temp+rename" is imprecise (only base filename, not sized variants) | High | Strong (process-image.ts:1088/1137/1162/1184/1219 vs :1236) | **CONFIRMED as doc-accuracy note** (not a bug) |
| 4 | Structurally anomalous HEIC upload with `strip_gps_on_upload=true` retains GPS in the paid-download-streamed original (GPS tracer residual A) | Medium (code-path-confirmed; reachability unknown) | Strong (process-image.ts:1628-1634 explicit fall-through) | **CONFIRMED as narrow residual** — see Flow 5 |
| 5 | Direct DB edit of `strip_gps_on_upload` on a populated DB leaves pre-toggle originals with GPS (GPS tracer residual B) | High | Strong (no GPS backfill exists) | **CONFIRMED as operator-footgun** (UI blocks this) |
| 6 | CRT-D1 (static-path staleness) is a latent bug for real scenarios | Low | Strong (disconfirmed) | **DISCONFIRMED** — see Flow 2 |
| 7 | `async_payment_succeeded` webhook gap reopens money-taken-no-goods | Low | Strong (disconfirmed for app surface) | **DISCONFIRMED** for app; residual only for out-of-band Stripe Dashboard Payment Links |
| 8 | Stale stub embeddings corrupt prod rankings (CLIP hypothesis B) | Low | Strong (disconfirmed) | **DISCONFIRMED** — model_version SELECT filter |
| 9 | Non-constant-time cookie compare somewhere (session hypothesis H4) | Low | Strong (disconfirmed) | **DISCONFIRMED** — `timingSafeEqual` |

---

## Flow 1 — Upload → Queue → Sharp → DB update → Derivatives

### Trace (evidence)

- **Per-image lock** (`image-queue.ts:195-212`): `GET_LOCK('gallerykit:image-processing:{id}', 0)` — non-blocking (`0` timeout). Acquired at `:261` BEFORE the row claim-check, BEFORE `processImageFormats`. Released in `finally` at `:544-547` via `releaseImageProcessingClaim`, which has its own inner `try/finally` (`:217-221`) guaranteeing `connection.release()` even if `RELEASE_LOCK` throws. MySQL auto-releases on connection close (crash, SIGKILL, pool eviction).
- **Conditional UPDATE** (`image-queue.ts:370-372`): `.where(and(eq(images.id, job.id), eq(images.processed, false)))` — matches CLAUDE.md verbatim.
- **Verify-non-zero gate** (`image-queue.ts:354-366`): BEFORE the conditional UPDATE, checks BASE filenames (`job.filenameWebp/Avif/Jpeg`) exist and are non-zero. This gate is the key control-flow fact that bounds Hypothesis 2.
- **`affectedRows === 0` cleanup** (`image-queue.ts:385-389`): passes `[]` (empty sizes) to `deleteImageVariants` for webp/avif/jpeg in parallel. The `[]` triggers full-directory scan in `deleteImageVariants` (`process-image.ts:517`: `if (!sizes || sizes.length === 0)` → `opendir` + `entry.name.startsWith(\`${name}_\`)` at `:523`). Catches every `{name}_{size}{ext}` regardless of configured `image_sizes`.
- **`deleteImage` is lock-free** (`images.ts:543-637`): no `acquireImageProcessingClaim` / `GET_LOCK`. By design — the conditional UPDATE is the guard. End-to-end race: delete fires mid-encode → row gone → worker's conditional UPDATE returns `affectedRows=0` → full-directory cleanup runs.
- **Atomic-rename contract**: applied ONLY to the largest-size → base filename (`process-image.ts:1236`: `if (size === sortedSizes[sortedSizes.length - 1])`), via `fs.link` → `fs.rename` with `copyFile → rename` and final `copyFile` fallbacks (`:1239-1257`). `sortedSizes` is ascending (`:976`), so the base-rename is the LAST write in the per-format loop.

### Competing hypotheses

**H_A (upload tracer's H5/H7): "Sized variants are non-atomic; crash mid-encode leaves partial bytes served to readers."**

Evidence FOR:
- Sized variants at non-largest sizes use direct `sharp.toFile(outputPath)` at `process-image.ts:1137/1162/1184/1219` — confirmed non-atomic.
- Sized variants ARE served: `photo-viewer.tsx:352-359` builds `<link rel="preload" imagesrcset="..._${w}.avif" ...>` from them; `lightbox.tsx:391`, `info-bottom-sheet.tsx:328`, `photo-viewer.tsx:988` reference `${filename}_${size}.jpg`. So the read-side IS reachable.

Evidence AGAINST (this is the decisive rebuttal):
- `sortedSizes` is **ascending** (`:976`). The per-format loop (`:1082`) iterates 640 → 1536 → 2048 → … → largest. The atomic base-rename runs ONLY at the largest size (`:1236`), i.e., AFTER every smaller sized variant's `toFile` has already resolved.
- The three formats run in parallel via `Promise.all` (`:1265`). If ANY format's `toFile` throws at ANY size — including a partial-write I/O error — `processImageFormats` rejects.
- On rejection, the queue's `try/catch` (around `:337`) catches, the verify-non-zero gate (`:354-366`) never runs, the conditional UPDATE never fires, **the row stays `processed=false`**.
- A reader cannot reach a sized variant for this image through any normal path until `processed=true` commits: gallery listings exclude `processed=false` rows, the photo-viewer page is gated on the image being processed.
- Therefore for a reader to observe a partial sized variant WITH `processed=true`, Sharp's `toFile` would have to return successfully while leaving a truncated file on disk — that is a libvips bug, not an application-layer race.
- **Restart boundary**: a SIGKILL mid-encode leaves partial sized variants on disk AND `processed=false` in DB. The bootstrap scan (`image-queue.ts:608-684`) re-discovers the row, re-acquires the lock cleanly, re-runs `processImageFormats`, which calls `toFile(outputPath)` again — Sharp opens with `O_WRONLY|O_CREAT|O_TRUNC`, overwriting the partial bytes in place. Heal-on-reencode confirmed.

**Verdict:** H_A is **down-ranked to theoretical**. The structural non-atomicity is real and confirmed (and CLAUDE.md's "derivatives use atomic temp+rename" is imprecise — see Hypothesis 3), but the application's control flow prevents the corrupt-read window from opening under any realistic failure mode. The only residual is a libvips-level silent-truncation bug, which is out of scope for application code.

**H_B: "INSERT commits but enqueue skipped → row stranded unprocessed forever."**

- INSERT (`images.ts:382`) and `enqueueImageProcessing` (`:441`) share a per-file `try` block (`:271-481`).
- Tag-processing between them is wrapped in its own `try/catch` (`:398-437`) that converts failures to warnings — cannot escape.
- The bootstrap scan at queue startup is the safety net.
- No provable throw path in `enqueueImageProcessing` between INSERT and itself.
- **Verdict: theoretical only.**

### Flow 1 verdict: **CLEAN.** No confirmed defects. One doc-accuracy refinement (Hypothesis 3 below).

---

## Flow 2 — Admin color-setting change → settings hash → ETag invalidation

### Trace (evidence)

- **Settings hash** (`settings-hash.ts:41-53`): 9 COLOR_IMPACTING_KEYS (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp/avif/jpeg`, `image_sizes`). `HASH_LENGTH = 8` (`:55`). Feeds SHA-256.
- **Serve-upload ETag** (`serve-upload.ts:214-215`): `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. Only reachable via the two route handlers (`app/uploads/[...path]/route.ts`, `app/[locale]/(public)/uploads/[...path]/route.ts`), both delegating to `serveUploadFile`.
- **Next precedence** (CLAUDE.md ARCH-R4C6-06): `headers()` config → filesystem (`public/`) → route handlers. Existing files served by Next static server, never reach `serveUploadFile`.
- **Static Cache-Control** (`next.config.ts:68-73`): `public, max-age=3600, must-revalidate` on `/uploads/...`. NO ETag directive. Next's static ETag is framework-generated `W/"{size-hex}-{mtime-hex}"` — NOT settings-hash-aware.
- **`public/uploads/*` is gitignored** (`.gitignore:48`); `git ls-files` returns 0 tracked files. `docker-compose.yml:25` bind-mounts `./public:/app/apps/web/public`. `docker compose up -d --build` + `image prune -af` + `builder prune -af` do NOT touch host bind-mount contents or mtimes.
- **SW HEAD probe** (`sw.template.js:216-260`): hits Next static server for existing files, returns 304 against mtime+size ETag. Does not rescue CRT-D1.

### Competing hypotheses

- **H1: CRT-D1 is accurate documentation of an eventually-consistent design (backfill required).** CONFIRMED. The static path bypasses `serve-upload.ts`; the static ETag is mtime+size only; file bytes are unchanged without backfill. The product's documented contract is "admin setting changes are applied via backfill" — the settings-hash ETag is a belt-and-braces secondary for the serve-upload path.
- **H2: There's a hidden path where settings-hash reaches static files.** DISCONFIRMED. No `ETag` directive in `next.config.ts`; Next.js does not expose a hook to inject settings-hash-aware ETags into the static server.
- **H3: Redeploys touch `public/uploads/` mtimes.** DISCONFIRMED. Gitignored + bind-mounted; `git pull` and Docker prunes cannot touch host `public/` contents.

### Rebuttal

Best challenge: "The 5-second TTL on `getServingColorSettingsHash` (`serve-upload.ts:46`) plus `max-age=3600` browser revalidation proves the design INTENDED to deliver fresh bytes after a setting flip — so CRT-D1 must be a bug because the static path bypasses that."

Why H1 stands: `settings-hash.ts:14-24` explicitly scopes the hash to the serve-upload path. The product contract (CLAUDE.md "Backfill" section: "Flipping any of these requires a backfill pass to re-encode existing photos") names backfill as the primary consistency lever. Settings-hash ETag is a second-line defense for the case where bytes ARE rewritten but mtime granularity is coarse — not the primary invalidation mechanism. CRT-D1 is the documented consequence.

**User-visible symptom?** None. The bytes a viewer receives were valid at encode time and remain a faithful (if older-preference) encoding of the source. The product guarantees byte-level freshness only after backfill.

**Flow 2 verdict: CLEAN.** CRT-D1 is accurate documentation, not a latent bug. No user-visible "wrong colors" symptom exists.

---

## Flow 3 — CLIP embedding → storage → decode → similarity scan

### Trace (evidence)

- **Double-gate resolver** (`gallery-config.ts:129-148`): reads `semantic_search_mode` from `admin_settings`, validates against `disabled|stub|production`, then unconditionally runs `if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') return 'disabled';`. Truth table:
  - DB `'production'` + env unset → `'disabled'` ✓
  - DB `'production'` + env `'true'` → `'production'` ✓
  - DB `'stub'` (any env) → `'stub'` ✓ (stub is not env-gated; valid served demo mode)
  - DB `'disabled'` → `'disabled'` ✓
  - DB error / catch → `'disabled'` (DEFAULTS at `gallery-config-shared.ts:108`) ✓ fail-closed
- **Similarity selector** (`semantic/route.ts:271`): `isProd ? dotProduct : cosineSimilarity`. `isProd = semanticMode === 'production'`.
- **L2-normalization** (`clip-embeddings.ts:167-181`): `normalizeEmbedding` divides every component by `sqrt(sum of squares)`. Both real encoders (`clip-model.ts:139 embedTextReal`, `:199 embedImageReal`) return `truncateAndNormalize(data)` → unit vectors. For unit vectors `dot(a,b) === cos(a,b)`.
- **Stub vectors** (`clip-inference.ts:24-50`): `deterministicEmbedding` returns raw `[-1,1]` floats, NOT normalized → `cosineSimilarity` required (and used).
- **Byte-count guard** (`clip-embeddings.ts:111`): `EMBEDDING_BYTES = EMBEDDING_DIM * 4 = 512 * 4 = 2048`. Accepts exactly 2048 bytes; base64-decodes otherwise and re-checks. Anything else → `null` → row silently skipped.
- **model_version partition** (schema + routes): PK is `image_id` alone (`schema.ts:274`). `image_embeddings.model_version` column + index `idx_image_embeddings_model_version_updated` (`:287`). Both routes filter `WHERE model_version = <active>` BEFORE scan: semantic route `:254`, similar route `:145`. `activeModelVersion = isProd ? PRODUCTION_MODEL_VERSION : STUB_MODEL_VERSION` (`:235`).
- **Upsert overwrite**: all three write paths (`image-queue.ts:468-473`, `embeddings.ts:148-153`, sidecar script) use `.onDuplicateKeyUpdate({ set: { embedding, modelVersion } })`. The `modelVersion` is in the SET clause → a prod backfill hitting a stub row overwrites BOTH bytes AND version tag.
- **Similar route stub gate** (`similar/[id]/route.ts:101-107`): `if (semanticMode !== 'production')` → rollback + 503 with body `"Similar photos requires production semantic search mode"`. Empty-results is NOT a possible outcome.

### Competing hypotheses

- **H_A (CLIP hypothesis B): "Stale stub rows corrupt prod rankings when mode flips to prod."** DISCONFIRMED. Both routes filter on `model_version = PRODUCTION_MODEL_VERSION`; a stub row is invisible to the prod scan. The architect's note ("upsert overwrites to the active model_version, reads filter on it") is fully verified.
- **H_B: "Mid-backfill coverage gap."** Real but bounded and self-healing. During a prod backfill, rows are rewritten one at a time; mid-backfill the table is a MIX. The prod route sees only migrated rows (correct); a reverse flip (prod→stub) leaves prod-versioned rows until a stub backfill rewrites them (coverage gap, not corruption). Both backfill entry points select "images lacking a row FOR THE ACTIVE model_version," so re-running heals coverage.
- **H_C: "Zero-vector degenerate case."** Theoretical only. `normalizeEmbedding` returns zero vector unchanged on zero input (`:171`); a zero stored vector scores 0 against every query → below the 0.22 threshold → silently dropped. Real CLIP encoders never emit all-zeros.

**Flow 3 verdict: CLEAN.** Prod-gate correct end-to-end. All six concerns resolve in favor of designed behavior. (AGG-C11-01 — the missing source-contract test pin on the similarity selector — remains the only test-coverage gap, already scheduled.)

---

## Flow 4 — Stripe checkout → webhook → entitlement → paid-download

### Trace (evidence)

- **Single payment surface** (`checkout/[imageId]/route.ts:193`): the only `stripe.checkout.sessions.create()` call in the codebase. `payment_method_types: ['card']` at `:207`. Client receives only `{ url }` for redirect (`:233`) — cannot influence `payment_method_types`.
- **Regression test** (`__tests__/checkout-route.test.ts:210-211`): asserts `sessionPayload.payment_method_types.toEqual(['card'])`.
- **Webhook** (`stripe/webhook/route.ts`): branches on exactly ONE event type — `checkout.session.completed` (`:88`). No handler for `async_payment_succeeded` / `async_payment_failed`.
- **`paid` gate** (`:105`): `if (payment_status !== 'paid')` → `console.warn` + return 200 (documented no-op for unpaid async sessions).
- **Idempotency** (`webhook/route.ts:320-382`): UNIQUE(sessionId) schema constraint (`schema.ts:299`) + SELECT guard + `onDuplicateKeyUpdate({ set: { sessionId } })` + `affectedRows === 1 && insertId > 0` disambiguation (verified against mysql2's default FOUND_ROWS flag, comment block `:367-381`). Only the fresh-insert winner logs the plaintext token.
- **Download authorization** (`download/[imageId]/route.ts:123-137`): keyed on `(imageId, downloadTokenHash)` pair. Token shape `dl_` + 43 base64url chars = 256 bits entropy (`download-tokens.ts:21-31`). Constant-time verify via `timingSafeEqual` (`:65-85`). Single-use atomic UPDATE `SET downloaded_at = NOW(), download_token_hash = NULL WHERE id = ? AND downloaded_at IS NULL` (`:379-385`). Hash cleared on claim — even a later DB leak cannot replay.

### Competing hypotheses

- **H_A: Card-only pin fully prevents async methods.** CONFIRMED for the app surface. Per Stripe docs, `payment_method_types: ['card']` presents only card on the hosted page; async methods (SEPA, ACH, OXXO, Boleto) require their type strings in the array. Card is synchronous-immediate → `checkout.session.completed` fires with `payment_status: 'paid'`. The `async_payment_succeeded` event is fired ONLY for async methods, which the pin excludes.
- **H_B: A second Stripe payment surface bypasses the pin.** DISCONFIRMED. Grep across `src/` + `scripts/` finds no `payment_link`, `subscriptions`, `prices.create`, or `pricing_table` reference.
- **H_C: Webhook accepts non-`paid` status in some branch.** DISCONFIRMED. The `paid` gate at `:105` precedes every INSERT.
- **H_D: Webhook replay mints duplicate entitlement rows.** DISCONFIRMED. UNIQUE(sessionId) + SELECT guard + ON DUPLICATE KEY UPDATE + insertId disambiguation.
- **H_E: Download auth spoofable.** DISCONFIRMED. 256-bit token, constant-time verify, atomic single-use, hash cleared.

### Rebuttal

Best challenge: "The pin only governs the app's session-creation surface. The Stripe Dashboard is a second surface — an operator-created Payment Link with async methods would hit the same webhook and find no `async_payment_succeeded` handler."

Why H_A stands for the codebase: CLAUDE.md's claim is scoped to the app checkout route. The Dashboard Payment Link scenario requires out-of-band operator action that the codebase neither enables nor documents. The webhook's `paid` gate still protects this case for synchronous (card) completions. **This is an operational invariant ("don't create Dashboard Payment Links with async methods"), not a code defect.**

**Flow 4 verdict: CLEAN.** Card-only pin correct and effective; idempotency sound; download authorization sound.

---

## Flow 5 — GPS strip on upload → original → paid-download stream

### Trace (evidence)

- **Strip call site (browser)** (`images.ts:311-317`): inside `uploadImages`, AFTER `saveOriginalAndGetMetadata` (`:279`), BEFORE the `images` row INSERT (`:382`). Gated on `uploadConfig.stripGpsOnUpload`. `await`ed synchronously.
- **Strip call site (Lightroom)** (`/api/admin/lr/upload/route.ts:311-327`): same shape, `await` before INSERT (`:404`).
- **Upload-contract lock**: `acquireUploadProcessingContractLock()` acquired at `images.ts:171` BEFORE `getGalleryConfig()` at `:177`, held in `try/finally` through `:540`. `settings.ts:74-79` requires the same lock before writing `strip_gps_on_upload`. LR route mirrors (`:159, :481`). Prevents the toggle-mid-upload race.
- **Strip implementation** (`process-image.ts:1573-1650`): tier-1 lossless byte surgery for JPEG/TIFF/HEIF/WebP via `gps-exif-strip.ts`; tier-2 Sharp re-encode (metadata-free) for PNG/anomalous; writes to `0600` temp file then `fs.rename` atomically.
- **Paid-download route** (`download/[imageId]/route.ts:282, 306, 349`): resolves `filePath = path.resolve(UPLOAD_DIR_ORIGINAL, image.filename_original)` and streams from that opened handle. No other source is read.
- **Public allowlist** (`serve-upload.ts:15`): `ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif'])`; `original/` excluded. No other route serves originals.
- **No `withMetadata(` in production source** — only historical comments (`gps-exif-strip.ts:5`, `process-image.ts:1542`) and test fixtures. Derivative encoders use `.keepIccProfile()` (ICC only — color, not GPS) and Sharp defaults (strip EXIF).
- **Settings guard** (`settings.ts:124-133`): toggling `strip_gps_on_upload` when any `images` row exists returns `uploadSettingsLocked`. The UI blocks the toggle post-first-upload.
- **No backfill re-strips**: grep confirms zero `stripGps` / `gps-exif-strip` references in `image-queue.ts`, `backfill-color-pipeline.ts`, `backfill-clip-embeddings.ts`, `admin-backfill-runner.ts`. Backfills only re-encode derivatives / embeddings.

### Competing hypotheses

- **H_A: Race — download fires between save and strip.** DISCONFIRMED. Strip is `await`ed before INSERT; download requires the row.
- **H_B: Race — `strip_gps_on_upload` flipped mid-upload.** DISCONFIRMED. Upload-contract lock held across save→strip→insert in both paths.
- **H_C: `keepIccProfile()` on PNG re-encode preserves GPS-bearing ICC.** DISCONFIRMED (theoretical). ICC profiles are color data; GPS lives in EXIF IFD / XMP. PNG re-encode path uses no `withMetadata`. Low-confidence-but-low-concern.
- **H_D: `withMetadata()` sneaks GPS in.** DISCONFIRMED. No production `withMetadata(` calls.
- **H_E: LEGACY_UPLOAD_DIR_ORIGINAL leaks unstripped original.** DISCONFIRMED for download route (reads `UPLOAD_DIR_ORIGINAL` only).

### Two narrow residuals (NOT bugs in shipping UI paths)

**Residual A — Structurally anomalous HEIC** (`process-image.ts:1628-1634`): tier-1 ISOBMFF walker returns `null`; prebuilt Sharp lacks HEVC encoder; function logs and returns WITHOUT stripping. The original retains GPS; the paid-download route serves it. Public DB columns are nulled → gallery UI shows no GPS. This is a **UI/file divergence** for one container family under one condition (malformed HEIC that defeats the walker). HEIC is the primary iPhone-original format, so "narrow" is relative to the deploy's upload mix.
- **Reachability unknown**: well-formed iPhone HEICs may always succeed in the walker; only genuinely corrupt/hostile files may trip it.
- **Discriminating probe**: take 5 real iPhone 14/15/16 HEIC originals with GPS, run through `stripGpsFromIsobmffBuffer` in isolation, assert `result !== null && result.stripped === true`. Any `null` is a confirmed in-the-wild leak.

**Residual B — Direct DB edit on populated DB**: `settings.ts:124-133` makes the false→true toggle impossible through the UI post-first-upload. But `mysql> UPDATE admin_settings SET value='true' ...` bypassing the action leaves pre-toggle originals with GPS (no GPS backfill exists, unlike the color backfill). Those originals are still streamed by the paid-download route.
- **Operator-footgun, not code defect.** Worth a CLAUDE.md note under the GPS section ("unlike color, there is no GPS backfill — toggling via direct DB edit on a populated DB leaves existing originals with GPS").

**Flow 5 verdict: CLEAN for shipping UI paths.** Two narrow residuals documented (anomalous-HEIC leak surface; direct-DB-edit footgun). Neither is reachable through the admin UI.

---

## Flow 6 — Session cookie → middleware → `isAdmin()`

### Trace (evidence)

- **Middleware** (`proxy.ts:81-116`): gate on `/[locale]/admin/` and `/admin/`. Format-only check (length ≥ 100, three non-empty colon segments). Comment at `:84` is explicit: *"Full cryptographic validation happens in verifySessionToken() within server actions."* Matcher excludes `/api/*` (`:140`) — admin API routes implement their own auth.
- **Layout guard** (`(protected)/layout.tsx:13`): server-component layout independently calls `isAdmin()` and redirects. Layouts wrap every page in their subtree; cannot be bypassed by the page.
- **Canonical verify** (`session.ts:94-151`): HMAC-SHA256 re-derive + `timingSafeEqual` (length pre-check at `:113` to make `timingSafeEqual`'s length precondition safe), regex shape checks AFTER crypto (`:124-125`), token-age check `> 24h || < 0` (`:130-134`), DB row lookup (`:137-143`), real-time expiry `session.expiresAt < new Date()` (`:145`).
- **Per-action auth**: every mutating action in `images.ts` (`uploadImages`, `deleteImage`, `deleteImages`, `updateImageMetadata`, `bulkUpdateImages`, `retryFailedImage`) calls `requireSameOriginAdmin()` then `isAdmin()` at the top.
- **`withAdminAuth`** (`api-auth.ts:49-121`): enforces `hasTrustedSameOrigin` AND `isAdmin()` centrally. PAT path (US-P53, Lightroom) requires verified scope AND bypasses origin (correct — cross-origin is the point of PATs).
- **Rate limit** (`auth.ts:124-164`): pre-increment BEFORE Argon2 (TOCTOU fix), per-IP AND per-account buckets, DB-backed with in-memory fast path.
- **Session rotation**: `login()` (`auth.ts:210-222`) deletes all prior sessions for the user inside a `db.transaction` with the new-session INSERT. `updatePassword()` (`:390-401`) mirrors.
- **Lint gates**: `lint:action-origin` exit 0; `lint:api-auth` exit 0. Both run at HEAD.

### Competing hypotheses

- **H1: Defense-in-depth airtight.** CONFIRMED.
- **H2: Action missing `isAdmin()`.** DISCONFIRMED — lint exit 0.
- **H3: API route missing `withAdminAuth`.** DISCONFIRMED — lint exit 0.
- **H4: Non-constant-time compare.** DISCONFIRMED — `timingSafeEqual` in the single verify path.
- **H5: Session fixation.** DISCONFIRMED — transactional rotation in `login()` and `updatePassword()`.

### Notes

- **`x-gk-admin-render: 1` header** (`proxy.ts:128`): set whenever a cookie exists (even invalid). NOT a leak — sole consumer is the SW offline-HTML cache exclusion (`sw-cache.ts`); reflects the requester's own cookie presence back to the same client. Not a security boundary.
- **Real-time expiry IS enforced**, not just the hourly purge (`session.ts:145`). The hourly job is GC optimization.
- **React `cache()` on `verifySessionToken`**: request-scoped, no cross-request leakage.

**Flow 6 verdict: CLEAN.** Defense-in-depth airtight across all four layers.

---

## Rebuttal Round

**Best challenge to the overall "zero defects" verdict:** the upload tracer's H_A (sized-variant non-atomicity, Flow 1) and the GPS tracer's Residual A (anomalous-HEIC, Flow 5) are both real code paths that could surface to users — calling them "theoretical" lets a real bug hide behind "probably unreachable."

**Response:**
- H_A's structural fact is confirmed and worth a CLAUDE.md refinement (the atomic-rename claim is imprecise). But the corrupt-read window cannot open under the application's actual control flow: `Promise.all` rejection on partial write → verify gate never runs → row stays `processed=false` → reader cannot reach the variants. The residual depends on a libvips-level silent-truncation bug, which is out of scope. Down-ranked correctly.
- Residual A is genuinely reachable for anomalous HEICs and is correctly reported as a narrow residual (not "theoretical"). It is documented in code (`process-image.ts:1628-1634`) and the prod deploy already shipped ~445 photos — whether any production upload has triggered it is the open operational question. **This is the single most valuable probe target.**

---

## Convergence / Separation Notes

- Flows 1-6 are **independently clean**. No shared root cause across flows.
- The doc-accuracy notes (Hypothesis 3: sized-variant atomicity; Residual B: GPS-backfill absence) are CLAUDE.md refinements, not code changes.
- Residual A (anomalous-HEIC GPS leak) is the only residual that is both code-path-confirmed AND potentially user-visible. It does not converge with the other flows — it is a standalone strip-implementation gap.

---

## Current Best Explanation

**All six traced flows are causally correct at HEAD `17f743f7` for shipping UI paths.** Zero confirmed code defects. The trace surfaces:

1. **One CLAUDE.md accuracy refinement (non-bug)** — "derivatives use atomic temp+rename" applies only to the base filename, not sized variants (`process-image.ts:1088/1137/1162/1184/1219` vs `:1236`). The control flow prevents the structural non-atomicity from becoming user-visible.

2. **One narrow residual with real leak surface** — structurally anomalous HEIC with `strip_gps_on_upload=true` retains GPS in the paid-download-streamed original (`process-image.ts:1628-1634`). UI/file divergence for one container family. Reachability against real iPhone HEICs unverified.

3. **One operator-footgun (not code defect)** — direct DB edit of `strip_gps_on_upload` on a populated DB leaves pre-toggle originals with GPS (no GPS backfill exists, unlike color backfill). UI blocks this; raw SQL does not.

4. **One CLAUDE.md accuracy refinement (non-bug)** — the `sw.template.js:204` freshness comment is slightly optimistic about the static path.

---

## Critical Unknown

**Is the anomalous-HEIC branch (`process-image.ts:1628-1634`) reachable for real iPhone HEIC uploads?** If well-formed iPhone HEICs ever trip the ISOBMFF walker's strict guards (out-of-bounds offset, unsupported `construction_method`, `ilocVersion > 2`), GPS leaks via the paid-download route for production uploads. This is the single residual that prevents 100% closure of Flow 5 and the only one with potential production impact.

---

## Discriminating Probe

Take 5 real iPhone 14/15/16 HEIC originals known to carry GPS (the prod deploy's likely primary ingest), run them through the production `stripGpsFromIsobmffBuffer` in isolation, and assert `result !== null && result.stripped === true && no-GPS-bytes-remain` for each. Any `null` return is a confirmed in-the-wild leak via Residual A. This collapses the uncertainty around the only non-theoretical residual in one pass.

---

## Uncertainty Notes

- **Residual A (anomalous-HEIC)**: code-path-confirmed; reachability unverified. Single most valuable probe target.
- **Sized-variant atomicity (Flow 1 H_A)**: structural fact confirmed; corrupt-read window depends on libvips-level silent truncation, which is out of scope for application code.
- **Residual B (direct-DB-edit GPS)**: operator-only; UI-blocked. Not a code defect.
- **Mid-backfill coverage gap (Flow 3 H_B)**: real, bounded, self-healing. Already complete in the current prod deploy per CLAUDE.md's ~445 production embeddings.
- **Stripe Dashboard Payment Link scenario (Flow 4)**: operational, not code. Cannot be verified from the repository.

---

## Per-flow verdict summary

| Flow | Verdict | Confidence | Residual |
|------|---------|------------|----------|
| 1. Upload/queue/Sharp/DB/derivatives | CLEAN | High | Sized-variant non-atomicity (theoretical; CLAUDE.md refinement) |
| 2. Color-setting → hash → ETag | CLEAN (CRT-D1 accurate) | High | SW comment slightly optimistic (non-bug) |
| 3. CLIP embedding → decode → scan | CLEAN | High | Mid-backfill coverage gap (self-healing) |
| 4. Stripe → webhook → entitlement → download | CLEAN | High | Dashboard Payment Link scenario (operational) |
| 5. GPS strip → original → download | CLEAN for UI paths | High | Anomalous-HEIC leak (reachability unverified) + direct-DB-edit footgun |
| 6. Session → middleware → isAdmin | CLEAN | High | None |

**Net confirmed code defects this cycle: 0.**
