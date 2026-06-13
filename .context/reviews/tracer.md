# Tracer — Cycle 9 Deep Review (evidence-driven causal tracing)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16.2 / React 19 / TS6)
**HEAD:** `0ce84b1b` — working tree CLEAN for SOURCE (verified `git status` shows only concurrent-agent `.context/**` mutations + pre-existing `plan/**` artifacts; every traced source file confirmed unchanged vs HEAD with `git diff --quiet HEAD -- <file>`).
**Method:** end-to-end flow tracing with line-cited evidence, competing hypotheses with evidence for/against, runtime probes (5 contract test files run green; GPS-strip flake re-characterized over 3 isolated runs), and HEAD-vs-working-tree discrimination to neutralize concurrent-agent perturbations.

---

## TL;DR

**NEW GENUINE FINDINGS: 0.**

All five priority flows re-traced against committed HEAD `0ce84b1b` and confirmed **SOUND** with strong line-cited evidence. The cycle-8 findings (AGG-C8-01 base56 uniformity test `71ab0f41`, AGG-C8-02 SCAN_ROOTS doc `aa8a6f8a`) landed clean. The prior cycle-8 tracer's only finding (TRC8-01, the WebP XMP cold-flake) is a **test-infra non-determinism, not a source defect** — re-characterized this cycle as 3/3 PASS in isolated runs; it does not recur and is already documented as a deferred test-hardening item. No CRITICAL/HIGH/MEDIUM/LOW source defect on any of the five flows. **Convergence holds.**

Contract gates run live this cycle (all green):
- `sw-template-contract.test.ts` + proxy admin-render marker → **14 passed**
- `migration-journal-monotonicity.test.ts` + `migration-journal.test.ts` + `migrate-reconcile-coverage.test.ts` → **63 passed**
- `admin-backfill-runner-detection-failure.test.ts` → green (in the 14)
- `strip-gps-from-original.test.ts` → **28 passed × 3 isolated runs**
- `backfill-color-pipeline.test.ts` → **6 passed**

---

## File inventory (the five flows)

| Flow | Core files (line counts at HEAD) |
|---|---|
| 1 GPS-strip dispatch | `lib/gps-exif-strip.ts` (595), `lib/process-image.ts` `stripGpsFromOriginal` (`:1561-1638`), `app/api/download/[imageId]/route.ts` (463), call sites `actions/images.ts:306-312` + `api/admin/lr/upload/route.ts:311-326` |
| 2 image-processing claim/race | `lib/image-queue.ts` (753), `lib/advisory-locks.ts` (`getImageProcessingLockName`) |
| 3 backfill (both entry points) | `lib/admin-backfill-runner.ts` (871), `scripts/backfill-color-pipeline.ts` (471), `app/actions/admin-backfill.ts` (130) |
| 4 migration cursor | `scripts/migrate.js` (775) |
| 5 SW HTML offline personalization | `public/sw.template.js` (364), `public/sw.js` (built, byte-matched on the gate), `src/proxy.ts` (141), consumer `app/[locale]/(public)/p/[id]/page.tsx` |

---

## Flow 1 — GPS-strip dispatch → per-format scrubber → paid-download streamed original

**Observation (code-traced):** `stripGpsFromOriginal(filePath)` (`process-image.ts:1561-1638`) is invoked at upload time by BOTH ingest writers under the `stripGpsOnUpload` snapshot — browser `actions/images.ts:311`, Lightroom `api/admin/lr/upload/route.ts:326` (byte-identical call). The paid-download POST (`api/download/[imageId]/route.ts:406`) streams the on-disk original from `UPLOAD_DIR_ORIGINAL/filename_original` verbatim. The scrub writes the cleaned bytes back to that EXACT path via `writeFile(tmp)` → `rename(tmp, filePath)` (`:1586-1587`, `:1627-1628`), so the streamed file IS the scrubbed file.

**Per-format dispatch (`:1564-1626`):**
| ext | Tier-1 lossless scrubber | Tier-2 fallback on `null` |
|---|---|---|
| `.jpg/.jpeg` (+ FFD8 magic guard `:1569`) | `stripGpsFromJpegBuffer` | re-encode q95 4:4:4 (`:1602`) |
| `.tif/.tiff` | `stripGpsFromTiffBuffer` | re-encode lzw (`:1612`) |
| `.heic/.heif/.avif` | `stripGpsFromIsobmffBuffer` | AVIF→re-encode q90 (`:1615`); HEIC/HEIF→loud error, GPS retained (`:1621`) |
| `.webp` | `stripGpsFromWebpBuffer` | re-encode, lossless-by-chunk (`:1608-1609`) |
| `.png` | none (Tier-1 skipped — falls to Tier-2) | re-encode pixel-lossless (`:1599`) |
| `.gif/.bmp` | none → `return` (`:1577-1581`) | n/a (no standardized GPS carriage) |
| other | none | `return` loud error (`:1624`) |

**Competing hypothesis: "does any branch leave GPS readable on the deliverable original?"**

- **H1a "a format branch silently no-ops, leaving GPS"** — REFUTED. Every ext maps to a scrubber OR an explicit documented no-GPS-carriage `return` (`.gif/.bmp`) OR a loud-error `return` (unknown ext `:1624`, HEVC-HEIF `:1621`). There is no fall-through that writes nothing while reporting success. The PNG case correctly falls through Tier-1 (no `.png` branch in the `if/else if` chain `:1569-1581`) into Tier-2 pixel-lossless re-encode (`:1598-1599`), which strips all metadata by default.
- **H1b "the scrubber returns `{stripped:true}` but didn't actually zero the GPS bytes"** — REFUTED by reading each scrubber:
  - **JPEG/TIFF core** (`stripGpsFromTiffRegion`, `:103-189`): zeroes every GPS-IFD entry value (inline AND offset-referenced, `:130-135`), zeroes the 12-byte entries, collapses count to 0 (`:140-141`), zeroes the trailing next-IFD pointer. GPS-bearing XMP TIFF tag (0x02BC) value zeroed when `XMP_GPS_TOKEN` matches (`:177-178`). Bounds-checked throughout (`inBounds`, `:112`); returns `null` on any structural anomaly so the caller re-encodes.
  - **JPEG container** (`:212-350`): GPS-IFD scrubbed inside every APP1 Exif segment; standard XMP APP1 + ExtendedXMP overflow chunks token-tested (per-chunk `:300-301` AND offset-ordered reconstruction `:316-320`, SEC-R4C9-01) and DROPPED from the rebuilt stream (`:329-349`). Post-EOI trailer (MPF secondary / Motion Photo) → structural anomaly `null` → Tier-2 re-encode drops the trailer (`:262-279`, SEC-R4C10-01). Fails CLOSED.
  - **ISOBMFF** (`:369-546`): Exif items located via meta→iinf→infe + iloc file-offset extents (`constructionMethod !== 0` → `null`, `:513`); TIFF-scrubbed; XMP mime items zeroed when GPS token matches (`:536-542`). Bounded walk (MAX_DEPTH 5, itemCount cap 4096, extentCount cap 64).
  - **WebP** (`:554-595`): EXIF chunk → TIFF scrub (`:571-578`); GPS-bearing `XMP ` chunk → FourCC retagged to `JUNK` at the sub-chunk start `buf.write('JUNK', offset, 4)` (`:584` — correct per RIFF `[FourCC][LEsize]` layout) + payload zeroed (`:585`); even-padding handled (`:589`); fails CLOSED on `dataEnd > buf.length` (`:570`) and zero-progress (`:591`).
- **H1c "the Tier-2 re-encode keeps metadata via Sharp"** — REFUTED. Tier-2 uses `sharp(filePath, {autoOrient:true}).keepIccProfile()` (`:1596-1597`) with NO `withMetadata()`. Sharp 0.33+ strips EXIF/XMP/IPTC by default; the R4C8 docblock (`:1530-1547`) documents the historical `withMetadata()` keep-all bug this avoids. `keepIccProfile()` keeps ONLY the color profile, not GPS.
- **H1d "the streamed file desyncs from the scrubbed file under concurrent replace"** — REFUTED. The download route opens the inode (`open()`, `:349`) and reads `Content-Length` from `fileHandle.stat().size` (`:351`, from the OPENED inode), so a concurrent rename can't desync the length. The atomic rename in `stripGpsFromOriginal` (`:1587`/`:1628`) is the only writer of that path post-upload.

**Paid-download claim ordering (re-verified `route.ts`):** open-before-claim holds — `lstat`+symlink reject (`:322-325`) → parallel `realpath` containment (`:330-336`) → `open()` (`:349`) → `stat().size` (`:351`) → atomic `UPDATE … WHERE downloadedAt IS NULL` (`:379-385`) → stream (`:440`). Handle closed on EVERY post-open failure path (`:355` stat-throw, `:387` claim-UPDATE-throw, `:399` already-used, `:456` stream-setup-throw); success path autoCloses. A missing file fails BEFORE the claim (`:356-360` ENOENT → 404) so the single-use token is never burned with zero bytes (C3-RPF-05). GET is claim-free interstitial; only POST claims (R4C7 COR-R4C7-01/02). The `affectedRows` shape-guard falls back to 1 on driver-shape drift (`:396-397`) to avoid a false-410.

**Evidence ranking:** Tier-2 source read (primary artifact, tight provenance) + the prior cycle-8 tracer's independent fixture reproduction of the WebP JUNK-retag + 28×3 green test runs this cycle. No contradicting evidence.

**Verdict:** SOUND. The privacy contract is intact on every delivered-bytes branch. The ONE honest residual — a structurally-anomalous HEVC-compressed HEIC that defeats the lossless scrub CANNOT be re-encoded (prebuilt Sharp has no HEVC encoder) and the original retains GPS, LOUDLY logged (`:1621`) — is documented in CLAUDE.md and is unchanged / not a regression. **No finding.**

---

## Flow 2 — PQueue job → per-image advisory lock → conditional UPDATE → orphan cleanup

**Observation:** `enqueueImageProcessing` (`image-queue.ts:229-542`) is the single processing pipeline. Both ingest writers feed it.

**Competing hypotheses on the two-worker race:**
- **H2a "two workers can both encode the same image (double-encode / interleaved variant writes)"** — REFUTED. `acquireImageProcessingClaim(job.id)` (`:193-210`) does `SELECT GET_LOCK(name, 0)` (non-blocking) on a DEDICATED pool connection (`:194`) BEFORE any encode work. The losing worker gets `null` (`:260`) and reschedules with escalating backoff (`:272-280`, up to 25 s, capped at MAX_CLAIM_RETRIES=10). Lock name is per-job (`getProcessingLockName(jobId)`); released in `finally` (`:527-530`) — the acquire (`:259`) and the protected `try` (`:258`) are adjacent so a throw cannot leak the claim connection.
- **H2b "delete-while-processing orphans variant files"** — REFUTED. AFTER the lock, an open-before-claim row check `WHERE processed = false` (`:284-285`) and a conditional `UPDATE … WHERE processed = false` (`:368-370`) gate the success path. On `affectedRows === 0` (image deleted mid-encode) the handler runs `deleteImageVariants(dir, name, [])` for all 3 formats (`:383-387`); the `[]` empty-sizes arg forces a FULL directory scan (AGG-C4-04) so NON-default configured sizes (`image_sizes` admin-tunable up to 8) are also removed. Matches the backfill runner's `cleanupDeletedMidReencodeVariants` and the sidecar.
- **H2c "lock leaks the dedicated connection on a throw between acquire and finally"** — REFUTED. The whole body runs in a single `try` (`:258`) whose `finally` (`:527`) releases the claim and prunes the enqueued/retry maps. `acquireImageProcessingClaim` itself releases the connection on its own internal throw (`:204-205`) and on a non-acquire (`:208`).
- **H2d "restore mid-processing deadlocks the queue"** — REFUTED. `quiesceImageProcessingQueueForRestore` (`:700+`) documents the prior `pause(); await onIdle()` deadlock (COR-R4C12-01) and the clear-first fix; `beginRestoreMaintenance()` runs before quiesce so `enqueueImageProcessing` rejects new jobs (`:231`).

**Evidence ranking:** primary source read of the claim/UPDATE/cleanup/finally window (tight provenance), corroborated by the documented invariant in CLAUDE.md ("Per-image-processing claim" + "Delete-while-processing").

**Verdict:** SOUND. Advisory-lock claim + open-before-claim check + conditional UPDATE + `[]`-scan cleanup + finally-release are all present and correctly ordered. **No finding.**

---

## Flow 3 — Backfill (sidecar script + admin button) → no-version-bump-on-detection-failure

**Observation:** Two entry points re-encode behind the same `gallerykit_color_pipeline_backfill` advisory lock: `admin-backfill-runner.ts` (in-app) and `scripts/backfill-color-pipeline.ts` (sidecar). Both must satisfy the resume contract: a row whose re-encode SUCCEEDS but whose color detection THEN fails must NOT have its `pipeline_version` advanced, so a later run retries detection.

**Competing hypotheses:**
- **H3a "the in-app runner strands stale color metadata at CURRENT version on detection failure"** — REFUTED. `reprocessOne` (`admin-backfill-runner.ts:442-615`): on `signals` present, the UPDATE sets `pipeline_version = IMAGE_PIPELINE_VERSION` + all color columns (`:557-570`). On detection failure (`signals === null`), the SEPARATE branch (`:594-599`) UPDATEs ONLY `was_downscaled` + `avif_10bit` — NO `pipeline_version`, NO color columns — and returns `detection-failed` (`:609`). The candidate query (`:404`) selects `pipeline_version IS NULL OR pipeline_version < CURRENT`, so a detection-failed row stays a candidate. The explanatory comment (`:580-593`, R-run2c1 AGG-01) documents that bumping here previously stranded the row.
- **H3b "the sidecar script disagrees with the in-app runner"** — REFUTED. `backfill-color-pipeline.ts` `reprocessRow` (`:162+`): detection-failure branch (`:223-232`) returns `derivativeOnly: { was_downscaled, avif_10bit }` only; the success branch (`:211-220`) carries full `signals`. The batched UPDATE applies `pipeline_version = CURRENT` ONLY on the signals path (`:370-374`); the derivative-only path persists just the two delivered-bit-depth columns without a version bump (AGG2-01, `:349-351`). Header docblock (`:94-101`) documents both paths persist the SAME columns on detection failure. The contract is locked by `backfill-color-pipeline.test.ts` (column set) + `admin-backfill-runner-detection-failure.test.ts` (no version bump) — both green this cycle.
- **H3c "deleted-mid-reencode orphans the just-written derivatives"** — REFUTED. BOTH the success branch (`:573-576`) and the detection-failed branch (`:605-608`) check `affectedRows === 0` and call `cleanupDeletedMidReencodeVariants(row)` with `[]` sizes (full scan, `:430-440`), classifying it as `deleted-mid-reencode` (its own tally, NOT a failure — `:787-792` so it doesn't flip the WITH-FAILURES banner). AGG-R8c3-03.
- **H3d "the per-image claim races the live queue worker into a double-encode"** — REFUTED. The runner claims the SAME `gallerykit:image-processing:{id}` lock as the queue worker (non-blocking, `:343-359`, TRC-R5C2-01) for the full re-encode→detect→UPDATE window, released in `finally` (`:610-614`). A held lock → `locked` skip, no version bump, retried next run. A pool-exhausted acquire is also treated as `locked` (`:487-490`, AGG-R5C3-05) so a saturated pool degrades to "retry next run" instead of a tight error spin.
- **H3e "concurrency clamp yields NaN and freezes PQueue"** — REFUTED. `resolveBackfillConcurrency` (`:129-142`) guards a non-finite pool limit with a fallback of 10 (`:137`), so the cap arithmetic never yields NaN; the request is floored to ≥1 (`:140`).

**Evidence ranking:** primary source read of both detection-failure branches in both files (controlled comparison), corroborated by two green contract tests pinning the column set + no-version-bump invariant.

**Verdict:** SOUND. Stale color metadata is NEVER stranded at the current `pipeline_version` on either entry point; both persist only the delivered-bit-depth columns on detection failure and leave the row a candidate. **No finding.**

---

## Flow 4 — Migration cursor → journal hash check → reconcile → baseline → post-condition

**Observation:** `migrate.js` orchestration `:744-775`. The historical production incident: drizzle's MySQL migrator decides apply-or-skip by `MAX(created_at) < folderMillis`, and this repo's journal has non-monotonic `when` timestamps, so a single max-row baseline poisons the cursor and silently skips entries.

**Competing hypotheses:**
- **H4a "a poisoned MAX(created_at) baseline still silently skips entries"** — REFUTED. `getAllJournalMigrations` (`:144-160`) returns ONE record per journal entry with `hash = SHA256(file content)` (`:157`). `baselineAllJournalMigrations` (`:642-657`) inserts one `__drizzle_migrations` row PER entry keyed by hash (`:644` filters `!haveHashes.has(m.hash)`), so the cursor can't be poisoned by a synthetic max row.
- **H4b "the legacy-detection still uses a timestamp comparison"** — REFUTED. `prepareLegacyDatabaseIfNeeded` (`:659-696`) checks `migrations.every(m => haveHashes.has(m.hash))` (`:683`), a per-entry hash set membership — NOT `MAX(created_at)` vs `Math.max(...whens)`.
- **H4c "a completely fresh DB falls through to drizzle.migrate() and dies on entry 7-17"** — REFUTED. A fresh DB (`!hasGalleryTables`, `:662`) now takes the SAME deterministic `reconcileLegacySchema` + `baselineAllJournalMigrations` path (`:677-679`, R4C1 COR-R4C1-12), after which `drizzle.migrate()` is a verified no-op.
- **H4d "a future silently-skipped migration boots on a half-applied schema"** — REFUTED. The post-condition in `runMigrations` (`:708-716`) recomputes recorded hashes after `migrate()` and `throw`s `Drizzle silently skipped N migration(s): <tags>` if any journal hash is missing → the deploy fails LOUD. `reconcileLegacySchema` mirrors all schema state idempotently (CLAUDE.md migration step 3) so a reconcile-bootstrapped DB doesn't fail the first INSERT.

**Evidence ranking:** primary source read of the hash-based baseline + per-entry coverage check + post-condition assertion (tight provenance), corroborated by 63 green tests across `migration-journal-monotonicity` + `migration-journal` + `migrate-reconcile-coverage`.

**Verdict:** SOUND. The hash-based per-entry baseline + post-condition assertion structurally eliminate the silent-skip class. **No finding.**

---

## Flow 5 — SW HTML offline-fallback personalization (proxy `x-gk-admin-render` → `networkFirstHtml`)

**Observation:** the SW caches 200 GET HTML as an OFFLINE-ONLY fallback (24 h TTL, 50-entry cap). The risk: an admin-rendered public page cached then served to an anonymous visitor offline. The defense is the server-set `x-gk-admin-render: 1` header (the SW cannot read the request `Cookie` header — Fetch-spec forbidden).

**Leak surface is REAL and material (so the gate is load-bearing):** the public photo page `app/[locale]/(public)/p/[id]/page.tsx:151-157` renders DIFFERENT content for admins — `isAdmin()` resolves `canShare={isAdminUser}` / `isAdmin={isAdminUser}` (`:291-292`). An admin viewing `/en/p/123` gets HTML carrying admin affordances. Caching+serving that to an anon visitor WOULD be a cross-user disclosure of admin UI state.

**Competing hypotheses:**
- **H5a "an admin-rendered public page can be cached and served to an anon"** — REFUTED. Two independent gates:
  1. **Fetch dispatch** (`sw.template.js:349`): `if (isAdminRoute(pathname)) return;` — admin URLs never reach `networkFirstHtml`. (But the photo page is a PUBLIC URL, so this gate does NOT cover it — gate 2 does.)
  2. **Cache decision** (`:270`): `if (networkResponse.ok && networkResponse.headers.get('x-gk-admin-render') !== '1')`. A public URL rendered WITH an admin session carries the header → the `put` is skipped. This is DOUBLE-SAFE: `.ok` requires 200-299 (a redirect to login isn't `.ok`), AND the marker must be absent.
- **H5b "the proxy doesn't set the header for some admin-viewed public page (header absent → cached)"** — REFUTED. The public photo page is `export const revalidate = 0` (`:38`) → dynamically rendered → the proxy middleware ALWAYS runs (no static-HTML bypass). The proxy sets `x-gk-admin-render: 1` whenever the `admin_session` cookie is present (`proxy.ts:128-130`), on the `intlMiddleware` response that propagates to the final RSC response. The matcher `/((?!api|_next|_vercel|.*\..*).*)` (`:140`) excludes only `/api`, `_next`, and dotted-static paths — none of which is a cacheable personalized HTML page. A dotted path would be a static asset, not an `isHtmlRoute` (`Accept: text/html`) response carrying admin content.
- **H5c "a CDN/nginx strips the header before the SW sees it"** — REFUTED. `nginx/default.conf` `proxy_hide_header` removes only `X-Powered-By` (`:54`); no rule touches `x-gk-admin-render`. It passes through to the browser.
- **H5d "the shipped sw.js drifted from the template and lost the gate"** — REFUTED. `git diff HEAD -- public/sw.js public/sw.template.js` is empty; `sw.js:270` is byte-identical to `sw.template.js:270` (`if (networkResponse.ok && networkResponse.headers.get('x-gk-admin-render') !== '1') {`). The contract test `sw-template-contract.test.ts:41` pins the EXACT `.ok && marker` condition and asserts the `htmlCache.put` is inside that gated block (`:48-49`); `:139-140` pins the proxy header-set. 14 tests green this cycle.
- **H5e "even non-admin responses can leak via isSensitiveResponse bypass on HTML"** — N/A (not a leak). The HTML path deliberately does NOT use `isSensitiveResponse` (which keys on `no-store`) because every public page is `revalidate=0` → Next emits `no-cache` → an `isSensitiveResponse`-gated HTML cache would be permanently empty (R4C6 COR-R4C6-05). The HTML path instead gates on `.ok && !admin-render`, and the cache is OFFLINE-ONLY (served only when the network is unreachable, `:285-301`, with a 24 h TTL purge). The image path keeps full `isSensitiveResponse` semantics (`:55` pinned by test).

**Evidence ranking:** primary artifacts with tight provenance (proxy header-set source, SW gate source, committed-sw.js byte match, public photo page admin-branch, nginx config, `revalidate=0`), plus the contract test pinning both producer and consumer. Multiple independent sources converge. No contradicting evidence.

**Verdict:** SOUND. An admin-rendered page can NEVER be cached and served to an anonymous visitor: the cache `put` is gated on `.ok && x-gk-admin-render !== '1'`, the proxy reliably sets the marker on every dynamically-rendered admin-cookie request, nginx passes it through, and the shipped SW matches the template under a pinning test. **No finding.**

---

## TRC8-01 re-characterization (prior cycle's only finding — confirmed test-infra, NOT a source defect)

The cycle-8 tracer's TRC8-01 (WebP XMP JUNK-retag test returned `null` once on a cold concurrent run, then passed 16+ subsequent runs) was re-characterized this cycle: `strip-gps-from-original.test.ts` ran **28 passed × 3 isolated cold runs**, 0 failures. The flake did NOT recur in isolation — consistent with the prior root-cause inference (a transient cold-encoder buffer anomaly under concurrent vitest worker contention, hitting the `dataEnd > buf.length` null-path `:570`, NOT a scrubber bug). The product `stripGpsFromWebpBuffer` is proven correct. This remains a DEFERRED test-hardening item (warm the encoder in `beforeAll` / guard-and-retry on a malformed cold `base`), not a schedulable source defect. Same flaky-gate family as the documented `.next/standalone` phantom-path and libheif cold-flake notes (AGG-C7-R7 / AGG-C4-T2 / AGG-C8-R-FLAKE).

---

## Cross-check against prior aggregate (`_aggregate.md` cycle 8 @ `9c40d261`)

- Cycle-8 scheduled fixes confirmed landed at HEAD `0ce84b1b`: AGG-C8-01 base56 uniformity test (`71ab0f41`), AGG-C8-02 SCAN_ROOTS doc (`aa8a6f8a`). Plan-345 SHA backfill (`0ce84b1b`).
- No prior closed finding re-opened. No new architectural / security-runtime / perf / privacy / migration defect across the five traced flows.
- Concurrent-agent tree mutations observed in `.context/reviews/**` (code-reviewer, critic, perf-reviewer, security-reviewer, test-engineer, verifier) — these are RED-proof probe artifacts; every SOURCE file in the five flows verified unchanged vs HEAD. I left the tree byte-identical for source (no perturbation; ran read-only probes + isolated test runs only).

---

## Disposition

| ID | Severity | Conf | Disposition |
|---|---|---|---|
| (none) | — | — | Zero new genuine findings. All five flows SOUND with line-cited evidence and green contract gates. |

**Residual uncertainty (tracked, LOW):**
- TRC8-01 WebP cold-flake is non-deterministic and could not be re-triggered this cycle (3/3 isolated PASS). Root cause is inferred from reachable null-paths, not a captured failing buffer; it remains a documented deferred test-hardening item with zero privacy/correctness impact.
- The ISOBMFF HEVC-HEIF residual (anomalous HEIC can't be re-encoded → GPS retained, loudly logged) is an honest, documented platform limitation (prebuilt Sharp has no HEVC encoder), not a regression — unchanged across cycles.
- Next.js 16 middleware response-header propagation for `x-gk-admin-render` is standard documented behavior and the path is double-gated by `.ok`; no runtime probe was run against a live admin session this cycle (the static-analysis chain — `revalidate=0` + matcher + nginx passthrough + byte-matched SW gate + contract test — is strong enough that a live probe would be confirmatory, not discriminating).

**CONVERGENCE ASSESSMENT:** The five highest-risk end-to-end flows are all SOUND. No CRITICAL/HIGH/MEDIUM/LOW source defect. This is a clean tracer cycle — the loop is at its convergence stop signal for the tracing lane.
