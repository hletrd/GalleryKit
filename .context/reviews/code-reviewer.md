# Code-Reviewer Review — Run-8 Cycle-3 (HEAD `ada92ba5`)

**Reviewer:** code-reviewer agent
**Scope:** Code-quality (logic, SOLID, maintainability, error handling, state-consistency) of the ~20 commits landed today (run-7 c1 + run-8 c2), plus a broad sweep of server actions, lib utilities, and components.
**Method:** Read every changed file; validated behavior from source (not comments); independently re-checked all sub-agent claims; ran the relevant test suites.

## Verdict: APPROVE

No CRITICAL or HIGH severity issues found at HIGH confidence. The run-8 cycle-2 fixes (AGG-R8-01..13) are **correct, complete, and regression-free** at current HEAD. All 153 tests across the touched-file areas pass (touch-target, og-sanitize×2, color-detection, backfill-fatal-counters, migrate-reconcile-coverage, sw-template-contract, home-metadata, detection-failure, blur-wiring, privacy, tag-names-sql).

The findings below are all LOW severity — test-coverage gaps and documented-limitation notes. None block the cycle.

---

## Verification of the run-8 c2 fixes (all CONFIRMED correct)

| Item | File | Verdict |
|---|---|---|
| AGG-R8-02 home og:image → per-photo OG card | `(public)/page.tsx:112-119` | ✅ Correct. Matches the established `/p/[id]/page.tsx:96` sibling pattern (same `absoluteImageUrl('/api/og/photo/${id}')`). Test `home-metadata-title.test.ts` pins URL shape + 1200×630 + twitter mirror. |
| AGG-R8-03 image-manager checkbox 44px + raw-checkbox audit | `image-manager.tsx:418,444`, `touch-target-audit.test.ts` | ✅ Correct. Both labels `min-h-11 min-w-11`. Confirmed exactly 2 raw checkboxes in src, both fixed. New `scanRawCheckboxes` windowed scan works (66 audit tests pass). |
| AGG-R8-04 active tag-chip count contrast | `tag-filter.tsx:92-110` | ✅ Correct. `currentTags.includes(tag.slug)` gates `text-primary-foreground/90` vs `text-muted-foreground`. |
| AGG-R8-05 SW HEAD probe 300ms bound | `sw.template.js:230`, `sw.js:230` | ✅ Correct. `AbortSignal.timeout(300)` throws → caught at line 245 → falls through to stale-serve. Present in built `sw.js`. |
| AGG-R8-06 NCLX code-2 no longer erases ICC | `color-detection.ts:381-386`, `process-image.ts:662` | ✅ Correct & complete. Per-field `!== undefined` guards preserve ICC values for unspecified NCLX fields. `isHdr` derivation (line 389) preserved in all cases. No delivery-byte impact. Strict improvement for admin audit (primaries upgrades 'unknown'→real CIE value). |
| AGG-R8-07 load-more unmount guard | `load-more.tsx` | ✅ Correct. `mountedRef` added to both the success-path (`|| !mountedRef.current`) and finally-block guards; cleanup effect flips it. |
| AGG-R8-08 home-client 0-width CSS guard | `home-client.tsx:276-283` | ✅ Correct & complete. `hasValidDims` guards both aspect-ratio and `containIntrinsicSize` denominators; `estimatedCardWidth` is independently guaranteed > 0 (line 196-202). 1:1 fallback is valid CSS. |
| AGG-R8-09 backfill width re-validation | `admin-backfill-runner.ts:430-436` | ✅ Correct. `!Number.isFinite || <= 0` → classified `encode-failed` (idempotent, no version bump, retries next run). Mirrors upload-path guard. |
| AGG-R8-10 mixed-run counter partition + index tripwire | `admin-backfill-runner-fatal-counters.test.ts`, `migrate-reconcile-coverage.test.ts` | ✅ Correct. Counter partition is mutually exclusive (a row that throws in the version-bump UPDATE bubbles out of `reprocessOne`'s catch-less try/finally to the queue catch → `errors++`, never `processed++`). Index tripwire is a valuable addition. |
| AGG-R8-13 shared `sanitizeForOg` across both OG routes | `og-sanitize.ts`, `og/route.tsx:82-88`, `og/photo/[id]/route.tsx:81-83` | ✅ Correct. Both routes import the shared module; uses global `stripUnicodeFormatting` + C0 strip; `?? ''` handles null return. |

---

## Findings

### COR-1 [LOW, confidence HIGH] — No test pins the home OG route's actual `sanitizeForOg` CALLSITES

**File:** `apps/web/src/app/api/og/route.tsx:82,83,88` (the new consumer); tests at `src/__tests__/og-sanitize.test.ts` + `sanitize-for-og-global.test.ts`.

**Problem:** The AGG-R8-13 fix wires the home/site OG route to call `sanitizeForOg` on `topicLabel`, `siteTitle`, and each tag. The shared function is well-tested, and `sanitize-for-og-global.test.ts` structurally greps the **photo** route + the **p/[id] page** for the import/strip — but **neither test asserts that `api/og/route.tsx` (the home route) actually invokes `sanitizeForOg` on its rendered strings.** The whole point of AGG-R8-13 was that the home route previously rendered RAW; a future regression that drops the three `sanitizeForOg(...)` wraps (e.g. a careless refactor of the tag-map chain on line 88) would reintroduce the exact symmetry gap with a green suite.

**Failure scenario:** A refactor inlines `topicRecord.label` without the wrap; bidi/zero-width chars (if a validator is ever loosened) render raw into the home OG card again. No test fails.

**Fix:** Add a source-grep case to `sanitize-for-og-global.test.ts` for `src/app/api/og/route.tsx` asserting it imports from `@/lib/og-sanitize` AND that the three rendered values (`topicLabel`/`siteTitle`/tag list) flow through `sanitizeForOg` — mirroring the existing per-photo-route case. (Source-presence is the established pattern here; behavioral mocking of `ImageResponse` is overkill.)

**Note:** This is a defense-in-depth surface (inputs are admin-controlled and `containsUnicodeFormatting`-rejected at write time; Satori renders to image, no script sink), so live risk is negligible — hence LOW.

---

### COR-2 [LOW, confidence MEDIUM] — `migrate-reconcile-coverage` index/column tripwires match comments, not just code

**File:** `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:79` (column) and `:143` (index).

**Problem:** Both tripwires use bare `MIGRATE_SRC.includes(name)` / `MIGRATE_SRC.includes(c)` substring matches over the entire `migrate.js` source. An index or column name that appears ONLY in a comment in `migrate.js` (e.g. `// idx_foo: dropped in v9`, or a column named in a docblock but absent from any `ensureColumn`/`ensureIndex`/`CREATE TABLE` statement) would satisfy the assertion without the reconcile actually applying it. The test self-describes as "a SOURCE tripwire (name presence, not structural equivalence)," so this is a documented limitation — but the gap is real: it would let exactly the silent-drop failure class it targets slip through if the name happens to be mentioned in prose.

**Failure scenario:** Author adds migration `0022` with `CREATE INDEX idx_new ...`, forgets the `ensureIndex` mirror, but writes a `// idx_new handled by drizzle` comment in migrate.js. Existing-DB upgrade silently drops the index; test passes.

**Fix (optional):** Strip `//` and `/* */` comments from `MIGRATE_SRC` before the `.includes` checks, or assert against an `ensureIndex(`/`INDEX \`?name\`` token rather than a bare substring. Low priority — the authoritative check remains the fresh-DB init + information_schema diff.

---

### COR-3 [LOW, confidence MEDIUM] — `scanRawCheckboxes` wrapper detection only recognizes `<label>`, may false-positive on `<div>`-wrapped checkboxes

**File:** `apps/web/src/__tests__/touch-target-audit.test.ts:624-629`.

**Problem:** The new windowed scan accepts a checkbox's 44px floor only when a `<label className="…min-h-11…">` appears within 4 lines above. If a future raw checkbox is wrapped in a 44px `<div>` / `<span>` / Radix `Slot` (a perfectly valid tap-area wrapper) instead of a `<label>`, the scan will flag it as a violation and FAIL the build — a false positive that forces the author to either restructure to a `<label>` or add a `KNOWN_VIOLATIONS` exemption. The current 2 checkboxes both use `<label>`, so no live failure, but the audit will over-fire on the next non-label wrapper.

**Failure scenario:** A new accessible toggle wraps `<input type="checkbox">` in `<div className="flex min-h-11 min-w-11 items-center">`; the audit fails despite being compliant.

**Fix (optional):** Broaden the wrapper regex from `/<label\b/` to `/<(?:label|div|span)\b/` (the windowed `CHECKBOX_44_OK` check on the same line already constrains it to a sized wrapper), or document the `<label>`-wrapper requirement as an intentional repo convention in the test comment so the next author adds an exemption knowingly.

---

### COR-4 [LOW, confidence HIGH] — Unlocalized error string in `retryFailedImage`

**File:** `apps/web/src/app/actions/images.ts:1085` — `return { error: 'Invalid image ID' };`

**Problem:** Every other error return in this action uses `t('...')`; this integer-validation guard returns a raw English string. i18n inconsistency.

**Failure scenario:** A non-English admin triggers the guard (only reachable via a malformed client call — the UI passes real IDs, and the value never contains user text) and sees English while sibling errors are localized.

**Fix:** Replace with an existing localized key (e.g. `t('invalidInput')`). Trivial.

---

## Sub-agent claims I investigated and REJECTED (false positives)

I dispatched two Explore agents over server-actions and lib/components and independently re-verified every High/Medium claim from source. The following were **incorrect** and are NOT findings:

- **rate-limit.ts:176 "off-by-one in X-Forwarded-For client index"** — REJECTED. `clientIndex = validParts.length - hopCount - 1` is **correct**. XFF is ordered `[client, proxy1, …, proxyN]` left-to-right with the rightmost closest to the server. With `[client, cdn, nginx]` and `hopCount=2`, the trusted suffix is the last 2 (`cdn, nginx`); the client is at index `3-2-1=0` = `validParts[0]`. The `-1` is required. Verified against the inline doc and the math.
- **icc-extractor.ts:78 "off-by-one truncates last char (`strLen-1`)"** — REJECTED. The ICC `desc` (textDescription) ASCII string is NUL-terminated and `declaredLength` includes the trailing NUL; `subarray(strStart, strStart + (strLen-1))` correctly drops the NUL. Intentional and correct.
- **icc-extractor.ts:76 "strLen can go negative if dataSize < 12"** — REJECTED. Line 70 guards `dataSize < 12` and `break`s before line 76 is reached, so `dataSize - 12 >= 0` always holds.
- **color-detection.ts:225 / gain-map-detection.ts NaN propagation in box-size arithmetic** — REJECTED. All box sizes are read via `readUInt32BE` / `readBigUInt64BE`, which return finite uints by Node semantics — never NaN. No `parseInt` on binary fields.
- Other Explore "findings" (public.ts rollback null, sharing.ts `!` assertion, db-actions BigInt compare, topics.ts tuple unwrap) — these are the repo's established defensive patterns on synchronous `BoundedMap`/mysql2 tuple shapes; correct as written, no smoking bug.

---

## Final sweep (commonly-missed classes) — clean

- **Off-by-one:** og-route tag `.slice(0, 20)`, keyset cursor `id > cursor`, batch `length < BATCH_SIZE` termination — all correct.
- **null/undefined:** `og-sanitize` `?? ''`; `latestImage?.title`; `rows[0]?.cnt`; runner `claimConn` null-check — all guarded.
- **async ordering:** runner lock acquire/`try`/`finally` adjacency (no throw window); load-more mountedRef; fire-and-forget `.catch()` on `runBackfill` — correct.
- **resource cleanup:** `releaseBackfillLock`/`releaseImageProcessingClaim` in `finally` with `.catch(()=>undefined)`; lock connection handoff nulls `lockConn` to avoid double-release — correct.
- **type coercion:** `Number.isFinite(poolLimit)` NaN guard in `resolveBackfillConcurrency`; `Number(process.env.ADMIN_BACKFILL_CONCURRENCY) || 1` — correct.

**No relevant file was skipped.** All 12 priority files named in the assignment were read in full and validated.
