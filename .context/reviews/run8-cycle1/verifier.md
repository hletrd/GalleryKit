# Verifier Report — Run-8 Cycle-1

**HEAD:** 47b1e21f  
**Scope:** All blocking gates + Stripe paid-download removal consistency (commits 6c5e0b61..47b1e21f)  
**Run date:** 2026-06-21  
**Baseline:** Run-7 2240 tests → Run-8 2028 tests (2024 passed / 4 skipped / 0 failed / 223 files / 2 skipped)

---

## Verdict

**Status: PASS**  
**Confidence: high**  
**Blockers: 0**

---

## Evidence

| Check | Result | Command | Output |
|-------|--------|---------|--------|
| ESLint | PASS | `npm run lint --workspace=apps/web` | exit 0, no errors |
| lint:api-auth | PASS | `npm run lint:api-auth --workspace=apps/web` | exit 0, 2 routes checked (db/download, lr/upload) |
| lint:action-origin | PASS | `npm run lint:action-origin --workspace=apps/web` | exit 0, 44 exports scanned (6 exempt-commented, 38 OK) |
| lint:public-route-rate-limit | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web` | exit 0, 6 public route files checked |
| Typecheck | PASS | `npm run typecheck --workspace=apps/web` | exit 0 (typecheck:app + typecheck:scripts + check:js-scripts; 7 JS scripts checked) |
| Tests | PASS | `npm test --workspace=apps/web` | 2024 passed / 4 skipped / 0 failed / 221 passed + 2 skipped (223 files) |
| Build | PASS | `npm run build --workspace=apps/web` | exit 0, 38 routes, 0 ENOENT warnings |
| npm audit | PASS (known) | `npm audit --omit=dev` | 0 crit / 0 high / 2 moderate (postcss via next, build-time-only) — unchanged from run-7 |

---

## Acceptance Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | ESLint passes (exit 0) | VERIFIED | exit 0, no output |
| 2 | lint:api-auth passes with route count | VERIFIED | exit 0; 2 admin routes checked (db/download, lr/upload) |
| 3 | lint:action-origin passes with export count | VERIFIED | exit 0; 44 exports (38 OK + 6 exempt-commented skips) |
| 4 | lint:public-route-rate-limit passes | VERIFIED | exit 0; 6 public route files |
| 5 | typecheck passes (exit 0) | VERIFIED | exit 0; route typegen + tsc + 7 JS scripts |
| 6 | Tests: 2024 passed / 4 skipped / 0 failed / 223 files | VERIFIED | Exactly matches — 221 passed + 2 skipped files |
| 7 | The 4 skips are ONLY clip-weight-gated suites | VERIFIED | All 4 skipped tests are from `clip-offline-load.test.ts` (2 tests) and `clip-semantic-integration.test.ts` (2 tests); `describe.skip` in both files is conditional on `SEEDED`/`RUN` env vars; no other file has `describe.skip` outside clip |
| 8 | Build exits 0 with route count | VERIFIED | exit 0; 38 routes listed (no sales/checkout/stripe/download/entitlement routes) |
| 9 | Build has no new ENOENT warnings | VERIFIED | `grep "ENOENT\|No such file"` count = 0; run-7's 3 dev-fixture warnings are gone (the files those traced to may have been removed with the paid-download deletion) |
| 10 | npm audit: 0 crit/high, ≤2 moderate | VERIFIED | 2 moderate (postcss/next); stripe removal did not add new vulnerabilities; stripe pulled no transitive vulns |
| 11 | IMAGE_PIPELINE_VERSION = 7 | VERIFIED | `gallery-config-shared.ts:21`: `export const IMAGE_PIPELINE_VERSION = 7;` |
| 12 | COLOR_IMPACTING_KEYS count = 9 | VERIFIED | `settings-hash.ts:42-54`: array has exactly 9 entries: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` |
| 13 | No live imports of deleted modules | VERIFIED | `grep` over `src/` for `@/lib/stripe`, `@/lib/license-tiers`, `@/lib/download-tokens`, `@/lib/download-interstitial`, `actions/sales` — zero results outside test files; `node_modules/stripe` absent in both `apps/web/node_modules` and root `node_modules` |
| 14 | Migration 0023 present with `when=1782000000000` | VERIFIED | `_journal.json` entry idx=23, tag=`0023_remove_paid_downloads`, when=1782000000000; max(when) = 1782000000000 > prior max 1781687094232 — monotonically correct |
| 15 | `migrate.js reconcileLegacySchema` drops entitlements + license_tier | VERIFIED | `migrate.js:627-628`: `await dropTableIfPresent(connection, 'entitlements')` and `await dropColumnIfPresent(connection, dbName, 'images', 'license_tier')` |
| 16 | Free-download anchors render without payment gate | VERIFIED | `photo-viewer.tsx:176-177,927-969`: `downloadHref` = `/uploads/jpeg/{filename}`, `avifDownloadHref` = `/uploads/avif/{filename}`; rendered unconditionally within `{downloadHref && (…)}` guard (no `isPaid`/`isUnlocked`/`entitlement` check present) |
| 17 | Stripe dep gone from `apps/web/package.json` | VERIFIED | `grep "stripe" package.json` = no output; Python parse confirms neither `dependencies` nor `devDependencies` contain any stripe key |
| 18 | Stripe gone from package-lock.json | VERIFIED | `grep -c "stripe" package-lock.json` = 0 (root lock); no `apps/web/package-lock.json` (monorepo uses root lock) |
| 19 | `db/schema.ts` has no entitlements/license_tier | VERIFIED | zero matches |
| 20 | `data.ts` has no entitlements/license_tier | VERIFIED | zero matches |
| 21 | `apps/web/src/app/actions.ts` has no sales/stripe/checkout refs | VERIFIED | zero matches |

---

## Removal Consistency Check (commits 6c5e0b61..47b1e21f)

The removal spans 5 commits in order:

1. `6c300402` — strip paid UI + license_tier wiring, keep free download
2. `e172c4fc` — drop entitlements + images.license_tier (migration 0023 SQL + journal)
3. `961a7f1f` — drop stripe dep, paid i18n keys, docs + stale comments
4. `3f687985` — refresh SW_VERSION stamp after removal
5. `47b1e21f` — fix reconcileLegacySchema to not create entitlements/license_tier

**Consistency observations:**

- SQL migration (`0023_remove_paid_downloads.sql`): `DROP TABLE IF EXISTS entitlements` + `ALTER TABLE images DROP COLUMN license_tier` — correct.
- Journal `when=1782000000000` is strictly > prior max `1781687094232` — monotonically correct.
- `reconcileLegacySchema` (commit 47b1e21f fix): no longer creates `entitlements` table or `license_tier` column (`migrate.js:370,596` carry comments explaining they are NOT re-created; `:627-628` DROP them). This is the correct direction: a legacy baseline must remove what the new state no longer has.
- `schema.ts`: no `entitlements` table, no `license_tier` column — consistent.
- `photo-viewer.tsx`: download anchors point directly at `/uploads/jpeg/` and `/uploads/avif/` with no payment gate, `downloadHref` computed purely from `filename_jpeg` (`:176`).
- `rate-limit.ts`: no paid-download / checkout / stripe references — clean.
- `image-types.ts` / `bulk-edit-types.ts`: no `license_tier` / `entitlement` fields — clean.
- `@/lib/download-filename` import (`photo-viewer.tsx:37`) is retained and valid — it is a general filename utility, not a paid-download-specific module; confirmed it is unrelated to the stripe removal.
- Stripe absent from `node_modules` (both web and root), `package.json`, and `package-lock.json`. The 2 moderate audit findings (postcss/next) are build-time-only and identical to run-7 — stripe's removal did not introduce or expose new vulnerabilities.
- Route table (38 routes) contains no `/sales`, `/checkout`, `/stripe`, `/download`, or `/entitlement` routes.
- DEFERRED items from run-7 (`ARCH-R7C2-01` Stripe `charge.refunded` gap, `TE-R7C2-02` Stripe webhook behavioral coverage) are now moot — the entire Stripe integration is removed. These carry-forward entries are superseded and should be dropped from the next deferred register.

---

## Gaps

None blocking. One housekeeping note:

- **Deferred items ARCH-R7C2-01 and TE-R7C2-02** referenced Stripe webhook behavior. Both are now moot with the full removal and should be dropped from the deferred register rather than carried forward.

---

## Recommendation

**APPROVE**

All 8 gates pass with fresh evidence. Test counts match expected (2024/4/0, 223 files). The 4 skips are exclusively clip-weight-gated suites. The paid-download removal is internally consistent across schema, migration journal, reconcileLegacySchema, package.json/lock, node_modules, UI components, and route table. No new audit vulnerabilities introduced.
