# Verifier — Cycle 9 (review-plan-fix)

**Date:** 2026-06-14
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD verified:** `0ce84b1b` (working tree clean for ALL tracked source — only `.context/reviews/*` artifacts and untracked `plan/plan-34{5,6}*.md` differ, none are app source). Re-confirmed `git rev-parse --short HEAD = 0ce84b1b` after every probe; all source-file diffs empty (0 source modifications).
**Mandate:** evidence-based correctness verification of the six highest-risk invariant areas. Prove the cycle-8 fixes (plans 345/346) landed non-vacuously, and prove the standing privacy / GPS-scrub / backfill / migration / auth invariants are TRUE from the code — by reading the resulting code, running tests, and perturbing the source to prove RED where a property could be silently broken.

---

## Verdict

**Status: PASS.** Every mandated invariant is CONFIRMED TRUE at HEAD `0ce84b1b`. The two cycle-8 fixes (`71ab0f41` generateBase56 distribution test; `aa8a6f8a` SCAN_ROOTS doc) landed correctly and the test is proven non-vacuous. Five separate regression guards were proven RED-on-perturbation by hand (then the source restored byte-identically). **No new finding.** This loop has converged.

- **Confidence: High** — claims verified by reading the cited code lines + running targeted vitest + perturbing five source files to prove the guards genuinely fail RED + fresh full gate runs with explicit exit codes.
- **Blockers: 0.**
- **NEW genuine findings: 0.**

---

## Evidence — gates (fresh, this cycle, explicit exit codes)

| Check | Result | Command | Output / exit |
|-------|--------|---------|---------------|
| ESLint | PASS | `npm run lint` | exit 0 |
| Typecheck (full app+scripts) | PASS | `npm run typecheck` | **exit 0** ("Checked 7 JavaScript script files."; typecheck:app passed) |
| lint:api-auth | PASS | `npm run lint:api-auth` | exit 0 (2 admin route files OK) |
| lint:action-origin | PASS | `npm run lint:action-origin` | exit 0 ("All mutating server actions enforce same-origin provenance.") |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit` | exit 0 (semantic uses helper; stripe-webhook exempt) |
| Targeted vitest (invariant files) | PASS | `vitest run` (12 files across all 6 areas) | all green (base56 10, gps/webp 32, migration 63, backfill+privacy 26, etc.) |

No flake observed this cycle on the targeted runs (the documented real-encode AVIF/WebP cold-flake AGG-C8-R-FLAKE did NOT reproduce; `backfill-color-pipeline.test.ts` passed).

---

## Invariant 1 — Cycle-8 fixes (plans 345/346) landed correctly + non-vacuous

### 1a. `generateBase56` distribution test — PROVEN NON-VACUOUS by hand

**Claim:** `71ab0f41` added a deterministic distribution test to `base56.test.ts` that goes RED against a naive `%56` impl (drops rejection sampling).

**Source verified:** `apps/web/src/lib/base56.ts:6-28` — `generateBase56` correctly does rejection sampling: `do { randomValue = pool[poolIdx++]; … } while (randomValue >= 224)` then `BASE56_CHARS.charAt(randomValue % 56)`. Rejects bytes ≥ 224 because `256 % 56 = 32` (the bias tail). Callers confirmed security-relevant: `actions/sharing.ts:127` (`PHOTO_SHARE_KEY_LENGTH = 10`) and `:239` (`GROUP_SHARE_KEY_LENGTH = 10`) — the SOLE mint for `/s/<key>` + `/g/<key>` public access tokens.

**Test verified:** `base56.test.ts:42-65` — 500k-sample char-frequency tally, asserts every one of 56 chars appears + `max/min ratio < 1.2`.

**RED-on-perturbation proof (method: mutate source, run test, restore):**
- Baseline GREEN: `vitest run base56.test.ts` → **10 passed**.
- Mutated `base56.ts` to the naive `const pool = randomBytes(length); … charAt(pool[i] % 56)` (rejection loop removed). Re-ran: **1 failed | 9 passed** — the distribution test failed with `AssertionError: expected 1.290141945565829 to be less than 1.2`. The other 9 tests (length/charset/successive-differ + isBase56) stayed GREEN, empirically proving they are BLIND to the entropy regression and the new test is the sole guard.
- Restored from `/tmp/base56.ts.orig`: `shasum` = `39ddc2dc…` (matches HEAD), `git diff` empty.
- **Conclusion:** non-vacuous. Observed naive ratio 1.290 sits above the 1.20 threshold; correct code ~1.04-1.06 sits below → non-flaky margin confirmed.

### 1b. SCAN_ROOTS doc (AGG-C8-02) — matches code

**Claim:** `aa8a6f8a` corrected CLAUDE.md:505 to add the `app/[locale]/(public)/` route group to the `SCAN_ROOTS` description.

**Verified:**
- `CLAUDE.md:505` now reads: "walks every `.tsx`/`.jsx` file under `SCAN_ROOTS` (= `components/` + the admin route group `app/[locale]/admin/` + the public route group `app/[locale]/(public)/`) recursively."
- The live `SCAN_ROOTS` array (`touch-target-audit.test.ts:79-83`) is exactly THREE directories: `componentsDir`, `adminDir`, `publicDir`. The doc now matches the array exactly.
- The plan's "follow the code, not the inaccurate CRIT8-01 claim" decision was CORRECT: there is no root-level-locale-file entry in `SCAN_ROOTS` (the critic's claim was refuted in plan-345 Item 2).
- **Residual nuance (NOT a finding, safe-direction, pre-existing):** the scan ALSO consumes a SEPARATE `appLevelExtraFiles` list (`:59-65`, 5 root-level `[locale]/*.tsx` files) via `files.push(...appLevelExtraFiles...)` at `:743`, which the doc sentence does not mention. This is the safe direction (the doc UNDER-states total coverage; nothing ships unguarded), the doc accurately describes `SCAN_ROOTS` specifically, and it was outside the scheduled AGG-C8-02 scope. The loop has already triaged this class as doc-completeness record-only. No re-escalation.

---

## Invariant 2 — Privacy guards (compile-time) — ALL PROVEN NON-VACUOUS

### 2a. `_SensitiveKeysInPublic` / `publicSelectFields` omit all PII — PROVEN RED

**Source verified:** `data.ts:416-420`:
- `PrivacySensitiveKeys` union = 20 keys: latitude, longitude, filename_original, user_filename, processed, original_format, original_file_size, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version.
- `publicSelectFields` (`:355-357`) is built from `publicSelectFieldCore` — the destructuring rest (`:325-353`) after omitting all PII keys from `adminSelectFields`.
- `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>`; `_privacyGuard: _SensitiveKeysInPublic extends never ? true : [error] = true`.

**RED-on-perturbation proof:** Injected `latitude: images.latitude` into the `publicSelectFields` object literal. `tsc -p tsconfig.typecheck.json --noEmit` →
`src/lib/data.ts(420,7): error TS2322: Type 'boolean' is not assignable to type '["latitude", "ERROR: privacy-sensitive field found in publicSelectFields — see PRIVACY comment above"]'.`
Restored from `/tmp/data.ts.orig` (`shasum` = `c5b8f6fc…`, git diff empty). **The guard is a real compile-time gate — a PII leak into the public select fails the typecheck gate, naming the offending key.**

**Runtime fixture parity:** `privacy-fields.test.ts` `SENSITIVE_KEYS` (`:6-42`) = the SAME 20 keys as the union (verified key-by-key). The symmetric guard test (`:83-90`) asserts `adminSelectFieldKeys − publicSelectFieldKeys === SENSITIVE_KEYS` EXACTLY (`toEqual`), so a NEW unclassified admin field fails loudly at runtime — closing the gap the compile-time guard can't (unknown-key add). Ran privacy-fields.test.ts → all green.

### 2b. Map-privacy UNION contract — PROVEN RED

**Source verified:** `data.ts:429-432` — `_MapSensitiveKeys = Exclude<PrivacySensitiveKeys, 'latitude'|'longitude'>`; the guard fires if `publicMapSelectFields` contains any sensitive key OTHER than lat/lng. This is precisely the documented UNION contract: `publicMapSelectFields ⊆ publicSelectFields ∪ {latitude, longitude}`.

**RED-on-perturbation proof:** Injected `is_hdr: images.is_hdr` into `publicMapSelectFields` (`:391-393`). tsc →
`src/lib/data.ts(432,7): error TS2322: Type 'boolean' is not assignable to type '["is_hdr", "ERROR: privacy-sensitive field found in publicMapSelectFields — must only add latitude/longitude vs publicSelectFields"]'.`
Restored (hash matches, diff empty). **The UNION contract is enforced: only latitude+longitude may be added to the map select beyond the public set; any other sensitive key fails the typecheck gate.**

`getMapImages` is the only consumer (enforces `topics.map_visible = true` via inner JOIN per `:359-365`).

---

## Invariant 3 — GPS-scrub correctness — VERIFIED bounded + fails-closed + actually removes GPS

**Source read in full:** `lib/gps-exif-strip.ts` (595 LOC) + `lib/process-image.ts:1498-1518`.

### TIFF GPS-IFD zeroing core (`stripGpsFromTiffRegion`, `:103-189`) — the heart of all 4 scrubbers
- Bounds: `tiffEnd > buf.length || tiffEnd - tiffStart < 8 → null` (`:104`); byte-order II/MM only else null (`:105-109`); magic `42` check (`:110`); `inBounds` validates every absolute access against `[tiffStart, tiffEnd)` (`:112`).
- **Actually removes GPS:** `zeroGpsIfd` (`:116-143`) — for each GPS-IFD entry, zeros the out-of-line value bytes (`buf.fill(0, valueAbs, valueAbs + valueSize)` `:133`) AND the 12-byte entry (`:135`), then zeros the next-IFD pointer (`:140`) and collapses the IFD count to 0 (`:141`). Both the entries and their pointed-to value bytes are zeroed — a reader sees an empty GPS IFD. Confirmed correct.
- Termination: IFD-chain walk bounded by `MAX_IFD_CHAIN` with a `visited` Set catching cycles (→ null on revisit, `:150`) and `next === 0` break (`:184`). Monotonic-or-fail.
- Fail-closed: every structural anomaly returns `null`, which the caller treats as "fall back to metadata-free re-encode."

### JPEG (`stripGpsFromJpegBuffer`, `:212`)
- SOI check; bounded segment walk; **post-EOI trailer rejection** (`:262-278`) — a GPS-bearing MPF/MotionPhoto secondary after the primary EOI is a structural anomaly → null → tier-2 re-encode (which decodes only the primary). ExtendedXMP overflow-chunk reconstruction (offset-ordered) so a GPS token split across chunk boundaries is still caught (`:218-225`).

### HEIF/ISOBMFF (`stripGpsFromIsobmffBuffer`, `:369`) + WebP (`stripGpsFromWebpBuffer`, `:554-595`)
- WebP: RIFF+WEBP magic else null (`:555-559`); chunk walk bound `offset + 8 <= buf.length`; `dataEnd > buf.length → null` (`:570`); EXIF chunk delegates to the verified TIFF core; XMP chunk retags FourCC→`JUNK` + zeros payload on GPS token (`:584-585`); RIFF even-padding (`:589`); `next <= offset → null` overflow guard (`:591`); returns the ORIGINAL buffer reference when nothing stripped (`:594`). (The JUNK-retag offset was proven RED-on-perturbation in cycle-7 / VER8-02 — branch unchanged at HEAD.)

### WebP lossless-by-chunk detection (`process-image.ts:1498-1518`) — bounded + fails-closed
- Header check else `false` (safe lossy default); walk bound `offset + 8 <= buf.length`; returns `true` ONLY on genuine `VP8L` pixel chunk (`:1508`), `false` on `VP8 ` (`:1509`); `next <= offset → false` overflow/zero-progress guard (`:1514`); defaults `false` if no pixel chunk found (`:1517`).
- Call site (`:1608`): `const isLosslessWebp = isLosslessWebpByChunk(input);` — **grep confirms NO `input.includes('VP8L')` whole-buffer scan remains** (only doc-comment references to the avoided naive approach). The cycle-7 AGG-C7-05 fix is intact.
- Known limitation (AGG-C8-R2 / DBG8-NC-02, RECORD-ONLY, re-confirmed): does NOT descend into `ANMF`, so an animated-lossless WebP on the doubly-rare Tier-2 GPS re-encode fallback re-encodes lossy. **GPS is stripped either way → zero privacy/correctness impact.** Comment at `:1511` is mildly aspirational vs implementation. No change. NOT a new finding.

**Tests:** `strip-gps-from-original.test.ts` (incl. the consolidated `stripGpsFromIsobmffBuffer` direct coverage from `23f62c66`) + `process-image-webp-lossless-detect.test.ts` → **32 passed**.

---

## Invariant 4 — Backfill no-version-bump-on-detection-failure + column-set parity

### 4a. No version bump on detection failure — PROVEN NON-VACUOUS (RED-on-perturbation)

**Source verified:** `admin-backfill-runner.ts` `reprocessOne` (`:495-615`):
- Encode-failed (`:517-519`): returns `encode-failed`, no UPDATE, no version bump.
- Success path (`signals` truthy, `:556-577`): UPDATE sets `pipeline_version = IMAGE_PIPELINE_VERSION` + the 8 color columns + `was_downscaled` + `avif_10bit`.
- **Detection-failure path** (`signals` null, `:594-609`): UPDATE sets ONLY `was_downscaled` + `avif_10bit` — `pipeline_version` is conspicuously ABSENT from the SET clause. Returns `detection-failed`. The row stays below `IMAGE_PIPELINE_VERSION`, so candidate selection (`pipeline_version < CURRENT`, `:374`/`:404`) re-picks it next run. Contract holds by direct read.

**RED proof:** Added `pipeline_version = ${IMAGE_PIPELINE_VERSION},` to the detection-failure UPDATE. Ran `admin-backfill-runner-detection-failure.test.ts` → **1 failed** at `:199` (`expect(text).not.toContain('pipeline_version')` — the reconstructed SQL now contained `pipeline_version = ,`). Restored from `/tmp/abr.ts.orig` (hash = `45484ba9…`, diff empty). **The contract is genuinely guarded** — the test reconstructs the static Drizzle SQL and asserts no detection-failure UPDATE sets `pipeline_version`.

### 4b. Column-set parity with fresh upload — VERIFIED (exact `toEqual`)

- Admin-runner success UPDATE (`:557-570`) persists: `pipeline_version, icc_profile_name, color_primaries, transfer_function, matrix_coefficients, is_hdr, has_gain_map, color_pipeline_decision, was_downscaled, avif_10bit` (10 cols).
- Sidecar script parity test `backfill-color-pipeline.test.ts:146-196` (AGG-02): derives `persistedColumns = Object.keys(signals).sort()` from the REAL `reprocessRow` outcome (Sharp-encoded sRGB fixture), then `expect(...).toEqual([avif_10bit, color_pipeline_decision, color_primaries, has_gain_map, icc_profile_name, is_hdr, matrix_coefficients, transfer_function, was_downscaled])` (9 color cols; `pipeline_version` is the separate candidate-selection key). Exact array equality → any drift fails. Non-vacuous by construction.
- Both entry points (in-app runner + sidecar script) write the SAME column set, matching CLAUDE.md.

**Tests:** `backfill-color-pipeline.test.ts` + `backfill-detection-failure-contract.test.ts` + `admin-backfill-runner-detection-failure.test.ts` → all green (26 across this + privacy + base56).

---

## Invariant 5 — Migration post-condition fails loud on silently-skipped migrations

**Source verified:** `migrate.js`:
- `getAllJournalMigrations` (`:144-160`): reads full journal, one record per entry with `hash = SHA256(migration SQL file content)` (`:157`).
- `getRecordedHashes` (`:615-617`): reads the `hash` column of `__drizzle_migrations`.
- **Post-condition** in `runMigrations` (`:698-719`): after `migrate(db, …)`, computes `missing = expectedMigrations.filter(m => !recordedHashes.has(m.hash))` (`:709`); if non-empty, `throw new Error("Drizzle silently skipped N migration(s): …")` naming the tags (`:710-718`). Logic correct by direct read.
- `prepareLegacyDatabaseIfNeeded` (`:659-696`): no longer compares `MAX(created_at)` — uses `migrations.every(m => haveHashes.has(m.hash))` (`:683`) and reconciles + per-entry baselines otherwise. Fresh-DB bootstrap routed through the same deterministic path (`:662-680`).

**Test characterization + RED proof:** `migration-journal-monotonicity.test.ts`:
- The genuinely load-bearing protection (Group 1, `:56-95`): asserts journal `when` strictly advances by idx EXCEPT the documented idx-7 inversion allowlist, and the allowlist isn't stale. A NEW non-monotonic entry fails `:75`. Behavioral.
- The post-condition is guarded by (a) a STRUCTURAL MIRROR of the predicate (`:98-111`) and (b) a SOURCE-TEXT pin (`:113-119`) — `expect(src).toContain('Drizzle silently skipped')` + a regex matching the filter expression. This is the documented strategy because `runMigrations` requires a live MySQL connection (it cannot be unit-exercised directly).
- **RED proof of the source-pin:** Neutered the throw → `console.warn` and changed the string to "NEUTERED skip warning". Ran the test → **1 failed** at `:117` (`expect(src).toContain('Drizzle silently skipped')`). Restored from `/tmp/migrate.js.orig` (hash = `b7600288…`, diff empty). **A refactor that quietly drops the loud-fail IS caught.**
- **Honest characterization (NOT a finding):** the source-pin would NOT catch a subtle logic regression that preserves the string but breaks the predicate. However, the predicate is correct by direct read, mirrored+tested, and the throw presence is pinned. The combination is a reasonable, documented test-depth strategy for live-DB code. Consistent with prior cycles; no escalation.

**Tests:** `migration-journal-monotonicity.test.ts` + `migration-journal.test.ts` + `migrate-reconcile-coverage.test.ts` → **63 passed**.

---

## Invariant 6 — Auth invariants — ALL VERIFIED

### 6a. Session token `timingSafeEqual` (`session.ts:99-134`)
- HMAC-SHA256 over `timestamp:random` with the session secret (`:108`). Length-guard BEFORE `timingSafeEqual` (`:113-115`, required since timingSafeEqual demands equal-length buffers; hex sigs are fixed-length so this is not a meaningful oracle). Constant-time compare `:117`. Structural shape checks run AFTER crypto verification (`:121-125`) so they can't be a timing oracle — well-reasoned defense-in-depth. Token-age bounds: both upper (24h) and lower (negative/future) (`:127-133`). Matches CLAUDE.md.

### 6b. Login two-bucket rate limit (`auth.ts:95-164`, `rate-limit.ts`)
- TWO buckets enforced: per-IP `login` (`:105-110`) AND per-account `login_account` (key `acct:<sha256-prefix>`, `:116-122`). Either ≥ `LOGIN_MAX_ATTEMPTS` rejects.
- Constants: `LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_WINDOW_MS = 15 min` (`rate-limit.ts:62-63`). `buildAccountRateLimitKey` (`:148-152`): `acct:` + sha256(trim+lowercase username) prefix slice. Lowercase-normalized → case variants share a bucket (no evasion).
- TOCTOU fix: BOTH buckets incremented BEFORE the Argon2 verify (`:124-139`) preventing burst brute-force. DB-backed durable check with strict `>` (`:145-156`) + rollback if rejected (so a rejected request doesn't permanently burn budget). Graceful DB-unavailable fallback to in-memory Maps (`:157-164`). Dummy-hash verify on missing user (`:175-178`) prevents timing enumeration. Matches CLAUDE.md exactly ("per-IP 5/15-min + per-account `acct:<sha256-prefix>` same limits").

### 6c. Last-admin-deletion prevention (`admin-users.ts:179-268`)
- Auth + same-origin (`:183-187`), self-delete prevented (`:194-196`).
- **Table-wide advisory lock `LOCK_ADMIN_DELETE`** (`gallerykit_admin_delete`) acquired with 5s timeout on a dedicated pooled connection (`:218-225`) — serializes ALL admin deletions so two concurrent deletes can't both observe ">1 admin" and remove the final two rows (the comment correctly notes a target-scoped lock would be insufficient, `:211-214`).
- Inside a transaction: `COUNT(*) FROM admin_users <= 1 → LAST_ADMIN throw` (`:228-233`), read UNDER the lock+txn → TOCTOU closed. Audit-log FK detach (`:256`, the documented errno-1451 mitigation) before delete. `affectedRows === 0 → USER_NOT_FOUND` (`:261-262`). Invariant holds.

---

## Vacuous-test scan (mandated) — none found that protect a broken property

Every regression guard I perturbed went RED as designed (5/5: base56 distribution, `_privacyGuard`, `_mapPrivacyGuard`, backfill no-version-bump, migration source-pin). The two STRUCTURAL-MIRROR tests I noted (`map-privacy` runtime inline-mirror per AGG-C8-R1; `migration` post-condition predicate-mirror) are SUPPLEMENTARY, not load-bearing — in both cases the genuine protection (compile-time UNION guard / correct `runMigrations` source + presence-pin) is sound and itself proven non-vacuous. These are the same dispositions the loop already recorded; neither is a vacuous test masking a broken property.

---

## Restore integrity (all five perturbations reverted byte-identically)

| File | HEAD shasum | Restored shasum | git diff |
|------|-------------|-----------------|----------|
| `src/lib/base56.ts` | `39ddc2dc…` | `39ddc2dc…` | empty |
| `src/lib/data.ts` (×2 perturbations) | `c5b8f6fc…` | `c5b8f6fc…` | empty |
| `src/lib/admin-backfill-runner.ts` | `45484ba9…` | `45484ba9…` | empty |
| `scripts/migrate.js` | `b7600288…` | `b7600288…` | empty |

Final `git status`: 0 source modifications; only `.context/reviews/*` artifacts + untracked `plan/*.md` differ. HEAD never moved (`0ce84b1b`).

---

## Recommendation

**APPROVE.** All six mandated invariant areas are CONFIRMED TRUE at HEAD `0ce84b1b`. The two cycle-8 fixes landed correctly and the generateBase56 distribution test is proven non-vacuous (RED at ratio 1.290 vs the 1.20 threshold against a naive `%56` mutation). The standing privacy compile-time guards (both `_SensitiveKeysInPublic` and the map-privacy UNION) are real and fail RED on a PII injection. The GPS scrubbers actually zero GPS-IFD entries + values and are bounded/fail-closed on all four formats; the WebP lossless-by-chunk detector is bounded and fails-closed to lossy. The backfill no-version-bump-on-detection-failure contract is guarded (proven RED) and the column-set parity uses exact `toEqual`. The migration post-condition throws loud and its presence is pinned (proven RED on neuter). The auth invariants (timingSafeEqual session verification, two-bucket 5/15-min login rate limit, table-wide-advisory-lock last-admin prevention) all match the code and CLAUDE.md.

**NEW genuine findings: 0.** This is consistent with the cycle-8 convergence assessment (12→13→17→9→5→6→5→2→0). The loop has converged.

### Confirmed PASS (summary)
- Cycle-8 fixes: generateBase56 distribution test (RED-proven non-vacuous) + SCAN_ROOTS doc (matches the live 3-entry array).
- Privacy: `_SensitiveKeysInPublic` (RED-proven), map-privacy UNION (RED-proven), 20-key union ↔ SENSITIVE_KEYS fixture parity, symmetric runtime guard.
- GPS-scrub: TIFF GPS-IFD zeroing actually removes GPS; 4 scrubbers + lossless detector bounded + fail-closed; no substring scan remains.
- Backfill: no-version-bump-on-detection-failure (RED-proven) + 10-column parity (exact toEqual).
- Migration: post-condition logic correct + loud-fail throw presence pinned (RED-proven on neuter).
- Auth: session timingSafeEqual, login two-bucket (5 / 15-min, acct:<sha256> key), last-admin advisory-lock + COUNT-in-txn.
- 6 gates green (lint, typecheck full, 3 security lint gates) with explicit exit 0; targeted vitest across all 6 areas green.
