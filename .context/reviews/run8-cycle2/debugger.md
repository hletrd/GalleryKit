# Debugger Review — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Agent:** debugger
**Scope:** Latent bug / regression hunt over the paid-download-removal diff
(commits `6c300402..47b1e21f`) plus cycle-1 fixes (FIND-R8C1-01..05) applied
through HEAD `f63af3b9`.

---

## NEW FINDINGS: 0

No new latent bugs, dangling references, broken null guards, partially-removed
branches, or state machine gaps were found. The paid-download removal is
surgically clean.

---

## Evidence Summary — Files Diffed and Verified

The following files were diffed and each checked for: dangling variables,
unused imports, now-always-true/false conditions, broken null guards,
off-by-one in shifted indices, partially-removed branches, state machines
missing states.

### `apps/web/src/app/actions/images.ts`

- `licenseTier` destructuring, `isTriState(licenseTier)` validation guard,
  enum validation block, `setClause` assignment, and `logAuditEvent` metadata
  field all removed consistently.
- `logAuditEvent` call at former line ~1051 now correctly logs only the
  remaining fields: `ids`, `topicMode`, `titlePrefixMode`, `descriptionMode`,
  `addTagNames`, `removeTagNames`, `applyAltSuggested`. No dangling reference.
- Status: CLEAN

### `apps/web/src/lib/bulk-edit-types.ts`

- `LICENSE_TIERS` const, `LicenseTier` type, and `licenseTier: TriState<LicenseTier>`
  field removed from `BulkUpdateImagesInput`. No consumers remain.
- Status: CLEAN

### `apps/web/src/components/bulk-edit-dialog.tsx`

- `licenseMode`/`licenseValue` state, license UI section, `LicenseTier` import
  all removed. No remaining references.
- Status: CLEAN

### `apps/web/src/components/photo-viewer.tsx`

- Download guard simplified from
  `{downloadHref && (!image.license_tier || image.license_tier === 'none') && (`
  to `{downloadHref && (`. Correct: `image.license_tier` no longer exists in
  the type; `typecheck exit 0` (cycle-1 verifier) confirms.
- No `checkout` or `licenseTier` text anywhere in the file (grep count: 0).
- `free-download-contract.test.ts` FORBIDDEN list includes `'checkout'` and
  `'license_tier'` — the test passes, confirming both absent.
- Status: CLEAN

### `apps/web/src/components/info-bottom-sheet.tsx`

- Same download guard simplification as `photo-viewer.tsx`. Same analysis.
- Grep count for `checkout`/`Checkout`: 0.
- Status: CLEAN

### `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`

- `searchParams` parameter and checkout-status parsing block (~6 lines) removed.
- No remaining `searchParams` or `checkout` references.
- Status: CLEAN

### `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` and `s/[key]/page.tsx`

- `licensePrices={config.licensePrices}` prop pass removed from both.
- `config` no longer has `licensePrices` field (confirmed in `gallery-config.ts`).
- Status: CLEAN

### `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`

- `ShoppingCart` import and License Pricing card (~60 lines) removed.
- Status: CLEAN

### `apps/web/src/db/schema.ts`

- `license_tier` column removed from `images` table definition.
- Entire `entitlements` table definition removed.
- Drizzle schema no longer references either. `typecheck exit 0` confirms.
- Status: CLEAN

### `apps/web/src/lib/data.ts`

- `license_tier: images.license_tier` removed from `adminSelectFields`.
- `license_tier` was in `adminSelectFields` only (not `publicSelectFields`);
  `_SensitiveKeysInPublic` compile-time guard still compiles (`tsc exit 0`).
- `SENSITIVE_KEYS` fixture in `privacy-fields.test.ts` does not list
  `license_tier` (it was an admin-only field, not in the sensitive-omit list
  for `publicSelectFields`). The schema removal makes the fixture correct.
- Status: CLEAN

### `apps/web/src/lib/gallery-config-shared.ts`

- `license_price_editorial_cents`, `license_price_commercial_cents`,
  `license_price_rm_cents` removed from `GALLERY_SETTING_KEYS`, `DEFAULTS`,
  and `VALIDATORS`.
- `getSettingsMap()` in `gallery-config.ts` queries
  `WHERE key IN ([...GALLERY_SETTING_KEYS])`, so any stale
  `license_price_*_cents` rows already in `admin_settings` are simply ignored
  at read time. No data-read breakage.
- Status: CLEAN

### `apps/web/src/lib/gallery-config.ts`

- `licensePrices: Record<string, number>` removed from `GalleryConfig` interface.
- `licensePrices` object construction removed from both DB-path and fallback-path
  in `_getGalleryConfig`. No consumers remain (verified by grep returning empty
  across `src/`).
- Status: CLEAN

### `apps/web/src/lib/rate-limit.ts`

- `CHECKOUT_WINDOW_MS`, `CHECKOUT_MAX_REQUESTS`, `CHECKOUT_RATE_LIMIT_MAX_KEYS`,
  `checkoutRateLimit`, `pruneCheckoutRateLimit`, `preIncrementCheckoutAttempt`,
  `rollbackCheckoutAttempt`, `resetCheckoutRateLimitForTests` (~41 lines)
  removed.
- `check-public-route-rate-limit.test.ts` references only
  `preIncrementShareAttempt` and `preIncrementSemanticAttempt` — no checkout
  helper references remain.
- Status: CLEAN

### `apps/web/scripts/migrate.js`

- `dropTableIfPresent(connection, tableName)`: 2-parameter signature.
  Call site `dropTableIfPresent(connection, 'entitlements')` matches exactly.
- `dropColumnIfPresent(connection, dbName, tableName, columnName)`: 4-parameter
  signature. Call site `dropColumnIfPresent(connection, dbName, 'images',
  'license_tier')` matches exactly.
- Drop ordering: `entitlements` (has FK → `images.id`) dropped BEFORE
  `license_tier` column from `images`. FK is on the referencing table
  (`entitlements`), not on the column being dropped (`license_tier`), so there
  is no FK dependency blocking the column drop. Correct order.
- No `ensureForeignKey` call for `entitlements` exists — confirmed by grep.
  The `ensureForeignKey` section covers `images`, `image_tags`,
  `shared_group_images`, `topic_aliases`, `sessions`, `audit_log` only.
  Dropping `entitlements` after ensureForeignKey runs cannot recreate it.
- `migrate-reconcile-coverage.test.ts` DROP tripwire (FIND-R8C1-05): explicitly
  pins both `dropTableIfPresent(connection, 'entitlements')` and
  `dropColumnIfPresent(connection, dbName, 'images', 'license_tier')` in
  comment-stripped code. Test passes.
- Journal monotonicity: migration 0022 `when=1781687094232` → 0023
  `when=1782000000000` — strictly increasing.
- Status: CLEAN

### `apps/web/src/lib/process-image.ts` and `apps/web/src/lib/gps-exif-strip.ts`

- Comment-only changes ("paid-download deliverable" → "on-disk original").
  Functional logic byte-identical. (Previously confirmed by cycle-1 verifier
  and noted in cycle-1 aggregate as REJ-R7C3-01 — NOT re-filed.)
- Status: CLEAN

### API route comment-only files

- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/app/api/search/semantic/route.ts`
- Comment-only changes (removed references to `/api/checkout/[imageId]`).
  Functional logic unchanged.
- Status: CLEAN

### `apps/web/messages/en.json` and `apps/web/messages/ko.json`

- No `stripe`, `checkout`, `downloadPage`, `licenseTier`, or `licensePric`
  keys remain in either file (grep returned empty). Cycle-1 FIND-R8C1-01
  (orphaned i18n namespace removal) already handled this.
- Status: CLEAN

---

## DO-NOT-RE-FILE Confirmations

Per standing instruction, the following adjudicated items were NOT re-filed:

- **REJ-R7C3-01** (`gps-exif-strip.ts` indexSize): functional logic in
  `gps-exif-strip.ts` is byte-identical after the −2 comment-only edit.
  Confirmed by direct code inspection.
- **MED-R7C2-01** (histogram clip %): REFUTED in prior cycle. No evidence
  found to reopen.
- **NF-R7C5-01** (migrate baseline duplicate rows): REFUTED in prior cycle.
  No evidence found to reopen.

---

## Deferred Items (carry-forward, unchanged)

All items from `.context/plans/run8-cycle1/deferred.md` carry forward
unchanged. No new items added:

- DEF-C11-01, R7C1-CR-01..04, TE-R7C2-03..05, OBS-R7C2-02..07,
  INFO-R7C2-08/09 — unchanged.
- ARCH-R7C2-01 / TE-R7C2-02 — CLOSED/MOOT (confirmed in cycle-1 aggregate).
- RES-R7C6-01 — CLOSED (confirmed in cycle-1 aggregate).

---

## Verification Baseline

From cycle-1 verifier (HEAD `47b1e21f`, then cycle-1 fixes through `f63af3b9`):
- `tsc --noEmit exit 0` (typecheck:app)
- Vitest: all tests pass, 0 failed
- `next build exit 0` (38 routes)

No code changes made in this cycle. The baseline holds.
