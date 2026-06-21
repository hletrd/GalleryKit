# Code Reviewer — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Angle:** Deep code-correctness sweep of the whole repo, with explicit re-examination of the Stripe paid-download removal blast radius (commits `6c5e0b61`..`47b1e21f`) that cycle-1 might have missed, plus a fresh-eyes pass over high-value libs the removal-focused cycle-1 review under-examined.

## NEW FINDINGS: 0

**Verdict: APPROVE.** No new correctness / security / data-loss / logic / edge-case / error-handling / invariant findings. The codebase remains converged; the paid-download removal is surgically clean and was already fully cleaned up by cycle-1 (HEAD advanced `47b1e21f` → `f63af3b9` with the 7 cycle-1 fix commits). Every removal-modified surviving source file was independently re-verified this cycle. Gates green at HEAD (typecheck app+scripts exit 0; 81/81 focused tests pass).

---

## What I checked (evidence)

### 1. Removal blast radius — every surviving modified source file re-verified line-by-line

The removal modified (not deleted) these source files. I read each diff against its parent and the current state:

| File | Change | Verdict |
|---|---|---|
| `lib/rate-limit.ts` (−59) | Entire `checkout*` helper block (`CHECKOUT_WINDOW_MS`/`MAX_REQUESTS`/`MAX_KEYS`, `checkoutRateLimit`, `pruneCheckoutRateLimit`, `preIncrementCheckoutAttempt`, `rollbackCheckoutAttempt`, `resetCheckoutRateLimitForTests`) removed coherently; docstring Pattern-2 example updated. No dangling export, no orphaned bounded-map. **CLEAN.** |
| `components/photo-viewer.tsx` (−108) | Buy button / checkout effect / `licensePrices`/`checkoutStatus` props / `ShoppingCart` import removed; download footer guard `&& (!image.license_tier || …)` removed → footer now `{downloadHref && (...)}`. Dropdown internals (labels/hrefs/structure, lines 927-974) **byte-identical** to pre-removal (verified via `git show 6c300402^`). **CLEAN.** |
| `components/info-bottom-sheet.tsx` (−2 net) | Same guard removal (`info-bottom-sheet.tsx:489`), symmetric with photo-viewer. **CLEAN.** |
| `components/bulk-edit-dialog.tsx` (−42) | `licenseMode`/`licenseValue` state, `LicenseTier`/`LICENSE_TIERS` imports, License-tier `<select>` JSX, and the `licenseField` TriState assembly removed. Input object no longer sends `licenseTier`. **CLEAN.** |
| `lib/bulk-edit-types.ts` (−4) | `LicenseTier` type + `LICENSE_TIERS` const removed; `BulkUpdateImagesInput` no longer has `licenseTier`. Single source of truth; typecheck-enforced. **CLEAN.** |
| `app/actions/images.ts` (−16) | `bulkUpdateImages` no longer destructures/validates/sets `licenseTier`; audit metadata `licenseTierMode` removed; `LICENSE_TIERS` import dropped. Empty-setClause edge case still guarded by `Object.keys(setClause).length > 0`. GPS-strip comment refreshed. **CLEAN.** |
| `lib/data.ts` (−2) | `license_tier: images.license_tier` removed from `adminSelectFields`. It was a non-PII PUBLIC field, so `publicSelectFields` (derived by PII-omit destructure) loses it automatically; net public field set otherwise unchanged. Privacy guards (`_PrivacySensitiveKeys`/`_SensitiveKeysInPublic`) still hold. **CLEAN.** |
| `lib/image-types.ts` (−2) | `license_tier?` optional field removed from `ImageDetail`. **CLEAN.** |
| `lib/gallery-config-shared.ts` / `gallery-config.ts` | `license_price_*` keys/defaults/validators/resolved field removed. All 15 remaining setting keys retain symmetric default+validator+resolver (sub-agent table). **CLEAN.** |
| `app/[locale]/(public)/p/[id]/page.tsx` (−13) | `searchParams` prop + `?checkout=success\|cancel` parsing removed; `licensePrices`/`checkoutStatus` props dropped from `<PhotoViewer>`. Only consumer was checkout redirect. **CLEAN.** |
| `g/[key]/page.tsx`, `s/[key]/page.tsx` (−1 each) | `licensePrices`/`checkoutStatus` wiring removed. **CLEAN.** |
| `app/actions.ts` (−1 net) | `LICENSE_TIERS` value-export + `LicenseTier` type-export removed; `BulkUpdateImagesInput`/`TriState` re-exports kept. **CLEAN.** |
| `app/api/admin/db/download/route.ts`, `app/api/search/semantic/route.ts`, `app/api/admin/lr/upload/route.ts` | **Comment-only** edits (stale `/api/checkout` cross-references refreshed). Functional logic byte-identical. Confirms cycle-1 debugger/code-reviewer. **CLEAN.** |
| `settings-client.tsx` (−56) | License Pricing card removed (admin UI). **CLEAN.** |

### 2. Dangling-reference sweep (whole repo, not just `src`)
`grep -rniE "license_tier|licensePrice|/api/checkout|/api/download/|stripe|entitlement"` across `*.ts/tsx/js/json/conf/sql` (excl. node_modules/.next/lock):
- **Live source: 0 hits.**
- nginx `default.conf`: 0 stale checkout/download/stripe locations.
- Only remaining hits are the **immutable historical migrations** `drizzle/0008_image_license_tier.sql`, `drizzle/0013_entitlements.sql`, and their `_journal.json` entries — these are CORRECT and REQUIRED: their hashes are recorded in `__drizzle_migrations`; deleting them would break the `runMigrations` post-condition assertion. Migration 0023 drops what 0008/0013 created. Proper lineage, not dead code.

### 3. Migration 0023 correctness (re-derived all paths)
The unguarded `ALTER TABLE images DROP COLUMN license_tier` in `0023_remove_paid_downloads.sql` is sound across every flow in `prepareLegacyDatabaseIfNeeded` → `runMigrations`:
- **journalCovered** (all hashes incl. 0023 present) → drizzle.migrate() no-op. Safe.
- **gallery tables + incomplete hashes** → `reconcileLegacySchema` drops the column (idempotent `dropColumnIfPresent`) + `baselineAllJournalMigrations` records 0023's hash → drizzle.migrate() sees 0023 baselined → unguarded `.sql` DROP **never runs**. Safe.
- **fresh DB** → reconcile (column never created) + baseline all → 0023 recorded → no-op. Safe.
- **normal incremental upgrade** (all prior hashes recorded, 0023 missing, column exists) → drizzle runs 0023 → drops the existing column. Safe.
The only path where the unguarded DROP executes is the one where the column provably exists. `reconcileLegacySchema` drops run LAST (after all CREATE/ALTER) and are INFORMATION_SCHEMA-guarded. Confirms cycle-1.

### 4. Fresh-eyes correctness audits on untouched / under-examined libs (parallel sub-agents)
- `lib/gallery-config-shared.ts` + `gallery-config.ts` — 15 keys, all symmetric (default+validator+resolver); numeric validators bounded correctly (no off-by-one); error-catch fallback mirrors normal resolver; **CLEAN**.
- `lib/settings-hash.ts` + `serve-upload.ts` — `COLOR_IMPACTING_KEYS` = exactly 9 keys; hash input deterministic (const-array `.map().join('|')`, not object-key iteration); `_ColorKeysAreSettingKeys` guard holds; ETag `W/"v${PIPELINE}-${mtimeMs}-${size}-${8charHash}"` no double-slice; **CLEAN**.
- `lib/image-queue.ts` — per-image claim cleanup correct (`affectedRows===0` → `deleteImageVariants(dir,fn,[])` full scan); hourly GC errors each `.catch`-swallowed (one failure doesn't abort the rest); bootstrap NOT-IN cap + FIFO eviction sound; `scheduleBootstrapRetry` bounded/idempotent/`unref`'d; embedding `void` IIFE both await-sites try-wrapped (safe, not a floating rejection — I read `image-queue.ts:434-478` directly to confirm); **CLEAN**.
- `lib/download-filename.ts` (+ test) — path-traversal-safe (`[^a-z0-9]+`→`-` strips `/ \ : ..`), C0/C1 + bidi + zero-width stripped, NFKD-normalized, 60-char slug cap (well under 255-byte FS limit), extension de-dotted/lowercased/fallback, ID digit-sanitized; the now-unconditional primary deliverable is robust; **CLEAN**.
- `lib/smart-collections.ts` — all values parameterized (Drizzle `eq/gt/like/inArray` + `sql` template binding); LIKE `%_\` escaped; empty AND/OR rejected at parse; operator switch exhaustive with loud `default` throw; depth-limited (MAX_DEPTH 4); no unbounded path (filter-only); **CLEAN**.
- `lib/data.ts` privacy guards — `publicSelectFields` derivation intact after `license_tier` removal; `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic`/`_MapSensitiveKeys` all hold; no public query reads `.license_tier`; schema/migration/select/guard layers synchronized; **CLEAN**.

### 5. Gate evidence at HEAD `f63af3b9`
- `npm run typecheck` (app via `tsconfig.typecheck.json` incl. `__tests__/` + scripts, 7 JS files) → **exit 0** (proves zero dangling types post-removal).
- Focused vitest (`free-download-contract`, `migrate-reconcile-coverage`, `privacy-fields`, `data-tag-names-sql`) → **81/81 passed**.

---

## Items deliberately NOT filed (with reasons)

- **Download dropdown label nuance** (photo-viewer trigger reads `downloadP3Jpeg`/`downloadJpeg` while items read `downloadSrgbJpeg`/`downloadP3Avif`): this block is **byte-identical before and after the removal** (pre-existing converged code through 7 runs, NOT removal blast radius). The trigger is a menu opener, not a download link; the JPEG derivative for a wide-gamut P3 source IS a P3 JPEG per the encoder matrix, and the item descriptions (`downloadSrgbJpegDesc` "Compatible with all devices" vs `downloadP3AvifDesc` "wider gamut") communicate the actual tradeoff. Not introduced/made-reachable by the removal → out of this cycle's removal-blast-radius scope, and not a defect. No finding.
- **Download footer now unconditional for every image**: this is the INTENDED behavior of the removal — GalleryKit is explicitly a free gallery; the `license_tier` gate that previously hid the JPEG download for paid images is correctly gone. No finding.
- **Stale client could send `licenseTier` to `bulkUpdateImages`**: server/client ship together (single Next standalone deploy, atomic); the type is the single source of truth and typecheck-enforced; an extra key on the wire is silently ignored (untyped object → no excess-property check at runtime). Deploy-atomicity, not a correctness defect. No finding.
- **image-queue embedding `void` IIFE lacks an outer `.catch()`**: both await sites are inside `try` blocks with nothing throwable between/after; currently safe. Same "stylistic-only, safe" disposition class cycle-1 used. No finding.
- Historical migrations `0008`/`0013` + journal entries: required immutable lineage (see §2). No finding.

## Do-not-re-file confirmations (re-verified this cycle)
- All cycle-1 FIND-R8C1-01..05 fixes are **landed and green** (free-download contract + migrate reconcile tripwire tests pass; orphaned `downloadPage` namespace gone — `grep -rn downloadPage src` = 0; dead `licensePrices` fixture line gone; stale comments refreshed).
- MED-R7C2-01 (histogram clip %) — REFUTED, not re-litigated.
- REJ-R7C3-01 (`indexSize`) — DISPROVED, `gps-exif-strip.ts` touched only −1 comment by removal; not re-litigated.
- ARCH-R7C2-01 + TE-R7C2-02 (Stripe webhook) — MOOT (route deleted); not re-litigated.
- RES-R7C6-01 (HEIC GPS-strip residual) — CLOSED (leak vector deleted); re-open criterion preserved.

---

**Bottom line:** The run-7 convergence holds. The paid-download removal is correct, complete, and was fully cleaned by cycle-1. Independent re-verification of every modified source file, the migration dual-path, the privacy invariant, and six high-value untouched libs surfaced **zero new actionable findings**. APPROVE.
