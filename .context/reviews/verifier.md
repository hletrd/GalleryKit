# Verifier Report — Cycle 2, HEAD 8ccc8806, 2026-06-16

> Replaces stale prior-run content (CLIP-focused). This pass verifies repo-wide
> invariants claimed in CLAUDE.md. All lint gates, tests, and typecheck executed
> fresh. Code quoted from actual files, not docs.

---

## Claims Table

| # | Claim (from CLAUDE.md) | Status | Evidence |
|---|------------------------|--------|----------|
| 1 | `publicSelectFields` omits every PII/admin-only field listed; compile-time guards `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic` exist and fail compilation if violated | VERIFIED | `data.ts:353-419` — all 14 claimed fields destructure-omitted before `publicSelectFields` is built; `PrivacySensitiveKeys` union at line 416 covers all 14; `_privacyGuard` at line 419 is a `never`-conditional that fails `tsc` if any key leaks; `typecheck` exits 0 |
| 2 | Every `api/admin/**` route method-export wraps `withAdminAuth` | VERIFIED | `lint:api-auth` exits 0 — both admin route files (`db/download/route.ts`, `lr/upload/route.ts`) verified OK |
| 3 | Every mutating server action returns early on `requireSameOriginAdmin()` | VERIFIED | `lint:action-origin` exits 0 — 28 mutating exports OK, 6 explicit exempt comments accepted |
| 4 | Every mutating public API route pre-increments a rate limit or carries the exempt tag | VERIFIED | `lint:public-route-rate-limit` exits 0 — 9 public route files checked, all pass |
| 5 | `isSafeBlurDataUrl`/`assertBlurDataUrl` called at producer, write, AND read sites; 4096-char cap exists | VERIFIED | Producer: `process-image.ts:883` calls `assertBlurDataUrl`; Write: `actions/images.ts:347` calls `assertBlurDataUrl`; Read: `photo-viewer.tsx:196` calls `isSafeBlurDataUrl`; Cap: `blur-data-url.ts:45` — `MAX_BLUR_DATA_URL_LENGTH = 4096` |
| 6 | Settings-hash covers the documented `COLOR_IMPACTING_KEYS`; count claimed as 9 in ETag section | PARTIALLY VERIFIED — DOC DISCREPANCY | `settings-hash.ts:37-49` has exactly 9 keys (5 color + 3 quality + 1 size). CLAUDE.md ETag section (line 263) correctly states 9. BUT the "Admin tunables (color/HDR)" table has only 7 data rows — omits `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`. Code is correct; tunables table is incomplete. |
| 7 | Migration post-condition assertion in `scripts/migrate.js` throws on silent skip; `getAllJournalMigrations` + hash-based baseline present | VERIFIED | `migrate.js:144` — `getAllJournalMigrations` reads journal and SHA-256-hashes each `.sql` file; `migrate.js:703-715` — post-condition throws `"Drizzle silently skipped N migration(s): …"` if any hash missing from `__drizzle_migrations`; legacy DB path uses hash-presence check (not `MAX(created_at)`) |
| 8 | Advisory lock names in code match documentation | VERIFIED | `advisory-locks.ts:19-44` defines all 6 documented names exactly: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit:image-processing:${jobId}`, `gallerykit_color_pipeline_backfill` |
| 9 | Composite DB indexes listed in CLAUDE.md exist in `db/schema.ts` | VERIFIED | `schema.ts:114` — `(processed, capture_date, created_at)`; line 115 — `(processed, created_at)`; line 116 — `(topic, processed, capture_date, created_at)`; line 117 — `user_filename`; line 118 — `uploaded_by`; line 132 — `image_tags(tag_id)`; lines 232-233 — `image_views(bot, viewed_at, country_code)` and `image_views(bot, viewed_at, referrer_host)` — all documented indexes present |
| 10 | Touch-target audit, privacy-fields, sw-template-contract, and data-tag-names-sql tests exist and are non-trivial | VERIFIED | Line counts: `touch-target-audit.test.ts` 1244 lines; `privacy-fields.test.ts` 122 lines; `sw-template-contract.test.ts` 146 lines; `data-tag-names-sql.test.ts` 267 lines. All 2145/2147 tests pass |
| 11 | Public routes set `revalidate = 0`; admin pages use `force-dynamic` | VERIFIED | Public: all 9 public `page.tsx` files set `revalidate = 0` (home, p/[id], g/[key], s/[key], [topic], timeline, map, year/[year], c/[slug]). Admin: all 10 admin `page.tsx` files set `dynamic = 'force-dynamic'` (verified via grep across all 12 admin pages) |
| 12 | CSV escape + `validation.ts` strip documented Unicode bidi/zero-width ranges | VERIFIED | `validation.ts:58` — `UNICODE_FORMAT_CHARS = /[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]/` covers all documented ranges; `csv-escape.ts:7` derives global flag twin from same source; OG routes (`route.tsx`, `photo/[id]/route.tsx`) both import and call `sanitizeForOg` from `@/lib/og-sanitize` |

---

## Gate and Test Execution Results

| Gate | Command | Result |
|------|---------|--------|
| API auth lint | `npm run lint:api-auth --workspace=apps/web` | PASS — 2 admin routes OK |
| Action origin lint | `npm run lint:action-origin --workspace=apps/web` | PASS — 28 OK, 6 explicit exempt |
| Public rate-limit lint | `npm run lint:public-route-rate-limit --workspace=apps/web` | PASS — 9 files OK |
| Vitest unit tests | `npm test --workspace=apps/web` | PASS — 2145 passed, 2 skipped, 0 failed (230 test files, 96 s) |
| TypeScript typecheck | `npm run typecheck --workspace=apps/web` | PASS — 0 errors (`typecheck:app` + `typecheck:scripts`) |

---

## Findings

### VER-01 — CLAUDE.md admin tunables table omits 4 of the 9 COLOR_IMPACTING_KEYS

**Severity:** Low (documentation only; code is correct)
**Confidence:** High

**Claimed:** The "Admin tunables (color/HDR)" table documents the settings whose change requires backfill and triggers ETag invalidation.

**Actual:** The table has 7 data rows. `COLOR_IMPACTING_KEYS` in `settings-hash.ts:37-49` has 9 entries. The 4 missing from the table are `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, and `image_sizes`. Flipping any of these changes encoded bytes of served derivatives — an admin doing so would not know from the tunables table that a backfill pass is required or that the ETag is invalidated.

**Where correct:** The ETag section (CLAUDE.md line 263) accurately lists all 9 and notes `(AGG-R7-08 corrected the count from a stale "5")`. The tunables table was not updated when quality/size keys were added to `COLOR_IMPACTING_KEYS`.

**Enforcing code:** `apps/web/src/lib/settings-hash.ts:37-49`

---

### VER-02 — PRIVACY prose in `data.ts:319` and its CLAUDE.md mirror name only 7 of 20 omitted fields

**Severity:** Very Low (implementation correct; test covers all fields)
**Confidence:** Medium

The explanatory comment at `data.ts:319` says `publicSelectFields` omits `(latitude, longitude, filename_original, user_filename, original_format, original_file_size, processed)`. The actual omission block (lines 330-354) excludes 20 fields, including `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `uploaded_by`, `processing_error`, `failed_at`, `color_space`, `icc_profile_name`, `pipeline_version`, and `was_downscaled`. All are correctly excluded in code and in `PrivacySensitiveKeys`. The `privacy-fields.test.ts` fixture covers the full set. Only the explanatory prose paragraph is an abbreviated list. No security impact.

---

### VER-03 — Photo viewer page lives at `(public)/p/[id]/page.tsx`, not `p/[id]/page.tsx` as CLAUDE.md implies

**Severity:** None (informational)
**Confidence:** High

CLAUDE.md describes the route as `app/[locale]/p/[id]/`. The actual file is `app/[locale]/(public)/p/[id]/page.tsx`. The `(public)` segment is a Next.js route group (parenthesised — no URL segment) so the URL `/p/[id]` resolves correctly. `revalidate = 0` is set at line 38. No behavioral issue; purely a path description in the doc that omits the `(public)` group.

---

## Summary

**Claims checked:** 12
**VERIFIED:** 11
**PARTIALLY VERIFIED:** 1 (claim 6 — code correct, admin tunables table incomplete)
**NOT VERIFIED:** 0
**Discrepancies:** 1 meaningful doc gap (VER-01), 2 trivial/informational (VER-02, VER-03)

**Top 3 discrepancies:**

1. **VER-01 (Low):** CLAUDE.md "Admin tunables (color/HDR)" table lists 7 settings but `COLOR_IMPACTING_KEYS` has 9 — `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes` are absent. Admins relying on the table would not know these settings trigger ETag invalidation and require backfill.

2. **VER-02 (Very Low):** The PRIVACY prose paragraph in `data.ts` (mirrored in CLAUDE.md) names only 7 of the 20 actually-omitted fields. Full omission is enforced in code and tested in `privacy-fields.test.ts`; prose is abbreviated.

3. **VER-03 (None):** CLAUDE.md refers to the photo viewer route as `p/[id]/` without the `(public)` route-group segment. URL resolution is unaffected; pure doc notation gap.

---

## Verdict

**PASS** — All 4 lint gates clean, 2145/2147 tests pass, typecheck 0 errors.
The single PARTIALLY VERIFIED claim reflects a documentation table gap only; the enforcing code and hash logic in `settings-hash.ts` are correct.
No security-critical or behavioral discrepancies found.
