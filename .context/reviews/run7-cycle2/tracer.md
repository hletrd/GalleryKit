# Run-7 Cycle-2 — Tracer (causal flow tracing)

HEAD: `1cdbb883` (run-7 cycle-2 SW stamp over AGG-R7C1-01/02 fixes)
Method: competing-hypothesis causal tracing with evidence-for / evidence-against per flow, disconfirmation pass, ranked verdicts.

## Summary

| Flow | Verdict | Confidence |
|---|---|---|
| 1. GPS-strip × paid-download (JPEG/TIFF/HEIF/AVIF/HEIC/WebP/PNG) | **RESIDUAL-UNCLEAR** (HEIC anomaly path; reachability unverified, narrowed) | Medium |
| 2. Backfill re-encode × delete-during-reencode race (both entry points) | **CLEAN** | High |
| 3. Stripe checkout → webhook → entitlement (card-only pin, idempotency, async gap, refund) | **CLEAN** with one operational residual (no `charge.refunded` webhook handler) | High |
| 4. CLIP production-vs-stub mode switching (model_version isolation, resolver healing) | **CLEAN** | High |
| 5. Service-worker HEAD revalidation 300 ms timeout | **CLEAN** | High |
| 6. Session/cookie × middleware admin guard | **CLEAN** | High |

**Confirmed bugs scheduled: 0.** Residuals carried: 1 (RES-R7C2-01, the HEIC anomaly GPS-strip path — same surface as RES-R7C1-01, reachability still unverified against a real iPhone HEIC; no confirmable reachable failure this cycle).

---

## Trace Report — Flow 1: GPS stripping × paid-download stream

### Observation
`stripGpsFromOriginal(filePath)` (`apps/web/src/lib/process-image.ts:1573-1650`) is invoked on every upload (web UI: `apps/web/src/app/actions/images.ts:316`; Lightroom publish-plugin: `apps/web/src/app/api/admin/lr/upload/route.ts:326`) when `strip_gps_on_upload=true`. The paid-download route (`apps/web/src/app/api/download/[imageId]/route.ts:306, 349`) streams `image.filename_original` byte-for-byte from `UPLOAD_DIR_ORIGINAL`. The question: does the UI/file divergence (DB columns nulled, on-disk original not scrubbed) ever leak GPS into the paid-download stream?

### Hypothesis Table
| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|---|---|---|---|---|
| 1 | Lossless scrubbers cover JPEG/TIFF/AVIF/WebP; only structurally anomalous HEIC leaks (process-image.ts:1628-1634) | Medium | Moderate | The HEIC anomaly branch exists and is reachable; sharp cannot re-encode HEVC so it no-ops. Reachability against real iPhone HEICs is the open question. |
| 2 | A real format (not HEIC) silently retains GPS via a bounds-check false-negative | Low | Weak | All non-HEIC formats either scrub losslessly OR fall through to a Sharp re-encode that strips metadata by default. No evidence of a hole. |
| 3 | XMP-Extended (overflow chunk)GPS slips past the JPEG scrubber | Very Low | Strong-against | SEC-R4C9-01 reconstruction pass (gps-exif-strip.ts:326-330) closes the split-token case; tested at strip-gps-from-original.test.ts:443-458. |

### Evidence For (H1 — HEIC anomaly leak)
- `process-image.ts:1628-1634`: when the lossless ISOBMFF scrubber (`stripGpsFromIsobmffBuffer`) returns `null` for `.heic`/`.heif`, prebuilt Sharp cannot encode HEVC and the function logs `console.error(... original retains GPS)` and returns **without modifying the file**.
- `gps-exif-strip.ts:523`: `if (constructionMethod !== 0) return null;` — any HEIC item whose `iloc` entry uses `construction_method=1` (idat-based) or `2` (content-indexed) routes to the anomaly branch.
- `gps-exif-strip.ts:460`: `if (ilocVersion > 2) return null;` — future/odd iloc versions also route to anomaly.
- The HDR ingest gate (`images.ts:283`) rejects only PQ/HLG HEICs; **standard SDR iPhone HEICs with GPS pass through to `stripGpsFromOriginal`**.
- Both ingestion surfaces (web UI `images.ts:316` AND Lightroom plugin `lr/upload/route.ts:326`) call the same function — so a photographer exporting a HEIC with GPS from Lightroom hits the same path.

### Evidence Against (H1 — reachability unverified)
- **Spec convention (HEIF / ISO 14496-12):** the `Exif` metadata item is small static metadata and is conventionally written with `construction_method=0` (file offsets) even when the coded image tiles use `idat`. Apple's HEIC writer follows this convention for the Exif item; `construction_method=1` is used for coded tiles / grid items, not for the Exif metadata item. **If** this holds for all iPhone models, the scrubber succeeds and no leak occurs.
- The fixture-based test suite (28 tests, all green this run) exercises the AVIF path via `stripGpsFromIsobmffBuffer` and confirms lossless in-place scrub (`strip-gps-from-original.test.ts:341-355`) — the ISOBMFF walker is correct for `construction_method=0` items.
- **Decisive negative evidence could not be produced locally:** Sharp on this host cannot encode HEVC (`heifsave: Unsupported compression` — same licensing constraint as production), so I could not generate a real iPhone-class HEIC fixture to probe the `iloc` structure empirically.

### Rebuttal Round
- **Best challenge to H1:** the spec convention strongly implies the Exif item uses `construction_method=0`, in which case the scrubber handles real iPhone HEICs correctly and the line-1633 branch is dead code for the common case. Under that reading, H1 is not a reachable bug.
- **Why H1 still stands as RESIDUAL:** the convention is a strong prior, not a proof. Without a corpus of real iPhone HEICs (multiple iOS versions, both single-image and grid/burst configurations, Motion HEICs) exercised against the scrubber, I cannot certify the branch is unreachable. The branch's behavior IF reached is unambiguous and severe (GPS retained in the paid-download original). The cost of leaving it open is privacy regression on a narrow slice; the cost of "fixing" it speculatively (e.g. zeroing the whole Exif item on anomaly) is paid-deliverable corruption with no proven benefit.

### Convergence / Separation
H1 and H2 do NOT converge: H1 is HEIC-specific and gated on Sharp's HEVC-encoder absence; H2 is a general scrubber-correctness concern. H2 has no supporting evidence this cycle — every non-HEIC format is either scrubbed or re-encoded cleanly.

### Current Best Explanation
The GPS-stripping pipeline is **correct for JPEG / TIFF / AVIF / WebP / PNG** across all reachable paths (lossless scrub for the first four; metadata-free re-encode for PNG and for any anomaly in the first four). The **HEIC anomaly path is the sole residual**: IF a real HEIC upload trips the ISOBMFF walker's strict guards (`construction_method ≠ 0`, `ilocVersion > 2`, or an out-of-bounds offset), the original retains GPS and the paid-download route streams it. The DB columns are nulled regardless, so the gallery UI never leaks — this is a pure UI/file divergence on one container family. Provisional: reachability is the critical unknown.

### Critical Unknown
**Do real iPhone HEICs (and Lightroom-exported HEICs) ever carry their Exif item with `iloc construction_method ≠ 0`, or with `ilocVersion > 2`?** If yes, GPS leaks in production for `strip_gps_on_upload=true` uploads; if no, line 1633 is defensive dead code.

### Discriminating Probe
Generate (or obtain) a small corpus of real `.heic` files — iPhone single-image, iPhone burst/grid, iPhone Motion HEIC, and a Lightroom Classic HEIC export — and run each through `stripGpsFromIsobmffBuffer` directly, asserting both the return value (`stripped:true`, not `null`) and the post-scrub absence of GPS via `exiftool -gps*`. If any returns `null`, H1 is a confirmed reachable bug. A single representative iPhone HEIC is the highest-value first probe.

### Uncertainty Notes
- The HEIC encode failure on this Mac (`heifsave: Unsupported compression`) blocked the empirical probe; this is environmental, not a code finding.
- No production telemetry confirms whether the `console.error` at line 1633 has ever fired in the deployed instance. Querying the production logs for `cannot strip GPS from structurally anomalous HEIC` would be a zero-cost confirming probe if log access exists.

---

## Trace Report — Flow 2: Backfill re-encode × delete-during-reencode race

### Observation
Two equivalent entry points re-encode existing photos: the in-app runner (`apps/web/src/lib/admin-backfill-runner.ts`) and the sidecar script (`apps/web/scripts/backfill-color-pipeline.ts`). `deleteImage` (`apps/web/src/app/actions/images.ts`) does NOT take the per-image processing advisory lock, so it can interleave with a re-encode. The concern: a delete mid-re-encode orphans the freshly-written derivative files (the row is gone but the files remain).

### Hypothesis Table
| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|---|---|---|---|---|
| 1 | Both entry points correctly detect affectedRows===0 and clean up variants | High | Strong | Code-and-test evidence at both UPDATE sites in the runner and the sidecar. |
| 2 | A window exists between the re-encode write and the affectedRows check where a second delete re-creates the row, causing the cleanup to delete a different image's files | Very Low | Strong-against | No re-creation path exists; deletes are soft-then-hard and do not re-insert. |

### Evidence For (H1 — clean)
- **In-app runner, success branch:** `admin-backfill-runner.ts:573-576` — after the version-bump UPDATE, `if (affectedRows === 0) { cleanupDeletedMidReencodeVariants(row); return deleted-mid-reencode; }`.
- **In-app runner, detection-failed branch:** `admin-backfill-runner.ts:605-608` — the SAME affectedRows===0 guard is applied to the partial UPDATE (was_downscaled/avif_10bit), so the orphan-cleanup covers both branches.
- **Sidecar script:** `backfill-color-pipeline.ts:127-135` (`cleanupDeletedMidReencodeVariants`) + `:140-146` (`collectDeletedMidReencode` filters affectedRows===0) + `:456` (flush). Mirror of the runner.
- **Full-directory cleanup:** `deleteImageVariants(dir, fn, [])` with empty sizes array scans the whole directory, so non-default-size variants are caught too (documented in CLAUDE.md; both call sites pass `[]`).
- Test coverage: `__tests__/admin-backfill-runner-detection-failure.test.ts` and `__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` (referenced in comments at `admin-backfill-runner.ts:435` and `backfill-color-pipeline.ts:135`).

### Evidence Against (H1)
- None found. The advisory-lock posture (`gallerykit_color_pipeline_backfill` serializes the two entry points against each other; per-image `gallerykit:image-processing:{id}` claim serializes against the live upload queue) closes the double-encode vector. The affectedRows===0 check closes the orphan vector.

### Verdict: **CLEAN** (High confidence). The delete-during-reencode race is handled symmetrically at both UPDATE sites in both entry points, with full-directory variant cleanup and dedicated test coverage. This was the AGG-R8c3-03 / AGG-C4-02 work from prior cycles and it holds.

---

## Trace Report — Flow 3: Stripe checkout → webhook → entitlement

### Observation
End-to-end paid-download flow: `POST /api/checkout/[imageId]` creates a Stripe session → Stripe sends `checkout.session.completed` to `POST /api/stripe/webhook` → handler creates an `entitlements` row → customer redeems via `POST /api/download/[imageId]?token=...`.

### Hypothesis Table
| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|---|---|---|---|---|
| 1 | Card-only pin + 3-layer idempotency + correct sig-verify ordering = no duplicate entitlements, no signature-bypass race | High | Strong | Code evidence at checkout:207, webhook:320-382, stripe.ts:51. |
| 2 | Dashboard-initiated refund (`charge.refunded`) leaves entitlement live (no webhook handler) | Medium | Moderate | Webhook only matches `checkout.session.completed`; refund is admin-only via sales.ts. |
| 3 | Success-URL race: customer lands before webhook arrives → broken state | Very Low | Strong-against | success_url is a client-side toast only; no entitlement dependency. |

### Evidence For
- **H1 card-only pin:** `apps/web/src/app/api/checkout/[imageId]/route.ts:207` — `payment_method_types: ['card']` is pinned. Repo-wide grep confirms this is the ONLY `stripe.checkout.sessions.create` call site outside tests (sales.ts uses `retrieve` and `refunds.create` only).
- **H1 idempotency (3 layers):** schema UNIQUE on `session_id` (`schema.ts:299`); pre-INSERT SELECT (`webhook/route.ts:320-331`); `onDuplicateKeyUpdate` belt-and-suspenders (`route.ts:357-365`) with the R4C3 COR-R4C3-02 `affectedRows===1 && insertId>0` disambiguation (`route.ts:366-382`) so a dup-key loser's plaintext token is NOT logged to the manual-distribution line.
- **H1 sig-verify timing:** `webhook/route.ts:74` `constructStripeEvent` throws → 400 BEFORE any DB work; all entitlement writes are at `route.ts:88+`.
- **H3 success-URL race is benign:** `checkout/route.ts:227` `success_url` carries only `?checkout=success`; `page.tsx:145-149` + `photo-viewer.tsx:124-136` render a client-side toast with NO entitlement lookup. Token delivery is via the manual-distribution log (`route.ts:437-450`), not the redirect.

### Evidence Against / Gaps
- **H2 (refund residual):** the webhook handler (`route.ts:88`) matches ONLY `checkout.session.completed`. A refund issued directly in the Stripe Dashboard fires `charge.refunded`, which falls through to `return { received: true }` (`route.ts:453`) with no local state change. The entitlement stays `refunded=false` with a live `downloadTokenHash`, so the customer can still download a refunded photo until the admin ALSO clicks Refund in the GalleryKit `/sales` UI (`sales.ts:222-249` converges local state on `charge_already_refunded`). Reachable, but requires the photographer to refund outside the app.

### Verdict
- H1, H3: **CLEAN** (High).
- H2: **RESIDUAL-UNCLEAR** — operational, not a correctness defect in the happy path. The CLAUDE.md already documents the async-payment gap (Cycle 3 RPF / plan-316 CRT-R5C1-04); the `charge.refunded` webhook gap is a sibling but is NOT documented. Severity is bounded: refunds are admin-initiated and the in-app refund path works correctly; only the Dashboard-refund workflow leaves a stale-live entitlement. **Not scheduled as a confirmed bug** (no money-taken-no-goods defect, no false charge); flagged as an operational note for the critic/architect lanes to evaluate whether a `charge.refunded` handler is worth adding this cycle.

---

## Trace Report — Flow 4: CLIP production-vs-stub mode switching

### Observation
Production runs `semantic_search_mode=production` with `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. The `image_embeddings` table has a single-column PK on `image_id` (NOT composite with `model_version`). Mode switches could in principle leave stub-tagged rows that pollute production queries, or vice versa.

### Hypothesis Table
| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|---|---|---|---|---|
| 1 | Every query filters `WHERE model_version = activeModelVersion`, so leftover stub rows are EXCLUDED from production queries (recall ramp-up, not garbage) | High | Strong | Query-side filters at both routes. |
| 2 | Resolver healing race: upload writes under mode X, mode flipped mid-flight, row tagged with stale version | Very Low | Strong-against | Healing is monotonic DOWN; upload hook early-returns on disabled; single-row PK + onDuplicateKeyUpdate overwrites in place. |
| 3 | Offline model load failure hangs/crashes the route | Very Low | Strong-against | clip-model.ts:101-105 re-throws after nulling cached promise; route catches → 503 + rate-limit rollback. |
| 4 | Vector dimension / normalization mismatch computes garbage | Very Low | Strong-against | Both writers enforce 512-dim; decode drops non-2048-byte; kernels throw on length mismatch; normalization-aware kernel selection (prod→dotProduct, stub→cosineSimilarity). |

### Evidence For (H1 — clean)
- `semantic/route.ts:254` `.where(eq(imageEmbeddings.modelVersion, activeModelVersion))`; `similar/[id]/route.ts:117,145` same filter. Backed by `idx_image_embeddings_model_version_updated` (`schema.ts:287`, `0022_*.sql`).
- Single-row PK means a stub-era row is physically overwritten when a production backfill/re-embed runs; until then it is EXCLUDED from production queries by the WHERE clause, not served.
- Kernel selection (`semantic/route.ts:271`): `const similarity = isProd ? dotProduct : cosineSimilarity;` — correct because production vectors are L2-normalized (dot === cosine) while stub vectors are NOT normalized (must use cosine). Gated on mode, not on row.

### Verdict: **CLEAN** (High). The single-row-PK design is safe BECAUSE every query filters `model_version`. No reachable garbage-serving path. The 503-on-broken-mount path is reachable and correct (rate-limit rolled back, no silent stub fallback). This flow was the most thoroughly defended of the six.

---

## Trace Report — Flow 5: Service-worker HEAD revalidation 300 ms timeout

### Observation
`public/sw.template.js:38` defines `HEAD_REVALIDATE_TIMEOUT_MS = 300`. The image-derivative fetch path does a synchronous HEAD revalidation with `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (`sw.template.js:239`) to preserve freshness on fast networks. Concern: under a slow/hung network the probe could stall the masonry paint.

### Hypothesis Table
| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|---|---|---|---|---|
| 1 | AbortSignal.timeout caps the probe at 300 ms; on abort the catch at :254 falls through to stale-serve + background revalidate | High | Strong | Direct code reading. |
| 2 | The 300 ms budget is too tight and false-aborts on a healthy slow connection, regressing freshness | Low | Weak | 300 ms is a deliberate trade-off (AGG-R8-05); background revalidate self-heals. |

### Evidence For (H1 — clean)
- `sw.template.js:236-240`: `fetch(request.url, { method:'HEAD', headers:{'If-None-Match': cachedEtag}, signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS) })`.
- `sw.template.js:254-256`: `catch { // HEAD probe failed — fall through to stale-serve below }`.
- `sw.template.js:262-263`: `startRevalidate(); return cached;` — the stale-serve + background-revalidate path runs on any abort/error.
- On 304 (`sw.template.js:241-246`): serves cached, no body fetch — the fast-network freshness win.
- On 200 with changed ETag (`:247-252`): `startRevalidate()` and serve fresh if available.

### Verdict: **CLEAN** (High). The timeout is bounded; every non-success path (abort, network error, non-304) falls through to stale-serve with background revalidation. No stall vector. The 300 ms figure is a documented, tested trade-off (AGG-R8-05, pinned by `__tests__/sw-template-contract.test.ts`).

---

## Trace Report — Flow 6: Session/cookie × middleware admin guard

### Observation
`proxy.ts` middleware runs on localized pathnames (matcher excludes `/api/*`). It checks `admin_session` cookie presence/format for protected admin routes. Real cryptographic verification happens in `verifySessionToken` inside server actions. Concern: could the middleware format-only check let a forged cookie reach a protected admin page that then trusts the cookie?

### Hypothesis Table
| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|---|---|---|---|---|
| 1 | Middleware is format-only by design; every mutating action independently verifies via isAdmin() → no bypass | High | Strong | proxy.ts:84 explicit comment; session.ts HMAC + timingSafeEqual + DB lookup. |
| 2 | A protected admin page renders sensitive content based solely on middleware cookie presence | Very Low | Strong-against | Admin pages are server components that call isAdmin()/getCurrentUser() for any sensitive data. |

### Evidence For (H1 — clean)
- `proxy.ts:84`: explicit comment — "Full cryptographic validation happens in verifySessionToken() within server actions."
- `proxy.ts:90, 103`: middleware rejects only on missing cookie, sub-100-char token, or wrong part count — pure format gate, redirects to login.
- `session.ts:108-119`: `createHmac('sha256', secret)` + `timingSafeEqual(signatureBuffer, expectedSignatureBuffer)` with length pre-check — constant-time HMAC verification.
- `session.ts:124-134`: post-HMAC shape assertions + token-age check (24 h) — a forged token fails HMAC first (no timing oracle).
- `session.ts:136-148`: DB session lookup by `tokenHash` + `expiresAt` check + lazy delete of expired rows.
- Defense in depth: every mutating server action calls `requireSameOriginAdmin()` / `isAdmin()` independently (locked by `lint:action-origin` and `lint:api-auth`).

### Verdict: **CLEAN** (High). The middleware is intentionally a cheap format gate; the trust boundary is `verifySessionToken` + per-action `isAdmin()`. No reachable bypass.

---

## Cross-flow synthesis

### Residual carried forward
**RES-R7C2-01** (= RES-R7C1-01, re-confirmed and narrowed): the HEIC anomaly GPS-strip path (`process-image.ts:1628-1634`) retains GPS in the on-disk original when `stripGpsFromIsobmffBuffer` returns `null`, and the paid-download route streams that original. Reachability against real iPhone HEICs remains the critical unknown. Spec convention suggests the Exif item uses `construction_method=0` (scrubber succeeds), but no empirical confirmation was possible this cycle (Sharp on this host cannot encode HEVC). **Not scheduled as a confirmed bug** — requires a real-iPhone-HEIC probe to confirm a reachable failure. The two highest-value confirming probes are: (a) run real `.heic` fixtures through the scrubber, (b) grep production logs for the `cannot strip GPS from structurally anomalous HEIC` error string.

### Operational note (not a bug, for critic/architect evaluation)
The Stripe webhook handles ONLY `checkout.session.completed`. A refund issued in the Stripe Dashboard (`charge.refunded`) leaves the entitlement live until the admin re-refunds in-app. Bounded by the admin-initiated refund path working correctly. Documented async-payment gap (Cycle 3 RPF) is a sibling; this `charge.refunded` gap is undocumented but lower-severity (no money-taken-no-goods defect).

### Convergence notes
- Flows 2, 4, 5, 6 are independently CLEAN; they do not share a root cause.
- Flow 1's residual is HEIC-specific and does not generalize to the other containers (each has either a working lossless scrubber or a working re-encode fallback).
- Flow 3's refund residual is Stripe-webhook-specific and unrelated to Flow 1.

### What did NOT regress this cycle
- AGG-R7C1-01 (NCLX matrix code 8 → YCgCo) and AGG-R7C1-02 (Firefox color-gamut MQ doc) — both FIXED last cycle, verified still in place at HEAD `1cdbb883`. The SW_VERSION stamp refresh (`10108963-p7`) is the only delta and is a build artifact, not a logic change.

### Files relevant to the residuals
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/process-image.ts` (lines 1573-1650 — `stripGpsFromOriginal`, HEIC anomaly branch at 1628-1634)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/gps-exif-strip.ts` (lines 379-556 — `stripGpsFromIsobmffBuffer`, `construction_method` guard at 523, `ilocVersion` guard at 460)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/api/download/[imageId]/route.ts` (lines 306, 349 — paid-download streams the original)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/actions/images.ts:316` and `/Users/hletrd/flash-shared/gallery/apps/web/src/app/api/admin/lr/upload/route.ts:326` (both upload surfaces invoke `stripGpsFromOriginal`)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/api/stripe/webhook/route.ts` (line 88 — only `checkout.session.completed` handled; `charge.refunded` falls through)
