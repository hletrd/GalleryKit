# Architect — Run-8 Cycle-1 Deep Review (HEAD 47b1e21f)

**Scope:** architectural correctness of the Stripe paid-download REMOVAL (commits 6c5e0b61..47b1e21f). Five focus axes: completeness, layering, migration architecture, systemic invariants, doc-code drift. Plus: which carried run-7 deferrals are now MOOT.

**Verdict:** The removal is architecturally **clean and complete**. `npm run typecheck` passes, the 6 directly-affected test suites pass (86/86), i18n key-parity passes, all 3 static lint gates pass. **Zero CRIT, zero HIGH, zero MED. Three LOW cosmetic/dead-code leftovers.** Several run-7 deferrals are now MOOT (target code deleted) and should be CLOSED by the planner.

**Method:** full deletion inventory (`git diff --diff-filter=D`), per-file diff of every changed source/test/config file, whole-word residual greps across `src/`, `messages/`, `CLAUDE.md`, both READMEs, `.env.local.example`, `drizzle/`; blocking typecheck (PASS); targeted `vitest run` of affected suites + i18n parity (PASS); the 3 lint scanners (PASS).

---

## Summary

The 27 deleted files (libs stripe/license-tiers/download-tokens/download-interstitial; routes webhook/checkout/download; sales action+2 pages; 16 tests) are gone with no dangling imports. Kept abstraction `download-filename.ts` verified still wired to the FREE path (`info-bottom-sheet.tsx`, `photo-viewer.tsx`), docstring clean. Config chain (validation→resolution→consumption) coherent: `GALLERY_SETTING_KEYS`, `DEFAULTS`, `VALIDATORS`, `GalleryConfig`, and the fallback block all dropped the 3 `license_price_*_cents` keys + `licensePrices` field symmetrically. `COLOR_IMPACTING_KEYS` correctly UNCHANGED at 9 (license keys never byte-impacting). Migration 0023 DDL present in BOTH the `.sql` AND `reconcileLegacySchema` (dual-path requirement met). Privacy guards intact. No advisory lock orphaned (checkout used in-memory rate-limit only, fully removed). **CLAUDE.md + both READMEs were already scrubbed in the removal commit** — the run-context premise that they "still extensively document" paid-download is FALSE at HEAD.

---

## Analysis (per focus axis)

### 1. COMPLETENESS — clean
- Deleted, no dangling refs: `src/lib/{stripe,license-tiers,download-tokens,download-interstitial}.ts`, `src/app/api/{stripe/webhook,checkout/[imageId],download/[imageId]}/route.ts`, `src/app/actions/sales.ts`, `src/app/[locale]/admin/(protected)/sales/{page,sales-client}.tsx`, 16 tests. `src/app/api/{checkout,download}` dirs GONE.
- Kept abstraction wired to FREE path: `download-filename.ts buildDownloadFilename()` imported/called by `info-bottom-sheet.tsx:25,162,165` + `photo-viewer.tsx:37,184,187`; `download-filename.test.ts` passes; docstring clean. NOT orphaned.
- Dead enums removed: `LICENSE_TIERS`/`LicenseTier` + `licenseTier` field gone from `bulk-edit-types.ts`.
- Barrel cleaned: `actions.ts` no longer exports `LICENSE_TIERS`/`LicenseTier`; `sales` was never barrel-exported.
- Consumers cleaned: `images.ts` (bulkUpdate destructure/validation/setClause/audit), `bulk-edit-dialog.tsx` (all UI/state/imports), `settings-client.tsx` (License Pricing card + `ShoppingCart`), `photo-viewer.tsx` (Buy button + checkout fetch + post-redirect toast + `checkoutStatus`/`licensePrices` props + `ShoppingCart`), `info-bottom-sheet.tsx:489`, `p/[id]/page.tsx` (`searchParams`/`checkoutStatus`).
- Intended behavior change confirmed: `info-bottom-sheet.tsx:489` `downloadHref && (!image.license_tier || ...==='none')` → `downloadHref &&`. Free download UNCONDITIONAL.
- DB: `images.license_tier` + `entitlements` (2 indexes + FK) removed from `schema.ts`; not in `data.ts adminSelectFields` (confirms it was PUBLIC, never a `_PrivacySensitiveKey`); removed from `image-types.ts`.
- Env/SQL/SW: `.env.local.example` dropped STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET/LOG_PLAINTEXT_DOWNLOAD_TOKENS; no STRIPE_/LICENSE_/DOWNLOAD_TOKEN env refs in `src`. Historical `drizzle/0008`+`0013` `.sql` correctly retained (immutable journal history). `public/sw.js` = `47b1e21f-p7` (matches HEAD).

### 2. LAYERING — coherent
- `gallery-config-shared.ts`: no `license_price_*_cents` in keys/defaults/validators. No validated-but-unresolved or resolved-but-undefaulted key.
- `gallery-config.ts`: `licensePrices` removed from `GalleryConfig`, main resolver, AND catch-block fallback (all 3 sites).
- `settings-hash.ts`: `COLOR_IMPACTING_KEYS` = exactly 9 (5 color + 3 quality + image_sizes); docstring says 9; `_ColorKeysAreSettingKeys` guard holds. License prices were correctly NEVER in this set. `settings-hash.test.ts` lost exactly the 2 `licensePrices:` fixture lines — count is right.

### 3. MIGRATION ARCHITECTURE — correct
- `0023_remove_paid_downloads.sql`: `DROP TABLE IF EXISTS entitlements` + `ALTER TABLE images DROP COLUMN license_tier` (unguarded column drop is acceptable — runs only on fresh DBs via drizzle.migrate() where 0008/0013 created the targets; legacy DBs are baselined, not run; documented in file header).
- `_journal.json` idx 23 `when=1782000000000` strictly > prior max (1781687094232) → drizzle will NOT silently skip.
- `migrate.js`: `dropColumnIfPresent` (INFORMATION_SCHEMA-guarded) + `dropTableIfPresent` helpers added, CALLED at END of `reconcileLegacySchema` (`:627-628`) after all ADDs; prior `ensureColumn(license_tier)` + `ensureTable(entitlements)` replaced with comments. Dual-path requirement (MIGRATION-VERIFY) SATISFIED.
- Post-condition false-fail check (PASS): `getAllJournalMigrations` hash = SHA256(0023 .sql content) (`migrate.js:144-160`); matches drizzle's recorded hash on fresh-apply, and `baselineAllJournalMigrations` inserts it on legacy path. `runMigrations` post-condition matches either way. No false-fail. 0023 follows the proven 0000-0022 format.

### 4. INVARIANTS — all hold
- Advisory locks: registry unchanged (`LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, image-processing, `LOCK_COLOR_PIPELINE_BACKFILL`). Paid-download never owned a lock (checkout used in-memory `checkoutRateLimit`, removed). NO orphan.
- Privacy guards: `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic`/`_omit*` intact; `license_tier` was PUBLIC (never in omit list) so removing from `adminSelectFields` is symmetric. `privacy-fields.test.ts SENSITIVE_KEYS` closed contract, passes. 3 guards intact.
- Process-local-state inventory: removing `checkoutRateLimit` + helpers SHRINKS the per-process set; CLAUDE.md runtime-topology line updated same commit (`OG/checkout/share/search/semantic` → `OG/share/search/semantic`). Doc matches code.

### 5. DOC-CODE DRIFT — already handled in commit 961a7f1f (premise refuted)
- CLAUDE.md: deleted `entitlements` table bullet (incl. async_payment_succeeded/card-only-pin/plan-316 paragraph); de-referenced GPS-strip prose ("paid-download route streams" → "retained original"); fixed rate-limit bucket list. Whole-word grep `entitle|stripe|sales|async_payment|checkout|paid|license.tier|download.?token|interstitial|webhook|refund|US-P54|plan-316` over CLAUDE.md → ZERO hits (lone `admin_tokens` is unrelated LR-PAT, still present).
- README.md (root): removed Paid Downloads feature bullet + Payments tech-stack row.
- apps/web/README.md: removed the entire 37-line "## Paid downloads (Stripe — US-P54)" section.

---

## Root Cause
N/A — removal-verification review, not a bug hunt. Removal executed correctly across code, schema, dual-path migration, tests, i18n parity, env, and docs.

---

## Findings (3 LOW, cosmetic)

### LOW-R8C1-01 — dead `licensePrices` property in test fixture
- Where: `apps/web/src/__tests__/serve-upload-settings-debounce.test.ts:34`.
- What: `FAKE_CONFIG` still carries `licensePrices: { editorial: 0, commercial: 0, rm: 0 }`, a property no longer on `GalleryConfig`.
- Why it doesn't break: bare object literal (not annotated `: GalleryConfig`), consumed via `vi.fn(async () => FAKE_CONFIG)` mock; excess property structurally ignored (no excess-property check). Typecheck passes; suite passes. Pure dead-fixture leftover — sibling `settings-hash.test.ts` had its 2 fixture lines removed, this one was missed.
- Fix: delete line 34.
- Confidence: HIGH.

### LOW-R8C1-02 — orphaned `downloadPage` i18n namespace + semantically-wrong copy
- Where: `apps/web/messages/en.json:63-69` and `messages/ko.json:63-69` (`downloadPage`: title/description/descriptionNoTitle/button/expiryNote).
- What: fed the deleted `download-interstitial.ts`. No `src` file references `downloadPage`/`expiryNote` anymore. Copy now WRONG for the free path: `expiryNote` = "valid for 24 hours after purchase and can be used once" / ko "구매 후 24시간... 한 번만" describes the deleted single-use paid token, not the kept unconditional free download.
- Why LOW not parity bug: key set identical in en/ko → `i18n-key-parity.test.ts` PASSES (verified). Dead-but-parity-safe, not a gate failure.
- Fix: delete the `downloadPage` namespace from BOTH en.json and ko.json (keep symmetric).
- Confidence: HIGH.

### LOW-R8C1-03 — stale comment cross-references to deleted routes (informational)
- Where: `apps/web/src/lib/process-image.ts:1108` ("paid on the wide-gamut path"); assorted test docstrings (`lr-upload-hdr-gate.test.ts`, `strip-gps-from-original.test.ts`, `images-action-gps-toggle-wiring.test.ts`) still say "paid-download route streams the original".
- What: comments only; the privacy property they describe (strip GPS from on-disk original) is REAL and still correct — the original is now streamed by the FREE download path, so the rationale survives, only the route name is stale.
- Fix: optional comment refresh. No behavioral impact. Note `process-image.ts:1547` "paid" is the "paid a cost" idiom, NOT the feature — verify wording before editing.
- Confidence: HIGH. Lowest signal; bundle with any future touch.

---

## Carried run-7 deferrals now MOOT (target code DELETED → planner should CLOSE)

| Deferral | Target | Status |
|---|---|---|
| ARCH-R7C2-01 | `api/stripe/webhook/route.ts:88` `charge.refunded` gap | MOOT — webhook route DELETED. CLOSE. |
| TE-R7C2-02 | `stripe-webhook-source.test.ts` 0% behavioral | MOOT — route + test file both DELETED. CLOSE. |
| RES-R7C6-01 (HEIC GPS-strip fall-through) | `process-image.ts:1628-1633` + `gps-exif-strip.ts` | REMAINS but RE-SCOPED — strip logic intact and still runs; leaked-file consumer changed from deleted paid route to FREE download route. Privacy substance UNCHANGED (free download streams the same original). Keep deferred; update wording "paid-download original" → "free-download original". NOT moot. |

NOT moot (unrelated, carry forward): DEF-C11-01, R7C1-CR-01..04, TE-R7C2-03 (semantic route — ALIVE), TE-R7C2-04 (audit — ALIVE), TE-R7C2-05 (embeddings action — ALIVE), OBS-R7C2-02..07, INFO-R7C2-08/09.

Note: of TE-R7C2-02..05, ONLY TE-R7C2-02 referenced a deleted test; 03/04/05 target live semantic/audit/embeddings code → NOT moot.

---

## Trade-offs (LOW-R8C1-02 disposition)

| Option | Pros | Cons |
|---|---|---|
| Delete namespace from both locale files | Removes dead keys + wrong copy; matches removal's own full-scrub standard | Tiny risk a future free interstitial wants these keys (unlikely; free download is a direct anchor) |
| Keep but fix `expiryNote` copy | Preserves keys for a possible future page | Leaves 4 other unused keys; churn with no consumer |
| Leave as-is | Zero effort | Dead namespace + misleading copy persists; weakens docs-match-code invariant |

Recommended: delete.

---

## Single highest-signal architectural item

The migration dual-path is correct AND the doc scrub was already done — so the most load-bearing remaining item is a confirmation, not a fix: migration 0023's drop lives in BOTH `0023_remove_paid_downloads.sql` AND `reconcileLegacySchema` (`migrate.js:627-628`), `_journal.json when=1782000000000` is strictly monotonic, and the `runMigrations` post-condition (SHA256(file) ∈ recorded hashes) will not false-fail on either fresh-apply or legacy-baseline. This is the one place an incomplete removal could have silently corrupted a production deploy (a legacy DB keeping a dangling `entitlements` FK or `license_tier` column), and it is handled. Everything else is cosmetic.

---

## References
- apps/web/drizzle/0023_remove_paid_downloads.sql:17-19 — table + column drop
- apps/web/drizzle/meta/_journal.json idx 23 when=1782000000000 — strictly > 1781687094232
- apps/web/scripts/migrate.js:210-228 — dropColumnIfPresent / dropTableIfPresent helpers
- apps/web/scripts/migrate.js:621-628 — drops appended to end of reconcileLegacySchema
- apps/web/scripts/migrate.js:144-160 — getAllJournalMigrations hash = SHA256(.sql content)
- apps/web/scripts/migrate.js:719-734 — runMigrations post-condition (no false-fail)
- apps/web/src/lib/gallery-config-shared.ts:25-66,91-125,146-191 — keys/defaults/validators (no license)
- apps/web/src/lib/gallery-config.ts:48-91,103-206 — GalleryConfig + resolver + fallback (no licensePrices)
- apps/web/src/lib/settings-hash.ts:42-54 — COLOR_IMPACTING_KEYS = 9, guard :63-66
- apps/web/src/lib/download-filename.ts:71 — kept helper, wired to free path
- apps/web/src/components/info-bottom-sheet.tsx:489 — unconditional free download
- apps/web/src/components/photo-viewer.tsx:174-187 — free Download button retained
- apps/web/src/lib/rate-limit.ts (diff) — checkoutRateLimit + helpers removed
- apps/web/src/lib/advisory-locks.ts:19-44 — lock registry unchanged, no orphan
- apps/web/src/lib/data.ts:262 (diff) — license_tier removed from adminSelectFields
- apps/web/src/__tests__/serve-upload-settings-debounce.test.ts:34 — LOW-R8C1-01 dead licensePrices
- apps/web/messages/en.json:63-69, messages/ko.json:63-69 — LOW-R8C1-02 orphaned downloadPage
- apps/web/src/lib/process-image.ts:1108 — LOW-R8C1-03 stale "paid" comment
- CLAUDE.md (diff) — paid-download prose already scrubbed (premise refuted)
- README.md / apps/web/README.md (diff) — paid-download docs already removed
