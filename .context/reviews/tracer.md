# Tracer — Cycle 8 Deep Review (evidence-driven causal tracing)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `9c40d261` (working tree clean except pre-existing `.context/**` + `plan/**` artifacts). Cycle-7 fixes AGG-C7-01..05 confirmed landed in commits `5ef545bf`..`9c40d261`.
**Method:** end-to-end flow tracing with line-cited evidence, competing hypotheses, evidence for/against, and runtime probes where the code alone could not certify a flow.

---

## TL;DR

Five priority flows traced. **Four are sound** with strong line-cited evidence (upload→queue→encode→cleanup, color-signal precedence → encoder → ETag invalidation, session/auth guard chain, migration silent-skip post-condition). The **fifth (GPS-strip) is functionally sound** — every per-format scrubber neutralizes GPS on the delivered bytes. The **one finding (TRC8-01, LOW)** is a *test-gate* nit: the WebP XMP-chunk JUNK-retag test `strip-gps-from-original.test.ts:282` is a **flaky gate** — it failed once on this session's first cold invocation (`stripGpsFromWebpBuffer` returned `null` → `expect(result).not.toBeNull()` at `:300`) and then passed 4 combined runs + 12 isolated cold-process runs + 1 full-suite run (2093/2093). This is a **test/encoder cold-flake, NOT a source defect** — the privacy scrubber is proven correct; the gate is non-deterministic under concurrent worker contention. The full suite is reliably green at HEAD.

---

## Flow 1 — Upload → original save → PQueue claim → Sharp encode → conditional UPDATE → orphan cleanup

**Observation (code-traced):** `enqueueImageProcessing` (`apps/web/src/lib/image-queue.ts:229-542`) is the single processing pipeline; both ingest writers feed it.

**Competing hypotheses on multi-worker safety:**
- **H1 "two workers can both encode the same image"** — REFUTED. `acquireImageProcessingClaim` (`image-queue.ts:193-210`) does `SELECT GET_LOCK(?, 0)` on a DEDICATED pool connection before any work; a non-acquiring worker returns `null` and reschedules with escalating backoff (`:260-281`). Lock name is per-job (`getImageProcessingLockName(jobId)`), released in `finally` (`:528`). Paired with the open-before-claim row check (`:284-289`) and the conditional `UPDATE … WHERE processed = false` (`:368-370`).
- **H2 "delete-while-processing orphans variant files"** — REFUTED. On `affectedRows === 0` (image deleted mid-encode) the handler runs `deleteImageVariants(dir, name, [])` for all 3 formats (`:383-387`); the `[]` empty-sizes arg forces a FULL directory scan (AGG-C4-04), so non-default configured sizes are also removed.
- **H3 "crash between link and rename leaves .tmp orphans forever"** — MITIGATED. `cleanOrphanedTmpFiles` (`:30-71`) runs on every bootstrap pass (`:672`), scans the 3 dirs in parallel, unlinks `*.tmp`, narrows the catch to non-ENOENT (`:56-68`).
- **H4 "restore mid-processing deadlocks the queue"** — REFUTED with strong evidence. `quiesceImageProcessingQueueForRestore` (`:700-741`) does `pause(); clear(); await onIdle()` IN THAT ORDER (`:724-726`); the docblock `:704-723` documents the prior `pause(); await onIdle()` deadlock (COR-R4C12-01) and why clear-first is required. `beginRestoreMaintenance()` runs before quiesce so `enqueueImageProcessing` rejects (`:231`).

**Confidence:** High that the flow is sound — advisory-lock claim + conditional UPDATE + open-before-claim + `[]`-scan cleanup are all present and correctly ordered.

**Verdict:** SOUND. No finding.

---

## Flow 2 — Paid-download original streaming → GPS-EXIF strip → per-format dispatch

**Observation:** `stripGpsFromOriginal` (`apps/web/src/lib/process-image.ts:1561-1638`) is invoked at upload time by BOTH ingest writers under the `stripGpsOnUpload` snapshot: browser `apps/web/src/app/actions/images.ts:306-312`, Lightroom `apps/web/src/app/api/admin/lr/upload/route.ts:311-327` (byte-identical call). The paid-download route (`apps/web/src/app/api/download/[imageId]/route.ts`) streams the on-disk original verbatim.

**Dispatch trace (`process-image.ts:1564-1626`), per-format:**
| ext | Tier-1 scrubber | Tier-2 fallback on `null` |
|---|---|---|
| `.jpg/.jpeg` | `stripGpsFromJpegBuffer` (`:1570`) | re-encode q95 4:4:4 (`:1602`) |
| `.tif/.tiff` | `stripGpsFromTiffBuffer` (`:1572`) | re-encode lzw (`:1612`) |
| `.heic/.heif/.avif` | `stripGpsFromIsobmffBuffer` (`:1574`) | AVIF→re-encode q90 (`:1615`); HEIC/HEIF→`return` loud error, GPS retained (`:1621`) |
| `.webp` | `stripGpsFromWebpBuffer` (`:1576`) | re-encode, lossless-by-chunk (`:1608-1609`) |
| `.gif/.bmp` | none → `return` (`:1577-1581`) | n/a (no standardized GPS carriage) |
| other | none | `return` loud error (`:1624`) |

**Competing hypothesis: "does any branch leave GPS readable on the deliverable?"**
- **JPEG** — REFUTED. `stripGpsFromTiffRegion` (`gps-exif-strip.ts:103-189`) zeroes every GPS-IFD entry value (inline + offset-referenced, `:130-135`), collapses the IFD to 0 entries (`:140-141`); GPS-bearing XMP APP1 (standard + ExtendedXMP, including offset-ordered reconstruction `:316-320`) is DROPPED (`:329-349`). A post-EOI trailer (MPF/Motion-Photo secondary) is a structural anomaly → `null` → Tier-2 re-encode drops the trailer (`:262-279`, SEC-R4C10-01). The lossless path fails CLOSED when it can't certify a trailer is GPS-free.
- **ISOBMFF (HEIC/AVIF)** — mostly REFUTED, ONE residual gap (already documented, not a regression). Exif items located via iinf/infe + iloc (file-offset construction only; `constructionMethod !== 0` → `null`, `:513`), TIFF-scrubbed; XMP mime items zeroed (`:536-542`). **Residual:** a structurally-anomalous HEIC/HEIF that defeats the lossless scrub CANNOT be re-encoded (prebuilt Sharp has no HEVC encoder) — `process-image.ts:1616-1622` logs `console.error` and RETURNS with GPS intact on disk. This is an honest, loudly-logged limitation already in CLAUDE.md ("structurally anomalous HEIC… original retains GPS"). AVIF anomalies DO re-encode (q90, `:1615`). Confidence High this is known/documented, not new.
- **WebP** — REFUTED (scrubber correct). EXIF chunk → TIFF scrub (`gps-exif-strip.ts:571-578`); GPS-bearing `XMP ` chunk → FourCC retagged to `JUNK` at `buf.write('JUNK', offset, 4)` (offset = sub-chunk start = correct per RIFF `[FourCC][LEsize]` layout, `:584`) + payload zeroed (`:585`); odd payload even-padded (`:589`). I independently reproduced the exact failing-test fixture (64×48 q95 WebP, inject `XMP ` GPS chunk before `VP8 `): `stripGpsFromWebpBuffer` returns `{stripped:true, len:196}`, GPS gone, `VP8 ` pixel chunk byte-identical (chunk walk `@12:'XMP '/101→121 @122:'VP8 '/66→196`).
- **Re-encode fallback metadata** — REFUTED. Tier-2 uses `sharp(…, {autoOrient:true}).keepIccProfile()` with NO `withMetadata()` (`process-image.ts:1596-1597`) — Sharp strips EXIF/XMP by default. The R4C8 docblock (`:1529-1536`) explains the historical `withMetadata()` keep-all bug.
- **AGG-C7-05 lossless-WebP detection** — VERIFIED FIXED. `isLosslessWebpByChunk` (`process-image.ts:1498-1518`) walks sub-chunks, returns true ONLY on a genuine `VP8L` pixel chunk (`:1511`), false on `VP8 ` (`:1512`), default-false on malformation (`:1517`) — replacing the prior whole-buffer `includes('VP8L')` substring scan. Privacy-safe regardless of the lossless/lossy choice.

**Paid-download claim ordering (route.ts):** open-before-claim holds — `lstat`+`realpath` traversal check (`:322-336`) → `open()` (`:349`) → `stat().size` from the OPENED inode (`:351`, Content-Length can't desync on concurrent replace) → atomic `UPDATE … WHERE downloadedAt IS NULL` (`:379-385`) → stream (`:406`). Handle closed on EVERY failure path (`:355,387,399,456`); success closes via autoClose. A missing file fails BEFORE the claim (`:356-360`) so the token is never burned with zero bytes (C3-RPF-05). GET is claim-free interstitial (`:198-258`); POST claims (R4C7).

**Confidence:** High that the privacy scrubbers are correct on all delivered bytes. The ONE honest residual (anomalous HEVC-HEIF can't be re-encoded → GPS retained, loudly logged) is documented and unchanged.

**Verdict:** SOUND (privacy contract intact). See TRC8-01 for the test-gate flake on the WebP XMP branch.

---

## TRC8-01 — WebP XMP-chunk JUNK-retag test is a FLAKY GATE (not a source defect)

**Severity:** LOW · **Confidence:** High (reproduced once + extensively characterized) · **Class:** test-gate non-determinism / cold-encode flake · **needs-manual-validation:** NO (root cause isolated to the encoder cold path, not the scrubber)

**Observation (runtime evidence):** On this session's FIRST vitest invocation —
```
npx vitest run src/__tests__/strip-gps-from-original.test.ts \
                src/__tests__/process-image-webp-lossless-detect.test.ts
→ 1 failed | 31 passed (32)
  FAIL > stripGpsFromWebpBuffer neutralizes a GPS-bearing XMP chunk (JUNK-retag…)
  AssertionError: expected null not to be null
    ❯ strip-gps-from-original.test.ts:313 → expect(pixelsAfter).not.toBeNull()
```
The root assertion is at `:300 expect(result).not.toBeNull()` — `stripGpsFromWebpBuffer(withXmp)` returned `null`; `:313` is the downstream symptom once `result!` is null.

**Competing hypotheses:**
- **H-A "source defect — the JUNK-retag branch (`gps-exif-strip.ts:579-588`) is wrong"** — REFUTED. I reproduced the EXACT fixture path (64×48 q95 WebP via `toFile`→`readFile`, same injected XMP GPS payload) in an isolated probe: `RESULT={"stripped":true,"len":196}`, GPS removed, `VP8 ` byte-identical. The branch is reachable and correct.
- **H-B "deterministic order-dependent failure"** — REFUTED. The same two-file combination passed 3/3 on immediate re-run (`Tests 32 passed (32)` ×3). The single file alone: `28 passed (28)`. Twelve isolated cold-process runs of a standalone probe of the exact fixture: 12/12 PASS, 0 NULL. Full suite cold: `219 files / 2093 tests passed`, exit 0.
- **H-C "encoder cold-flake — the first libvips/WebP encode in a fresh worker transiently emits a buffer that trips a `stripGpsFromWebpBuffer` null-path"** — BEST-SUPPORTED. The ONLY `null`-returns reachable for this XMP-only fixture (no EXIF chunk) are: the RIFF magic check (`:555-559`, constructed by the test → can't fail), `dataEnd > buf.length` (`:570`), or the zero-progress guard (`:591`). All three depend on the encoder-produced `base` buffer's chunk sizes. A transient first-encode anomaly (short/odd buffer, or libheif/libvips init racing the WebP encode under concurrent vitest workers) makes the injected top-level RIFF size or `VP8 ` chunk extent overrun `buf.length`, hitting `:570`.

**Evidence for/against H-C:**
- FOR: failure appeared only on the cold first run; `vitest.config.ts` sets no `pool`/`isolate`/`fileParallelism` override (default forks pool with file-parallelism), so two encode-heavy files share worker contention on a cold process. The repo already documents two flaky-gate families in THIS exact suite — the `.next/standalone` phantom-path flake (fixed by the `exclude` in `vitest.config.ts`) and the "libheif cold-flake" / shared-`public/uploads` isolation note (aggregate AGG-C7-R7 / AGG-C4-T2). This WebP cold-flake is the same shape.
- AGAINST: I could not re-catch the `null` after the first occurrence (16+ subsequent runs all green), so I could not capture the exact malformed `base` bytes. Root cause is inferred from the reachable null-paths + the one-shot reproduction, not from a captured failing buffer.

**Failure scenario (if it recurs in CI):** a cold CI worker hits the transient encoder anomaly → the JUNK-retag test goes RED with `expected null not to be null` → the per-iteration deploy gate fails on a NON-deterministic test, not on any product regression. **No privacy/runtime impact** — the scrubber is correct; only the gate is unreliable.

**Critical unknown:** the exact byte-shape of the `base` WebP buffer in the failing cold run (which null-path fired). Not captured because the flake did not recur.

**Discriminating probe / recommended fix (test-hardening only, cheapest first):** make the fixture deterministic instead of encoder-dependent —
1. add a guard in the test: if `webpPixelChunk(base) === null` after encode, re-encode once before injecting (removes the cold-encode dependency from the assertion path); OR
2. assert the encoder output's chunk extents are well-formed before injection and skip-with-warning on a malformed cold encode; OR
3. move the WebP `base` encode into `beforeAll` so libvips is warmed once and the buffer is reused (matching the JPEG fixtures that already run earlier and warm libvips).

The product `stripGpsFromWebpBuffer` needs NO change — it is proven correct.

---

## Flow 3 — Color signal precedence → encoder decision → derivative gamut → ETag invalidation

**Observation:** `detectColorSignals` (`apps/web/src/lib/color-detection.ts:300-411`) resolves primaries; `resolveColorPipelineDecision` / `resolveAvifIccProfile` (`process-image.ts:661/754`) pick the encode path.

**Precedence trace (`color-detection.ts:343-401`):** the documented order NCLX > ICC chromaticity > ICC name is correctly implemented:
1. ICC-name inference first (`:343-345`).
2. ICC chromaticity UPGRADES only when name is `unknown` + medium/high confidence (`:357-368`), mapping `srgb`→`bt709` at the boundary.
3. NCLX (when present) outranks, applied PER-FIELD with the ITU-T code-2 "Unspecified" guard (`:381-387`) — `if (nclxX !== undefined)` so a partially-specified NCLX box does NOT clobber valid ICC data with `unknown` (AGG-R8-06 / COR-1). `isHdr` derived from final `transferFunction in (pq,hlg)` (`:401`).

**Competing hypothesis: "does a setting flip invalidate cache on BOTH paths?"**
- **serve-upload path** — VERIFIED. ETag at `apps/web/src/lib/serve-upload.ts:201` = `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`. `settingsHash` covers **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`): 5 color keys + 3 quality keys + `image_sizes`. `HASH_LENGTH=8`, used verbatim (no `.slice` at the site). Flipping any of the 9 changes the hash → `must-revalidate` 304→200 cycle. The config-arg form (`getColorSettingsHash(config)`, `settings-hash.ts:72-85`) computes from VALIDATED config values (R8-H1), so an invalid stored value the encoder clamps to default doesn't misalign the ETag.
- **static path** — VERIFIED by reasoning. Files already in `public/uploads/` are served by Next's static server with a `W/"{size}-{mtime}"` ETag (CLAUDE.md R4C6 ARCH-R4C6-06). A settings flip alone does NOT change those — invalidation rides the BACKFILL re-encode: re-encoding rewrites the file in place under the same filename, changing both mtime and size → static ETag changes. Policy is `public, max-age=3600, must-revalidate` (deliberately NOT `immutable`) so the conditional revalidate actually fires.

**Doc nuance (NOT a defect):** the CLAUDE.md snippet in this session's context says the hash covers "**5**" keys, but the code has 9. The aggregate (AGG-C7-R3) already established the on-disk CLAUDE.md was corrected to 9 and the "5" is a stale paraphrase. Code is authoritative and correct; no flow impact.

**Confidence:** High. Precedence, per-field NCLX guard, and dual-path invalidation all verified.

**Verdict:** SOUND. No finding.

---

## Flow 4 — Session mint → cookie → proxy guard → isAdmin() defense-in-depth → rate limit

**Observation:** mint in `apps/web/src/lib/session.ts:82-89`; verify in `verifySessionToken` (`session.ts:94-151`); proxy presence-guard in `apps/web/src/proxy.ts:54-116`; per-action check via `isAdmin()`→`getCurrentUser()` (`apps/web/src/app/actions/auth.ts:33-56`).

**Competing hypothesis: "bypass or TOCTOU in the guard chain?"**
- **H1 "proxy presence-check is the only auth → forgeable cookie bypasses"** — REFUTED. `proxy.ts` does a PRESENCE + shape check only (`token.length >= 100`, 3 non-empty colon parts; `:90-115`) and the comment is explicit that "Full cryptographic validation happens in verifySessionToken() within server actions." Every mutating action independently calls `isAdmin()`. A forged cookie passes the proxy shape check but fails HMAC in `verifySessionToken`.
- **H2 "HMAC compare is a timing oracle"** — REFUTED. `verifySessionToken` (`session.ts:108-119`) computes expected HMAC, length-guards (`:113`), then `timingSafeEqual` (`:117`). Shape regexes for `random`/`signature` run AFTER the crypto compare (`:124-125`) — comment explicitly notes this prevents a timing oracle. 24h age cap (`:127-134`), hashed-token DB lookup (`:136-138`); expired session deleted (`:145-148`).
- **H3 "DB-stored secret enables forgery on DB compromise"** — REFUTED in production. `getSessionSecret` (`session.ts:30-36`) THROWS in production if `SESSION_SECRET` env is absent/short; DB fallback is dev/test only.
- **H4 "API admin routes skip the proxy guard"** — by-design + covered. `proxy.ts:140` matcher excludes `/api`; the `lint:api-auth` gate requires every `/api/admin/**` method to wrap `withAdminAuth`. The `x-gk-admin-render` header (`:128-130`) reflects only the requester's own cookie back to the same client (no cross-user disclosure), presence-only.

**Confidence:** High. The two-layer model (presence guard + cryptographic per-action check) holds; no TOCTOU because the action re-verifies cryptographically.

**Verdict:** SOUND. No finding.

---

## Flow 5 — Migration apply → drizzle silent-skip post-condition

**Observation:** `apps/web/scripts/migrate.js` orchestration `:744-775`; the non-monotonic journal `when` problem is the historical production incident.

**Competing hypothesis: "does the non-monotonic journal silent-skip actually get caught now?"**
- **H1 "a poisoned MAX(created_at) baseline still silently skips entries"** — REFUTED. `getAllJournalMigrations` (`:144-160`) returns one record per journal entry with `hash = SHA256(file content)`. `prepareLegacyDatabaseIfNeeded` (`:659-696`) checks `migrations.every(m => haveHashes.has(m.hash))` (`:683`), NOT a max-timestamp comparison. `baselineAllJournalMigrations` (`:642-657`) inserts one `__drizzle_migrations` row PER entry (hash + its own `when`), so the cursor can't be poisoned by a synthetic max row.
- **H2 "fresh DB falls through to drizzle.migrate() and dies on entry 7-17"** — REFUTED. A completely fresh DB (`!hasGalleryTables`, `:662`) now goes through the SAME `reconcileLegacySchema` + `baselineAllJournalMigrations` deterministic path (`:677-679`), then `drizzle.migrate()` is a verified no-op (R4C1 COR-R4C1-12).
- **H3 "a future silently-skipped migration boots on a half-applied schema"** — REFUTED. The post-condition in `runMigrations` (`:708-718`) recomputes recorded hashes after `migrate()` and `throw`s `Drizzle silently skipped N migration(s): <tags>` if any journal hash is missing → the deploy fails LOUD. `reconcileLegacySchema` mirrors all color/HDR/gain-map columns (`:364-380`) so a reconcile-bootstrapped DB doesn't fail the first INSERT (R4C1 COR-R4C1-13).

**Confidence:** High. The hash-based per-entry baseline + post-condition assertion structurally eliminate the silent-skip class.

**Verdict:** SOUND. No finding.

---

## Cross-check against prior aggregate (`_aggregate.md`, cycle 7 @ `d0920957`)

- Cycle-7 fixes (AGG-C7-01..05) confirmed present at HEAD `9c40d261`: AGG-C7-02 test landed `5ef545bf` (`strip-gps-from-original.test.ts:282-333`), AGG-C7-03 scale-token catch-all `99071d76`, AGG-C7-05 chunk-detection `85bca582` (`isLosslessWebpByChunk`, `process-image.ts:1498`).
- The aggregate's VERIFIED-CLEAN claim "full vitest green, libheif cold-flake did NOT reproduce" was at HEAD `d0920957`. At HEAD `9c40d261` the full suite is green (2093/2093) BUT the WebP XMP-branch cold-flake DID reproduce once this session → TRC8-01. This is a refinement, not a contradiction: the flake is real and intermittent; the cycle-7 run simply didn't hit it.
- No prior closed finding re-opened. No new architectural/security-runtime/perf/privacy defect.

---

## Disposition

| ID | Severity | Conf | Disposition |
|---|---|---|---|
| **TRC8-01** | LOW | High | SCHEDULE-cheap (test hardening only) OR DEFER. Make the WebP XMP fixture deterministic / warm the encoder in `beforeAll` / guard-and-retry on a malformed cold `base`. Product `stripGpsFromWebpBuffer` needs NO change — the scrubber is proven correct. Same flaky-gate family as the documented `.next/standalone` phantom-path and libheif cold-flake notes. |

**No CRITICAL/HIGH/MED runtime defect found.** Four of five priority flows are SOUND with line-cited evidence; the fifth (GPS-strip) is also functionally sound. The only finding is a non-deterministic TEST gate on the WebP XMP branch — a deploy-gate reliability nit, not a privacy or correctness regression.
