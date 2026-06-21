# Debugger — Run-8 Cycle-1 Deep Review (HEAD 47b1e21f)

**Scope:** latent bugs / failure modes / regressions introduced by the Stripe paid-download
removal (commits `6c5e0b61..47b1e21f`), with emphasis on MODIFIED (not deleted) files.

**Verdict summary:** 0 CRIT, 0 HIGH, 0 MED, 0 LOW confirmed bugs. All checks clean.
No re-filed items. Three previously-open deferred items are now CLOSED/MOOT/MITIGATED.

---

## PRIMARY CHECK: `license_tier` INSERT/UPDATE mismatch

**Verdict: NEGATIVE — no mismatch.**

Every surviving INSERT site was read in full:

| File | INSERT object | `license_tier` present? |
|------|--------------|------------------------|
| `apps/web/src/app/actions/images.ts:333-379` | `insertValues` (upload action) | NO |
| `apps/web/src/app/api/admin/lr/upload/route.ts:343-393` | `insertValues` (LR plugin upload) | NO |

Grep across all of `apps/web/src/` for `license_tier`, `licenseTier`, `entitlements`,
`download_token`, `paid_download`, `stripe`, `Stripe`, `checkout`, `STRIPE` (excluding
`__tests__/`) returned exactly two files:

1. `apps/web/src/components/bulk-edit-dialog.tsx:288` — a code COMMENT citing
   `C4-RPF-09 (sales load-error region)` as a prior-art precedent for `role="alert"`.
   Not live code; not functional. See "Non-findings" below.
2. `apps/web/src/lib/process-image.ts` — comment-only change (see below).

Drizzle ORM-based inserts: TypeScript would surface a removed-column reference as a type
error on the `db.insert(images).values({...})` call. `typecheck` passes, confirming no
Drizzle-level mismatch exists.

`apps/web/src/lib/data.ts`: zero hits for any removed-system identifier. CLEAN.
`apps/web/src/lib/image-types.ts`: zero hits. CLEAN.
`apps/web/src/lib/bulk-edit-types.ts`: `BulkUpdateImagesInput` has no `license_tier`. CLEAN.

---

## Modified-file audit

### `apps/web/src/lib/process-image.ts` (-6 lines)

**Change:** Comment-only. The GPS-strip doc comment previously said
"the paid-download endpoint streams byte-for-byte"; now reads "the original is retained at
`data/uploads/original/` byte-for-byte". No behavioral code changed.
**Finding:** None.

### `apps/web/src/lib/gps-exif-strip.ts` (-2 lines)

**Change:** Comment-only. "silently degrading the paid-download deliverable" →
"silently degrading the stored original". No behavioral code changed.
**Finding:** None.

### `apps/web/src/app/api/search/semantic/route.ts` (comment-only)

**Change:** Two comment lines removed references to `/api/checkout/[imageId]` and
"paid-flow". The `export const runtime = 'nodejs'` declaration, rate-limiting logic,
and all route handler code are unchanged.
**Finding:** None.

### `apps/web/src/app/api/admin/db/download/route.ts` (comment-only)

**Change:** Added comment `AGG9R-02` explaining that origin verification moved into
`withAdminAuth`. The implementation — `withAdminAuth` wrapper, `lstat` + `realpath`
symlink rejection, `isValidBackupFilename`, containment checks, audit log — is unchanged.
**Finding:** None.

### `apps/web/src/app/actions/images.ts` (reviewed)

`insertValues` (lines 333-379) contains all expected color/HDR/EXIF fields.
`license_tier` is absent, which is correct — the column was dropped in migration 0023.
No Stripe or entitlement references anywhere in the file.
**Finding:** None.

### `apps/web/src/app/api/admin/lr/upload/route.ts` (reviewed)

`insertValues` (lines 343-393) mirrors the upload action: all color/HDR fields present,
`license_tier` absent.
**Finding:** None.

### `apps/web/scripts/migrate.js` (reviewed)

Two new helpers added: `dropColumnIfPresent` and `dropTableIfPresent`.

Removals block at end of `reconcileLegacySchema` (lines 621-628):
```javascript
await dropTableIfPresent(connection, 'entitlements');
await dropColumnIfPresent(connection, dbName, 'images', 'license_tier');
```

**Drop order check:** `entitlements` has a FK `entitlements_image_id_fk` referencing
`images(id)`. `license_tier` is a column on `images`, not referenced by the FK.
Dropping `entitlements` first removes the FK, then dropping `license_tier` from `images`
is unconstrained. Even the reverse order would be safe (the FK is on `image_id`, not
`license_tier`), but the chosen order (table first, column second) is correct.
`DROP TABLE IF EXISTS` is idempotent in MySQL 8.0. `dropColumnIfPresent` guards on
`INFORMATION_SCHEMA` before issuing `ALTER TABLE … DROP COLUMN`. Both helpers are
idempotent.

The `ensureColumn` call that previously added `license_tier` was removed; a comment
explains it is not re-reconciled so a baselined legacy DB matches the post-0023 schema.
The `ensureTable` call that previously created `entitlements` was removed similarly.

**Finding:** None. Migration architecture is correct.

### `apps/web/src/components/photo-viewer.tsx` (grepped)

`Download` icon (lucide-react) imported at line 14. Used at lines 933, 969 for
free derivative downloads (`/uploads/jpeg/…`, `/uploads/avif/…`). Not orphaned.
`buildDownloadFilename` from `@/lib/download-filename` used at lines 183-187. Active.
No `license_tier`, `entitlement`, `paid`, `stripe` references.
**Finding:** None.

### `apps/web/src/components/info-bottom-sheet.tsx` (grepped)

Same pattern: `Download` icon used at lines 498, 534 for derivative downloads. Active.
`buildDownloadFilename` used at lines 162-165. Active.
**Finding:** None.

### `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (reviewed, 307 lines)

Props to `PhotoViewer`: `images`, `initialImageId`, `tags`, `prevId`, `nextId`,
`canShare`, `isAdmin`, `imageSizes`, `siteTitle`, `shareBaseUrl`,
`untitledFallbackTitle`, `slideshowIntervalSeconds`, `forceShowColorChips`,
`forceSrgbDerivatives`, `semanticSearchMode`. No paid/license fields.
**Finding:** None.

### `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` (reviewed, 250 lines)

Same clean prop pattern. No removed-system references.
**Finding:** None.

### `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` (reviewed, 133 lines)

Same clean prop pattern. No removed-system references.
**Finding:** None.

### `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` (reviewed, 687 lines)

`COLOR_HDR_BACKFILL_KEYS` contains only color/quality keys. `handleSave` sends only
changed settings fields. No `license_tier`, `sales`, or Stripe-related state.
`SettingsClientProps` interface has no paid-download field.
**Finding:** None.

---

## Non-findings (explicitly ruled out)

| Item | File:line | Verdict |
|------|-----------|---------|
| Stale comment `C4-RPF-09 (sales load-error region)` | `bulk-edit-dialog.tsx:288` | Comment is a precedent citation for `role="alert"`. Not live code referencing a removed system. Non-functional. |
| `process-image.ts` Stripe mention in grep | `process-image.ts` | Comment-only update; confirmed by diff. |

---

## Previously-open deferred items — status change

### RES-R7C6-01 (HEIC GPS-strip fall-through) — CLOSED/MITIGATED

The paid-download route that streamed originals (including potentially GPS-retaining
HEIF originals) has been deleted. No public streaming vector for originals now exists
in any surviving route. The original file on disk may still retain GPS metadata if the
strip failed silently, but there is no delivery path to expose it publicly.
**New status: MITIGATED — no public exposure vector.**

### ARCH-R7C2-01 (Stripe `async_payment_succeeded` gap) — MOOT

Entire Stripe system deleted. `checkout.session.async_payment_succeeded` handling was
deferred; now the webhook, checkout route, and entitlements table are all gone.
**New status: MOOT.**

### TE-R7C2-02 (Stripe behavioral test gap) — MOOT

Test coverage for Stripe webhook edge cases was deferred. Entire Stripe system deleted.
**New status: MOOT.**

---

## DO NOT RE-FILE (per task brief)

- MED-R7C2-01 (histogram clip %): exhausted/refuted.
- REJ-R7C3-01 (indexSize): disproved.
- NCLX pin class: exhausted.

---

## Build / type check

`typecheck` passes (per task brief). No TypeScript errors on removed-column references
because no live code names them. The Drizzle schema in `src/db/schema.ts` has no
`license_tier` or `entitlements` table definition (migration 0023 dropped both).

---

## Summary

| Severity | Count |
|----------|-------|
| CRIT | 0 |
| HIGH | 0 |
| MED | 0 |
| LOW | 0 |
| Non-findings | 1 (stale comment) |
| Deferred items closed | 3 (RES-R7C6-01, ARCH-R7C2-01, TE-R7C2-02) |

**The Stripe paid-download removal is complete and correct across all modified files.
No surviving INSERT/UPDATE/SELECT names `license_tier` or references `entitlements`.
No behavioral regressions detected in any modified file.**
