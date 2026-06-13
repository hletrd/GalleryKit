# Tracer — Cycle 3 Causal Trace Report

HEAD: `ada92ba5`. Scope: evidence-driven end-to-end tracing of 5 high-stakes data flows touched by run-8 cycle-2 commits. Prior cycle closed AGG-R8-01..13 — verified for regressions, not re-reported.

Verdict legend: confirmed-correct / confirmed-bug / needs-manual-validation. Confidence High/Medium/Low.

---

## TRC-1 — HOME OG IMAGE (commit 73496d2f)

### Observation
`generateMetadata` in `page.tsx` now emits `og:image = /api/og/photo/${latestImage.id}` (1200×630) instead of the base JPEG (AGG-R8-02). The chain is: home metadata → that route URL → `og/photo/[id]/route.tsx` → `pickFirstAvailablePhotoBuffer` on-disk fallback → `OG_PHOTO_MAX_BYTES` cap.

### Hypotheses
- **H-1a** Home page passes the right params for `/api/og/photo` to embed the latest photo.
- **H-1b** `/api/og/photo` can 404 / return oversized / blank in some state.
- **H-1c** Absolute-URL construction is correct across locales / proxy.

### Trace (file:line)
1. `page.tsx:92` `getImagesLite(undefined, …, 1, 0)` → `latestImage = images[0]` (`:93`). `getImagesLite` selects `...publicSelectFields` (`data.ts:733`), which includes `id`, `title`, `filename_jpeg`.
2. `page.tsx:112-119` builds `og:image` only when `latestImage` exists; URL = `absoluteImageUrl('/api/og/photo/${latestImage.id}', seo.url)`. Only the **id** is passed — the route re-fetches everything by id.
3. `og/photo/[id]/route.tsx:62-66` `getImageCached(imageId)` → `getImage` (`data.ts:923`), which filters `eq(images.processed, true)` (`:940`) and returns `publicSelectFields` incl. `filename_jpeg`.
4. `route.tsx:77-79` if `!image` → `buildFallbackResponse(..., seo.og_image_url || undefined)` → **302** to site OG or `origin/` (`:235-259`). Never a broken-image 404 to the crawler.
5. `route.tsx:103-108` `origin = new URL(req.url).origin`; `pickFirstAvailablePhotoBuffer(origin, image.filename_jpeg, config.imageSizes)`.
6. `og-photo-fetch.ts:75-86` sorts sizes ascending, tries each `tryFetchPhotoBuffer`; `:44-67` rejects non-2xx, `Content-Length > OG_PHOTO_MAX_BYTES`, buffered `length > OG_PHOTO_MAX_BYTES` (1 MB, `:31`), and 10 s timeout → returns the first sized derivative under cap.
7. `route.tsx:109-115` if `!fetched` (every size 404/over-cap mid-backfill) → `buildFallbackResponse(..., OG_SUCCESS_CACHE_CONTROL, seo.og_image_url)` → **302**.
8. Success: Satori PNG → `postProcessOgImage` (`:29-35`) → sRGB JPEG q88 → `Response` 1200×630.

### Evidence FOR
- **H-1a**: `latestImage.id` is sufficient; the route owns its own fetch. `filename_jpeg` is guaranteed present on the re-fetched row (`publicSelectFields`). ✔
- **H-1c**: `absoluteImageUrl` (`image-url.ts:44-50`) resolves through `imageUrl` then `new URL(resolved, seo.url)`. `seo.url` is the configured site origin (locale-independent). The OG `<meta>` is intentionally a **single canonical absolute URL**, not locale-prefixed — correct: OG image URLs are not localized, and `/api/og/photo` carries no locale segment. Inside the route, `origin = new URL(req.url).origin` is used for the internal photo fetch, so Satori fetches `${origin}/uploads/jpeg/...` on the same host the request landed on — proxy-correct. ✔
- **H-1b (against, mostly)**: every non-success branch returns a **302**, never a hard 404/blank to the crawler; the 1 MB cap structurally prevents the oversized-base-JPEG problem the commit targeted (Twitter's 5 MB limit). The base-JPEG outlier is gone. ✔

### Evidence AGAINST / Gaps
- **H-1b residual (LOW):** `og:image` width/height are hard-asserted `1200×630` at `page.tsx:115-116`, but on the fallback path the route returns a **302 redirect** to `seo.og_image_url`, whose real dimensions are whatever the admin uploaded. If the admin's site OG isn't 1200×630, the declared meta dims mismatch the delivered bytes for freshly-uploaded/mid-backfill photos. This is a transient-window cosmetic mismatch (crawlers re-fetch on the 302's non-immutable cache), and the *home-card-specific* concern (oversized) is resolved. Not a regression introduced by this commit (the per-photo route already behaved this way for `/p/[id]`).
- **`alt` text (`page.tsx:117`)** uses `latestImage.title` raw (filename-guarded via `isLatestTitleFilename`). `alt` is an HTML meta attribute rendered by Next's metadata serializer (escaped), NOT Satori-rendered, so the OG-sanitize concern does not apply here. The Satori-rendered title is re-derived and sanitized inside the route (see TRC-2). ✔

### Verdict
**confirmed-correct** — High. The home OG no longer ships the oversized base JPEG; the no-404 guarantee is preserved via 302 fallback; cross-locale/proxy URL construction is correct. One LOW cosmetic note (declared 1200×630 vs admin-OG dims on the fallback path) is pre-existing and shared by all per-photo OG consumers.

---

## TRC-2 — OG SANITIZE SYMMETRY (commits d5399742 / ada92ba5)

### Observation
Both OG routes now import `sanitizeForOg` from the shared `@/lib/og-sanitize` (`route.tsx:5`, `og/photo/[id]/route.tsx:8`). The shared fn (`og-sanitize.ts:28-30`) = `stripUnicodeFormatting(value) ?? ''` then `.replace(OG_C0_CONTROL_CHARS, '')`.

### Hypotheses
- **H-2a** Both call sites sanitize ALL untrusted Satori-rendered strings identically.
- **H-2b** Some string reaches Satori unsanitized in one route but not the other.

### Trace — enumerate every string node rendered into each `ImageResponse`

**`api/og/route.tsx` (topic/site card)** renders exactly 3 untrusted text surfaces:
- `siteTitle` (`:153`) ← `sanitizeForOg(seo.title || siteConfig.title)` (`:83`) ✔
- `topicLabel` (`:170`) ← `sanitizeForOg(clampDisplayText(topicRecord.label, …))` (`:82`) ✔
- `tagList[]` (`:184-197`, rendered as `#{tag}`) ← each `sanitizeForOg(clampDisplayText(t, …))` (`:88`) ✔

**`api/og/photo/[id]/route.tsx` (per-photo card)** renders exactly 2 untrusted text surfaces:
- `displayTitle` (`:173-187`) ← `sanitizeForOg(getPhotoDisplayTitle(image, …))` (`:82-83`) ✔
- `siteTitle` (`:198`) ← `sanitizeForOg(seo.title || siteConfig.title)` (`:81`) ✔

### Evidence FOR
- **H-2a**: Both routes route every user/admin-controlled rendered string through the *same* `sanitizeForOg`. `stripUnicodeFormatting` uses the GLOBAL-flag twin `UNICODE_FORMAT_CHARS_GLOBAL` (`validation.ts:82,92-94`) → replace-ALL of bidi + zero-width (the module doc at `og-sanitize.ts:18-21` explicitly warns a non-global replace would strip only the first). C0 strip via `OG_C0_CONTROL_CHARS` (`og-sanitize.ts:25`). Identical processing on both sides. ✔
- **No author surface anywhere**: grepped both routes — neither renders an `author`/`uploaded_by`/`author_name` field into Satori. `author_name` exists only in the feed query (`data.ts:784`), which is the Atom route, not an OG card. The task's "author" string is not a Satori sink on either OG route. ✔
- **`displayTitle` derivation is safe**: `getPhotoDisplayTitle` (`photo-title.ts:33-56`) only concatenates `image.title` and `humanizeTagLabel(tag.name)` (a `_`→space replace, `:29-31`); it introduces no new unsanitized branch — the *result* string is wrapped by `sanitizeForOg` at the call site (`route.tsx:83`). The tags-from-`tag_names` path (`getPhotoDisplayTitleFromTagNames`, `:67-83`) feeds into the same wrapped result. ✔

### Evidence AGAINST / Gaps
- None. Both routes are exhaustively covered; no string escapes sanitization on either side. The earlier symmetry gap (home route rendered raw) is closed and pinned by `og-sanitize` test (commit ada92ba5 — "pin shared og-sanitize global-strip contract").
- Defense-in-depth only (not a live exploit): inputs are admin-controlled, validator-rejected at write time (`containsUnicodeFormatting`), and Satori has no script sink — consistent with the module's own honesty doc (`og-sanitize.ts:6-16`).

### Verdict
**confirmed-correct** — High. Symmetry gap closed; both routes sanitize all (and only) the strings they render, identically, via one shared global-strip function. No unsanitized string reaches Satori on either route.

---

## TRC-3 — COLOR DETECTION NCLX↔ICC (commit 74235265)

### Observation
`detectColorSignals` previously applied `NCLX_*_MAP[code] ?? 'unknown'` unconditionally when an nclx box existed (pre-fix), clobbering ICC-derived transfer/matrix/primaries with `'unknown'` for H.273 code 2 ("Unspecified"). Now each field applies only `if (… !== undefined)` (`color-detection.ts:381-386`).

### Hypotheses
- **H-3a** Audit columns (`transfer_function`, `matrix_coefficients`, `color_primaries`, `color_pipeline_decision`) are now internally consistent and match CLAUDE.md "NCLX > ICC chromaticity > ICC name" per-field precedence.
- **H-3b** Residual cases where stored columns disagree (a real contradiction, not a documented divergence).

### Trace (file:line)
1. ICC-derived baseline computed first: `colorPrimaries = inferColorPrimaries(iccName)` (`:343`), `transferFunction = inferTransferFunction(...)` (`:344`), `matrixCoefficients = inferMatrixCoefficients(iccName)` (`:345`).
2. ICC-chromaticity upgrade when name opaque (`:357-368`) — the middle precedence tier.
3. NCLX override per-field (`:381-386`): `nclxPrimaries = NCLX_PRIMARIES_MAP[code]`, applied only when `!== undefined`. **Confirmed code 2 is absent from all three maps** — `NCLX_PRIMARIES_MAP` keys {1,9,11,12}, `NCLX_TRANSFER_MAP` keys {1,4,5,6,7,8,11,13,14,15,16,17,18}, `NCLX_MATRIX_MAP` keys {0,1,8,9,10}. So code 2 → `undefined` → ICC value survives.
4. `is_hdr` derived from `transferFunction` (`:389`) — now correctly stays SDR when a code-2 transfer falls back to an `srgb`/`gamma*` ICC value instead of being forced to `'unknown'`.

### Evidence FOR
- **H-3a**: The fix implements *exactly* the per-field precedence: NCLX where specified, else the lower ICC tier. The test cited in the commit (`color-detection.test.ts`: NCLX(12, code-2, code-2)+sRGB-ICC → primaries `p3-d65` but transfer `srgb`/matrix `identity` survive) matches the code path: `NCLX_PRIMARIES_MAP[12]='p3-d65'` overrides, `NCLX_TRANSFER_MAP[2]=undefined`/`NCLX_MATRIX_MAP[2]=undefined` preserve ICC. ✔
- **`color_pipeline_decision` divergence is documented and intentional** (`process-image.ts:665-682` COR-2 note): the resolver prioritises ICC working-space NAME (editing intent / delivery driver), while `color_primaries` is NCLX-first (source container tag). On a deliberately-mismatched container (sRGB-named ICC inside P3 NCLX) the audit row shows `color_primaries=p3-d65` + an `srgb`-family decision — an accurate record of the conflict, by design. `resolveColorPipelineDecision` falls back to `resolveDecisionFromPrimaries(signals?.colorPrimaries)` only when `!iccProfileName` (`:683-685`). ✔

### Evidence AGAINST / Gaps
- **Matrix code 0 ('identity') edge — verified safe.** `NCLX_MATRIX_MAP[0]='identity'` (a *defined, truthy-string* value). The guard uses `!== undefined`, NOT truthiness, so code 0 correctly overrides ICC matrix to `'identity'` rather than being skipped. A `??`-only or truthiness guard would have been a bug here; the `!== undefined` form is correct. ✔
- **Chromaticity-backfilled matrix interaction (LOW, not a contradiction):** at `:364-366`, when chromaticity identifies a gamut and matrix was `'unknown'`, matrix is set to `'identity'`/`'bt2020-ncl'`. A later NCLX matrix (if defined) still overrides it (`:386`) — correct precedence (NCLX > chromaticity). No disagreement.
- No residual contradiction found. The one apparent "disagreement" (primaries vs decision) is the documented, test-locked by-design divergence, not a bug.

### Verdict
**confirmed-correct** — High. Per-field NCLX>ICC precedence is correctly implemented; code 2 and code 0 both handled correctly via `!== undefined`. The primaries/decision divergence is intentional and documented. Audit columns are internally consistent under the documented contract.

---

## TRC-4 — BACKFILL WIDTH (commit e8fce327)

### Observation
`admin-backfill-runner.ts:411-426` adds a `!Number.isFinite(row.width) || row.width <= 0` guard before `processImageFormats`, returning `{ ok: false, reason: 'encode-failed' }` with a distinct log.

### Hypotheses
- **H-4a** A width=0/corrupt row now fails gracefully with no silent stale-version strand (retries next run).
- **H-4b** The guard introduces a version bump or skips retry.

### Trace (file:line)
1. `reprocessOne` (`admin-backfill-runner.ts:~400`): after the `missing-original` check (`:408`), the new guard (`:417-424`) short-circuits with `reason: 'encode-failed'` for `width <= 0` / non-finite.
2. CLAUDE.md contract: backfill is idempotent — `encode-failed` means **no `pipeline_version` UPDATE**, so the row stays below `IMAGE_PIPELINE_VERSION` and remains a candidate for the next run (`WHERE pipeline_version != IMAGE_PIPELINE_VERSION`).
3. The guard sits BEFORE the lock-critical re-encode/detection/UPDATE block (`:428+` "LOCK-CRITICAL"), so no advisory lock is acquired and no DB write happens for a bad-width row.

### Evidence FOR
- **H-4a**: Returning `encode-failed` (not a success/skip) guarantees the version is NOT bumped → no stale-version strand → retried next run after metadata repair. The distinct `console.error` (`:419-422`) separates bad-metadata from genuine Sharp encode failures for operators. Mirrors the upload-path dimension guard in `process-image.ts`. The CLAUDE.md "no version bump on detection failure" invariant (Run-2 Cycle 1 AGG-01/02), pinned by `admin-backfill-runner-detection-failure.test.ts`, is consistent with this classification. ✔
- The `Number.isFinite` check also catches `NaN`/`Infinity`/`null`-coerced widths, not just `<= 0` — broader than the strict requirement. ✔

### Evidence AGAINST / Gaps
- **Counter-classification (LOW, by design):** a bad-width row is counted as `encode-failed` in the run summary, conflating "needs metadata repair" with "real encode failure." The commit explicitly accepts this (the distinct log is the mitigation) and `width` is `NOT NULL` in schema, so this is defensive-only. Commit f3667858 ("mixed-run counter partition") landed after, addressing counter accuracy — out of this commit's scope.
- No path observed where a `width<=0` row could reach `processImageFormats` and bump the version. ✔

### Verdict
**confirmed-correct** — High. Width-corrupt rows fail gracefully pre-lock, no version bump, idempotent retry preserved. The `encode-failed` classification is intentional and the distinct log addresses operator triage.

---

## TRC-5 — SW BOUNDED HEAD (commit 9b7bb240)

### Observation
`staleWhileRevalidateImage` (`sw.template.js:163-260`) wraps the synchronous HEAD ETag probe with `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)` (`:230`, const at `:35`).

### Hypotheses
- **H-5a** The 300 ms-abort path falls through to serve-stale + background revalidate, with no double-fetch and no unhandled rejection.
- **H-5b** The abort causes a double GET, an unhandled rejection, or a stuck path.

### Trace (file:line)
1. `startRevalidate` (`:180-196`) is a LAZY single-flight closure: guarded by `if (!revalidatePromise)` so it dispatches **at most one** body GET per invocation; chain ends in `.catch(() => null)` (`:193`) — no unhandled rejection from the body fetch.
2. HEAD probe in a `try` (`:226-231`) with `signal: AbortSignal.timeout(300)`.
   - **304** (`:232-237`): serve `cached`, `touchMeta(...).catch(() => {})` (`:235`, swallowed) — no body GET. ✔
   - **200 + differing ETag** (`:238-243`): `fresh = await startRevalidate()`; if `fresh` return it. The *only* body GET in the function.
   - **200 + same ETag**: falls through to `:253` `startRevalidate()` (background) + `return cached`.
3. **Abort / network throw** → `catch {}` (`:245-247`) "fall through to stale-serve below" → `:253` `startRevalidate(); return cached;`. ✔
4. No-cache path (`:257-259`): `await startRevalidate()` then `?? 503`.

### Evidence FOR
- **H-5a (no double-fetch):** the HEAD (`method: 'HEAD'`) and the GET (`startRevalidate`) are distinct request methods — a HEAD is not a GET, so even when both fire (200+differing-ETag) there is exactly one *body* GET. On the abort path, the HEAD is aborted (no body) and exactly one background GET is dispatched via `startRevalidate`. The single-flight `revalidatePromise` guard prevents two GETs regardless. ✔
- **No unhandled rejection:** the aborted HEAD throws into the `try/catch` (`:245`); the body fetch chain self-catches (`:193`); `touchMeta` is `.catch`-guarded (`:235`). Every async edge is handled. ✔
- **Correct fall-through:** abort lands in the same `catch` as a network failure, which the code (`:245-254`) routes to serve-stale + background revalidate — exactly the documented one-paint self-heal window. ✔

### Evidence AGAINST / Gaps
- **Subtle ordering (LOW, benign):** on the 200+differing-ETag branch, if `startRevalidate()` resolves `null` (body fetch failed/sensitive), `:242` `if (fresh) return fresh;` does NOT early-return, so control falls to `:253` which calls `startRevalidate()` again — but single-flight returns the *same already-settled* promise (not awaited there) and `return cached`. Net: serve stale, no second GET. Behaviorally correct, just a non-obvious double-call of the idempotent closure. ✔
- `AbortSignal.timeout` is supported in all SW-capable target runtimes (Chrome 103+, FF 100+, Safari 16+) — no feature-detection needed. ✔
- No path observed that leaves the function without returning a `Response` or that fires two body GETs.

### Verdict
**confirmed-correct** — High. The 300 ms abort correctly falls through to serve-stale + single background revalidate; no double body-fetch (HEAD≠GET, single-flight guard); no unhandled rejection (all async edges caught). One benign non-obvious double-call of the idempotent `startRevalidate` closure on a rare branch — no behavioral impact.

---

## Summary of verdicts

| ID | Flow | Verdict | Confidence |
|----|------|---------|-----------|
| TRC-1 | Home OG image (73496d2f) | confirmed-correct | High |
| TRC-2 | OG sanitize symmetry (d5399742/ada92ba5) | confirmed-correct | High |
| TRC-3 | Color NCLX↔ICC per-field precedence (74235265) | confirmed-correct | High |
| TRC-4 | Backfill width guard (e8fce327) | confirmed-correct | High |
| TRC-5 | SW bounded HEAD probe (9b7bb240) | confirmed-correct | High |

**No confirmed bugs. No regressions of the prior-closed AGG-R8-01..13.** Three LOW cosmetic/observational notes (none actionable as bugs):
- TRC-1: declared `og:image` 1200×630 vs admin-site-OG dims on the 302 fallback path (pre-existing, shared by all per-photo OG consumers).
- TRC-4: bad-width rows counted under `encode-failed` (by design; distinct log mitigates; counter-partition follow-up landed in f3667858).
- TRC-5: benign non-obvious double-call of the idempotent single-flight `startRevalidate` on the 200+differing-ETag-then-null branch (no behavioral impact).

No next-probes required — all five flows resolved to high-confidence verdicts from direct source evidence.
