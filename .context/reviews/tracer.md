# Tracer — Cycle 7 Evidence-Driven Causal Trace

**Scope:** GalleryKit @ HEAD `d0920957` (clean tree). Four high-risk end-to-end flows traced with competing hypotheses, runtime probes, and static evidence.

**Headline result:** All four flows **VERIFIED-CLEAN**. No new defects. The WebP RIFF GPS-strip fix (`b6c4f915`) is genuinely working — runtime-confirmed lossless on lossy/VP8L/alpha/animated/EXIF+XMP layouts. Prior-cycle closed findings were not re-opened.

Method note: I built ground truth independently rather than trusting commit messages — synthesized real Sharp-produced WebP buffers and a hand-built animated WebP, ran the actual scrubber over them, and verified pixel-chunk byte-identity + GPS removal. Where I could not synthesize an input (true ANIM/ANMF), I hand-assembled the bytes.

---

## FLOW 1 — GPS-strip dispatch + WebP lossless scrub → **VERIFIED-CLEAN**

### Observation
`stripGpsFromOriginal` (process-image.ts:1522) dispatches by extension to Tier-1 lossless scrubbers (gps-exif-strip.ts) with a Tier-2 Sharp re-encode fallback on `null`. The WebP scrubber (`stripGpsFromWebpBuffer`, gps-exif-strip.ts:554) was fixed at `b6c4f915` to read RIFF `[tag@offset][size@offset+4]` in spec order.

### Hypotheses
- **H1**: WebP original with GPS now takes the LOSSLESS path (stripped=true, byte-identical pixels) rather than the lossy fallback. → **CONFIRMED**
- **H2**: Some input shape (multi-chunk, VP8L, animated, EXIF+XMP) makes the scrubber return null or corrupt the file. → **REFUTED** across every shape tested.

### Evidence (runtime probes, Sharp / vitest v4.1.4)
The chunk walker (gps-exif-strip.ts:563-593) reads `chunkTag = ascii[offset,offset+4]`, `chunkSize = u32LE[offset+4]`, advances `next = dataStart + chunkSize + (chunkSize%2)`. I drove real and hand-built buffers through it:

| Input shape | Chunks | Scrub result | Pixel chunk | Walk |
|---|---|---|---|---|
| lossy q95 + EXIF(gps) | `VP8X:10 \| VP8 :66 \| EXIF:338` | stripped=true, GPS gone | byte-identical | EXACT |
| lossless VP8L + EXIF(gps) | `VP8X:10 \| VP8L:23 \| EXIF:338` | stripped=true, GPS gone | **VP8L byte-identical** | EXACT |
| near-lossless + EXIF(gps) | `VP8X:10 \| VP8L:23 \| EXIF:338` | stripped=true, GPS gone | byte-identical | EXACT |
| EXIF(gps) + XMP(gps) | `VP8X \| VP8 \| EXIF \| XMP→JUNK` | stripped=true; EXIF GPS gone; XMP retagged JUNK; "GPSLatitude" token gone | byte-identical | EXACT |
| EXIF(gps) + XMP(gps, **odd-length**) | `… \| XMP:224→JUNK:224` | stripped=true; both neutralized | byte-identical | EXACT |
| VP8X+**ALPH**+VP8+EXIF(gps) (alpha) | `VP8X \| ALPH:16 \| VP8 \| EXIF` | stripped=true; ALPH preserved; GPS gone | byte-identical | EXACT |
| XMP-only(gps), no EXIF | `VP8 \| XMP→JUNK` | stripped=true; token gone | byte-identical | EXACT |
| plain WebP, no metadata | `VP8 ` | stripped=false, **same input ref** | n/a | EXACT |
| hand-built **animated** VP8X+ANIM+ANMF[decoy "EXIF" inside frame]+EXIF(gps) | `VP8X \| ANIM \| ANMF:84 \| EXIF:74` | stripped=true; top-level EXIF GPS zeroed; **decoy "EXIF" inside ANMF untouched** | n/a | EXACT |

Key confirmations:
- **VP8L lossless path is alive** — the b6c4f915 fix is real. Before the fix, FourCC `VP8X` (0x58385056 ≈ 1.48 GB) was misread as chunkSize and `dataEnd > buf.length` returned null immediately. Now the EXIF chunk is correctly located and scrubbed; VP8L compressed bytes survive verbatim.
- **XMP JUNK-retag targets the tag field** (`buf.write('JUNK', offset, 4)`, line 584), NOT the size field — verified output walk stays EXACT with the size preserved (the other half of b6c4f915).
- **Top-level RIFF walker does NOT descend into ANMF frames** — a decoy "EXIF…" byte string inside an animated frame's sub-chunk is left untouched; only the real top-level EXIF/XMP chunks are scrubbed. Animated WebP carries EXIF/XMP at the top RIFF level per spec, so this is correct and lossless (no frame flattening).
- **Odd-size chunks**: `paddedSize = chunkSize + (chunkSize%2)` correctly skips the RIFF pad byte; VP8L:23 → next advances by 24. No off-by-one.

### Dispatch correctness (process-image.ts:1528-1550)
- `.webp` → `stripGpsFromWebpBuffer`; on `null` → Tier-2 re-encode with `isLosslessWebp = input.includes('VP8L')` preserving lossless mode (line 1566). On `{stripped:false}` → early-return byte-identical (line 1546). Correct three-way branch.
- The Tier-2 fallback still strips GPS (Sharp decodes only the primary, drops metadata) — so even the `null` anomaly path is privacy-safe (quality-only cost). Confirmed by the existing "JPEG structure defeats scrubber" test passing.

### Residual (documented, not a finding)
A structurally-anomalous HEIC defeating the lossless scrub cannot be re-encoded (no HEVC encoder in prebuilt Sharp) and logs `console.error` while retaining GPS on the original (process-image.ts:1579). This is the documented, loudly-logged limitation; DB columns are still nulled so the public gallery never leaks. Not a tracing defect.

**Conclusion: CORRECT (VERIFIED-CLEAN).** High confidence — runtime-validated across 9 input shapes incl. the prompt's specific concerns (multi-chunk, VP8L, animated, EXIF+XMP). `strip-gps-from-original.test.ts` 24/24 green.

---

## FLOW 2 — Paid-download: token CAS → serve on-disk ORIGINAL → **VERIFIED-CLEAN**

### Observation
`POST /api/download/[imageId]` validates a single-use token, opens the original, atomically claims, then streams (route.ts:265-463). The token primitives live in download-tokens.ts.

### Hypotheses
- **H1**: Served original (post GPS-strip) matches what the entitlement promised. → **CONFIRMED** (lifecycle ordering).
- **H2**: Race between token claim and file read serves the wrong/partial bytes. → **REFUTED**.
- **H3**: Some path serves an un-stripped original after purchase. → **REFUTED** (strip is upload-time + setting is locked once photos exist).

### Evidence
**Open-before-claim ordering (route.ts:284-401)** — the documented and verified sequence:
1. `lstat` + symlink/regular-file reject (322-325), `realpath` containment (330-336).
2. `open(resolvedFilePath,'r')` → `fileHandle`; `fileSize = (await fileHandle.stat()).size` from the **opened inode** (349-351), all BEFORE the claim.
3. Atomic CAS: `UPDATE entitlements SET downloadedAt=NOW(), downloadTokenHash=null WHERE id=? AND downloadedAt IS NULL` (379-385). `affectedRows===0 → close handle → 410` (396-401).
4. Stream from the **already-open handle** (`fileHandle.createReadStream()`, 406); Content-Length from the opened inode (444).

Race analysis: because both the byte stream and Content-Length derive from the single opened handle/inode, a concurrent atomic rename of the directory entry cannot desync them (the handle pins the old inode). Handle is closed on **every** failure path (355, 387, 399, 456); success path uses stream autoClose. This is the C3-RPF-05 / R4C4-06 / R4C5-04 hardening and it holds.

**Lifecycle — no un-stripped original reaches a buyer:**
- GPS-strip runs **synchronously at upload** (`images.ts:311`, `lr/upload/route.ts:326`) using the upload-start config snapshot, writing via temp-file + atomic `fs.rename` (process-image.ts:1547-1548).
- `strip_gps_on_upload` is **locked once any image exists** (settings.ts:115-134 → `uploadSettingsLocked`), so it can never be flipped after the first photo. There is no post-upload re-strip path.
- An entitlement (and thus a download token) only exists after a Stripe purchase of an already-uploaded image → the original is necessarily already stripped per its upload-time decision.
- Only **three** files touch `UPLOAD_DIR_ORIGINAL`: images.ts (write+strip), lr/upload (write+strip), download route (read). No alternate original-serving sink. sales.ts `.update(entitlements)` calls (210, 234) are refund-only (`refunded:true, downloadTokenHash:null`, never touch `downloadedAt`).

**D-101-06 used-row disambiguation (route.ts:139-167)** correctly distinguishes 404 (never existed) from 410 (claimed: cleared hash AND `isNotNull(downloadedAt)`), and refund clears hash WITHOUT downloadedAt so the `isNotNull(downloadedAt)` guard (160) avoids mislabeling a refunded-never-downloaded row. The `refunded` check (180) blocks refunded downloads before serving.

**Token CAS primitive** — `verifyTokenAgainstHash` (download-tokens.ts:65) enforces token shape + 64-hex stored-hash shape before `timingSafeEqual` (constant-time, equal-length). GET interstitial is claim-free + fs-free (the HEAD/scanner-safe path).

**Conclusion: CORRECT (VERIFIED-CLEAN).** High confidence. No claim/read desync; no un-stripped-original path post-purchase.

---

## FLOW 3 — Color-pipeline backfill detection-failure semantics → **VERIFIED-CLEAN**

### Observation
On a successful re-encode whose color detection THEN fails transiently, both backfill paths must persist derivative columns WITHOUT bumping `pipeline_version`, so the row stays a candidate (`pipeline_version < CURRENT`) for a later detection retry.

### Hypothesis
- **H1**: Either path strands stale color metadata at the current version on detection failure. → **REFUTED** in both.

### Evidence
Candidate query in both: `processed=TRUE AND (pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)` (runner 374/404; script 299). A row left behind CURRENT is re-picked next run.

**admin-backfill-runner.ts** (`reprocessOne`, 495-614):
- Encode first → on throw, `encode-failed`, no version bump (517-520).
- Detection in its own try/catch (534-554); on failure `signals=null`.
- `if (signals)` → UPDATE sets `pipeline_version=CURRENT` + all color + derivative cols (557-570).
- `else` (detection failed) → UPDATE sets **only** `was_downscaled` + `avif_10bit` — **no `pipeline_version`, no color cols** (594-599) → returns `detection-failed`. The R-run2c1 AGG-01 comment (580-593) documents exactly this.

**scripts/backfill-color-pipeline.ts** (`reprocessRow` 198-235; `flushBatch` 358-411):
- Detection success → `{outcome:'processed', signals:{…}}` → `updateBatch` → UPDATE with `pipeline_version=CURRENT` + color + derivative (369-382).
- Detection failure → `{outcome:'processed', derivativeOnly:{…}}` → `derivativeBatch` → UPDATE with **only** `was_downscaled` + `avif_10bit` (386-391). Routing at 423-429. AGG2-01 comment (349-351) confirms intent.

Both paths share the per-image advisory lock and clean up orphaned derivatives on `affectedRows===0` (deleted-mid-reencode: runner 573-576/605-608, script 397-407).

### Test gate
`admin-backfill-runner-detection-failure.test.ts`, `backfill-detection-failure-contract.test.ts`, `admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` → **3/3 green** (ran live this cycle).

**Conclusion: CORRECT (VERIFIED-CLEAN).** High confidence — static trace + 3 passing contract tests. Both paths align; neither strands metadata.

---

## FLOW 4 — Session/auth: /[locale]/admin/* → proxy → action/route guard → **VERIFIED-CLEAN**

### Observation
Middleware (proxy.ts) does a cookie presence+format check (NOT crypto); the real gate is per-action `requireSameOriginAdmin` + `isAdmin`/`getCurrentUser`, and per-route `withAdminAuth`.

### Hypotheses
- **H1**: A mutating sink reaches the DB without auth (cross-origin OR unauthenticated). → **REFUTED**.
- **H2**: `requireSameOriginAdmin` is mistaken for an auth check, leaving origin-only-guarded mutating actions. → **REFUTED** — every mutating action ALSO does a real auth check.

### Evidence
**`requireSameOriginAdmin` is CSRF-only, by design.** It calls `hasTrustedSameOrigin` (action-guards.ts:37-44), a pure Origin/Referer-vs-Host check with no session component (request-origin.ts:79-107, fail-closed on missing source). So actions must ALSO call `isAdmin()`/`getCurrentUser()`. I audited co-presence across all 14 action files + db-actions.ts:

- Every file with `requireSameOriginAdmin` (soa>0) also has an auth check (`getCurrentUser`/`isAdmin`); `public.ts` correctly soa=0/auth=0 (intentionally anonymous, per CLAUDE.md).
- Two count-level soa>auth files inspected at the body level and cleared:
  - **lr-tokens.ts**: all 3 mutating/list exports do `requireSameOriginAdmin()` early-return THEN `getCurrentUser()` → `if(!user) unauthorized` (32-37, 102-107, 120-125); `revokeToken` scoped `{userId, tokenId}` so a user can only revoke their own tokens.
  - **sales.ts**: only mutating action `refundEntitlement` has BOTH `requireSameOriginAdmin()` (164) AND `isAdmin()` (166); `listEntitlements` is read-only-exempt but still gates on `isAdmin()` (32).

**Auth root verified:** `getCurrentUser` → `getSession()` → `verifySessionToken(token)` (HMAC, session.ts) → DB lookup (auth.ts:33-43). `isAdmin = !!getCurrentUser()` (54-56). Real cryptographic verification, not presence-only.

**API routes** — `withAdminAuth` (api-auth.ts:49-103) enforces, in order: (1) optional token-scope path with `verifyToken` + `tokenHasScope` for cross-origin LR clients (63-89); (2) `hasTrustedSameOrigin` → 403 (92-99); (3) `isAdmin()` → 401 (100-103) — both gate BEFORE the handler.

**Lint gates (architectural invariants, all ran green this cycle):**
- `lint:api-auth` — every `api/admin/**` HTTP method wraps `withAdminAuth`. OK.
- `lint:action-origin` — every mutating action returns early on `requireSameOriginAdmin()`. "All mutating server actions enforce same-origin provenance."
- `check-action-origin.test.ts` + `check-api-auth.test.ts` → green (part of the 63/63 run).

**Middleware boundary:** matcher excludes `/api/*` (proxy.ts:140) — so API auth is route-level only (correct; docblock warns new admin routes must self-guard, enforced by lint:api-auth). The `x-gk-admin-render` header (128-130) only reflects the requester's own cookie back to the same client (no cross-user disclosure) and is presence-only — crypto stays in the actions.

**Conclusion: CORRECT (VERIFIED-CLEAN).** High confidence — body-level audit of all action files, auth-primitive root trace, withAdminAuth ordering, and 4 passing lint/test gates. No origin-only-guarded mutating sink; no unauthenticated/cross-origin path to a mutating sink.

---

## DEFECT findings

**None.** All four flows are confirmed-correct. This is a deliberate result on a near-converged codebase: I formed competing hypotheses for each flow, sought disconfirming evidence (the lr-tokens.ts soa>auth count and the WebP null-return edge cases were the two most promising leads), and both resolved to clean.

## Convergence / separation notes
- Flows 1 and 2 share a root invariant: GPS-strip is upload-time + lossless-when-possible, and the stripped original is what the download route serves. They were traced separately (scrub correctness vs serve-path race) and both independently clean — genuine separation, not a single mechanism.
- Flow 4's two guard families (`requireSameOriginAdmin` for actions, `withAdminAuth` for routes) converge on the same two primitives: `hasTrustedSameOrigin` (CSRF) + `isAdmin`/`getCurrentUser` (auth). Both enforce the pair; this is real convergence on a shared, verified foundation.

## Uncertainty / probe recommendations (low residual)
- **Flow 1 — true encoder-produced animated WebP**: I hand-assembled ANIM/ANMF bytes (the walker logic is fully exercised). For belt-and-braces, a fixture from `cwebp`/ffmpeg with a real ANMF + appended top-level EXIF/XMP would pin the encoder-emitted layout. The walker's chunk-skip logic is shape-agnostic, so confidence is already high; this is optional hardening, not a gap.
- **Flow 2 — HEIC anomaly residual** is documented and logged, not a defect. If desired, an `avifenc`/`heif-enc` shell-out fallback would close it (out of scope for tracing; that is a feature, WI-09 adjacent).

## Test evidence run this cycle
- `strip-gps-from-original.test.ts`: 24/24 (within the 63-test run).
- `admin-backfill-runner-detection-failure` + `backfill-detection-failure-contract` + `…deleted-mid-reencode-detection-failure`: 3/3.
- `check-action-origin` + `check-api-auth` + `strip-gps-from-original`: 63/63.
- `lint:api-auth`, `lint:action-origin`: pass.
- Runtime WebP probes (8 Sharp-built shapes + 1 hand-built animated): all lossless + GPS-removed + EXACT chunk walk.
