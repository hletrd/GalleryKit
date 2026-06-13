# Verifier — Evidence-Based Correctness Verification (run-9 cycle-2 / orchestrator cycle 5)

**HEAD:** `1dde9b1e` · **Date:** 2026-06-13 · **Working tree:** CLEAN
**Angle:** prove (by reading code + running/inspecting the pinning test) that each of the 6 newest fixes (`40a65aef`..`1dde9b1e`, plan-337) does what its commit message claims; catch any COSMETIC fix or VACUOUS test.

> All evidence below was gathered by the verifier running the commands/regex/contrast-math directly at HEAD `1dde9b1e` — no claim is trusted on the plan's or commit's word.

---

## Verdict

**Status: PASS** · **Confidence: high** · **Blockers: 0**

All 6 fixes verified EFFECTIVE (not cosmetic) and their pinning tests proven NON-VACUOUS where applicable. All 6 gates green by independent measurement. No net-new finding.

---

## Gate Evidence (measured live this cycle by the verifier)

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | **PASS** | `npm run lint --workspace=apps/web` | exit 0 (clean) |
| Typecheck (app+scripts) | **PASS** | `npm run typecheck --workspace=apps/web` | exit 0 — `typecheck:app` "Types generated successfully"; `typecheck:scripts` checked 7 JS files + tsc scripts clean |
| lint:api-auth | **PASS** | `npm run lint:api-auth --workspace=apps/web` | exit 0 |
| lint:action-origin | **PASS** | `npm run lint:action-origin --workspace=apps/web` | exit 0 |
| lint:public-route-rate-limit | **PASS** | `npm run lint:public-route-rate-limit --workspace=apps/web` | exit 0 |
| Full vitest | **PASS** | `npx vitest run` | **215 files / 2068 tests passed, 0 failed** (COLD run, 165.66s) |
| i18n leaf-key parity | **PASS** | leaf-key set diff en.json vs ko.json | **837 = 837**, en-only 0, ko-only 0 — MATCH |
| libheif cold-flake | **NO REPRO** | full cold vitest | `backfill-color-pipeline` + `process-image-color-roundtrip` did NOT flake this run |

**Vitest delta vs prior aggregate:** prior cycle measured 214 files / 2067 tests at HEAD `ce0029aa`. This batch is 215 files / 2068 tests — exactly +1 file +1 test, matching the new `admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts` added by `2251b122`. The count moved for the documented reason; nothing else changed in the suite shape.

---

## Per-Fix Verification

### Fix 1 — `40a65aef` touch-target audit `max-h`/`max-w` false-positive + self-check — **PASS (effective + non-vacuous)**

**Claim:** the bare `h`/`w` FORBIDDEN branches now carry `(?<!max-)` so `max-h-10`/`max-w-9` are NOT flagged, while `h-8`/`min-h-6`/`h-10` still ARE; the 9 added negative fixtures are non-vacuous regression pins.

**Code at HEAD:** every bare `h-8`/`h-9`/`h-10|w-10|size-10` literal, cn() composite, HTML `<button>`, and the 4 scale-token catch-all alternations now have `\b(?<!max-)…` (touch-target-audit.test.ts ~:300-365). `min-h`/`min-w`/`size` branches intentionally un-guarded (true floors).

**Effectiveness PROVEN — verifier ran the EXACT committed regex in Node, with and without the lookbehind:**

```
scale-token catch-all:
  max-h-10  WITH=pass   WITHOUT=FLAG     ← fix removes the false positive
  max-w-9   WITH=pass   WITHOUT=FLAG     ← fix removes the false positive
  h-8       WITH=FLAG   WITHOUT=FLAG     ← real floor still caught
  min-h-6   WITH=FLAG   WITHOUT=FLAG     ← real floor still caught
h-10|w-10|size-10 literal branch:
  max-h-10  WITH=pass   WITHOUT=FLAG
  h-10      WITH=FLAG   WITHOUT=FLAG
```

The fix is NOT cosmetic: under the reverted regex `max-h-10`/`max-w-9` flag; under the committed regex they pass, while genuine sub-44 tokens still flag.

**Self-check NON-VACUOUS:** the 9 new fixtures (`max-h-10`, `max-w-9`, `max-h-8`, `max-w-10`, `max-h-screen`, `max-w-full`, cn() + HTML forms) live in the `does not flag valid` block, which asserts `FORBIDDEN.some(rule => rule.pattern.test(snippet))` is `false`. Reverting the `(?<!max-)` makes `max-h-10`/`max-w-9` match → `matched===true` → those fixtures go RED. (`max-h-screen`/`max-w-full` are robust regardless — they never match `-(?:[1-9]|10)` — but the numeric-suffix fixtures are the load-bearing non-vacuous pins.)

**Test run:** `touch-target-audit.test.ts` → **12 passed / 12**.

### Fix 2 — `300009d4` sidecar backfill `flushBatch` `affectedRows` cleanup guard — **PASS (effective)**

**Claim:** capture `affectedRows` on BOTH UPDATE branches; on `affectedRows===0` clean up derivatives via `deleteImageVariants(dir, fn, [])` (dir-scan) AFTER the tx commits; count as `deletedMidReencode`, decrement `processed`, surface in summary.

**Code at HEAD (`scripts/backfill-color-pipeline.ts` ~:337-395):**
- Branch 1 (full color UPDATE): `const [res] = await tx.execute(sql\`UPDATE images SET pipeline_version=…\`)` then `if ((res as ResultSetHeader)?.affectedRows === 0) deletedMidReencodeFiles.push(item.files);` — present.
- Branch 2 (derivative-only UPDATE): identical `const [res] = await tx.execute(...)` + same `affectedRows===0` push — present.
- `cleanupDeletedMidReencode(files)` calls `deleteImageVariants(UPLOAD_DIR_{WEBP,AVIF,JPEG}, files.filename_*, [])` — `[]` confirmed (full dir-scan).
- Cleanup runs AFTER `db.transaction(...)` returns (the `deletedMidReencodeFiles` array is drained post-commit), so a best-effort unlink error cannot roll back sibling updates — matches the comment.
- `processed -= deletedMidReencodeFiles.length`, `deletedMidReencode += …`, and `deletedMidReencode=${deletedMidReencode}` added to the final summary line — present.

Filenames are now threaded into each batch item (`updateBatch`/`derivativeBatch` carry `files: BatchFilenames`), populated from `row.filename_{webp,avif,jpeg}` at enqueue. Contract is now IDENTICAL to `admin-backfill-runner.ts`'s `cleanupDeletedMidReencodeVariants`. This closes the AGG-C4-02 production-path divergence. No unit test added (sidecar `main()` is hard to isolate; the `deleteImageVariants([])` dir-scan contract is independently pinned by `process-image-variant-scan.test.ts`, and the in-app twin is pinned by Fix 5) — acceptable given the runner-twin and contract coverage.

### Fix 3 — `fd708c1e` sales StatusBadge light-mode contrast → `*-700` — **PASS (effective; contrast recomputed)**

**Claim:** `downloaded` → `text-green-700 dark:text-green-400`, `pending` → `text-amber-700 dark:text-amber-400`; both 5.02:1 on white (vs failing 3.30/3.19 at -600).

**Code at HEAD (`sales-client.tsx:95,97`):**
```
downloaded: cls: 'text-green-700 dark:text-green-400'
pending:    cls: 'text-amber-700 dark:text-amber-400'
```
Confirmed exact.

**Contrast recomputed by the verifier (WCAG 2.x relative-luminance, Tailwind palette, on #ffffff):**
```
green-600 (#16a34a) = 3.30:1  FAIL   (the old value)
green-700 (#15803d) = 5.02:1  PASS   (the new value)
amber-600 (#d97706) = 3.19:1  FAIL   (the old value)
amber-700 (#b45309) = 5.02:1  PASS   (the new value)
```
The StatusBadge text is `text-xs` (small text) so the 4.5:1 floor (WCAG 1.4.3 AA) applies — both new values clear it. Dark `-400` variants were already passing and are retained. Verifier grep `text-green-600|text-amber-600|text-red-600` excluding `dark:` across `src/` → **0 residual light-mode -600 sites** (no match). Fix is effective, not cosmetic.

### Fix 4 — `18de78eb` upload-worker delete-race cleanup `[]` dir-scan — **PASS (effective)**

**Claim:** all 3 `deleteImageVariants` calls in the upload queue's `affectedRows===0` "deleted during processing" cleanup now pass `[]` (full dir-scan), so non-default `image_sizes` derivatives are also removed.

**Code at HEAD (`image-queue.ts:384-386`):**
```
deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp, []),
deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif, []),
deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg, []),
```
Verifier grep confirms these are the ONLY `deleteImageVariants` call sites in the file (plus the import at :8); all three carry the `[]` third arg. The `[]` form triggers the directory scan in `deleteImageVariants` (scan runs when `sizes.length === 0`), so every `{name}_{size}{ext}` variant is removed regardless of size config — closing the AGG-C4-04 non-default-size orphan. Contract now matches the runner + sidecar.

### Fix 5 — `2251b122` test for runner's 2nd (detection-failure) cleanup branch — **PASS (test NON-VACUOUS)**

**Claim:** the new test pins `admin-backfill-runner.ts:605` (detection-failed-but-encode-succeeded UPDATE), and would go RED if that guard were removed.

**Runner control-flow verified at HEAD (`admin-backfill-runner.ts`):** detection failure sets `detectionError` in the `catch` and leaves `signals` undefined → the `if (signals)` first branch (`:556-578`, with the `:573` guard) is SKIPPED → execution reaches the SECOND UPDATE (`:596`) followed by the `:605` guard: `if ((updateResult as …)?.affectedRows === 0) { await cleanupDeletedMidReencodeVariants(row); return { ok: false, reason: 'deleted-mid-reencode' }; }`. Both guards call `cleanupDeletedMidReencodeVariants` which uses `deleteImageVariants(…, [])` for all 3 formats (`:430-435`).

**Non-vacuity PROVEN by reasoning about the mock (`…-detection-failure.test.ts`):**
- `detectColorSignalsMock` THROWS (`:47-49`) → forces `signals` undefined → guarantees the second branch is the one reached (not the first). `processImageFormatsMock` resolves OK (`:41`) so the encode "wrote" derivatives — the precondition for orphaning.
- `executeMock` returns `[{ affectedRows: 0 }]` for ALL non-SELECT queries (`:179-180`) → the `:605` guard fires.
- Assertions: `cleanedDirs` contains `/uploads/webp`, `/uploads/avif`, `/uploads/jpeg` (`:202-205`); every `deleteImageVariants` call's 3rd arg `toEqual([])` (`:207-209`); `deletedMidReencode===1`, `processed===0`, `detectionFailures===0`, `lastRunHadFailures===false` (`:214-223`).

If the `:605` guard were deleted, the second branch falls through to `return { ok: false, reason: 'detection-failed' }`: (a) `deleteImageVariantsMock` is NEVER called → `cleanedDirs` is `[]` → `expect(cleanedDirs).toContain('/uploads/webp')` FAILS; and (b) the outcome becomes `detection-failed` → `state.detectionFailures` would be `1` → `expect(state.detectionFailures).toBe(0)` FAILS. TWO independent assertions flip RED. The commit message documents the same empirically-confirmed RED. Test is genuinely non-vacuous.

**Test run:** detection-failure test + the success-branch sibling + `sanitize-for-og-global` → **8 passed / 8** across 3 files.

### Fix 6 — `1dde9b1e` doc/comment honesty (4 sub-items) — **PASS (docs match code)**

Each claim cross-checked against the ACTUAL code at HEAD:

(a) **CLAUDE.md cache() count 9→10.** Verifier enumerated `= cache(` in `data.ts`: exactly **10** wrapped exports — `getSmartCollectionBySlugCached`(:1332), `getImageCached`(:1595), `getLatestImageForOgCached`(:1597), `getTopicBySlugCached`(:1598), `getTopicsCached`(:1599), `getTagsCached`(:1600), `getTopicsWithAliasesCached`(:1601), `getImageByShareKeyCached`(:1603), `getSharedGroupCached`(:1608), `getSeoSettings`(:1649). CLAUDE.md:357 now says "wraps 10" and the prose lists 9 `*Cached` + `getSeoSettings` = 10, including the previously-missing `getLatestImageForOgCached`. **Match.**

(b) **CLAUDE.md COLOR_IMPACTING_KEYS citation `:34-46`→`:37-49`.** Verifier read `settings-hash.ts`: the array opens at line **37** (`const COLOR_IMPACTING_KEYS = [`) and closes at line **49** (`] as const;`). CLAUDE.md:263 now cites `:37-49` and counts **9** keys (5 color + 3 quality + 1 size) — the array has exactly 9 entries. **Match.**

(c) **`(public)/page.tsx` home og:image comment.** The corrected comment (`:104-116`) now states "note there is NO base-JPEG last resort, only the sized `_NNN.jpg` derivatives are tried" and "302-redirects to the admin-configured `og_image_url`, or to the site homepage HTML if that setting is empty … NOT a freshly-generated 'site OG card'." Verifier confirmed against code: `pickFirstAvailablePhotoBuffer` (`og-photo-fetch.ts:75-86`) iterates ONLY `tryFetchPhotoBuffer(origin, baseFilename, size)` over sorted sizes and returns `null` on total miss — no base-JPEG path. The route's `if (!fetched)` (`route.tsx:109-115`) calls `buildFallbackResponse(req, …, seo.og_image_url || undefined)`; `buildFallbackResponse` (`:235-259`) 302s to `ogImageUrl` if present, else 302s to `${origin}/` (site root HTML). **Comment matches code exactly.**

(d) **`p/[id]/page.tsx` JSON-LD asymmetry comment.** The new comment (`:217-228`) documents that `name`/`description`/`keywords`/breadcrumb `topic_label` are intentionally NOT `sanitizeForOg`-wrapped while EXIF PropertyValues ARE, justified by (1) `safeJsonLd` escaping all output + (2) write-time `containsUnicodeFormatting` validator-gating on the admin string fields vs un-gated EXIF. Verifier confirmed: `name: displayTitle`(:229), `description: image.description`(:230), `keywords`(:231) are bare; `camera_model`/`lens_model`/`exposure_time` wrapped in `sanitizeForOg`(:234-238). **Comment matches code; the security posture it describes is correct (defensible, not a fix-the-wrong-way trap).**

**Test run:** `sanitize-for-og-global.test.ts` → 6/6 (the tightened C0-strip docstring change is comment-only).

---

## Net-New Findings

**NONE.** Every fix is effective (not cosmetic) and every applicable pinning test is non-vacuous. No fix failed verification, so no fix produces a net-new finding this cycle.

I specifically looked for the cosmetic/vacuous failure modes and did not find them:
- Fix 1 is not cosmetic (proven by the WITH/WITHOUT regex divergence) and its self-check is not vacuous (numeric `max-*` fixtures flip RED on revert).
- Fix 2's guard is on BOTH branches and the cleanup uses the `[]` dir-scan (not the default-sizes form) — the exact bug the runner/queue fixes also closed.
- Fix 3's color values are real (`-700`) and the contrast clears 4.5:1 by recomputation, not assertion.
- Fix 4 passes `[]` on all three calls (not the silent 2-arg default-sizes form).
- Fix 5's test reaches the SECOND branch (detection throws → first branch skipped) and asserts both the cleanup-call set and the outcome counter, either of which catches a dropped `:605` guard.
- Fix 6's four doc/comment edits each match the live code I read.

---

## Cross-check against prior aggregate (AGG-C4-01..07)

These 6 fixes are exactly the SCHEDULE set from `.context/reviews/_aggregate.md` (cycle 4): AGG-C4-01 (Fix 1), -02 (Fix 2), -03 (Fix 3), -04 (Fix 4), -05 (Fix 5), -06+-07 (Fix 6). All scheduled items are now landed and independently re-verified CLOSED at HEAD `1dde9b1e`. The DEFERRED set (AGG-C4-08 SW lost-update, AGG-C4-09 stale `KNOWN_VIOLATIONS=6`, the test-depth tail, the arch consolidation) is unchanged and out of scope for this evidence-check; none was falsely marked closed.

---

**FIXES VERIFIED: 6/6**
**NET-NEW FINDINGS THIS CYCLE: 0**
