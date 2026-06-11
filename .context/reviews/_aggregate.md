# Aggregate Review — GalleryKit Run-5 Cycle 1

**Date:** 2026-06-11
**Run/Cycle:** run-5 cycle 1
**Contributing agents (11):** code-reviewer (COR), security-reviewer (SEC), perf-reviewer (PERF), critic (CRT), verifier (VER), test-engineer (TEST), tracer (TRC), architect (ARCH), debugger (BUG), document-specialist (DOC), designer (DES)

## AGENT FAILURES

None — all 11 agents completed. Three agents had transient API rate-limit errors AFTER writing their files; the files are complete and were aggregated in full.

## Aggregator verification notes

The aggregation pass independently verified four high-impact claims against the working tree:

1. **TRC-R5C1-18 CONFIRMED** — `apps/web/src/app/actions/images.ts:1042-1048`: `retryFailedImage` calls only `requireSameOriginAdmin()`; no `isAdmin()` anywhere in the function body.
2. **TRC-R5C1-16 MITIGATED IN SHIPPED TOPOLOGY** — `apps/web/docker-compose.yml:21` sets `TRUST_PROXY: "true"`, so the documented compose deployment is NOT affected; the collision applies only to bare/non-compose deployments. Severity reduced HIGH → MED with this evidence (tracer itself flagged this as the discriminating probe).
3. **BUG-R5C1-01 PREMISE WEAKENED** — `apps/web/src/lib/process-image.ts:1074-1080`: `base` is constructed via `sharp(processingInputPath, …)` — a FILE-PATH-backed pipeline, not a stream. Sharp file-backed instances are re-executable after `.toFile()` (each execution re-reads the file); the "clone of an already-drained stream" failure mode applies to stream inputs. The fallback also carries an R4C8 COR-R4C8-06 lineage comment indicating it was exercised in a prior cycle. Severity reduced HIGH → MED, classification needs-manual-validation (a fixture test forcing the 10-bit-reject path is the right probe).
4. **BUG-R5C1-02 STRUCTURE CONFIRMED** — `process-image.ts:867` calls `detectColorSignals` with no try/catch between the original-file write (~783-790) and the caller's `savedOriginalFilename` assignment (`images.ts:279`); any throw in that window leaks the on-disk original.

---

## MERGED FINDINGS INDEX

Sorted by severity, then cross-agent agreement (N agents), then confidence. 93 merged findings from 125 raw findings. Canonical ID = lowest-numbered contributing ID.

| # | Canonical ID | Sev | Conf | Class | Agree | Contributing IDs | Title |
|---|---|---|---|---|---|---|---|
| 1 | CRT-R5C1-01 | CRIT | High | confirmed | 1 | — | `semantic_search_mode='production'` selectable in admin UI; serves RANDOM stub results to the public |
| 2 | TEST-R5C1-01 | CRIT | High | confirmed | 1 | TEST-R5C1-12 | `verifySessionToken` (entire session-auth path incl. age boundaries) has zero unit tests |
| 3 | TRC-R5C1-18 | HIGH | High | confirmed | 1 | — | `retryFailedImage` missing `isAdmin()` — same-origin request without valid session reaches DB mutation |
| 4 | BUG-R5C1-02 | HIGH | High | confirmed | 1 | — | Original file leaked on disk when `detectColorSignals` throws during upload |
| 5 | PERF-R5C1-01 | HIGH | High | confirmed | 1 | — | In-app backfill runner loads ALL candidate rows into memory (unbounded; OOM risk on live process) |
| 6 | PERF-R5C1-02 | HIGH | High | confirmed | 1 | — | Analytics country/referrer breakdowns have no usable index → full scan + filesort on highest-cardinality table |
| 7 | CRT-R5C1-02 | HIGH | High | confirmed | 1 | — | `[AUTO] ` stub prefix leaks into PUBLIC photo titles, `<title>` tags, and SEO |
| 8 | CRT-R5C1-03 | HIGH | High | confirmed | 1 | — | `HDR_FEATURE_ENABLED` flag gates NOTHING (dead scaffolding); docs imply a live WI-09 gate |
| 9 | TEST-R5C1-02 | HIGH | High | confirmed | 1 | — | `BoundedMap` prune/eviction (the primitive under every rate-limit Map) untested |
| 10 | TEST-R5C1-03 | HIGH | High | confirmed | 1 | — | `getSessionSecret` production-hardening guard untested |
| 11 | TEST-R5C1-04 | HIGH | High | confirmed | 1 | — | `isValidTokenShape` download-token gate boundary cases untested |
| 12 | TEST-R5C1-05 | HIGH | High | confirmed | 1 | TEST-R5C1-16 | Argon2id work factors unverified by any test (constants unpinned + call-site mock masks options) |
| 13 | TEST-R5C1-06 | HIGH | High | confirmed | 1 | — | Checkout route price-validation / happy-path / per-branch rollback untested |
| 14 | DES-R5C1-01 | HIGH | High | confirmed | 1 | — | Upload dropzone has no accessible name |
| 15 | DES-R5C1-02 | HIGH | High | confirmed | 1 | — | Password form submit button 40 px — below the 44 px touch-target floor |
| 16 | DES-R5C1-03 | HIGH | High | confirmed | 1 | — | Lightbox `aria-live` position counter receives `aria-hidden` when controls auto-hide — never announced |
| 17 | DES-R5C1-04 | HIGH | High | confirmed | 1 | — | Bottom sheet forces focus to drag handle on every state change |
| 18 | DES-R5C1-05 | HIGH | High | confirmed | 1 | — | P3 badge inside masonry `<Link>` produces redundant AT double-reads on every wide-gamut photo |
| 19 | VER-R5C1-01 | MED | High | confirmed | 2 | VER-R5C1-02, VER-R5C1-08, DOC-R5C1-01, DOC-R5C1-08 | Settings-hash ETag documentation drift: 3 of 9 keys listed (CLAUDE.md ×2 + source docblock) + spurious `.slice(0,8)` in formula |
| 20 | PERF-R5C1-05 | MED | Med | needs-manual-validation | 2 | ARCH-R5C1-07 | `revalidate = 0` on every public page: full dynamic render per request, no HTML cache, 10-conn pool cliff under spikes |
| 21 | COR-R5C1-01 | MED | High | confirmed | 1 | — | `bulkUpdateImages` reads TriState `.mode` before validating shape → unhandled 500 on malformed payload |
| 22 | SEC-R5C1-01 | MED | Med | needs-manual-validation | 1 | — | Per-photo OG route derives internal-fetch origin from request Host header (constrained SSRF) |
| 23 | SEC-R5C1-02 | MED | Med | likely | 1 | — | PAT auth path: no failed-token-verification audit/rate accounting in `withAdminAuth` |
| 24 | TRC-R5C1-14 | MED | Med | confirmed | 1 | — | Originals uploaded before `strip_gps_on_upload` retain GPS in paid downloads (no retroactive strip) |
| 25 | TRC-R5C1-15 | MED | High | confirmed | 1 | — | 24 h download-token expiry with no re-issue path; stdout log is the only distribution channel |
| 26 | TRC-R5C1-16 | MED | High | likely (mitigated by default config) | 1 | — | Stripe idempotency key `checkout-{id}-unknown-{minute}` collides across buyers when TRUST_PROXY unset |
| 27 | TRC-R5C1-17 | MED | Med | confirmed | 1 | — | Download single-use check `affectedRows ?? 1` fallback permits double-download on driver shape change |
| 28 | BUG-R5C1-01 | MED | Med | needs-manual-validation | 1 | — | AVIF 10-bit fallback clones `base` after a failed `.toFile()` — verify file-backed re-execution is sound |
| 29 | BUG-R5C1-03 | MED | High | confirmed | 1 | — | `verifyWebpIccInBuffer` scans only first 1 KB — false "no ICCP" on real wide-gamut WebP |
| 30 | BUG-R5C1-04 | MED | Med | likely | 1 | — | `toMySqlDateTime` uses server-local getters — TZ change between deploys silently corrupts DATETIME ordering |
| 31 | BUG-R5C1-05 | MED | High | confirmed | 1 | — | `decimalToRational` returns decimal string for exposures ≥ 1 s instead of EXIF rational |
| 32 | ARCH-R5C1-01 | MED | High | confirmed | 1 | — | serve-upload settings-hash ETag is inert in the shipped nginx topology (sendfile bypasses Node) |
| 33 | ARCH-R5C1-02 | MED | High | confirmed | 1 | — | No retention/pruning for `image_views`/`topic_views`/`shared_group_views` — unbounded growth |
| 34 | ARCH-R5C1-03 | MED | Med | likely | 1 | — | `geoip-lite` not in serverExternalPackages/tracing; silent degradation to `country='XX'` + stale data |
| 35 | ARCH-R5C1-04 | MED | High | confirmed | 1 | — | Migration journal `when`-monotonicity enforced only at deploy time on the prod host — no CI/vitest guard |
| 36 | PERF-R5C1-03 | MED | High | confirmed | 1 | — | Embedding hook reads `admin_settings` per processed image even when semantic search is disabled (default) |
| 37 | PERF-R5C1-04 | MED | Med | likely | 1 | — | `getTopics` correlated `MAX(updated_at)` subquery per topic row (sitemap path, no covering index) |
| 38 | PERF-R5C1-06 | MED | Med | needs-manual-validation | 1 | — | `getImage` prev/next adjacency 4-way OR predicate defeats single-index range scan on hottest route |
| 39 | PERF-R5C1-07 | MED | Med | likely | 1 | — | SW blocks cached-image serving on a synchronous HEAD round-trip (inverts SWR contract) |
| 40 | DOC-R5C1-02 | MED | High | confirmed | 1 | — | `BACKFILL_CONCURRENCY` vs `ADMIN_BACKFILL_CONCURRENCY`: different names, different defaults, one undocumented |
| 41 | DOC-R5C1-03 | MED | High | confirmed | 1 | — | Deployment checklist omits `src/` prefix for site-config.json path |
| 42 | DOC-R5C1-04 | MED | High | confirmed | 1 | — | 7 production-relevant env vars absent from `.env.local.example` |
| 43 | TEST-R5C1-07 | MED | High | confirmed | 1 | — | `upload-paths.ts` resolve/legacy-assert functions untested |
| 44 | TEST-R5C1-08 | MED | High | confirmed | 1 | — | `withAdminAuth` wrong-scope token branch untested |
| 45 | TEST-R5C1-09 | MED | Med | likely | 1 | — | Advisory-lock name string values not pinned by any test |
| 46 | TEST-R5C1-10 | MED | High | confirmed | 1 | — | `e2e/public.spec.ts` is empty — zero public-route e2e coverage |
| 47 | TEST-R5C1-11 | MED | Med | likely | 1 | — | Paid-download GET→POST claim flow has no e2e test |
| 48 | TEST-R5C1-13 | MED | Med | likely | 1 | — | Stripe webhook covered only by source-scan tests — false confidence on money-path logic |
| 49 | DES-R5C1-06 | MED | High | confirmed | 1 | — | Search input double accessible-name (`label` + `aria-label`) + dead mobile backdrop |
| 50 | DES-R5C1-07 | MED | High | confirmed | 1 | — | `aria-keyshortcuts="I"` advertised but shortcut hint hidden on mobile (discoverability gap) |
| 51 | DES-R5C1-08 | MED | High | confirmed | 1 | — | Nav `bg-background/50` fallback fails contrast when backdrop-filter unsupported |
| 52 | DES-R5C1-09 | MED | High | confirmed | 1 | — | `containIntrinsicSize` fixed 300 px estimate causes CLS on mobile single-column |
| 53 | DES-R5C1-10 | MED | High | confirmed | 1 | — | Lightbox prev/next visible affordance badge 40 px (outer target compliant) |
| 54 | DES-R5C1-11 | MED | Med | likely | 1 | — | Hidden photo-viewer subtree keeps effects/AnimatePresence running during lightbox |
| 55 | DES-R5C1-12 | MED | High | confirmed | 1 | — | Bottom sheet peek state has no backdrop — inconsistent tap-to-dismiss across states |
| 56 | DES-R5C1-13 | MED | High | confirmed | 1 | — | Sidebar `transition-all` + overflow-hidden clips content mid-animation; double-animation frame drops |
| 57 | DES-R5C1-14 | MED | High | confirmed | 1 | — | Masonry overlay gradient contrast insufficient on high-key photos |
| 58 | DES-R5C1-15 | MED | High | confirmed | 1 | — | Ken Burns reduced-motion suppression relies solely on JS gate — no CSS belt-and-suspenders |
| 59 | DES-R5C1-16 | MED | High | confirmed | 1 | — | Lightbox hardcoded `blue-500` focus rings diverge from design-system `ring-ring` token |
| 60 | CRT-R5C1-05 | LOW | High | confirmed | 2 | ARCH-R5C1-06 | `@/lib/storage` abstraction is fully dead code; `switchStorageBackend('s3')` silently constructs a local backend |
| 61 | TRC-R5C1-01 | LOW | High | confirmed | 2 | PERF-R5C1-11 | Bootstrap re-enqueue passes no config snapshot — jobs use LIVE config + redundant per-job `admin_settings` reads |
| 62 | COR-R5C1-02 | LOW | High | confirmed | 1 | — | Public IPv6 referrer hosts stored verbatim as `referrer_host` instead of `direct` |
| 63 | COR-R5C1-04 | LOW | Med | likely | 1 | — | Semantic-search route does `getGalleryConfig` DB read before rate-limit pre-increment |
| 64 | COR-R5C1-05 | LOW | High | confirmed | 1 | — | SW same-ETag 200 HEAD probe still dispatches a redundant full-GET revalidate |
| 65 | COR-R5C1-06 | LOW | Med | needs-manual-validation | 1 | — | `restoreDatabase` lock teardown relies on fragile manual-release-per-early-return; stale line-number comment |
| 66 | COR-R5C1-07 | LOW | High | confirmed (documented) | 1 | — | HEIC GPS strip tier-2 fallback silently retains GPS on structural anomaly (paid download streams it) |
| 67 | SEC-R5C1-04 | LOW | Med | needs-manual-validation | 1 | — | `validateSeoOgImageUrl` relative branch lacks percent-encoded traversal normalization (defense-in-depth) |
| 68 | CRT-R5C1-04 | LOW | High | confirmed | 1 | — | Stripe `checkout.session.async_payment_succeeded` handler missing (latent: delayed-payment methods never mint entitlements) |
| 69 | CRT-R5C1-06 | LOW | Med | needs-manual-validation | 1 | — | CLAUDE.md backfill block hardcodes `/home/ubuntu/gallery` vs `.env.deploy` `DEPLOY_PATH` |
| 70 | VER-R5C1-03 | LOW | High | confirmed | 1 | — | CLAUDE.md says "random-64-char-hex" SESSION_SECRET; enforcement is min 32 chars |
| 71 | TRC-R5C1-02 | LOW | Med | needs-manual-validation | 1 | — | SW ETag probe vs Next-static ETag format mismatch in route-handler/static crossover edge case |
| 72 | TRC-R5C1-13 | LOW | Med | needs-manual-validation | 1 | — | Failed restore → `endRestoreMaintenance` in finally → bootstrap runs against possibly inconsistent DB |
| 73 | ARCH-R5C1-05 | LOW | High | confirmed | 1 | — | All non-login rate limits are in-memory; per-iteration deploys zero every budget (OG/checkout/share/search) |
| 74 | PERF-R5C1-10 | LOW | Med | likely | 1 | — | `deleteImageVariants(sizes=[])` does a full `opendir` scan of 3 derivative dirs on every delete |
| 75 | BUG-R5C1-06 | LOW | High | confirmed | 1 | — | Permanent failure resets `bootstrapCursorId` to null → full re-scan from id 0 |
| 76 | BUG-R5C1-07 | LOW | Med | needs-manual-validation | 1 | — | `verifyAvifNclxInBuffer` scans only first 4096 bytes — false negatives on exotic AVIF |
| 77 | BUG-R5C1-08 | LOW | High | confirmed | 1 | — | `[...permanentlyFailedIds]` re-spread (up to 1000 items) on every bootstrap batch query |
| 78 | DOC-R5C1-05 | LOW | High | confirmed | 1 | DOC-R5C1-09 | React `cache()` docs use non-`Cached` names and list only 3 of 9 wrapped functions |
| 79 | DOC-R5C1-06 | LOW | Med | likely | 1 | — | "Vitest 1300+ unit tests" claim overstated vs ~186 files / ~346 blocks (1799 tests per test-engineer run) |
| 80 | DOC-R5C1-07 | LOW | High | confirmed | 1 | — | Docs acknowledge only the locale-prefixed upload route; two upload route files exist |
| 81 | DOC-R5C1-11 | LOW | High | confirmed | 1 | — | Deployment checklist missing explicit note that Docker handles `npm install` |
| 82 | DOC-R5C1-24 | LOW | High | confirmed | 1 | — | "4 KB" blur cap is 4096 *characters* (~3 KB decoded data) |
| 83 | DOC-R5C1-27 | LOW | High | confirmed | 1 | — | Root `build` uses `--workspaces` (all) vs other scripts `--workspace=apps/web` — undocumented |
| 84 | TEST-R5C1-14 | LOW | Med | likely | 1 | — | Touch-target `KNOWN_VIOLATIONS` stale entries only `console.warn`, never fail |
| 85 | TEST-R5C1-15 | LOW | High | confirmed | 1 | — | `csp-nonce.ts` has no tests |
| 86 | DES-R5C1-17 | LOW | High | confirmed | 1 | — | Locale-switch `aria-label` hardcoded ko/English ternary breaks on third locale |
| 87 | DES-R5C1-18 | LOW | High | confirmed | 1 | — | Dead `id="photo-viewer-shortcuts"` — nothing references it via `aria-describedby` |
| 88 | DES-R5C1-19 | LOW | High | confirmed | 1 | — | Empty-state inline SVG lacks `aria-hidden="true"` |
| 89 | DES-R5C1-20 | LOW | High | confirmed | 1 | — | Inherited global tags visually greyed but no ARIA read-only state for AT |
| 90 | DES-R5C1-21 | LOW | High | confirmed | 1 | — | Error page `<h1>` at `text-muted-foreground/30` ≈ 1.4:1 contrast (fails AA; 404 page does this right) |
| 91 | DES-R5C1-22 | LOW | High | confirmed | 1 | — | Lightbox position counter announces "3 / 20" without translated context label |
| 92 | DES-R5C1-23 | LOW | Med | needs-manual-validation | 1 | — | Bottom sheet `95vh` fallback on iOS 15 Safari may clip behind home indicator |
| 93 | DES-R5C1-24 | LOW | High | confirmed | 1 | — | 12 px EXIF labels at ~6.1:1 — passes AA, marginal for low-vision (no fix strictly required) |

---

## DETAILED FINDINGS

### CRITICAL

#### CRT-R5C1-01 — `semantic_search_mode = 'production'` selectable in admin UI but serves RANDOM stub results to the public
- **Severity:** CRIT · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (critic)
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:18-19, 169-190`; `apps/web/src/lib/clip-inference.ts` (stub); `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:540`; `apps/web/src/lib/gallery-config-shared.ts:168`
- **Description:** The route's own docblock warns "the stub encoder returns RANDOM results. Do NOT enable semantic_search_mode in production until the stub is replaced," yet the admin settings UI renders `<SelectItem value="production">`, the config validator accepts `'production'` as a stored value, and the route's only gate is `mode !== 'production'` → 503. When `'production'` IS selected, the route proceeds to `embedTextStub(query)` (a SHA-256-derived deterministic vector with no semantic relationship to image content) and serves cosine-ranked noise as authoritative-looking public search results. The only guard is a soft amber warning paragraph — a fail-open posture inconsistent with the codebase's fail-closed doctrine (10-bit AVIF capability probe, fail-closed config reads).
- **Failure scenario:** A photographer enables semantic search "to try it," picks the only option labelled production-grade, saves. Visitors search "sunset" and receive content-unrelated photos with enriched thumbnails/titles that look intentional. No error, no telemetry, no rollback signal.
- **Fix:** Make `'production'` unselectable/unsavable until real inference exists: (a) gate the SelectItem behind a runtime capability probe (onnxruntime + model files present), (b) reject `'production'` in `isValidSettingValue` while the stub is the only encoder, and (c) in the route, treat `'production'` as 503 on a *capability* check (encoder module present), not a config check.

#### TEST-R5C1-01 — `verifySessionToken` has ZERO unit tests (entire session-authentication path)
- **Severity:** CRIT · **Confidence:** High · **Classification:** confirmed (coverage gap) · **Agreement:** 1 agent (test-engineer; merges TEST-R5C1-12, same root cause: token-age boundaries are part of the untested function)
- **Where:** `apps/web/src/lib/session.ts:94-145`; only existing test `session.test.ts` covers `hashSessionToken` + token format
- **Description:** `verifySessionToken` is the whole session-auth path: HMAC-SHA256 signature validation, `timingSafeEqual` comparison (with length pre-check), 24 h max-age check, negative-age clock-skew guard, DB session lookup, and expired-session deletion. None of it is exercised by any test. A refactor that breaks the signature-length early-return, removes the `tokenAge < 0` guard, or inverts the age comparison would ship a session-forgery or eternal-token bypass with a green suite.
- **Failure scenario:** Future refactor makes the `timingSafeEqual` branch unreachable or drops the negative-age guard ("impossible case"); pre-dated tokens become valid indefinitely; no test fails.
- **Fix:** Add unit tests with mocked `@/db` (same pattern as `admin-tokens.test.ts`): wrong HMAC → null; >24 h old → null; negative age → null; malformed part count → null; missing DB row → null; expired DB row deleted + null; valid fresh token → session object.

---

### HIGH

#### TRC-R5C1-18 — `retryFailedImage` missing `isAdmin()`; same-origin alone reaches the mutation
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed (aggregator-verified) · **Agreement:** 1 agent (tracer)
- **Where:** `apps/web/src/app/actions/images.ts:1042-1048`; `apps/web/src/lib/action-guards.ts:37-44`
- **Description:** `retryFailedImage(id)` calls only `requireSameOriginAdmin()` — which checks Origin/Referer provenance, NOT session validity — and never calls `isAdmin()`/`getCurrentUser()`. Every other mutating action in `images.ts` calls both (e.g. `deleteImage` at 543, `updateImageMetadata` at 797). The action-origin lint gate enforces the origin guard but cannot detect the missing auth check. A same-origin request without a valid admin session (XSS context, expired session) can clear `processing_error`/`failed_at` on an arbitrary image and re-enqueue processing.
- **Failure scenario:** An XSS payload (or any same-origin script context) invokes the server action with an arbitrary image ID and no valid `admin_session`; the action proceeds to the DB update and re-enqueue — unauthenticated mutation + CPU-burning reprocessing trigger.
- **Fix:** Add `if (!(await isAdmin())) return { error: t('unauthorized') };` immediately after the origin check, matching the file's standard pattern. Consider extending the action-origin lint script to also require an `isAdmin()` call (or a documented exempt tag) in mutating actions.

#### BUG-R5C1-02 — Original file leaked on disk when `detectColorSignals` throws during upload
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed (structural; aggregator-verified call site) · **Agreement:** 1 agent (debugger)
- **Where:** `apps/web/src/lib/process-image.ts:783-790` (write), `:867` (`detectColorSignals` call, no try/catch); `apps/web/src/app/actions/images.ts:279` (`savedOriginalFilename` assigned only on success), `:458` (cleanup guard)
- **Description:** `saveOriginalAndGetMetadata` writes the original to disk, then calls `detectColorSignals(originalPath, …)` with no surrounding try/catch or `finally` unlink. If the ISOBMFF walker / ICC parse / 1 MB header read throws (malformed-but-Sharp-parseable HEIF, transient I/O error), the exception propagates before the caller assigns `savedOriginalFilename`, so the caller's catch-path cleanup (`if (savedOriginalFilename)`) never fires. The original is permanently orphaned under `data/uploads/original/` with no DB row and no cleanup job covering row-less originals.
- **Failure scenario:** Repeated uploads of a structurally anomalous HEIF each leak one full-size original (up to 200 MB) silently; disk fills on the 124 G deploy host.
- **Fix:** Wrap everything after the file write in try/catch that unlinks `originalPath` before re-throwing — or assign the filename out-parameter before the throwable section so the caller's existing cleanup sees it.

#### PERF-R5C1-01 — In-app backfill runner loads ALL candidate rows into memory at once
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (perf-reviewer)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:158-168` (`fetchCandidates`, no LIMIT/batching), `:276-332` (`runBackfill` enqueues all up front)
- **Description:** `fetchCandidates()` materializes every un-migrated image row (id + 5 filename strings + ICC name) into one array, then `runBackfill` adds one PQueue closure per row up front — doubling residency. The companion operator script (`scripts/backfill-color-pipeline.ts:199`) deliberately batches at `BATCH_SIZE = 100`; the in-app runner does not, and it runs inside the live web process.
- **Failure scenario:** "Re-encode existing photos" clicked on a 100k-photo gallery after a pipeline bump → ~60-120 MB candidate array + closure array + mysql2 mega-result buffer on the production web process → GC thrash or OOM that takes the whole site down.
- **Fix:** Mirror the script's keyset-batched loop (`WHERE … AND id > :cursor ORDER BY id ASC LIMIT 100`), drain per batch, advance cursor. Keep `fetchCandidateCount` for the up-front disclosure.

#### PERF-R5C1-02 — Analytics country/referrer breakdown queries have no usable index
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (perf-reviewer)
- **Where:** `apps/web/src/lib/analytics-data.ts:93-114` (`getCountryBreakdown`), `:169-190` (`getReferrerBreakdown`); `apps/web/src/db/schema.ts:231` (only index leads with `image_id`)
- **Description:** Both queries filter `bot = false [AND viewed_at >= since]` and group by `country_code`/`referrer_host`; the sole index on `image_views` leads with `image_id`, unusable here → full table scan + temp table + filesort on the app's highest-cardinality table (one insert per public photo view).
- **Failure scenario:** Multi-million-row `image_views` makes the admin /analytics page multi-second, pins a connection from the 10-slot pool per breakdown, and competes with the live insert path for buffer-pool pages.
- **Fix:** New migration (follow the journal monotonic-`when` runbook): `idx_image_views_bot_viewed_country (bot, viewed_at, country_code)` and `idx_image_views_bot_viewed_referrer (bot, viewed_at, referrer_host)`.

#### CRT-R5C1-02 — `[AUTO] ` stub prefix leaks into PUBLIC photo titles, browser `<title>`, and SEO
- **Severity:** HIGH (critic: MAJOR) · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (critic)
- **Where:** `apps/web/src/lib/caption-generator.ts:27, 33-40`; `apps/web/src/lib/photo-title.ts:104-105` (verbatim fallback); `apps/web/src/lib/data.ts:263-264` (`alt_text_suggested` is public); consumers `photo-viewer.tsx:174`, `info-bottom-sheet.tsx:157`
- **Description:** With `auto_alt_text_enabled='true'`, the stub writes `"[AUTO] Photo taken with <camera>"` into `alt_text_suggested` (public by design for the `alt` attribute). `getPhotoDisplayTitle` falls back to that string VERBATIM for untitled/untagged photos, so the engineering prefix reaches the public page heading, the document `<title>`, and indexable SEO surfaces — the opposite of the "photographer's intent" premise.
- **Failure scenario:** Photographer enables auto alt-text, uploads untitled photos; Google indexes pages titled "[AUTO] Photo taken with Canon EOS R5".
- **Fix:** Strip the prefix at the public read boundary in `photo-title.ts` (or exclude `alt_text_suggested` from the visible-title fallback, keeping it for `alt=""` only). Add a test asserting `[AUTO]` can never reach a public visible title.

#### CRT-R5C1-03 — `HDR_FEATURE_ENABLED` gates NOTHING; docs imply a live WI-09 gate; `hdr-filenames.ts` is dead code
- **Severity:** HIGH (critic: MAJOR, doc-integrity) · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (critic)
- **Where:** `apps/web/src/lib/feature-flags.ts:10` (exported, zero consumers); `apps/web/src/lib/hdr-filenames.ts` (zero non-self importers); CLAUDE.md "HDR ingest" section
- **Description:** Grep confirms zero references to `HDR_FEATURE_ENABLED` / `NEXT_PUBLIC_HDR_FEATURE_FLAG` outside the definition, and zero hits for `avifenc`/`_hdr.avif` usage — WI-09 does not exist. The docs present the flag and helper as the mechanism that will switch on HDR delivery; in reality the admin-only honesty invariant is enforced solely by the privacy guard. The inert flag is a trap for the WI-09 implementer (who may assume it already guards badge gating / `<picture>` sources / field exposure). Note: DOC-R5C1-04 separately lists the env var as undocumented — when fixing, do not document it as functional.
- **Failure scenario:** A contributor implements WI-09 behind the "existing" flag, flips the env var, and ships half-connected HDR (or unfulfilled public HDR badges).
- **Fix:** Delete `HDR_FEATURE_ENABLED` + `hdr-filenames.ts` (let WI-09 introduce its own wiring), or add explicit "DEAD/RESERVED — not wired" banners to both files and correct CLAUDE.md to state the honesty invariant is enforced by the privacy guard, not the flag.

#### TEST-R5C1-02 — `BoundedMap` prune/eviction primitive has no unit tests
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/lib/bounded-map.ts:1-142`
- **Description:** `BoundedMap.prune()` implements expiry collect-then-delete and hard-cap oldest-entry eviction; it underpins every rate-limit Map (login, account, search, share, checkout, OG). Neither path has a dedicated test. An off-by-one in the excess calculation could grow unboundedly (memory exhaustion) or over-evict (rate-limit entries deleted → brute-force window) undetected.
- **Failure scenario:** Eviction math regression ships; production Maps grow without bound or legitimate limiter entries vanish; no test fails.
- **Fix:** Pure unit tests: expiry pruning, return-value semantics, hard-cap eviction order (`maxKeys=3`, insert 5, assert oldest 2 gone), `createResetAtBoundedMap` / `createWindowBoundedMap` expiry behavior.

#### TEST-R5C1-03 — `getSessionSecret` production guard untested
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/lib/session.ts:27-33`
- **Description:** The guard that makes production THROW (instead of falling back to a DB-stored secret obtainable via DB-read compromise) when `SESSION_SECRET` is absent/short is entirely untested; an inverted condition would silently weaken production key handling.
- **Failure scenario:** `!== 'production'` flipped to `=== 'production'` in a refactor; prod accepts DB-stored secret; no test fails.
- **Fix:** `vi.stubEnv`/`vi.resetModules` tests: prod + short secret throws; prod + valid secret returns without DB; dev without env falls through to mocked DB path.

#### TEST-R5C1-04 — `isValidTokenShape` never tested as a unit
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/lib/download-tokens.ts:43-52`
- **Description:** The first security gate of the paid-download route (short-circuits malformed tokens before hashing/DB) is only reached indirectly; null/undefined/wrong-prefix/wrong-length/wrong-charset boundaries are unexercised. A `{43}` → `{43,}` regex regression would pass all existing tests.
- **Failure scenario:** Greedy-quantifier regression lets arbitrarily long tokens through to DB lookups; existing token-crypto tests stay green.
- **Fix:** Direct boundary tests for null/undefined, 42/44-char bodies, wrong prefix, non-base64url chars, exact-valid shape, and a generated token passing.

#### TEST-R5C1-05 — Argon2id work factors unverified by any test (constants unpinned; call-site mock masks options)
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer; merges TEST-R5C1-16 — same root cause: a weakening of `PASSWORD_HASH_OPTIONS` or its omission at the `argon2.hash` call site would not fail any test)
- **Where:** `apps/web/src/lib/password-hashing.ts:1-18`; `apps/web/src/__tests__/admin-users.test.ts:45-47, 119, 131, 147` (full `argon2` mock)
- **Description:** `PASSWORD_HASH_OPTIONS` (`memoryCost: 65_536`, `timeCost: 3`, `parallelism: 4`, argon2id) is pinned by nothing; `admin-users.test.ts` mocks `argon2.hash` without asserting the options argument, so removing `options` from the call entirely also passes.
- **Failure scenario:** `timeCost: 1` "to speed up tests" or a dropped options arg ships; password hashing silently weakens.
- **Fix:** (1) 5-line policy test asserting minimums on the exported constants; (2) `expect(argon2HashMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: argon2id, memoryCost: 65_536 }))` in admin-users tests.

#### TEST-R5C1-06 — Checkout route: price validation, happy path, per-branch rollback untested
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/app/api/checkout/[imageId]/route.ts:47-66, 68-218`
- **Description:** Only the DB-error rollback path is tested. Untested: `getTierPriceCents` strict `/^\d+$/` parse (prevents `"500abc"` truncation-charging), `priceCents <= 0` guard, `!image.processed` guard, idempotency-key construction, successful `{ url }` creation, and rate-limit rollback on each 4xx branch.
- **Failure scenario:** Someone "simplifies" the strict parse to `parseInt`; a typo'd admin price `"500abc"` silently charges $5.00.
- **Fix:** Behavioral unit tests with mocked Stripe + DB following the existing `checkout-db-error-rollback.test.ts` pattern, one per branch above.

#### DES-R5C1-01 — Upload dropzone has no accessible name
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/upload-dropzone.tsx:398-411`
- **Description:** The react-dropzone root receives `tabIndex={0}` but no `aria-label`/label association; the inline "Drop photos here" text is not wired as the accessible name. Screen-reader users hear a nameless generic region for the primary admin workflow.
- **Failure scenario:** Blind admin activates the drop zone via switch access; nothing meaningful is announced.
- **Fix:** Add `aria-label={t('upload.dropzoneLabel')}` (new i18n key) on the root props override and `aria-disabled={uploading || !hasTopics}` for the inert state.

#### DES-R5C1-02 — Password form submit button renders 40 px — below the 44 px floor
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:108`
- **Description:** The submit `<Button type="submit">` has no size/height override, rendering shadcn default `h-10` (40 px) — below the project's documented 44 px WCAG 2.5.5 policy. The login form already uses `h-11`; the password form missed the same fix. (If `ui/button.tsx` variant floors apply here, the touch-target audit fixture should prove it — reconcile with the audit's KNOWN_VIOLATIONS either way.)
- **Failure scenario:** Mobile admin fat-fingers the security-sensitive password-change submit.
- **Fix:** `className="h-11"` (or `size="lg"`) to match `login-form.tsx:102`.

#### DES-R5C1-03 — Lightbox `aria-live` position counter gets `aria-hidden` when controls auto-hide
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/lightbox.tsx:666-674` (counter), `:370` (`controlVisibilityProps`)
- **Description:** The `role="status" aria-live="polite"` counter receives the shared `{ tabIndex:-1, 'aria-hidden':true }` spread when controls hide; an aria-hidden live region never announces, so position updates ("3 / 20") are silent exactly when keyboard users navigate with controls auto-hidden.
- **Failure scenario:** Blind user arrows through the lightbox after the 3 s auto-hide; no position feedback at all.
- **Fix:** Remove `controlVisibilityProps` from the status div; fade visually with opacity/visibility while keeping it in the AT tree. (Pair with DES-R5C1-22's missing context label.)

#### DES-R5C1-04 — Bottom sheet forces focus to the drag handle on every state change
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/info-bottom-sheet.tsx:59-65, 144-153`
- **Description:** Focus is programmatically moved to `dragHandleRef` on every non-expanded state transition (including intermediate swipe states and every reopen-to-peek), so keyboard/switch users repeatedly land on a low-value handle instead of actionable content; the handle's `aria-label` also doesn't reflect expand-vs-collapse state.
- **Failure scenario:** Keyboard user expands → closes → reopens; every cycle dumps them on the drag handle and they must Tab back into the EXIF/download content.
- **Fix:** Focus the close button on open-to-peek; make the handle label state-aware (`viewer.expandSheet` / `viewer.collapseSheet`).

#### DES-R5C1-05 — P3 gamut badge inside masonry `<Link>` produces redundant AT double-reads
- **Severity:** HIGH · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/home-client.tsx:352-361`
- **Description:** The badge `<span role="img" aria-label=…>` sits inside the link, so every wide-gamut card link is announced as "View photo [title] P3 wide-gamut photo" — redundant noise on every grid item; the same information is available in the viewer's ColorDetailsSection.
- **Failure scenario:** Screen-reader gallery browsing reads a compound label for every P3 photo.
- **Fix:** `aria-hidden="true"` on the badge span in the masonry card.

---

### MEDIUM

#### VER-R5C1-01 — Settings-hash documentation drift: key list (3 of 9) in three places + spurious `.slice(0,8)` in the documented ETag formula
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 2 agents (verifier, document-specialist) · **Contributing:** VER-R5C1-01, VER-R5C1-02, VER-R5C1-08, DOC-R5C1-01, DOC-R5C1-08
- **Where:** CLAUDE.md line ~257 (ETag section) and line ~100 (Key Files table); `apps/web/src/lib/settings-hash.ts:7-9` (docblock) vs `:34-46` (`COLOR_IMPACTING_KEYS` = 9 keys); `apps/web/src/lib/serve-upload.ts:201`
- **Description:** Docs (CLAUDE.md ETag paragraph, CLAUDE.md Key Files table, and the settings-hash.ts module docblock itself) list only the original 3 keys; the code hashes 9 (`+ sdr_jpeg_chroma, wide_gamut_max_source_pixels, image_quality_webp/avif/jpeg, image_sizes`). The CLAUDE.md formula also writes `settingsHash.slice(0,8)` while the code uses `${settingsHash}` directly (the 8-char truncation lives inside the library — functionally identical, misleading attribution).
- **Failure scenario:** A developer adding a new quality setting trusts the 3-item list, doesn't add the key, and ships a cache-invalidation gap; or expects `image_quality_*` flips to need manual workarounds that are already automatic.
- **Fix:** Update both CLAUDE.md locations and the source docblock to reference the full `COLOR_IMPACTING_KEYS` list (or "see settings-hash.ts"); drop `.slice(0,8)` from the documented formula (or note the truncation is internal). Coordinate with ARCH-R5C1-01, which changes what this paragraph should claim about production behavior.

#### PERF-R5C1-05 — `revalidate = 0` on every public page: full dynamic render per request, no HTML cache, pool cliff under spikes
- **Severity:** MED · **Confidence:** Med · **Classification:** needs-manual-validation (deliberate product trade-off; requires confirming all mutation paths call revalidatePath before flipping) · **Agreement:** 2 agents (perf-reviewer, architect) · **Contributing:** PERF-R5C1-05, ARCH-R5C1-07
- **Where:** every `apps/web/src/app/[locale]/(public)/**/page.tsx` (`revalidate = 0`); `apps/web/src/db/index.ts:19-21` (pool 10 + queue 20); interacts with `public/sw.template.js:244` `networkFirstHtml`
- **Description:** All public pages are fully dynamic (framework `no-store`), so every request re-runs all DB work with zero HTML/CDN caching; combined with a 10-connection/20-queue pool and a fire-and-forget analytics INSERT per page view, a modest spike (viral link, OG unfurl storm, crawler) saturates the pool and 500s. The SW had to ship an explicit no-store exemption just to populate an offline cache. CLAUDE.md says reintroduce ISR only with an invalidation plan — `revalidateLocalizedPaths` already exists and is called from `images.ts:517`.
- **Failure scenario:** A shared photo goes viral; >30 in-flight renders reject at `getConnection`; the gallery 500s for everyone, with no cache layer to absorb the burst.
- **Fix:** Short ISR window (`revalidate = 30-60`) on read-mostly list pages (home/topic/year) paired with explicit `revalidatePath` on mutations (audit all mutation paths first), keeping `revalidate = 0` where freshness is essential; or an nginx micro-cache with a few-second TTL in front of public GETs. If ISR is reintroduced, audit that mutations call narrow `revalidateLocalizedPaths` rather than `revalidateAllAppData` (see PERF-R5C1-12 note in non-issues).

#### COR-R5C1-01 — `bulkUpdateImages` accesses TriState `.mode` before validating input shape
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (code-reviewer)
- **Where:** `apps/web/src/app/actions/images.ts:869-936` (`.mode` reads at 900/909/918/926 before the try at 938)
- **Description:** `ids`/`addTagNames`/`removeTagNames` are shape-validated but the four `TriState` object fields (`topic`, `titlePrefix`, `description`, `licenseTier`) are not; a payload omitting one throws `TypeError: cannot read 'mode' of undefined` OUTSIDE the try/catch → unhandled server-action rejection (framework 500) instead of the localized `{ error: t('invalidInput') }` every sibling action returns. No DB write occurs (throws first).
- **Failure scenario:** Admin client bug or hand-rolled same-origin request sends `{ ids:[1], addTagNames:[], removeTagNames:[] }` → stack-trace-y 500 on a privileged endpoint.
- **Fix:** Add an `isTriState` guard over all four fields right after the `ids` checks, returning `t('invalidInput')`.

#### SEC-R5C1-01 — Per-photo OG route derives internal-fetch origin from the request Host header (constrained SSRF)
- **Severity:** MED · **Confidence:** Med · **Classification:** needs-manual-validation (depends on edge Host filtering) · **Agreement:** 1 agent (security-reviewer)
- **Where:** `apps/web/src/app/api/og/photo/[id]/route.tsx:114` (`new URL(req.url).origin`), also the 302 fallback at `:262`; `apps/web/src/lib/og-photo-fetch.ts:50-52`; `nginx/default.conf` (`proxy_set_header Host $host;`, no default_server reject block)
- **Description:** The Satori OG image's internal photo fetch builds its origin from the client-supplied Host header. If the TLS edge forwards arbitrary Host values, the server fetches `https://attacker.tld/uploads/jpeg/<derived>.jpg` and base64-embeds the response into the served OG JPEG — constrained SSRF (fixed GET, fixed path suffix, 10 s timeout, 1 MB cap) with response exfiltration and CDN cache-poisoning of the 302 fallback.
- **Failure scenario:** Edge passes `Host: attacker.tld`; per-photo OG entry is poisoned with attacker-served bytes; internal hosts answering 2xx on that fixed path are readable.
- **Fix:** Derive the origin from a trusted server-side base (`process.env.BASE_URL` / `siteConfig.url`, falling back to req origin only in dev) for both the fetch and the 302 Location; optionally add an nginx `default_server` 444 block.

#### SEC-R5C1-02 — PAT auth path: no failed-token-verification audit or rate accounting
- **Severity:** MED · **Confidence:** Med · **Classification:** likely (hardening) · **Agreement:** 1 agent (security-reviewer)
- **Where:** `apps/web/src/lib/api-auth.ts:63-89`; `apps/web/src/app/api/admin/lr/upload/route.ts:57`
- **Description:** `withAdminAuth`'s token branch verifies `X-GalleryKit-Token` against the DB with no per-IP failure counter and no audit event — unlike the cookie login path (5/15min buckets + `login_failure` audit). The 256-bit keyspace makes brute force infeasible (hence MED), but credential-stuffing of stolen PATs leaves zero forensic trail; nginx's 30 r/m admin zone is the only volume mitigation.
- **Failure scenario:** A leaked PAT is replayed/stuffed; the operator has no signal that failed token presentations occurred.
- **Fix:** Add a `token_auth_failure` audit event + small per-IP failure counter in the token branch, mirroring the login pattern.

#### TRC-R5C1-14 — Originals uploaded before `strip_gps_on_upload` was enabled retain GPS in paid downloads
- **Severity:** MED · **Confidence:** Med · **Classification:** confirmed (mitigated by the settings lock in normal operation) · **Agreement:** 1 agent (tracer)
- **Where:** `apps/web/src/app/api/download/[imageId]/route.ts:282` (streams raw original); `apps/web/src/app/actions/images.ts:305-311` (strip at upload time only); `apps/web/src/app/actions/settings.ts:115-134` (lock)
- **Description:** GPS strip happens only at upload; the paid-download route streams the on-disk original verbatim with no re-check. The `strip_gps_on_upload` toggle is locked once any image exists, which makes the gap unreachable in normal operation — it matters for images imported before the lock existed, direct-DB toggles, or any lock bypass bug. Related but distinct: COR-R5C1-07 (HEIC tier-2 scrub failure) leaks GPS through the same download path by a different mechanism.
- **Failure scenario:** Operator believes GPS stripping is on; a pre-lock-era original with GPS is sold; buyer's download contains coordinates.
- **Fix:** Either add a download-time GPS audit/strip pass for originals whose upload predates the setting, or document explicitly that the guarantee applies only to images uploaded while the setting was on; a one-off backfill scrub script is the thorough option.

#### TRC-R5C1-15 — 24 h download-token expiry with no re-issue path; stdout is the only distribution channel
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (known TODO US-P54-phase2) · **Agreement:** 1 agent (tracer)
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:346-382, 437-449`
- **Description:** `expiresAt = now + 24h`, single-use, idempotency prevents regeneration on Stripe retry, and the `LOG_PLAINTEXT_DOWNLOAD_TOKENS` stdout line is the only fulfillment channel. If the operator misses the window, a paying customer cannot download and there is no self-service re-issue.
- **Failure scenario:** Sale lands overnight; operator checks logs 30 h later; customer paid, token expired, manual DB surgery required.
- **Fix:** Prioritize the deferred email pipeline, or add an admin "re-issue token for entitlement" action; at minimum lengthen expiry and document the operational SLA.

#### TRC-R5C1-16 — Stripe idempotency key collides across buyers when TRUST_PROXY is unset
- **Severity:** MED (tracer rated HIGH; downgraded — aggregator verified `docker-compose.yml:21` sets `TRUST_PROXY: "true"`, so the shipped topology is protected) · **Confidence:** High · **Classification:** likely (real only in non-compose/bare deployments) · **Agreement:** 1 agent (tracer)
- **Where:** `apps/web/src/app/api/checkout/[imageId]/route.ts:173-178`
- **Description:** With `TRUST_PROXY` unset, `getClientIp()` returns `'unknown'`, making the key `checkout-{imageId}-unknown-{minute}`; two buyers of the same image in the same minute receive the SAME Stripe session — one buyer's payment can satisfy the other's entitlement metadata.
- **Failure scenario:** Bare-metal/non-compose deployment without TRUST_PROXY; two concurrent buyers in one minute; second buyer is handed the first buyer's checkout session.
- **Fix:** When `ip === 'unknown'`, omit the idempotency key (or add a per-request random component); document the TRUST_PROXY dependency in deployment docs.

#### TRC-R5C1-17 — Download single-use check falls back `affectedRows ?? 1` (permissive)
- **Severity:** MED · **Confidence:** Med · **Classification:** confirmed (intentional but risky trade-off) · **Agreement:** 1 agent (tracer)
- **Where:** `apps/web/src/app/api/download/[imageId]/route.ts:394-400`
- **Description:** If the Drizzle/mysql2 result shape ever stops exposing `affectedRows` on UPDATE, the `?? 1` fallback allows the download even when 0 rows were claimed — a single-use bypass. The comment documents this as a deliberate prefer-customer-experience choice; mysql2 has been stable here for years.
- **Failure scenario:** A driver/ORM upgrade changes the result header shape; already-claimed tokens silently allow repeat downloads until noticed.
- **Fix:** Pin the shape with a unit test against the real drizzle/mysql2 result type (cheap), or restructure to read the claim result through a typed helper that fails loudly on shape mismatch instead of defaulting open.

#### BUG-R5C1-01 — AVIF 10-bit fallback calls `base.clone()` after a failed `.toFile()`
- **Severity:** MED (debugger rated HIGH; reduced — aggregator verified `base` is FILE-PATH-backed (`sharp(processingInputPath, …)` at process-image.ts:1074-1080); Sharp file-backed pipelines re-read the input per execution, so the consumed-stream premise likely doesn't apply; the path also carries an R4C8 COR-R4C8-06 fix lineage) · **Confidence:** Med · **Classification:** needs-manual-validation · **Agreement:** 1 agent (debugger)
- **Where:** `apps/web/src/lib/process-image.ts:1106-1140`
- **Description:** When the 10-bit encode throws a bitdepth error, the catch retries via `base.clone()…bitdepth:8`. The debugger's concern (clone of a consumed pipeline → empty/corrupt output) is real for stream inputs but `base` here is file-backed. What's genuinely unverified: that the 8-bit retry path produces a valid file end-to-end on a real bitdepth-reject, since the probe singleton normally prevents this branch from ever running in CI.
- **Failure scenario:** If the premise held: wide-gamut image hits per-image 10-bit reject; all AVIF sizes written corrupt/empty while the row is marked processed with `avif_10bit=false`.
- **Fix:** Add a fixture test that forces the bitdepth-reject path (mock `.toFile` to throw a `/bitdepth/` error once) and asserts the fallback writes a non-empty, decodable AVIF. If any doubt remains, construct the fallback from `sharp(processingInputPath, …)` fresh instead of `base.clone()` — strictly safer at negligible cost.

#### BUG-R5C1-03 — `verifyWebpIccInBuffer` scans only the first 1 KB
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (debugger)
- **Where:** `apps/web/src/lib/process-image.ts` (`verifyWebpIccInBuffer`)
- **Description:** WebP is RIFF; ICCP can sit after large VP8/VP8L/ANIM chunks, beyond offset 1024 for any high-resolution image. The function then reports "no ICCP" for correctly-embedded profiles. Audit-only today (misleading warnings, no blocking), but it poisons the verification signal for the wide-gamut pipeline.
- **Failure scenario:** Every >1 MP wide-gamut WebP logs a false "no ICCP" warning; an operator chasing color bugs is sent down the wrong path.
- **Fix:** Walk RIFF chunks sequentially (or scan ≥64 KB) for the ICCP FourCC.

#### BUG-R5C1-04 — `toMySqlDateTime` server-local getters: TZ change between deploys silently corrupts DATETIME ordering
- **Severity:** MED · **Confidence:** Med · **Classification:** likely (requires an ops event to trigger) · **Agreement:** 1 agent (debugger)
- **Where:** `apps/web/src/lib/mysql-datetime.ts:19`
- **Description:** Local-time serialization (intentionally matching mysql2) means a container `TZ` change (or host migration KST→UTC) makes pre/post-change rows (`sessions.expires_at`, `failed_at`, …) compare in mixed zones with no error anywhere.
- **Failure scenario:** Redeploy with different `TZ`; session expiries jump ±9 h; sorts and expiry checks are silently wrong for mixed-era rows.
- **Fix:** Document `TZ` as a required-stable env in docker-compose; optionally a startup assertion comparing current `TZ` against a first-boot value in `admin_settings`, failing loudly on change.

#### BUG-R5C1-05 — `decimalToRational` returns decimal strings for exposures ≥ 1 s
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (debugger)
- **Where:** `apps/web/src/lib/process-image.ts` (`decimalToRational`, ~line 1319)
- **Description:** Values ≥ 1 short-circuit to the decimal string (`"1.5"`, `"4"`) instead of EXIF-conventional rationals (`"3/2"`, `"4/1"`); strict rational parsers break. Sub-second rounding can also yield non-canonical denominators (1/300 → 1/299.9997-class drift).
- **Failure scenario:** Long-exposure photo displays a malformed shutter value in strict EXIF viewers / the gallery's own EXIF surfaces.
- **Fix:** Return `"${n}/1"` for integers and nearest-simple-fraction (e.g. quarter-stop snap) for non-integers ≥ 1.

#### ARCH-R5C1-01 — serve-upload settings-hash ETag is inert in the shipped nginx topology
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (doc-vs-reality drift) · **Agreement:** 1 agent (architect) — cross-ref TRC-R5C1-02 (Next-static layer, related but distinct mechanism) and VER-R5C1-01 (same doc paragraph)
- **Where:** `apps/web/nginx/default.conf:146-166` (sendfile of `/uploads/{jpeg,webp,avif}` directly from public/); `apps/web/src/lib/serve-upload.ts:200-201`; `apps/web/docker-compose.yml:23-25`
- **Description:** In the documented production deployment, nginx serves existing derivatives via sendfile — requests never reach Node, so the P4-E2 settings-hash ETag never executes; nginx emits only its mtime/size ETag. The documented "flip a color setting → caches bust automatically" guarantee does not hold behind nginx; invalidation actually rides on the mandatory backfill's mtime change.
- **Failure scenario:** Admin flips `force_srgb_derivatives` without running a backfill; cached old-color bytes keep revalidating 304 for up to the max-age window and beyond.
- **Fix:** Lowest-effort: correct CLAUDE.md + add a note in serve-upload.ts that its ETag is dev/fallback-path-only and backfill is what busts caches. Structural alternative: move the settings hash into the URL (query/v= or content-addressed filename) so static layers participate.

#### ARCH-R5C1-02 — No retention/pruning for the three analytics view-event tables
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (architect) — complements PERF-R5C1-02 (index) on the same tables
- **Where:** `apps/web/src/app/actions/public.ts:360, 381, 397` (INSERTs); `apps/web/src/lib/audit.ts:55-73` (the only table WITH retention)
- **Description:** `audit_log` has a 90-day purge job; `image_views`/`topic_views`/`shared_group_views` have none — every legitimate view is a row forever. Unbounded growth on the single-instance volume, ballooning dumps on the 124 G host, slowing dashboards.
- **Failure scenario:** Months of moderate traffic → millions of rows → slow analytics, bloated `data/backups/` dumps, disk-hygiene runbook fires more often.
- **Fix:** `purgeOldViewEvents(maxAgeMs)` mirroring `purgeOldAuditLog`, wired into the existing hourly job, env-gated (`VIEW_EVENT_RETENTION_DAYS`, default 365); chunked range-deletes using the `(bot, viewed_at, …)` indexes added for PERF-R5C1-02.

#### ARCH-R5C1-03 — `geoip-lite` absent from serverExternalPackages/tracing; silent degradation + stale data
- **Severity:** MED · **Confidence:** Med · **Classification:** likely (tracing-drop is environment-dependent; silent-degradation + staleness are certain) · **Agreement:** 1 agent (architect)
- **Where:** `apps/web/src/lib/analytics.ts:33-50` (runtime `require` → `() => null` on failure); `apps/web/next.config.ts:45`; `apps/web/package.json:49`
- **Description:** Standalone-output tracing can miss the runtime-only `require('geoip-lite')` and its side-effect-loaded `data/*.dat`; on failure every `country_code` silently becomes `'XX'` (console.debug only). Separately the bundled GeoLite2 snapshot is frozen at npm-install time and drifts stale.
- **Failure scenario:** A Next upgrade changes tracing; geo data files drop from the image; admins see empty country analytics and conclude "no international traffic" — no warning anywhere.
- **Fix:** Add to `serverExternalPackages` + `outputFileTracingIncludes` for its data dir; promote the load-failure log to WARN at startup; document staleness (or move to a maxmind reader with a mounted DB).

#### ARCH-R5C1-04 — Migration journal `when`-monotonicity has no CI/test guard (deploy-host-only enforcement)
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (journal already contains a verified idx 6→7 inversion) · **Agreement:** 1 agent (architect)
- **Where:** `apps/web/drizzle/meta/_journal.json` (idx 6 `when=1778304060000` > idx 7 `when=1746144000000`); `apps/web/scripts/migrate.js:697-708`; CLAUDE.md migration runbook step 2
- **Description:** The robust runtime post-condition ("Drizzle silently skipped N migration(s)") fires only at deploy time on the production host — there is no staging, so a non-monotonic `when` added by a contributor/agent turns directly into a hard production deploy failure. The rule lives only in CLAUDE.md prose.
- **Failure scenario:** An RPF-loop agent hand-writes a journal entry with a stale timestamp; `npm test` is green; deploy hard-fails in production.
- **Fix:** Vitest fixture asserting strictly increasing `when` across the journal AND that every `tag` has a matching `drizzle/NNNN_*.sql` file. Moves the burned-once failure left into the commit gate.

#### PERF-R5C1-03 — Embedding hook reads `admin_settings` on EVERY processed image even when semantic search is disabled
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (perf-reviewer) — fold the TRC-R5C1-01/PERF-R5C1-11 bootstrap-snapshot fix in here (same subsystem)
- **Where:** `apps/web/src/lib/image-queue.ts:405-413`
- **Description:** The fire-and-forget embedding closure calls `getGalleryConfig()` per job to learn the feature is off; React `cache()` gives zero dedupe outside request context, so a 500-photo bulk upload issues 500 redundant `admin_settings` SELECTs against the 10-conn pool during the busiest window. The caption hook one block up already reuses the config fetched at line 318.
- **Failure scenario:** Bulk upload competes with live page reads for pool slots purely to re-discover a disabled default.
- **Fix:** Plumb `semanticSearchMode` from the config already resolved in the same job scope (line 318), or a short-TTL process-level snapshot. Default-disabled must cost zero DB work.

#### PERF-R5C1-04 — `getTopics` correlated `MAX(updated_at)` subquery per topic row
- **Severity:** MED · **Confidence:** Med · **Classification:** likely (latent; bounded by ISR-cached sitemap consumer) · **Agreement:** 1 agent (perf-reviewer)
- **Where:** `apps/web/src/lib/data.ts:448-469`
- **Description:** Per-topic scalar subquery `MAX(images.updated_at)` cannot be answered from `idx_images_topic (topic, processed, capture_date, created_at)` — each topic triggers row probes. N = topic count; consumer is `/sitemap.xml` at `revalidate=3600`, so blast radius is bounded today, cliff appears with many large topics.
- **Failure scenario:** Sitemap ISR regeneration stalls multi-second on a many-topic, large-image-count gallery.
- **Fix:** When it shows in slow logs: covering index `(topic, processed, updated_at)` or one `GROUP BY topic` join instead of N subqueries. No action required today — keep on the radar.

#### PERF-R5C1-06 — `getImage` prev/next adjacency OR-predicate defeats single-index range scans on the hottest route
- **Severity:** MED · **Confidence:** Med · **Classification:** needs-manual-validation (EXPLAIN on a large seeded table required) · **Agreement:** 1 agent (perf-reviewer)
- **Where:** `apps/web/src/lib/data.ts:954-1057`
- **Description:** The 4-branch OR (range + equality chains + isNull) on each adjacency SELECT resolves via index-merge/wide range instead of a tight keyset seek; runs on every `/p/[id]` load (which is `revalidate=0`). Invisible at current scale; grows with the images table.
- **Failure scenario:** Hundreds of thousands of images → each photo-page view pays wider-than-necessary scans × 2 (prev+next).
- **Fix:** Rewrite the dated branch as a MySQL row-comparator tuple `(capture_date, created_at, id) < (X,Y,Z)` (NULL branch separate) and verify with EXPLAIN that `idx_images_processed_capture_date` is used as a range.

#### PERF-R5C1-07 — SW blocks cached-image serving on a synchronous HEAD round-trip
- **Severity:** MED · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent (perf-reviewer) — cross-ref COR-R5C1-05 (redundant GET on same-ETag 200, same probe; fixes should land together)
- **Where:** `apps/web/public/sw.template.js:193-237` (`staleWhileRevalidateImage`); reference `lib/sw-cache.ts`; pinned by `sw-template-contract.test.ts`
- **Description:** On cache hit the SW awaits a HEAD (If-None-Match) BEFORE returning cached bytes — converting the warm-cache paint into cache-hit-gated-on-RTT, one blocking HEAD per visible derivative on a masonry paint. The R10-H3 rationale (instant color-setting visibility) inverts the SWR contract.
- **Failure scenario:** Returning visitor on slow mobile: every cached thumbnail waits an RTT before painting — the SW adds latency on exactly the path it exists to accelerate.
- **Fix:** Serve cached synchronously; run the ETag check in the background and update for the NEXT view (accept one-cycle staleness on setting flips), or gate the synchronous probe on entry age. Update template + reference impl + contract test together; regenerate and commit `sw.js`.

#### DOC-R5C1-02 — `BACKFILL_CONCURRENCY` vs `ADMIN_BACKFILL_CONCURRENCY` naming/default divergence, half undocumented
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (document-specialist)
- **Where:** `apps/web/scripts/backfill-color-pipeline.ts:287` (`BACKFILL_CONCURRENCY`, default 2); `apps/web/src/lib/admin-backfill-runner.ts:308` (`ADMIN_BACKFILL_CONCURRENCY`, default 1); CLAUDE.md backfill block
- **Description:** The two equivalent backfill entry points read different env vars with different defaults; only the sidecar's is documented. An operator throttling the in-app runner with `BACKFILL_CONCURRENCY` silently has no effect.
- **Failure scenario:** Operator sets BACKFILL_CONCURRENCY=1 to protect a small VM, clicks the admin button, and runs at the other knob's default anyway.
- **Fix:** Align names (or document both with defaults); add to `.env.local.example`.

#### DOC-R5C1-03 — Deployment checklist omits `src/` prefix for site-config.json
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (document-specialist)
- **Where:** CLAUDE.md Deployment Checklist step 3; `apps/web/scripts/ensure-site-config.mjs:4` (expects `src/site-config.json`)
- **Description:** Checklist says copy `site-config.example.json` → `site-config.json` without the `apps/web/src/` path; following it verbatim still fails the build guard.
- **Failure scenario:** First-time deployer copies to repo root; build fails with a guard message that doesn't match what they just did.
- **Fix:** "Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json`." (Note: CLAUDE.md's Key Files table also says `apps/web/src/site-config.json` — the checklist is the outlier.)

#### DOC-R5C1-04 — Seven production-relevant env vars absent from `.env.local.example`
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (document-specialist)
- **Where:** `apps/web/.env.local.example` vs reads of `UPLOAD_ORIGINAL_ROOT`, `UPLOAD_ROOT`, `ADMIN_BACKFILL_CONCURRENCY`, `IMAGE_CLEANUP_CONCURRENCY`, `NEXT_PUBLIC_HDR_FEATURE_FLAG`, `NEXT_PUBLIC_GA_ID`, `NEXT_UPLOAD_BODY_MAX_BYTES`
- **Description:** Operators cannot tune these without reading source. `UPLOAD_ORIGINAL_ROOT` is the critical one (Docker volume mapping; already used in the documented sidecar command). Caution: per CRT-R5C1-03, `NEXT_PUBLIC_HDR_FEATURE_FLAG` currently gates nothing — document it as inert/reserved or delete it, do not advertise it as functional.
- **Failure scenario:** Operator misplaces the originals volume because `UPLOAD_ORIGINAL_ROOT` is undocumented; paid downloads 404.
- **Fix:** Commented entries with defaults + effects in `.env.local.example`.

#### TEST-R5C1-07 — `upload-paths.ts` untested (`resolveOriginalUploadPath` / `assertNoLegacyPublicOriginalUploads`)
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/lib/upload-paths.ts:58-100`
- **Description:** Mocked everywhere, tested nowhere. Wrong legacy-fallback logic = 404 on a paid original AFTER the single-use token is claimed; the production-startup legacy-dir assertion is also unexercised.
- **Failure scenario:** Fallback regression; valid paid download 404s with the token already burned.
- **Fix:** tmp-dir tests (pattern: `strip-gps-from-original.test.ts`) covering primary-hit, legacy-hit, neither, and the assert's warn/throw modes.

#### TEST-R5C1-08 — `withAdminAuth` wrong-scope token branch untested
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/lib/api-auth.ts:67`
- **Description:** Valid-token+has-scope and invalid-token are tested; valid-token+WRONG-scope is not. An `&&` → `||` regression would grant any-scoped tokens access to scope-gated routes with a green suite.
- **Failure scenario:** Short-circuit regression; `lr:read` token uploads via `lr:upload` route.
- **Fix:** One test: verified token with `['lr:read']` against a route requiring `lr:upload` → 401.

#### TEST-R5C1-09 — Advisory-lock name strings not pinned by any test
- **Severity:** MED · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/lib/advisory-locks.ts:1-46`
- **Description:** A rename changes the MySQL lock name in production; old + new app instances across a deploy boundary stop serializing (restore, backfill, per-image claims) with no failing test.
- **Failure scenario:** Refactor renames `gallerykit_db_restore`; during rolling restart, two processes restore concurrently.
- **Fix:** Fixture asserting the exported constants equal their documented values, incl. `getImageProcessingLockName(42)`.

#### TEST-R5C1-10 — `e2e/public.spec.ts` is empty
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/e2e/public.spec.ts` (zero describe/it)
- **Description:** All e2e is admin-gated; no coverage for public homepage render, photo viewer, shared-group access, 404s, or search rate-limit responses — routing/middleware/i18n breakage on the public surface ships undetected.
- **Failure scenario:** A proxy.ts or locale-routing change 500s the public homepage; suite green; production discovers it.
- **Fix:** Minimum viable specs: homepage 200 + grid renders; /p/[id] loads with metadata; /g/[key]; unknown route 404.

#### TEST-R5C1-11 — Paid-download GET→POST claim flow has no e2e test
- **Severity:** MED · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/e2e/origin-guard.spec.ts` (admin flows only)
- **Description:** The R4C7 fix (claim moved GET→POST for email-scanner safety) has no regression e2e: interstitial GET must NOT claim; POST claims once; second POST → 410.
- **Failure scenario:** A refactor reintroduces claim-on-GET; corporate mail scanners burn customers' tokens again.
- **Fix:** e2e spec with a seeded entitlement covering the three-step contract.

#### TEST-R5C1-13 — Stripe webhook covered only by source-scan tests
- **Severity:** MED · **Confidence:** Med · **Classification:** likely (test-type limitation / false confidence) · **Agreement:** 1 agent (test-engineer)
- **Where:** `apps/web/src/__tests__/stripe-webhook-source.test.ts`, `cycle3..8-rpf-source-contracts.test.ts`
- **Description:** Regex/indexOf tests pin structure but cannot catch runtime ordering (insert vs token generation), wrong idempotency column, NaN imageId parses, or email-truncation field errors — on the money path.
- **Failure scenario:** A logic regression preserves the scanned patterns but inverts behavior; all source-contract tests stay green.
- **Fix:** Behavioral unit tests with mocked Stripe + DB for completed-session happy path, duplicate delivery, deleted-image FK path, zero-amount path.

#### DES-R5C1-06 — Search input dual accessible-name + dead mobile backdrop
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/search.tsx:301-329`
- **Description:** `<Input>` carries both an `sr-only` `<label htmlFor>` and an `aria-label` (aria-label wins; label becomes inert — maintenance confusion); the `z-40` backdrop beneath the full-screen `z-50` mobile dialog is unreachable dead code.
- **Failure scenario:** Maintainer edits the `<label>` text expecting AT changes; nothing changes.
- **Fix:** Drop the `aria-label`, keep the label; render the backdrop only ≥sm or document the mobile no-op.

#### DES-R5C1-07 — Keyboard shortcut advertised via `aria-keyshortcuts` but hint hidden on mobile
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/photo-viewer.tsx:592, 659-724`
- **Description:** Info buttons declare `aria-keyshortcuts="I"`, but the visual hint is `hidden md:block` — Bluetooth-keyboard mobile users get the AT attribute with no discoverable hint; toolbar focus styling also leans entirely on shadcn defaults.
- **Failure scenario:** iPad+keyboard user never learns the shortcuts that AT claims exist.
- **Fix:** Show the hint at all sizes or add tooltips on the buttons.

#### DES-R5C1-08 — Nav 50%-opacity fallback fails contrast without backdrop-filter
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (impact device-dependent) · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/nav-client.tsx:73-112`
- **Description:** `bg-background/50` is the no-backdrop-filter fallback; nav text over arbitrary scrolled photo content can fall below WCAG AA on older Android WebView/Samsung Browser.
- **Failure scenario:** Low-vision user on an older WebView scrolls bright photos under the nav; links become unreadable.
- **Fix:** Fallback to `bg-background/90` (or solid); keep the translucent value only under `supports-[backdrop-filter]`.

#### DES-R5C1-09 — `containIntrinsicSize` fixed 300 px estimate causes mobile CLS
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (CLS portion; `colBase` naming note is cosmetic) · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/home-client.tsx:240-261`
- **Description:** The reserve-height estimate assumes ~300 px card width; mobile single-column cards run ~390 px, making reservations ~30% wrong before `content-visibility` renders — minor CLS on slow connections. Also `colBase = Math.min(itemCount, 1)` is a misleading name (under-sm count), not a bug.
- **Failure scenario:** Slow-3G visitor sees layout jumps as off-screen cards materialize at the wrong reserved heights.
- **Fix:** Estimate from column count/viewport width instead of the 300 px constant.

#### DES-R5C1-10 — Lightbox prev/next visible badge 40 px (outer target compliant)
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/lightbox.tsx:613-650`
- **Description:** Full-height edge buttons satisfy the touch floor; the `h-10 w-10` visual badge under-communicates the real tap zone, and the 64 px edge strips vs stopPropagation image click can surprise.
- **Failure scenario:** User aims precisely at the small circle, missing the (actually generous) zone affordance; cosmetic confusion only.
- **Fix:** Bump badges to `h-11 w-11` for visual parity.

#### DES-R5C1-11 — Hidden photo-viewer subtree keeps effects running during lightbox
- **Severity:** MED · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/photo-viewer.tsx:579, 777`
- **Description:** Lightbox-open hides the viewer with `display:none` but AnimatePresence + effects keep running on the hidden subtree — wasted CPU during slideshow playback (keyboard handlers correctly bail).
- **Failure scenario:** Long slideshow on a low-end device burns cycles animating an invisible tree.
- **Fix:** Conditionally render (or gate AnimatePresence on `!showLightbox`).

#### DES-R5C1-12 — Bottom sheet peek state lacks a backdrop — inconsistent tap-to-dismiss
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/info-bottom-sheet.tsx:193-199, 126-132`
- **Description:** Expanded → backdrop click collapses; peek → no backdrop, taps pass through to the photo behind, and nothing dismisses. Inconsistent mental model across states.
- **Failure scenario:** User taps outside a peek sheet expecting dismissal; the photo behind navigates instead.
- **Fix:** Low-opacity backdrop in peek that closes on tap.

#### DES-R5C1-13 — Sidebar `transition-all` + `overflow-hidden` clips content mid-animation
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/photo-viewer.tsx:803-808`
- **Description:** Width-animating `transition-all` against an overflow-hidden wrapper squishes EXIF/histogram content during the 500 ms close, concurrently with framer-motion image animation — frame drops on integrated GPUs.
- **Failure scenario:** Every sidebar toggle on a mid-range laptop visibly stutters and squishes.
- **Fix:** Limit transitioned properties (`transition-[opacity,transform]`); avoid width animation.

#### DES-R5C1-14 — Masonry overlay gradients under-contrast on high-key photos
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/home-client.tsx:363-378`
- **Description:** `from-black/65` (mobile) / `from-black/60` (desktop hover) over bright imagery can drop title contrast below 3:1 — against the project's stated WCAG AA goal.
- **Failure scenario:** Low-vision user can't read card titles over snow/white-wall photos.
- **Fix:** `from-black/75` / `from-black/70`, or add a text-shadow floor.

#### DES-R5C1-15 — Ken Burns reduced-motion suppression has no CSS belt-and-suspenders
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (defense-in-depth gap; JS gate currently correct) · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/globals.css:265-284`; `apps/web/src/components/lightbox.tsx:470, 528`
- **Description:** Suppression depends solely on the JS `shouldReduceMotion` gate; the inline `style.animation` shorthand can sidestep the global `animation-duration` override if the JS gate ever regresses or pre-hydration renders.
- **Failure scenario:** Hydration-order regression animates full Ken Burns for vestibular-disorder users who opted out.
- **Fix:** Explicit `@media (prefers-reduced-motion: reduce) { .lightbox-image { animation: none !important; } }`.

#### DES-R5C1-16 — Lightbox hardcoded `blue-500` focus rings diverge from design-system token
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (designer)
- **Where:** `apps/web/src/components/lightbox.tsx:550, 570, 594` (and siblings)
- **Description:** Lightbox controls use hardcoded blue outlines instead of `ring-ring`; inconsistent focus identity across themes and uncertain behavior under forced-colors. Not a WCAG failure (blue-on-black is high contrast), but a system inconsistency.
- **Failure scenario:** Keyboard user's focus affordance changes color semantics between the gallery and the lightbox.
- **Fix:** Swap to `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

---

### LOW

#### CRT-R5C1-05 — `@/lib/storage` is fully dead code; `switchStorageBackend('s3')` silently builds a local backend
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 2 agents (critic, architect) · **Contributing:** CRT-R5C1-05, ARCH-R5C1-06
- **Where:** `apps/web/src/lib/storage/{index,local,types}.ts`; sole importer is its own test (`storage-local.test.ts:10`)
- **Description:** Zero production call sites (grep-verified by both agents). Worse than inert: `switchStorageBackend` accepts a `StorageBackendType` and constructs `new LocalStorageBackend()` for ANY type — an attractive nuisance inviting a future "S3 toggle" that silently writes locally. CLAUDE.md honestly flags "Not Yet Integrated," but the API shape masquerades as functional.
- **Failure scenario:** Agent tasked with "add S3" wires an admin toggle to `switchStorageBackend('s3')`; uploads appear to switch but write locally.
- **Fix:** Delete the module + test until S3 is scheduled (deletion-first), or make non-`'local'` types throw `NotImplemented` and add UNUSED banners.

#### TRC-R5C1-01 — Bootstrap re-enqueue passes no config snapshot: live-config drift + redundant per-job reads
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 2 agents (tracer, perf-reviewer) · **Contributing:** TRC-R5C1-01, PERF-R5C1-11
- **Where:** `apps/web/src/lib/image-queue.ts:316-334` (live-config fallback), `:609-630` (bootstrap enqueues without quality/imageSizes)
- **Description:** Bootstrapped jobs (post-restart re-discovery, up to 500/batch) carry no upload-time snapshot, so each job re-reads live config — a consistency wrinkle (a restart-boundary job processes under settings changed since upload; largely fenced by the image_sizes lock-once contract) and redundant `admin_settings` SELECTs during the recovery window (up to 2N with the embedding read, see PERF-R5C1-03). `forceSrgbDerivatives` is also read live even for fresh jobs (TRC hypothesis B).
- **Failure scenario:** Restart with a large pending backlog: recovery window doubles config reads; rare cross-restart setting changes process stragglers inconsistently with their batch.
- **Fix:** Resolve config once per bootstrap batch and thread the snapshot into jobs (the upload path already proves the pattern); fold into the PERF-R5C1-03 fix.

#### COR-R5C1-02 — Public IPv6 referrers stored verbatim as `referrer_host`
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/analytics.ts:126-138, 149-181`
- **Description:** `isPrivateHost` only catches private-range literals; a public IPv6 referrer survives to `extractTldPlusOne`, which returns it verbatim (no dots) — violating the "TLD+1 or direct" contract. Attacker-suppliable Referer ⇒ analytics pollution only.
- **Failure scenario:** `Referer: https://[2001:db8::1]:8080/x` records `referrer_host='2001:db8::1'`.
- **Fix:** Collapse bare IPv4/IPv6 literals to `'direct'` before TLD+1 extraction.

#### COR-R5C1-04 — Semantic route does a `getGalleryConfig` DB read before the rate-limit pre-increment
- **Severity:** LOW · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent — cross-ref CRT-R5C1-01 (same route; fix together)
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:161-185`
- **Description:** With semantic search disabled (default), the 503 path runs an unmetered config DB read per request before the limiter is touched — a minor same-origin-bounded read amplifier.
- **Failure scenario:** Same-origin client spams the disabled endpoint; each hit costs a config SELECT, never a budget unit.
- **Fix:** Reorder gates that don't need the limiter, or accept (config read is cached/cheap); note for parity with checkout/OG charge-first patterns.

#### COR-R5C1-05 — SW same-ETag 200 HEAD probe still dispatches a redundant full-GET revalidate
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (documented-but-unfixed) · **Agreement:** 1 agent — cross-ref PERF-R5C1-07 (same probe; land together)
- **Where:** `apps/web/public/sw.template.js:220-236`; reference `lib/sw-cache.ts`
- **Description:** When a HEAD answers 200 with an ETag EQUAL to the cached one (CDNs that ignore If-None-Match on HEAD), control falls into `startRevalidate()` — full GET + byte-identical re-put + LRU meta rewrite per image view, exactly the cycle the 304 path was built to avoid.
- **Failure scenario:** Behind such a CDN, every cached image view costs HEAD + GET + meta rewrite.
- **Fix:** Treat same-ETag 200 like 304 (touch + serve cached); revalidate only on differing/absent ETag. Update template + sw-cache.ts + contract test, regenerate `sw.js`.

#### COR-R5C1-06 — `restoreDatabase` lock teardown fragility + stale line-number comment
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation · **Agreement:** 1 agent
- **Where:** `apps/web/src/app/[locale]/admin/db-actions.ts:331-360`
- **Description:** Teardown lives in the inner `finally`; early-returns before it each release manually (historically bug-prone, C7R-RPL-02). No live defect found, but a future early-return added between maintenance-begin and the inner try would strand `LOCK_DB_RESTORE` + the contract lock until pool eviction. Outer-finally comment cites stale line numbers.
- **Failure scenario:** Future edit adds a validation early-return mid-window; all subsequent restores fail `restoreInProgress`.
- **Fix:** Fix the comment; consider hoisting teardown into one boolean-guarded outer finally helper.

#### COR-R5C1-07 — HEIC GPS-strip tier-2 fallback silently retains GPS on structural anomaly
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (documented limitation — kept on record because the paid-download route streams the affected file) · **Agreement:** 1 agent — cross-ref TRC-R5C1-14 (different mechanism, same exposure surface)
- **Where:** `apps/web/src/lib/process-image.ts:1538-1544`
- **Description:** When the lossless ISOBMFF scrubber returns null on a `.heic`/`.heif`, tier-2 cannot re-encode (no HEVC encoder); the function error-logs and returns, leaving GPS in the on-disk original that paid downloads stream. DB nulled, derivatives clean — the gap is the original only.
- **Failure scenario:** Structurally-exotic iPhone HEIC sold with `strip_gps_on_upload=true`; buyer receives coordinates; operator only has an error log line.
- **Fix:** Product decision: fail-closed (reject upload when strip can't be certified) or serve a re-encoded derivative as the "original" for affected files.

#### SEC-R5C1-04 — `validateSeoOgImageUrl` relative branch: no percent-encoded traversal normalization
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation (defense-in-depth; current guard sound for known vectors) · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/seo-og-url.ts:9-24`
- **Description:** SEC-R4C20-01 closed the `\` bypass; the relative branch still accepts any `/…` without normalizing `%2f%2f`/`%5c`. Blast radius is admin-set meta/302 — crawler-self-XSS class at most.
- **Failure scenario:** A future crawler URL-normalization quirk re-decodes `/%2f%2fevil.com` into a scheme-relative redirect.
- **Fix:** Resolve via `new URL(value, base)` and re-assert origin equality (snippet in SEC review).

#### CRT-R5C1-04 — Stripe `checkout.session.async_payment_succeeded` handler missing
- **Severity:** LOW (critic: MINOR; latent) · **Confidence:** High · **Classification:** confirmed (documented in-code as future work) · **Agreement:** 1 agent
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:96-99`
- **Description:** Only `checkout.session.completed` is handled; async-settling methods (ACH/OXXO/Boleto) arrive `unpaid` then fire `async_payment_succeeded`, which falls through to `received:true` — customer paid, no entitlement minted. Unreachable with current card-only USD config.
- **Failure scenario:** Operator enables a delayed-payment method in the Stripe dashboard; settled payments never produce download tokens.
- **Fix:** Add the event case reusing the completed-path insert, or document the dashboard constraint.

#### CRT-R5C1-06 — CLAUDE.md backfill block hardcodes `/home/ubuntu/gallery` vs `.env.deploy` `DEPLOY_PATH`
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation (hinges on actual DEPLOY_PATH) · **Agreement:** 1 agent
- **Where:** CLAUDE.md Backfill block; `apps/web/deploy.sh:5`; root README deploy helper
- **Description:** If `DEPLOY_PATH` ≠ `/home/ubuntu/gallery`, a copy-pasted sidecar command mounts wrong/empty dirs and the backfill silently no-ops or fails opaquely.
- **Failure scenario:** Host relocation; operator pastes the documented command; ro-mounts point at nothing.
- **Fix:** Reference `$DEPLOY_PATH` in the doc block and cross-link `.env.deploy`.

#### VER-R5C1-03 — SESSION_SECRET described as "random-64-char-hex"; enforcement is min 32 chars
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (VER-R5C1-28 is the same agent's restatement)
- **Where:** CLAUDE.md env section vs `apps/web/src/lib/session.ts:20-32`
- **Description:** A 32-63-char secret passes validation despite the docs implying 64 is required; the `openssl rand -hex 32` example is fine.
- **Failure scenario:** Operator confusion only.
- **Fix:** Say "min 32 chars (recommend `openssl rand -hex 32` → 64 hex chars)".

#### TRC-R5C1-02 — SW ETag-format mismatch across static/route-handler crossover (edge case)
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation · **Agreement:** 1 agent — cross-ref ARCH-R5C1-01 (nginx layer)
- **Where:** `apps/web/public/sw.js:44-50, 222`; CLAUDE.md serving-precedence note
- **Description:** If an entry was cache-filled from the route handler (versioned ETag) but later HEAD-probed against the static layer (mtime/size ETag) — possible when a file appears in `public/` after first being served dynamically — the formats never match and every view forces a full re-fetch. Steady-state same-layer flows are self-consistent.
- **Failure scenario:** Post-backfill or post-restore file materialization flips the serving layer; affected cached entries thrash.
- **Fix:** Validate manually; if real, treat any 200-with-body probe response as the new cache entry rather than comparing cross-format ETags.

#### TRC-R5C1-13 — Failed restore: `endRestoreMaintenance` in finally lets bootstrap run against a possibly inconsistent DB
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation (recoverable via bootstrap retry) · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/image-queue.ts:673-714`; `db-actions.ts` restore finally
- **Description:** A mid-restore failure still ends maintenance and re-bootstraps; if schema is partially applied, the bootstrap SELECT fails into `scheduleBootstrapRetry` (recoverable but noisy/undefined window).
- **Failure scenario:** Corrupt dump aborts restore halfway; queue bootstrap loops retries against a broken schema until manual intervention.
- **Fix:** Consider keeping maintenance mode on after a failed restore until an explicit admin acknowledgment.

#### ARCH-R5C1-05 — All non-login rate limits are in-memory and reset on every deploy
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/rate-limit.ts:79-119` (OG/checkout/share/search/semantic in-memory) vs `:400-447` (login DB-backed); per-iteration deploy policy
- **Description:** Per-commit deploys (often many/hour during RPF loops) zero every in-memory budget; OG (expensive ImageResponse, GET — outside the lint gate) and checkout (costs Stripe calls) are the cost-bearing surfaces.
- **Failure scenario:** Scripted OG abuse rides the deploy cadence, getting a fresh budget per deploy.
- **Fix:** Promote OG + checkout to the existing `rateLimitBuckets` DB-backed pattern; document the rest as best-effort.

#### PERF-R5C1-10 — `deleteImageVariants(sizes=[])` full `opendir` scan per delete
- **Severity:** LOW · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/process-image.ts:485-526`
- **Description:** Delete paths pass `sizes=[]`, triggering O(dir-entries) scans of all three derivative dirs per deleted image to catch orphans from old size configs (C3-F02 comment acknowledges).
- **Failure scenario:** Batch-delete 50 images on a 100k-photo gallery = 150 full scans of ~600k-entry dirs; seconds of syscall churn on spinning disks.
- **Fix:** Pass configured sizes for the deterministic path; run the orphan scan only when sizes config actually changed.

#### BUG-R5C1-06 — Permanent failure resets `bootstrapCursorId` to null → full re-scan
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/image-queue.ts` (~line 498)
- **Description:** Adding a permanently-failed ID nulls the keyset cursor, so the next bootstrap restarts from id 0 — quadratic-ish behavior proportional to gallery size × failure count.
- **Failure scenario:** Large gallery with early-id permanent failures; every restart re-pages the whole table.
- **Fix:** Don't reset the cursor on permanent failure; `notInArray` exclusion already handles skipping.

#### BUG-R5C1-07 — `verifyAvifNclxInBuffer` 4096-byte scan window
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation (Sharp writes colr early; affects exotic AVIF only) · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/process-image.ts` (`verifyAvifNclxInBuffer`)
- **Description:** `colr` may legally sit beyond 4 KB; false "no NCLX" audit warnings for non-Sharp-generated AVIF. Non-blocking, audit-noise only.
- **Failure scenario:** Pass-through AVIF logs false negatives.
- **Fix:** Reuse the bounded ISOBMFF walker from color-detection.ts (or widen to 64 KB).

#### BUG-R5C1-08 — `[...permanentlyFailedIds]` re-spread per bootstrap batch query
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/image-queue.ts` (bootstrap loop)
- **Description:** Up-to-1000-item spread + IN clause rebuilt on every paginated query. Within packet limits, just wasteful.
- **Failure scenario:** Restart after hitting the 1000-ID cap on a large gallery; bootstrap noticeably slower.
- **Fix:** Hoist the array before the loop; consider whether the IN exclusion is needed during bootstrap at all (advisory lock + processed check already guard).

#### DOC-R5C1-05 — React `cache()` docs: non-`Cached` names + 3 of 9 wrapped functions listed
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent · **Contributing:** DOC-R5C1-05, DOC-R5C1-09 (same CLAUDE.md line)
- **Where:** CLAUDE.md ~line 347 vs `apps/web/src/lib/data.ts:1558-1610`
- **Description:** Docs name the UNWRAPPED `getImage`/`getTopicBySlug`/`getTopicsWithAliases`; the cache-wrapped exports carry a `Cached` suffix and there are 9 of them. A developer following the doc bypasses request-dedup.
- **Failure scenario:** New page calls `getImage()` thrice per render; duplicate queries per request.
- **Fix:** Reference the `*Cached` exports ("see data.ts exports ending in Cached").

#### DOC-R5C1-06 — "Vitest 1300+ unit tests" claim overstated
- **Severity:** LOW · **Confidence:** Med · **Classification:** likely (test-engineer's actual run reports 186 files / 1799 tests — the prose number is wrong in the OTHER direction; just make it accurate) · **Agreement:** 1 agent (DOC-R5C1-26 is the same agent's AGENTS.md restatement)
- **Where:** AGENTS.md
- **Description:** Static grep suggests ~346 blocks; the live vitest run reports 1799 tests (it.each/dynamic generation). Either way "1300+" is stale.
- **Fix:** State the current `npm test` summary number or drop the count.

#### DOC-R5C1-07 — Two upload route files exist; docs acknowledge only the locale-prefixed one
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent (DOC-R5C1-16 is the same agent's restatement)
- **Where:** `apps/web/src/app/uploads/[...path]/route.ts` + `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`; CLAUDE.md line ~255
- **Description:** Both routes serve independently (both delegate to `serveUploadFile`); a developer patching headers/auth on one leaves the twin unpatched.
- **Failure scenario:** Security header added to one route only; locale-prefixed requests miss it.
- **Fix:** Document both routes and their shared delegate.

#### DOC-R5C1-11 — Deployment checklist lacks the install-handled-by-Docker note
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (minor) · **Agreement:** 1 agent
- **Where:** CLAUDE.md Deployment Checklist
- **Fix:** One sentence noting Docker performs the install during build.

#### DOC-R5C1-24 — "4 KB" blur cap is 4096 characters (~3 KB decoded)
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (unit imprecision) · **Agreement:** 1 agent
- **Where:** CLAUDE.md vs `apps/web/src/lib/blur-data-url.ts:45`
- **Fix:** Say "4096-char string cap (~3 KB decoded payload)".

#### DOC-R5C1-27 — Root `build` uses `--workspaces` (builds all) unlike sibling scripts — undocumented
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (informational) · **Agreement:** 1 agent
- **Where:** root `package.json` scripts; CLAUDE.md Common Commands
- **Fix:** One-line note in Common Commands.

#### TEST-R5C1-14 — Touch-target `KNOWN_VIOLATIONS` stale entries only warn
- **Severity:** LOW · **Confidence:** Med · **Classification:** likely · **Agreement:** 1 agent
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:575-593`
- **Description:** `found < allowed` is a console.warn, so fixed components leave inflated allowances that mask the next new violation in the same file.
- **Failure scenario:** Component fixed (−2 violations), entry left at old count; two new violations later land unseen.
- **Fix:** Promote stale entries to failures (`expect(stale).toHaveLength(0)`).

#### TEST-R5C1-15 — `csp-nonce.ts` has no tests
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/lib/csp-nonce.ts`
- **Description:** Nonce generation/extraction untested; predictable-nonce or encoding regressions would weaken CSP. Indirect coverage via the CSP contract test only.
- **Fix:** Small unit tests: length/charset/uniqueness of generated nonces; extraction round-trip.

#### DES-R5C1-17 — Locale-switch `aria-label` hardcoded ko/English ternary
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/components/nav-client.tsx:164`
- **Fix:** `localeDisplayNames` map owned by i18n.

#### DES-R5C1-18 — Dead `id="photo-viewer-shortcuts"`
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/components/photo-viewer.tsx:592`
- **Fix:** Wire `aria-describedby` to the container or drop the id.

#### DES-R5C1-19 — Empty-state SVG lacks `aria-hidden`
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/components/home-client.tsx:397`
- **Fix:** `aria-hidden="true"` on the decorative SVG.

#### DES-R5C1-20 — Inherited global tags have no ARIA read-only state
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/components/upload-dropzone.tsx:486-490`
- **Fix:** `aria-label={t('upload.globalTagInherited', { tag })}` or fieldset/legend grouping.

#### DES-R5C1-21 — Error page `<h1>` at ~1.4:1 contrast
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent
- **Where:** `apps/web/src/app/[locale]/error.tsx:21`
- **Description:** `text-muted-foreground/30` decorative `<h1>` fails AA; the 404 page already does it right (`aria-hidden` decorative span + real heading).
- **Fix:** Mirror `not-found.tsx:29`'s pattern.

#### DES-R5C1-22 — Lightbox counter announces "3 / 20" without context
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **Agreement:** 1 agent — pair with DES-R5C1-03
- **Where:** `apps/web/src/components/lightbox.tsx:666-674`
- **Fix:** `aria-label={t('aria.photoPosition', {current, total})}` mirroring `photo-viewer.tsx:796`.

#### DES-R5C1-23 — Bottom sheet `95vh` fallback may clip on iOS 15 Safari
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation (physical device) · **Agreement:** 1 agent
- **Where:** `apps/web/src/components/info-bottom-sheet.tsx:221-222`
- **Fix:** `paddingBottom: env(safe-area-inset-bottom)` on the outer container; verify on device.

#### DES-R5C1-24 — 12 px EXIF labels at ~6.1:1 — AA-compliant, marginal
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (no fix strictly required) · **Agreement:** 1 agent
- **Where:** `apps/web/src/components/photo-viewer.tsx:852-855`; same pattern in info-bottom-sheet EXIF grid
- **Fix:** Optional: bump label size or contrast if low-vision feedback warrants.

---

## DOCUMENTED-INTENTIONAL / VERIFIED NON-ISSUES

Findings any agent explicitly identified as already-documented trade-offs, verified-correct designs, or false positives. The planner can skip these; provenance preserved.

| ID | Agent | Verdict | Summary |
|---|---|---|---|
| COR-R5C1-03 | code-reviewer | accepted trade-off | `TWO_PART_TLDS` is a deliberate lightweight eTLD+1 approximation (documented in-file); use `psl`/`tldts` only if analytics accuracy ever matters |
| COR-R5C1-08 | code-reviewer | verified NON-issue | Upload-tracker pre-claim ordering traced: every early-return precedes the claim; the only post-claim return settles first; contract lock always released in outer finally. Recorded so future reviewers don't re-flag |
| SEC-R5C1-03 | security-reviewer | accepted residual | Transitive `postcss < 8.5.10` moderate CVE via Next's tree; no fix without breaking downgrade; runtime exposure effectively nil (build-time trusted CSS only). Track Next releases |
| SEC-R5C1-05 | security-reviewer | documented opt-in | `LOG_PLAINTEXT_DOWNLOAD_TOKENS` stdout scaffold is the documented manual-fulfillment interim, off by default; replace with the email pipeline (see TRC-R5C1-15) and keep log-sink hygiene |
| SEC-R5C1-06 | security-reviewer | by-design | Public analytics view-record actions use in-memory per-IP caps — correct for the documented single-writer topology; revisit only on horizontal scale |
| PERF-R5C1-08 | perf-reviewer | known, mitigated | `searchImages` leading-wildcard LIKE scans: short-circuits, parallel fan-out, 30/min rate cap; FULLTEXT is the documented escape hatch (R2C11-LOW-06) |
| PERF-R5C1-09 | perf-reviewer | fine at realistic scale | Per-group view-count UPDATEs: chunked, atomic-swap, retry-capped; batching not justified at realistic shared-group cardinality |
| PERF-R5C1-12 | perf-reviewer | no action at 2 locales | `revalidateLocalizedPaths` O(paths×locales): trivial today; RE-AUDIT (narrow paths, not `revalidateAllAppData`) if ISR is reintroduced per PERF-R5C1-05 |
| TRC-R5C1-03 | tracer | documented acceptable | Settings-hash 5 s stale-while-revalidate window on serve-upload ETags — bounded, intentional |
| TRC-R5C1-04 | tracer | intentional design | Middleware admin-cookie check is format-only UX redirect; cryptographic gate is per-action `verifySessionToken` (defense-in-depth documented) |
| TRC-R5C1-05 | tracer | known design choice | No session rotation on use; 24 h window. Consistent with the documented "no 2FA/WebAuthn for a personal gallery" posture |
| TRC-R5C1-06 | tracer | acceptable | React `cache()` per-request session memo can't see same-request revocation — not exploitable, fundamental to the dedup pattern |
| TRC-R5C1-07 | tracer | documented | `sharedGroups.view_count` buffered counter lossy on SIGKILL; analytics dashboard reads the per-event rows table, not the column |
| TRC-R5C1-08 | tracer | intentional | Fire-and-forget analytics insert swallows FK errors at console.debug — analytics-only, failure acceptable |
| TRC-R5C1-09 | tracer | verified protected | `image_sizes` check-then-write TOCTOU is serialized by `LOCK_UPLOAD_PROCESSING_CONTRACT` held by both settings change and uploads |
| TRC-R5C1-10 | tracer | documented gap | `image_sizes` change doesn't auto-backfill; setting is locked once images exist, and CLAUDE.md documents the backfill requirement |
| TRC-R5C1-11 | tracer | verified handled | Delete-while-processing: running job's conditional UPDATE hits 0 rows → cleans up its own derivative files. No leak |
| TRC-R5C1-12 | tracer | verified correct | Restore-vs-upload interlock: restore takes the contract lock with zero timeout and fails fast `uploadSettingsLocked`; two-phase maintenance checks in upload are defense-in-depth |
| TRC-R5C1-19 | tracer | not a vulnerability | `bulkUpdateImages` runs origin check before `isAdmin()` — order inversion vs siblings, both checks present. Cosmetic consistency only (optionally normalize while fixing COR-R5C1-01) |
| TRC-R5C1-20 | tracer | intentional conservative | `x-gk-admin-render` set on cookie PRESENCE (server can't cheaply validate in middleware; SW can't read Cookie). Under-caching is the safe direction; worst case = degraded offline UX for stale-cookie holders |
| TRC-R5C1-21 | tracer | verified correct | SW `isSensitiveResponse` scoping: images (`must-revalidate`, not `no-store`) never filtered; HTML uses the dedicated admin-render header path |
| DES-R5C1-25 | designer | handled globally | Hover-overlay `duration-300` transition is suppressed by the globals.css `!important` reduced-motion blanket; component-level gate unnecessary (comment optional) |
| DOC-R5C1-10 | document-specialist | unscored, likely correct | `SHARP_CONCURRENCY` example-file comment matches Sharp's documented behavior; not a confirmed mismatch |

**Verified-clean sweeps (for provenance):** verifier confirmed 24 of 28 CLAUDE.md claims exactly match code (pipeline version, advisory-lock names, rate-limit params, nginx caps, pool config, privacy guards, migration assertion, blur contract, GPS/withMetadata warning, backfill column set, SW TTL/caps, i18n 829/829 parity). Document-specialist independently verified 9 more claims clean (Firefox color-gamut MQ status, Sharp 0.33+ withMetadata, default sizes, max 8 sizes, hourly purge, etc.). Code-reviewer verified clean: queue↔settings lock-once contract, SW template↔reference parity, privacy select-field guards, Stripe webhook idempotency, paid-download single-use claim ordering, SQL restore scanner, admin advisory locks, rate-limit window reset. Perf-reviewer verified clean: all bounded Maps, view-count flush concurrency, Sharp memory/CPU discipline, queue races, DB pool hygiene, N+1-free read paths, React render hotspots, Tailwind safelist, zero sync-fs in request paths. Debugger ruled out: queue-shutdown clear race, auth rate-limit ordering, db-actions double-finally, topicRouteSegmentExists unwrap, seo-og-url backslash gate completeness, gps-strip null-fallback posture.

---

## SUMMARY COUNTS

| Severity | Merged findings |
|---|---|
| CRIT | 2 |
| HIGH | 16 |
| MED | 41 |
| LOW | 34 |
| **Total merged** | **93** |

| Metric | Count |
|---|---|
| Raw findings across all 11 agents (before dedupe) | 125 (COR 8, SEC 6, PERF 12, CRT 6, VER 4, TEST 16, TRC 21, ARCH 7, BUG 8, DOC 12, DES 25) |
| Merged findings (after dedupe) | 93 |
| Cross-agent duplicate clusters | 4 (VER-01×DOC-01 settings-hash docs; CRT-05×ARCH-06 storage dead code; PERF-05×ARCH-07 revalidate=0; TRC-01×PERF-11 bootstrap snapshot) |
| Same-agent merges | 3 (TEST-01+12; TEST-05+16; DOC-05+09) |
| Documented-intentional / verified non-issues | 22 (+1 unscored) |
| Severity adjustments by aggregator verification | 2 (TRC-R5C1-16 HIGH→MED: TRUST_PROXY=true in shipped compose; BUG-R5C1-01 HIGH→MED: file-backed Sharp pipeline premise) |
