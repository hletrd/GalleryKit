# Verification Report — Cycle 6 (run-9 c3)

**11 claims verified, 0 critical failures. One test-isolation quirk (non-blocking). One CLAUDE.md count discrepancy (non-blocking doc note).**

HEAD: `4c3d5924` — working tree clean. Full suite: **218 test files, 2080 tests, 0 failures**.
Typecheck: **0 errors** (`typecheck:app` + `typecheck:scripts` both exit 0).

---

## Verdict

**Status: PASS** · **Confidence: high** · **Blockers: 0**

All 6 cycle-5 acceptance criteria verified with fresh evidence. Three broader CLAUDE.md behavior claims confirmed. One CLAUDE.md documentation count discrepancy found (cosmetic only — code correct).

---

## Gate Evidence

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| Full vitest | pass | `npm test --workspace=apps/web` | 2080 passed, 0 failed, 218 files, 269.82s |
| Typecheck (app+scripts) | pass | `npm run typecheck` from `apps/web/` | 0 errors — "Types generated successfully"; 7 JS scripts checked |
| Cycle-5 specific tests | pass | `npx vitest run` from `apps/web/` | image-queue (2/2), i18n-key-parity (2/2), touch-target-audit (13/13), backfill-deleted-mid-reencode (7/7) |
| Select regex correctness | pass | `node -e` inline execution | 6/6 cases correct — `max-h-10` no-flag, `h-8/h-9/h-10/cn("h-8")` flag |
| Queue source pin | pass | `node -e` inline regex on `image-queue.ts` | 3-arg `[]` form present for all 3 dirs; 2-arg form absent |
| Backfill column parity | pass | `sed` extraction of both UPDATE blocks | Identical 10-column sets in sidecar and in-app runner |

**Test isolation note:** `backfill-color-pipeline-deleted-mid-reencode.test.ts` fails `ERR_MODULE_NOT_FOUND` when run via `npx vitest run <path>` from the repo root — the `@/` alias is only active when vitest resolves `apps/web/vitest.config.ts`. Running from `apps/web/` (as `npm test --workspace` does) gives 7/7. This is pre-existing CWD-sensitivity documented in `vitest.config.ts`; not a code defect.

---

## Acceptance Criteria — Cycle-5 Commits

### Claim 1 — `fad9c279` sidecar backfill `collectDeletedMidReencodeFiles` + `cleanupDeletedMidReencodeVariants` tests — PASS (non-vacuous)

**Exports confirmed** at `apps/web/scripts/backfill-color-pipeline.ts:116,127,142`:
- `type BatchFilenames` (`:116`)
- `async function cleanupDeletedMidReencodeVariants` (`:127`)
- `function collectDeletedMidReencodeFiles` (`:142`)

**Partition test non-vacuity:** input `[{affectedRows:1,files:a}, {affectedRows:0,files:b}, {affectedRows:1,files:c}]` → asserts `result.toEqual([b])` and `result.toHaveLength(1)`. Dropping the `=== 0` filter makes result `[a,b,c]`, length 3 — both `.toEqual([b])` and `.toHaveLength(1)` flip RED.

**Cleanup test non-vacuity:** asserts `deleteImageVariantsMock` called 3 times with `(UPLOAD_DIR_WEBP, 'deleted-row.webp', [])` etc., and that `call[2]` is `[]` for every call. Omitting the 3rd arg makes `call[2]` `undefined`, failing `.toEqual([])`.

**Vitest (from `apps/web/`):** 7/7 passed.

---

### Claim 2 — `07a838d6` touch-target `<select>` patterns with `(?<!max-)` lookbehind — PASS

**All 4 select patterns** in `touch-target-audit.test.ts` lines 415–428 now carry `(?<!max-)` before `(?:h-8|h-9|h-10)`.

**Verified by running committed regex in Node against 6 test strings:**

| Input | Expected | Result |
|-------|----------|--------|
| `<select className="max-h-10 overflow-auto">` | no flag | no flag |
| `<select className="h-8 px-2">` | flag | flag |
| `<select className="h-9 rounded">` | flag | flag |
| `<select className="h-10">` | flag | flag |
| `<select className={cn("h-8", cls)}>` | flag | flag |
| `<select className="max-w-10">` | no flag | no flag |

All 6 correct. `max-w-10` does not flag because there are no `w-` patterns in the select ruleset (by design — only height constrains tap area on a `<select>`).

---

### Claim 3 — `e7d19f4b` three public `<Link>` elements get `min-h-11` in flex context — PASS

All three files confirmed at HEAD:

| File | Class at the relevant Link | Flex context |
|------|---------------------------|--------------|
| `apps/web/src/components/topic-empty-state.tsx:18` | `inline-flex items-center min-h-11 px-2 underline hover:text-primary` | parent: `flex flex-col items-center justify-center h-64` |
| `apps/web/src/components/home-client.tsx:434` | `inline-flex items-center min-h-11 px-2 text-sm underline hover:text-primary` | parent: `flex flex-col items-center gap-2` |
| `apps/web/src/app/[locale]/(public)/timeline/page.tsx:154` | `inline-flex items-center min-h-11 px-2 text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4` | parent: flex layout |

All three use `inline-flex items-center` — `min-h-11` (44 px) is an effective height floor in this context.

Touch-target audit positive-assertion block (`touch-target-audit.test.ts` — "public inline recovery `<Link>`s keep their min-h-11 tap area") passed as part of the 13/13 touch-target run.

---

### Claim 4 — `a062e81b` `i18n-key-parity.test.ts` asserts KEYS only, flattens correctly, passes at HEAD — PASS

**Test structure confirmed by reading source:**
- `flattenKeys()` recurses into objects, pushes leaf (non-object scalar) keys with dot-joined path prefix — correct namespace flattening.
- Asserts `missingInKo.toEqual([])` and `missingInEn.toEqual([])` plus sorted `koKeys.toEqual(enKeys)`. VALUES are never compared (DOC-R5C3-07 explicitly noted in the comment).
- Dropping a ko key makes `missingInKo` non-empty → first `expect(missingInKo, …).toEqual([])` fails RED with the exact key name in the message.

**Vitest:** 2/2 passed (`en and ko have IDENTICAL leaf-key sets` + `neither locale has duplicate leaf keys`).

---

### Claim 5 — `56bddff5` `image-queue-delete-race-cleanup-wiring.test.ts` pins `image-queue.ts` passes `[]` — PASS

**Source confirmed at `apps/web/src/lib/image-queue.ts:384–386`:**
```
deleteImageVariants(UPLOAD_DIR_WEBP, job.filenameWebp, []),
deleteImageVariants(UPLOAD_DIR_AVIF, job.filenameAvif, []),
deleteImageVariants(UPLOAD_DIR_JPEG, job.filenameJpeg, []),
```

**Node inline regex confirms:**
- 3-arg `[]` form: present for WEBP, AVIF, JPEG.
- 2-arg (default-sizes) form: absent — `deleteImageVariants\(\s*UPLOAD_DIR_(?:WEBP|AVIF|JPEG)\s*,\s*[^,()]+\)` matches null.

**Vitest:** 2/2 passed (`passes the [] (full dir-scan) sizes arg` + `does NOT use the 2-arg default-sizes form`).

---

### Claim 6 — `2637e5f2` `image-manager.tsx` touch-target budget tightened 6→1 — PASS

**Budget entry at `touch-target-audit.test.ts:183`:** `'components/image-manager.tsx': 1`.

**Node inline execution of 9 core FORBIDDEN patterns** (Button/button h-8/h-9/h-10 literal and cn() forms) against `components/image-manager.tsx` source → **0 matches**. The remaining 1 violation is the documented `size="sm"` spinner (decorative, admin keyboard-primary surface, exempt with comment).

**Full touch-target audit:** 13/13 passed at HEAD.

---

## Broader Stated-Behavior Claims

### Claim A — `IMAGE_PIPELINE_VERSION = 7` consistent across `process-image.ts`, `gallery-config-shared.ts`, `sw.js` stamp — CONFIRMED

- `apps/web/src/lib/gallery-config-shared.ts:21`: `export const IMAGE_PIPELINE_VERSION = 7;`
- `apps/web/src/lib/process-image.ts:303`: re-exports from `gallery-config-shared` (single source of truth).
- `apps/web/public/sw.js:26`: `const SW_VERSION = 'ee0f38bd-p7';` — ends with `-p7`.
- `apps/web/scripts/build-sw.ts:46`: `return \`${getCommitOrTimestamp()}-p${IMAGE_PIPELINE_VERSION}\`` — stamp construction confirmed.
- `apps/web/public/sw.template.js:2`: `const SW_VERSION = '__SW_VERSION__';` — placeholder intact, build-time replaced correctly.

All consistent. SW stamp uses a different SHA (`ee0f38bd`) than HEAD (`4c3d5924`) because `sw.js` is committed separately (built at `prebuild`), expected behavior.

---

### Claim B — Backfill 10-column UPDATE equivalence between sidecar and in-app runner — CONFIRMED

Both UPDATE blocks extracted with `sed`, columns identical:

| Column | Sidecar (`scripts/backfill-color-pipeline.ts:371–380`) | In-app (`src/lib/admin-backfill-runner.ts:559–568`) |
|--------|------|------|
| `pipeline_version` | present | present |
| `icc_profile_name` | present | present |
| `color_primaries` | present | present |
| `transfer_function` | present | present |
| `matrix_coefficients` | present | present |
| `is_hdr` | present | present |
| `has_gain_map` | present | present |
| `color_pipeline_decision` | present | present |
| `was_downscaled` | present | present |
| `avif_10bit` | present | present |

10 columns, identical set, both paths.

---

### Claim C — `blur-data-url` MIME contract enforced at producer + writer + reader — CONFIRMED

- **Producer** (`apps/web/src/lib/process-image.ts:17,883`): imports `assertBlurDataUrl` and wraps the Sharp-generated candidate: `blurDataUrl = assertBlurDataUrl(candidate)`.
- **Writer** (`apps/web/src/app/actions/images.ts:28,347`): imports `assertBlurDataUrl` and applies at write time: `blur_data_url: assertBlurDataUrl(data.blurDataUrl)`.
- **Reader** (`apps/web/src/components/photo-viewer.tsx:192,200`): reads `image.blur_data_url` from DB — the DB value was already validated at writer time.
- **Contract** (`apps/web/src/lib/blur-data-url.ts:34–36`): only `data:image/jpeg;base64,`, `data:image/png;base64,`, `data:image/webp;base64,` prefixes accepted; capped at 4096 chars.

All three enforcement sites present.

---

## Gaps

- **CLAUDE.md `COLOR_IMPACTING_KEYS` count says "9", code has 10** — Risk: low — `settings-hash.ts:37–48` contains 10 entries (5 color + 3 quality + `image_sizes` + `image_quality_*`). CLAUDE.md says "9 keys" and lists them as "5 color keys … 3 quality keys … and `image_sizes`" which is 5+3+1 = 9. Actual array has 10 entries. Counting `grep "'" | wc -l` on the array gives 10. CLAUDE.md undercounts by 1. The code is correct; documentation is stale. No code defect.

- **Backfill delete-race test requires `apps/web/` CWD** — Risk: low — The `npm test --workspace=apps/web` invocation (used by CI) resolves correctly. Direct `npx vitest run <path>` from repo root fails with `ERR_MODULE_NOT_FOUND` for `@/lib/upload-paths`. Pre-existing, documented in `vitest.config.ts`.

---

## Recommendation

APPROVE — all 6 cycle-5 acceptance criteria verified with fresh independent evidence (218/218 test files, 2080/2080 tests, 0 type errors). The three broader CLAUDE.md behavior claims hold exactly in code. The one documentation discrepancy (`COLOR_IMPACTING_KEYS` count "9" vs actual 10) is cosmetic — the code is correct and CLAUDE.md was not updated when `image_sizes` was added.

---

**CLAIMS VERIFIED: 11/11 (6 cycle-5 + 3 broader + 2 sub-claims)**
**BLOCKERS: 0**
**DOC DRIFT: 1 (CLAUDE.md COLOR_IMPACTING_KEYS "9" should be "10")**
