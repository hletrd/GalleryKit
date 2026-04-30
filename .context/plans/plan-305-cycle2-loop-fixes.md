# plan-305 — Cycle 2/100 RPF loop fixes (HEAD `8c4069c`)

**Aggregate:** `.context/reviews/_aggregate-cycle2.md`
**Run context:** review-plan-fix loop, 2026-04-25, cycle 2/100

## Goals

Address all 7 MEDIUM and 4 LOW findings from cycle-2 reviewer fan-out.
Fine-grained commits per finding. Each commit GPG-signed, semantic
gitmoji format. Deploy on success.

## Tasks

### T1 — AGG2-M01 / SR2-MED-01 — Blur prefix validation in photo-viewer

**File:** `apps/web/src/components/photo-viewer.tsx:348-356`

**Change:** Replace `image.blur_data_url ? {...} : undefined` with a
prefix-validating helper. Reject any non-`data:image/` value.

**Acceptance:**
- Add helper `isSafeBlurDataUrl(value): value is string` that asserts the prefix.
- The conditional uses `isSafeBlurDataUrl(image.blur_data_url)` instead of truthy check.
- Add a Vitest unit test for the helper covering: valid jpeg data URI, valid png data URI, empty string, raw URL, garbage string, null, undefined.

**Commit message:** `fix(photo-viewer): 🔒 validate blur_data_url prefix before inline style`

### T2 — AGG2-L03 / SR2-LOW-01 — Server-side write barrier for blur_data_url

**File:** `apps/web/src/app/actions/images.ts` (insert site), and a new helper file.

**Change:** Before the INSERT at line 301, validate `data.blurDataUrl`
shape AND length (cap at 4 KB). If invalid, set to null but continue
the upload.

**Acceptance:**
- New helper `assertBlurDataUrl(value): string | null` in `apps/web/src/lib/process-image.ts` (or a new file).
- The upload action calls it; failure path logs a warning, does NOT abort the upload.
- Unit test covering valid, oversized, and malformed inputs.

**Commit message:** `fix(images): 🔒 cap and validate blur_data_url at upload write site`

### T3 — AGG2-M02 — Touch-target audit per-file violation count

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts`

**Change:** Replace EXEMPTIONS Set with a per-file `KNOWN_VIOLATIONS`
Map. Each entry maps a file path to a count. Audit fails if a file
exceeds its known count.

**Acceptance:**
- Existing exempt files have their current violation counts recorded.
- Adding a new violation in an exempt file (e.g., a new `<Button size="sm">` in `image-manager.tsx`) trips the audit.
- Removing all violations from an exempt file is fine — the test passes either way.
- Comments retained from the original EXEMPTIONS list.

**Commit message:** `test(a11y): ✅ enforce per-file touch-target violation counts`

### T4 — AGG2-M03 — Touch-target audit FORBIDDEN regex coverage

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:90-103`

**Change:** Extend FORBIDDEN with:
- HTML `<button className="...h-[89]...">` regex
- `<Button size="icon">` regex (without an h-11 override)
- `cn()` composite literal-string detection

**Acceptance:**
- Existing tests still pass.
- A test fixture (in-memory string) with HTML `<button className="h-8">` trips a NEW pattern check.
- A fixture with `<Button size="icon">` trips a check.

**Commit message:** `test(a11y): ✅ widen touch-target audit to HTML buttons and size=icon`

### T5 — AGG2-M04 — Runtime tag_names non-null test

**File:** New file `apps/web/src/__tests__/data-tag-names-runtime.test.ts`

**Change:** Add a test that uses the existing test-DB or a Drizzle mock
to insert an image with two tags and assert `getImagesLite()` returns
`tag_names: 'TagA,TagB'` (non-null, comma-joined, distinct, ordered).

**Acceptance:**
- Test is self-contained (sets up + tears down its data).
- Asserts comma-separated list with the expected order.
- Asserts that an image with no tags returns `tag_names: null`.
- If the existing test infra requires a live DB, the test is skipped when DB unavailable (NOT a hard failure).

**Commit message:** `test(data): ✅ assert getImagesLite tag_names runtime aggregation`

### T6 — AGG2-M05 — Document the SQL shape rationale

**Files:**
- `CLAUDE.md` "Performance Optimizations" or "Database Indexes" section
- `apps/web/src/lib/data.ts:309-323` docblock (extend)

**Change:** Add a paragraph to CLAUDE.md describing why the masonry
listing uses LEFT JOIN + GROUP BY (not a correlated subquery) and
where the contract is locked.

**Acceptance:**
- CLAUDE.md update mentions the data.ts docblock and the fixture test.
- The data.ts docblock cites the cycle-1 NF-3 finding ID.

**Commit message:** `docs(claude): 📝 record tag_names SQL shape rationale`

### T7 — AGG2-M06 — Extract tag_names helper

**File:** `apps/web/src/lib/data.ts`

**Change:** Add `selectImagesWithTagNames(baseSelect)` helper or a
shared `tagNamesAgg` constant. Refactor the three call sites to use it.

**Acceptance:**
- Three call sites use the shared expression.
- The fixture test still passes (verifies LEFT JOIN + GROUP BY).
- No runtime behavior change.

**Commit message:** `refactor(data): 🧹 share tag_names aggregation across listing queries`

### T8 — AGG2-M07 — Document touch-target audit in CLAUDE.md

**File:** `CLAUDE.md` "Lint Gates" or "Testing" section

**Change:** Add a paragraph describing the touch-target audit:
- What it covers
- Where exemptions live
- How to add a new file (raise to h-11 or add EXEMPTIONS entry / count)

**Commit message:** `docs(claude): 📝 document touch-target audit alongside lint gates`

### T9 — AGG2-M08 — Move blur background to motion.div

**File:** `apps/web/src/components/photo-viewer.tsx:348-380`

**Change:** Move the `style={image.blur_data_url ? {...} : undefined}` from the outer `<div>` to the inner `motion.div` so the blur fades with the image.

**Acceptance:**
- Outer container retains `skeleton-shimmer` class for the no-blur fallback.
- Inner motion.div receives the inline style.
- The fade-in animation applies to BOTH the image AND its blur.
- Visual smoke test: navigate between two photos, verify no instant blur swap.

**Commit message:** `fix(photo-viewer): 🎨 fade blur preview alongside image transition`

### T10 — AGG2-L01 — Tighten SQL shape fixture regex

**File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts`

**Change:** Replace the greedy function-extraction regex with line-anchored markers. Use `^export async function NAME[\s\S]*?^}\n` (multi-line) or split-based extraction.

**Acceptance:**
- Test still passes against current data.ts.
- Refactored regex is documented.
- A new defensive assertion: extracted body contains the function name.

**Commit message:** `test(data): ✅ tighten getImagesLite fixture regex anchoring`

### T11 — AGG2-L02 — Assert getImagesLite excludes blur_data_url

**File:** `apps/web/src/__tests__/data-tag-names-sql.test.ts` (extend) OR `apps/web/src/__tests__/data-listing-payload.test.ts` (new)

**Change:** Add a fixture-style assertion that `data.ts` `publicSelectFields` block omits `blur_data_url` AND that `getImagesLite()`/`getImagesLitePage()`/`getAdminImagesLite()` do NOT spread `blur_data_url` into their select shapes.

**Acceptance:**
- Test reads source, asserts the line `// blur_data_url excluded` is present.
- Test asserts none of the three lite functions reference `images.blur_data_url`.

**Commit message:** `test(data): ✅ lock blur_data_url exclusion in listing select fields`

## Deferred (recorded, not scheduled this cycle)

| ID | File+region | Severity | Reason | Re-open exit criterion |
|---|---|---|---|---|
| AGG2-L04 / D2-LOW-01 | MySQL `group_concat_max_len` default 1024 bytes | Low | Truncation only on >50-tag images; current usage well under cap. | Any image hits >40 tags OR a regression report shows truncated `tag_names`. |
| CR2-LOW-02 | `data.ts:342, 396, 452` cap discrepancy 100/101 | Low | Intentional (page lookahead +1); harmless. | If a future refactor introduces a cap mismatch unrelated to lookahead. |
| CR2-LOW-05 | `LightboxTrigger` accepts no className | Low | No active need for caller-side override. | If a caller needs a different size. |
| CR2-INFO-01 / PR2-MED-03 | Composite indexes missing id tiebreaker | Medium | No measurable impact at current scale. | When ties on (capture_date, created_at) >100 rows in production. |
| PR2-LOW-02 | Shared-group blur SSR payload (50 KB max) | Low | Bounded by 100-image cap. | If shared groups lift the 100-image cap. |
| PR2-LOW-03 | Load-more rootMargin 200px combined with GROUP BY | Low | Cumulative cost negligible at current scale. | When gallery exceeds 5k images. |
| A2-LOW-01 | `_PerfSensitiveKeys` guard for blur in listings | Low | Convention currently enforced via comment + test. | If a future field is added without the discipline. |
| A2-LOW-02 | `lint:touch-target` script vs Vitest | Low | Vitest path works. | If audit needs to run independently of unit tests. |
| DS2-LOW-01 | CLAUDE.md image-pipeline blur consumer reference | Low | The pipeline doc mentions blur generation; consumer reference is polish. | Doc-cleanup cycle. |
| DS2-LOW-02 | F-/NF- lineage doc centralization | Low | Aggregate review serves as lineage. | Future archeology need. |
| DSGN2-LOW-01 | Photo container 40vh on landscape mobile | Low | No clipping; minor layout shift only. | Visual regression on real devices. |
| DSGN2-LOW-02 | Site title min-h wraps long nav_title | Low | Depends on user config. | Per-site complaint. |
| DSGN2-LOW-03 | Lightbox close/fullscreen 40 px | Low | EXEMPTION rationale needs refinement; primary fix scheduled in cycle 3. | Cycle 3 lightbox audit expansion. |
| D2-LOW-02 | `blur_data_url = ''` empty-string render | Low | Falsy check returns undefined; safe. | None — verified safe. |
| D2-LOW-03 | Audit walker symlink loop | Low | No symlinks in components dir. | If symlinks added. |
| CR2-INFO-02..03 | GROUP_CONCAT default separator + style spread | Info | Documentation entries. | None. |
| A2-INFO-01 | `getImage` / `getSharedGroup` ad-hoc spread | Info | Optional cleanup. | Future refactor. |

All deferrals satisfy the deferral rule:
- Citation: file + line where applicable.
- Severity preserved (no downgrade).
- Reason: scope, scale, or convention/test already mitigates.
- Exit criterion: explicit, falsifiable signal.

No security/correctness/data-loss findings deferred.

## Quality gates (must pass after each commit)

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run typecheck --workspace=apps/web` (if available)
- `npm run build --workspace=apps/web` (final check before deploy)
- `npm run test:e2e --workspace=apps/web` (final check before deploy)

## Deploy

After commit + push and all gates green: `npm run deploy`.
