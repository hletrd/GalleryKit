# Code Reviewer — Run-8 Cycle-1 Deep Review

**Repo:** GalleryKit @ HEAD `47b1e21f`
**Reviewer angle:** code-reviewer (spec compliance + correctness + dangling refs + logic/edge/error-handling)
**Scope this cycle:** the complete removal of the Stripe paid-download feature (commits `6c5e0b61`, `6c300402`, `e172c4fc`, `961a7f1f`, `3f687985`, `47b1e21f`) — 60 changed files, 97 insertions / 5183 deletions.
**Method:** read EVERY changed file's diff (not a sample); ran the blocking gates (`typecheck`, 3 security lint scripts, 6 targeted test suites) as evidence; did exhaustive cross-file symbol sweeps + a programmatic i18n-namespace orphan analysis.

---

## Verdict: APPROVE (with one LOW cleanliness finding)

The Stripe removal is **exceptionally clean**. Every dangling-reference vector I could enumerate (types, re-exports, JSX, server-action registry, i18n keys, rate-limit helpers, config schema, privacy guards, schema, migration, ops config, SW) is clear. The free-download path is intact, null-safe, and now unconditional as intended. The migration is robust across fresh / incremental / partial-DB paths. All gates green.

**NEW_FINDINGS: 1** (1 LOW).

---

## Evidence collected (all green)

| Gate | Result |
|---|---|
| `npm run typecheck` (typecheck:app + typecheck:scripts) | **PASS** (exit 0) — proves zero dangling TYPE references to any deleted symbol |
| `lint:api-auth` | **PASS** |
| `lint:action-origin` | **PASS** |
| `lint:public-route-rate-limit` | **PASS** (semantic route still uses rate-limit helper) |
| Tests: bulk-update-images, settings-hash, check-public-route-rate-limit, lr-upload-hdr-gate, touch-target-audit, data-tag-names | **6 files / 113 tests PASS** |
| i18n key parity en.json vs ko.json | **784 == 784, zero asymmetry** |

---

## Priority-1 — Dangling reference / type / re-export sweep: CLEAN

Exhaustive sweep of live `src` (excluding `__tests__`) for `stripe|license_?tier|licensetier|entitlement|checkout|download-?token|download-?interstitial|sales|paid-download`:

- **Module imports of deleted files** (`stripe`, `license-tiers`, `download-tokens`, `download-interstitial`, `actions/sales`): **NONE** (live + tests).
- **Route-path references** (`api/checkout`, `api/download`, `api/stripe`, `/sales`): **NONE**.
- **`LicenseTier` / `LICENSE_TIERS` / `licenseTier`**: **NONE** (deleted from `bulk-edit-types.ts`, `actions.ts` re-export, `bulk-edit-dialog.tsx`, `actions/images.ts`).
- **`licensePrices` / `license_price*`**: **NONE** (deleted from `gallery-config-shared.ts` keys/defaults/validators, `gallery-config.ts` interface + both resolution paths, all 3 page props, `PhotoViewer` prop, `settings-hash.test.ts` fixtures).
- **Checkout rate-limit symbols** (`checkoutRateLimit`, `preIncrementCheckoutAttempt`, `rollbackCheckoutAttempt`, `resetCheckoutRateLimitForTests`, `CHECKOUT_*`, `pruneCheckoutRateLimit`): **NONE**.
- **`STRIPE_*` env vars** (`STRIPE_SECRET`, `STRIPE_WEBHOOK`, `process.env.STRIPE`): **NONE**.
- **`stripe` npm dep**: removed from `package.json`; zero matches in lockfile.
- **server-action registry (`actions.ts`)**: no `sales`/`refund`/`createCheckout`/`getEntitlement` exports; the `LICENSE_TIERS` value export and `LicenseTier` type export removed; remaining `BulkUpdateImagesInput`/`TriState` exports intact.
- **Test files importing deleted modules** (would fail collection): **NONE**.
- The ONLY raw-grep hit in live src was a *historical comment* in `bulk-edit-dialog.tsx:287` ("Precedent: C4-RPF-09 (sales load-error region)") — a documentation breadcrumb, NOT a live reference. Not a defect.

`typecheck` passing is the authoritative confirmation that no type/re-export/JSX/dynamic dangling reference survives.

---

## Priority-2 — Free direct-download path (KEPT, made unconditional): CORRECT & NULL-SAFE

`photo-viewer.tsx` and `info-bottom-sheet.tsx` both dropped the `(!image.license_tier || image.license_tier === 'none')` guard, so the footer now renders whenever `downloadHref` is truthy. Verified end-to-end:

- `downloadHref = image?.filename_jpeg ? imageUrl('/uploads/jpeg/${image.filename_jpeg}') : null` (`photo-viewer.tsx:176`) — null when `filename_jpeg` is null.
- `avifDownloadHref = image?.filename_avif ? ... : null` (`:177`) — null-safe.
- Footer gated on `downloadHref` truthiness (`:927`); gamut-aware AVIF branch additionally requires `isWideGamutSource && avifDownloadHref` (`:929`) — both must be truthy, so a wide-gamut source missing its AVIF derivative cleanly falls through to the JPEG-only `<Button>` branch (`:963`).
- Download filenames `downloadNameJpeg` / `downloadNameAvif` / `downloadExt` are all defined (`:174-188`) and each `download=` attr falls back to `photo-${image.id}.${ext}` when the title slugifies empty (`:944,954,967`). No dangling rename.
- `isWideGamutPrimary(image?.color_primaries)` (`:189`) and `isP3Pipeline(image.color_pipeline_decision)` (`:934`) are unchanged client-safe predicates.

The free-download path was pre-existing code; the removal only deleted the paid guard wrapping it. No regression.

**GPS-strip rationale correctly preserved:** the on-disk original is NEVER served publicly — `serve-upload.ts:15` whitelists only `{jpeg, webp, avif}` and excludes `original/`. After the paid-route deletion the original is used only for backfill re-encode + at-rest GPS scrub. `stripGpsFromOriginal` calls in `actions/images.ts:314` and `lr/upload/route.ts:324` are unchanged; the docstring updates (process-image.ts, gps-exif-strip.ts, lr/upload, images.ts) correctly swap "paid-download deliverable" → "stored original / retained original." Defense-at-rest still justified. No behavioral change.

---

## Priority-3 — Migration 0023 + reconcileLegacySchema: ROBUST across all paths

`drizzle/0023_remove_paid_downloads.sql`:
```sql
DROP TABLE IF EXISTS `entitlements`;
ALTER TABLE `images` DROP COLUMN `license_tier`;
```
- **`_journal.json` monotonic:** entry 23 `when = 1782000000000 > 1781687094232` (entry 22). ✓ (drizzle's MAX(created_at) cursor will not skip it.)
- **Ordering / idempotency in `reconcileLegacySchema` (migrate.js):**
  - The `ensureColumn('license_tier', ...)` ADD (was line ~370) and the `entitlements` `ensureTable` CREATE (was ~575) are REMOVED and replaced with explanatory comments — so reconcile no longer re-creates what 0023 drops.
  - New idempotent helpers `dropColumnIfPresent` (guards on `columnInfo` — MySQL 8.0 has no `DROP COLUMN IF EXISTS`) and `dropTableIfPresent` (`DROP TABLE IF EXISTS`).
  - The two DROPs run **LAST** in `reconcileLegacySchema` (after all ADDs/indexes/FKs, `migrate.js:626-628`), so reconcile converges to the post-0023 state. Correct ordering: a dropped column is never re-added below.
  - The base `images` CREATE TABLE (`migrate.js:317`) has **no inline `license_tier`** — it was only ever added via the now-removed `ensureColumn`. ✓
- **Fresh-apply path (the prompt's specific concern):** a fresh DB goes through `prepareLegacyDatabaseIfNeeded` → `reconcileLegacySchema` (creates `images` WITHOUT `license_tier`; `dropColumnIfPresent` no-ops on the absent column) → `baselineAllJournalMigrations` records ALL journal hashes incl. 0008 AND 0023 → `drizzle.migrate()` is a verified no-op. **The 0023 `.sql` ALTER never executes on a fresh DB**, so the "0008 adds it / 0023 drops it" sequencing is moot on this path. ✓
- **Incremental prod DB at 0022:** `journalCovered` is false (0023 hash missing) → reconcile drops column+table → baseline records 0023 → `runMigrations` (`migrate.js:775-776` ordering: prepare BEFORE runMigrations) → `drizzle.migrate()` sees 0023 already recorded → skips its `.sql`. No double-drop. The `runMigrations` post-condition then confirms every hash present. ✓
- **Even the (never-used) raw drizzle 0001→0023 sequence is safe:** 0008 ADDs `license_tier`, 0023 DROPs it — both targets exist when each runs. ✓
- `baselineAllJournalMigrations` is retry-safe: filters `!haveHashes.has(m.hash)` so a retry inserts only missing hashes, never duplicates (re-confirms the run-7 NF-R7C5-01 refutation).

Migration zero-data-loss note in the `.sql` header (entitlements had 0 rows, every image `license_tier='none'`) documents the production safety check.

---

## Priority-4 — data.ts / image-types / gallery-config / schema / privacy guards: NO HALF-REMOVAL

- `db/schema.ts`: `images.license_tier` column removed; `entitlements` table definition removed (incl. its FK + indexes). No now-unused imports (`boolean`/`sql`/`timestamp` still used by other tables — verified indirectly via passing typecheck).
- `data.ts`: `license_tier` removed from `adminSelectFields`. `publicSelectFields` is DERIVED from `adminSelectFields`, so it's automatically clean. `license_tier` was a PUBLIC field (per its comment), so it correctly does NOT appear in `_PrivacySensitiveKeys` / `SENSITIVE_KEYS` — no asymmetric remnant (verified zero matches in `data.ts` + `privacy-fields.test.ts`).
- `image-types.ts`: `license_tier?` removed from `ImageDetail`.
- `bulk-edit-types.ts`: `LICENSE_TIERS`, `LicenseTier`, and `licenseTier` field removed from `BulkUpdateImagesInput`.
- `gallery-config*.ts`: keys/defaults/validators/interface/both-resolution-paths all clean; `validatedNumber` helper still used by 5 other settings (not orphaned).
- `actions/images.ts bulkUpdateImages`: `licenseTier` removed from destructure, tri-state validation, enum validation block, `setClause`, and the audit-log metadata. Consistent end-to-end.

No "omitted from one object but still in a guard" remnant found anywhere.

---

## Priority-5 — Partially-edited files (logic/edge/error-handling): NO INTRODUCED BUGS

- **`process-image.ts`**: COMMENT-ONLY (docstring "paid-download endpoint streams" → "original is retained"). Zero logic change.
- **`gps-exif-strip.ts`**: COMMENT-ONLY (docstring "paid-download deliverable" → "stored original"). Zero logic change. (Also re-confirms REJ-R7C3-01 indexSize remains a non-issue — untouched.)
- **`api/search/semantic/route.ts`**: COMMENT-ONLY (two docstring refs to `/api/checkout` reworded). The `runtime='nodejs'` pin and the malformed-embedding `.filter()` skip are untouched (TE-R7C2-03 deferred item unchanged).
- **`api/admin/lr/upload/route.ts`**: COMMENT-ONLY (runtime-pin docstring + GPS-strip rationale reworded). The GPS-strip call + HDR gate logic unchanged.
- **`api/admin/db/download/route.ts`**: COMMENT-ONLY (runtime-pin docstring).
- **`rate-limit.ts`**: pure removal of the checkout rate-limit block (constants, map, 4 helpers) + 2 docstring updates. The Pattern-2 docstring correctly drops the checkout example while keeping the semantic example. No remaining checkout symbol; the surviving share/OG/semantic helpers are untouched.
- **`bulk-edit-dialog.tsx`**: consistent removal of the `licenseMode`/`licenseValue` state, the `licenseField` tri-state build, the input field in `BulkUpdateImagesInput`, and the entire License Tier `<Select>` JSX block. Imports trimmed (`LicenseTier`, `LICENSE_TIERS`).
- **`settings-client.tsx`**: `ShoppingCart` import + the entire License Pricing `<Card>` removed; no orphaned handler.
- **Pages (`p/[id]`, `g/[key]`, `s/[key]`)**: `licensePrices` prop removed from all three; `p/[id]` additionally removed `searchParams` param + the `checkout` query parsing (verified zero `searchParams`/`checkoutStatus`/`checkoutValue` residual in `p/[id]/page.tsx`). `g/[key]` retains `searchParams` for its own `photoId` nav (legitimate, unrelated).

---

## Priority-6 — Final commonly-missed sweep

- **i18n key parity:** en.json == ko.json (784 each, zero asymmetry). All `stripe`/`license`/`checkout`/`buy`/`entitlement`/`sales` keys removed from BOTH locales. No live `t('stripe...'|'settings.license...'|'imageManager.bulkLicense...'|'imageManager.licenseTier...'|'viewer.buy|checkout...')` reference remains (would have rendered a literal key string at runtime — none found). Generic leaf names (`save`, `title`, `noChanges`, etc.) that the diff appeared to "delete" still exist under live namespaces (`imageManager`, `settings`) — they were only removed from the deleted `stripe`/`sales`/`settings.license*` sub-objects.
- **Ops config:** no `checkout`/`/api/download`/`api/stripe`/`stripe`/`license` references in `nginx/`, `docker-compose.yml`, `.env.local.example`, `Dockerfile`.
- **Service Worker:** committed HEAD `sw.js` carries `SW_VERSION = '961a7f1f-p7'` (stamped by `3f687985` after the removal); no paid refs in `sw.template.js` / `sw.js`. (Note: my running `npm run typecheck` triggered the `prebuild` → `build-sw.ts` hook, which re-stamped my WORKING-TREE `sw.js` to `47b1e21f-p7`. That is a build artifact from my own commands — the tree was clean at session start, only `.context/reviews/run7-cycle2/` was untracked — NOT a committed defect. It actually demonstrates the SW versioning re-stamps to current HEAD correctly.)

---

## FINDINGS

### LOW-R8C1-01 — Orphaned `downloadPage` i18n namespace (dead translation data) [confidence HIGH, confirmed]

**Where:** `apps/web/messages/en.json` and `apps/web/messages/ko.json`, namespace `downloadPage` (5 keys: `title`, `description`, `descriptionNoTitle`, `button`, `expiryNote`).

**Problem:** A programmatic sweep of ALL 35 i18n namespaces against live `src` (matching `namespace:'x'`, `getTranslations('x')`, `useTranslations('x')`, `'x.'` prefixes, and bare `'x'` args) found that `downloadPage` is the **single namespace with zero live consumers**. It was consumed exclusively by the now-DELETED paid-download route — confirmed: `git show 6c5e0b61^:apps/web/src/app/api/download/[imageId]/route.ts` line 227 was `getTranslations({ locale, namespace: 'downloadPage' })`. The route is gone (this was the paid post-purchase download landing page), so the namespace is dead translation data in both locales.

**Why it's a problem (and why it's only LOW):** This is exactly the "half-removed remnant" class the cycle was asked to catch — the removal deleted the consumer but left the i18n payload. It is LOW because: it is symmetric across en/ko (so it does NOT fail the i18n key-parity gate), it is never rendered (no consumer), and it causes no compile or runtime error. It is dead weight in the translation bundle and a latent confusion source (a future dev may think a download-landing page exists).

**Failure scenario:** None at runtime. The only "failure" is maintenance: a contributor greps for `downloadPage`, finds 10 i18n keys with no code, and wastes time reconstructing whether a page was supposed to exist. The keys also ship in the client i18n bundle unused (negligible bytes).

**Fix (operator-confirmed deletion):** Remove the `downloadPage` object from BOTH `messages/en.json` and `messages/ko.json`. Per the repo's i18n-parity convention the deletion must be symmetric (drop from both, keeping 784→779 == 779). No code change needed. Per CLAUDE.md destructive-action policy, since this edits tracked files, it should land as an explicit deliberate cleanup commit (e.g. `chore(i18n): 🧹 drop orphaned downloadPage namespace after paid-download removal`).

**Note:** the FREE download UI uses inline `viewer.download*` keys (in the `viewer` namespace — still live), NOT `downloadPage`. So removing `downloadPage` does not touch the free-download path.

---

## Items explicitly NOT re-filed (per deferred register / no new evidence)

- MED-R7C2-01 (histogram clip %, REFUTED) — not re-filed.
- REJ-R7C3-01 (`gps-exif-strip.ts` indexSize, DISPROVED) — `gps-exif-strip.ts` is comment-only this cycle; untouched; not re-filed.
- NCLX matrix/transfer map pin class (EXHAUSTED) — not re-filed.
- All carried run-7 deferred LOWs (R7C1-CR-01..04, ARCH-R7C2-01, TE-R7C2-02..05, OBS-* etc.): ARCH-R7C2-01 / TE-R7C2-02 (Stripe webhook gaps) and the checkout rate-limit observation are now **moot** — the entire Stripe surface is deleted; I am NOT re-filing them as "fixed" (the deletion closed them) but flagging that the deferred register should mark these Stripe-specific entries RESOLVED-BY-REMOVAL next planning pass. The non-Stripe deferred LOWs (DEF-C11-01 search input height, image-queue NOT IN, analytics XX, data-timeline bounds, audit-log tests) are unchanged and not re-raised here.
- RES-R7C6-01 (HEIC anomaly GPS-strip fall-through): `gps-exif-strip.ts` + `process-image.ts` GPS paths are comment-only this cycle (logic untouched), so the residual carries forward unchanged with no new reachability evidence. Not escalated.

---

## Summary

- **Files reviewed:** 60 (every changed file in the removal range; full diff read for all 21 modified live-src files + migrate.js + migration .sql + journal; symbol-swept the whole tree).
- **NEW_FINDINGS: 1** — LOW-R8C1-01 (orphaned `downloadPage` i18n namespace).
- **CRITICAL: 0 | HIGH: 0 | MEDIUM: 0 | LOW: 1**
- **Recommendation: APPROVE.** The Stripe paid-download removal is a model surgical deletion: typecheck + 3 security lint gates + 113 targeted tests all green, zero dangling references across every vector, free-download path intact and null-safe, migration robust on fresh/incremental/partial-DB paths. The single LOW is dead i18n data with no runtime impact.

**Positive observations:**
- Migration design is excellent — idempotent drop helpers, drops run LAST, fresh-DB path bypasses the raw `.sql` via reconcile+baseline, and the `.sql` header documents the zero-data-loss precondition. This is the safest possible way to drop a column+table in this repo's bespoke migrator.
- Comment hygiene is unusually thorough — every docstring that referenced the paid-download endpoint (process-image, gps-exif-strip, lr/upload, images.ts, rate-limit Pattern-2 doc, runtime-pin docs) was updated to reflect the new "retained original" reality rather than left stale.
- The free-download guard removal was applied symmetrically to BOTH consumers (photo-viewer + info-bottom-sheet), avoiding the "fix one sibling, miss the next" trap this repo has hit before.
- i18n removal kept en/ko in perfect parity, and generic leaf-key names were correctly preserved under their live namespaces (the deletion surgically targeted only the paid sub-objects).
