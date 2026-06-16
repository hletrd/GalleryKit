# Document-Specialist Review — Doc-vs-Code & Library-Usage Correctness

**Cycle:** 3
**HEAD:** b1e9e0da
**Date:** 2026-06-16
**Scope:** (1) CLAUDE.md / AGENTS.md / code-comment accuracy vs current code; (2) external library/framework usage correctness vs CURRENT authoritative docs (Next.js 16.2, React 19.2, Sharp 0.34.5, Drizzle ORM 0.45.2, Stripe SDK 22, next-intl 4.9, Argon2 0.44).

---

## HEADLINE: The two "strongly suspected" doc-drift findings are ALREADY CLOSED at HEAD

The task brief flagged two doc-drift findings as strongly suspected by other reviewers and asked me to confirm them. **Both were already corrected in CLAUDE.md at HEAD b1e9e0da — do NOT re-report them as open findings.**

### NOT-A-FINDING 1 — settings hash "5 keys" → already says 9
- **CLAUDE.md:264** already reads: *"The settings hash (P4-E2) covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`) — the 5 color keys …, the 3 quality keys …, and `image_sizes` … (AGG-R7-08 corrected the count from a stale '5')."*
- **Code `settings-hash.ts:37-49`** — `COLOR_IMPACTING_KEYS` = 9 entries (5 color + `image_quality_webp`/`avif`/`jpeg` + `image_sizes`). The source docstring (`settings-hash.ts:4-12`) was ALSO already corrected to "9 settings".
- **Verdict:** Consistent. The "5" the task expected to find no longer exists in the prose claim. Closed in a prior cycle (AGG-R7-08).

### NOT-A-FINDING 2 — React cache() "9 data-access functions" → already says 10
- **CLAUDE.md:361** already reads: *"React `cache()` wraps **10** data-access functions … every `data.ts` export ending in `Cached` (`getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`) plus `getSeoSettings`"* — 9 `*Cached` + `getSeoSettings` = 10, and `getLatestImageForOgCached` IS listed.
- **Code `data.ts`** — exactly 10 wrapped: `getSmartCollectionBySlugCached` (1332), `getImageCached` (1608), `getLatestImageForOgCached` (1610), `getTopicBySlugCached` (1611), `getTopicsCached` (1612), `getTagsCached` (1613), `getTopicsWithAliasesCached` (1614), `getImageByShareKeyCached` (1616), `getSharedGroupCached` (1621), `getSeoSettings` (1662).
- **Verdict:** Consistent. The "9" the task expected no longer exists. Closed in a prior cycle.

These were genuine drifts in earlier cycles; the brief was working from a pre-fix snapshot.

---

## FINDINGS (open)

### F1 — Stale `max-age=86400` in settings-hash.ts docstring (actual served value is 3600 everywhere)
- **Severity:** Low · **Confidence:** High
- **Doc claim (code comment):** `apps/web/src/lib/settings-hash.ts:20` — *"the existing cached responses keep the old bytes for `Cache-Control max-age=86400`."*
- **Actual code:** The served `Cache-Control` for derivatives is `public, max-age=3600, must-revalidate` in ALL three serving layers:
  - `serve-upload.ts:230` and `serve-upload.ts:252`
  - `next.config.ts:71` (`headers()` rule for `/uploads/:format(jpeg|webp|avif)/:file*`)
  - `nginx/default.conf:157`
  And CLAUDE.md itself documents `max-age=3600` (lines 264, security-headers section). There is no `max-age=86400` anywhere in the derivative-serving path.
- **Mismatch:** The docstring quotes a `max-age` value (86400 = 24 h) that the code never emits for derivatives. It appears to be a stale artifact from before the 3600/must-revalidate policy (R4C6 ARCH-R4C6-06) was adopted. The 86400 occurrences that ARE legitimate are `s-maxage` / `stale-while-revalidate` on the OG-image routes (`app/api/og/photo/[id]/route.tsx:15-16`, `app/api/og/route.tsx:19`) — a different cache surface, not the derivative path the docstring is describing.
- **Impact:** Comment-only; no runtime effect. A maintainer reading the docstring could be misled about the actual freshness window and the rationale for the settings-hash ETag (the real motivation is that derivatives are `must-revalidate` with a 1 h `max-age`, so the ETag is what forces the 304→200 swap when settings change).
- **Suggested fix (doc):** Change `settings-hash.ts:20` `max-age=86400` → `max-age=3600, must-revalidate` to match the shipped policy.

### F2 — Stripe webhook cross-reference drift (CLAUDE.md cites "plan-316 CRT-R5C1-04"; code now tracks the gap under Cycle-3/4 RPF ids)
- **Severity:** Low · **Confidence:** Medium
- **Doc claim:** `CLAUDE.md` `entitlements` table note — *"`checkout.session.async_payment_succeeded` is not yet handled … only card / immediate-payment methods are fully supported until plan-316 CRT-R5C1-04 ships."*
- **Actual code:** `app/api/stripe/webhook/route.ts:88` handles ONLY `checkout.session.completed`, and `:105-118` explicitly rejects non-`paid` (async) sessions. The substantive claim — async-paid (`async_payment_succeeded`) NOT handled — is **accurate**. However, the code's own comments (`:91`, `:99-104`) now track the follow-up under *"Cycle 3 RPF / P262-01 / C3-RPF-01"* and *"Cycle 4 RPF / P264-03 / C4-RPF-03"*, not "plan-316 CRT-R5C1-04".
- **Mismatch:** Only the tracking-id label drifted; the behavioral claim is correct.
- **Impact:** Cosmetic — a reader chasing "plan-316 CRT-R5C1-04" in the code finds the work referenced under different ids.
- **Suggested fix (doc):** Update the CLAUDE.md cross-ref to the current ids (or drop the specific plan id and just say "a future cycle"), to match the in-code comment lineage.

---

## VERIFIED-ACCURATE (no drift) — exhaustive checklist

Every doc claim below was confirmed against current HEAD code with file+line:

### Versions & constants
- **`IMAGE_PIPELINE_VERSION = 7`** — defined `gallery-config-shared.ts:21`, re-exported `process-image.ts:315`. CLAUDE.md:92 + :140 say 7. ✅ (CLAUDE.md:92 correctly states it's DEFINED in `gallery-config-shared.ts:21` and re-exported in process-image.ts.)
- **Default image sizes** `[640, 1536, 2048, 4096, 5120, 7680]` — `gallery-config-shared.ts:90` (`DEFAULT_IMAGE_SIZE_VALUES`). ✅
- **`avif_effort` default 6** — `gallery-config-shared.ts:128` (`'6'`). ✅
- **`wide_gamut_max_source_pixels` 50M** — `gallery-config-shared.ts:134` (`'50000000'`). ✅
- **`force_srgb_derivatives` / `allow_hdr_ingest` / `force_show_color_chips` default `false`** — `gallery-config-shared.ts:116/119/122`. ✅
- **`image_quality_webp/avif/jpeg` defaults 90/85/90** — `gallery-config-shared.ts:97/98/99`. ✅
- **Upload caps:** per-file 200 MiB (`upload-limits.ts:3`, `MAX_UPLOAD_FILE_BYTES = 200*1024*1024`), batch 2 GiB (`upload-limits.ts:1`), 100 files/window (`upload-limits.ts:2`). ✅
- **`QUEUE_CONCURRENCY` default 1** — `image-queue.ts:168`. ✅
- **Connection pool: 10 connections, queue limit 20, keepalive** — `db/index.ts:23` (`POOL_CONNECTION_LIMIT = 10`), `:33` (`queueLimit: 20`), `:35` (`enableKeepAlive: true`). ✅
- **Blur data URL cap 4096 chars** — `blur-data-url.ts:45` (`MAX_BLUR_DATA_URL_LENGTH = 4096`). ✅

### Rate limiting
- **Login "5 attempts / 15-min window"** — `rate-limit.ts:62` (`LOGIN_WINDOW_MS = 15*60*1000`), `:63` (`LOGIN_MAX_ATTEMPTS = 5`). Per-account bucket uses same window. ✅
- **`PASSWORD_CHANGE_MAX_ATTEMPTS = 10`** — `auth-rate-limit.ts:133` (CLAUDE.md doesn't pin this number; consistent). ✅

### nginx body caps (`nginx/default.conf`)
- **2 MiB default** — `:31` (`client_max_body_size 2M`). ✅
- **64 KiB login** — `:58` (admin login location). ✅
- **250 MiB db** — `:75` (`/admin/db`). ✅
- **216 MiB upload** — `:92` (`/admin/dashboard`). ✅
- **Derivative Cache-Control `public, max-age=3600, must-revalidate`** — `:157`. ✅

### ETag formats
- **serve-upload.ts** `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` — `serve-upload.ts:215` matches CLAUDE.md:264 char-for-char. The docstring at `serve-upload.ts:198` correctly references the "9-entry" list (no stale "5" there). ✅
- **next.config.ts headers** `public, max-age=3600, must-revalidate`, deliberately NOT `immutable` — `next.config.ts:64-71`. ✅

### Advisory locks (all 6 documented names present)
`gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}` — all found in `src` GET_LOCK call sites. ✅

### i18n plural convention (DOC-R5C3-07)
- **en.json** uses ICU plural: `messages/en.json:162-163` (`{count, plural, one {…} other {…}}`). ✅
- **ko.json** uses single fixed form: `messages/ko.json:162-163` (`{count}개` / `{count}장`, no `plural` block). ✅
- Matches the documented intentional asymmetry exactly. Do NOT "fix" ko.

### Privacy guard
- **`_PrivacySensitiveKeys`** type guard — `data.ts:416-418`. Includes `uploaded_by`, `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `pipeline_version`, `color_space`, `icc_profile_name`, `latitude`, `longitude`, `filename_original`, `user_filename` — matches the CLAUDE.md admin-only column table. ✅
- **`uploaded_by` FK `ON DELETE SET NULL`** — `db/schema.ts:94` (`onDelete: 'set null'`). ✅
- **`hdr-filenames.ts` RESERVED / NOT WIRED** — only imported by `__tests__/hdr-filenames.test.ts`; zero production importers. ✅

### Schema tables
- `admin_tokens` (schema.ts:196), `image_embeddings` (273), `entitlements` (290), `smart_collections` (312). ✅
- **`image_views` indexes** `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` — schema.ts:232/233 (migration 0021). ✅

### `tagNamesAgg` contract
- `data.ts:605` — `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)`, used by all masonry-list queries (`:734/783/833/899/923`). Matches CLAUDE.md "tag_names aggregation" section. ✅

### Migration runbook (`scripts/migrate.js`)
- `getAllJournalMigrations` (:144), `reconcileLegacySchema` (:247), `baselineAllJournalMigrations` (:642), `journalCovered = migrations.every((m) => haveHashes.has(m.hash))` (:683), loud-fail post-condition `throw new Error("[Migration] Drizzle silently skipped N migration(s): …")` (:712-713). All match the documented permanent fix. ✅

### Health endpoints
- `/api/health` gates DB probe on `HEALTH_CHECK_DB !== 'true'` — `api/health/route.ts:18`. ✅

### Argon2 parameters
- `password-hashing.ts:11-14` — `type: argon2.argon2id`, `memoryCost: 65_536`, `timeCost: 3`, `parallelism: 4`. Matches CLAUDE.md exactly (exceeds OWASP minimums). ✅

### AGENTS.md
- Fully consistent with code: git workflow, deploy policy, schema/migration rules, the 4 blocking lint gates (`lint`, `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit` — all present in `package.json:22-24` + ESLint), typecheck split, `_PrivacySensitiveKeys` symmetric guard. No drift. ✅

### Original-upload path
- `data/uploads/original/` private store — `upload-paths.ts:27-32` (`UPLOAD_ORIGINAL_ROOT`), referenced by `process-image.ts:1538`. ✅

---

## LIBRARY-USAGE CORRECTNESS (verified against current authoritative docs)

### Sharp 0.34.5 — `withMetadata()` GPS warning: ACCURATE ✅
- **Doc claim:** CLAUDE.md:187 + `process-image.ts:1542-1548` — *"`withMetadata()` keeps most input metadata (EXIF/XMP/IPTC) including GPS coordinates; in Sharp 0.33+ this behaviour is explicit."*
- **Verified against** the current official Sharp API docs (sharp.pixelplumbing.com/api-output): `withMetadata()` *"Keep most metadata (EXIF, XMP, IPTC) from the input image in the output image"* and adds an sRGB ICC profile. GPS lives in EXIF, so it is retained.
- **Verdict:** The warning remains correct for the installed `sharp ^0.34.5` (not just 0.33). The code correctly uses the modern split APIs instead — `keepIccProfile()` for the privacy re-encode (`gps-exif-strip.ts:1609`, `process-image.ts:1037/1609`) with NO metadata retention (Sharp strips EXIF/XMP by default when neither `withMetadata`/`keepMetadata`/`keepExif` is called). Library usage is correct. The CLAUDE.md "0.33+" phrasing is conservative-correct (still true at 0.34); no edit required.

### Drizzle ORM 0.45.2 — MySQL migrator MAX(created_at) behavior: ACCURATE ✅
- **Doc claim:** CLAUDE.md "Migration & Schema-Drift Runbook" — the MySQL migrator decides to apply each journal entry via `if (lastDbMigration.created_at < migration.folderMillis)`, checking only `MAX(created_at)`, not per-entry hashes; non-monotonic `when` timestamps poison the cursor and silently skip entries. Cites `node_modules/drizzle-orm/mysql-core/dialect.cjs:62`.
- **Verified in the installed package:** `node_modules/drizzle-orm/mysql-core/dialect.cjs:62` — `if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {` and `:69` inserts `(hash, created_at) values(${migration.hash}, ${migration.folderMillis})`. `migrator.cjs:55` sets `folderMillis: journalEntry.when`.
- **Verdict:** Exact match — the cited line number (dialect.cjs:62) is even still correct in 0.45.2. The documented silent-skip hazard is real in the installed version, and the custom hash-based post-conditions in `migrate.js` are the correct mitigation. CLAUDE.md's caveat ("file/line drifts across drizzle-orm versions; informational only") is appropriately hedged. ✅

### Next.js 16.2 — `revalidate = 0` dynamic-render semantics: ACCURATE ✅
- **Doc claim:** CLAUDE.md "Performance Optimizations" + SW section — public routes set `revalidate = 0` for immediate freshness; dynamically rendered routes emit no-cache response headers (which is why the SW caches HTML explicitly as an offline-only fallback).
- **Verified in code:** all 9 public route files export `export const revalidate = 0` (`(public)/page.tsx:16`, `p/[id]/page.tsx:38`, `g/[key]/page.tsx:17`, `s/[key]/page.tsx:14`, `[topic]/page.tsx:17`, `c/[slug]/page.tsx:14`, `year/[year]/page.tsx:15`, `timeline/page.tsx:14`, `map/page.tsx:9`). Consistent with the documented behavior and Next 16 App Router semantics (`revalidate = 0` ⇒ dynamic rendering). ✅

### Stripe SDK 22 — webhook event types: ACCURATE ✅
- **Doc claim:** Only card/immediate-payment fully supported; `async_payment_succeeded` not handled.
- **Verified:** `app/api/stripe/webhook/route.ts` dispatches only on `checkout.session.completed` (:88) and gates `payment_status === 'paid'` (:105), rejecting `'unpaid'` async sessions with a 200 `{received:true}`. This matches Stripe's documented behavior that `checkout.session.completed` fires for async methods with `payment_status: 'unpaid'` until settlement. Behaviorally correct; the gap is real and accurately documented (see F2 for the minor id-label drift). ✅

### next-intl 4.9 — ICU plural usage: ACCURATE ✅
- en.json uses valid ICU `{count, plural, one {…} other {…}}` syntax (next-intl delegates to Intl.PluralRules / ICU MessageFormat); ko.json omits the plural block, which is valid because next-intl only requires key parity, not value-shape parity. Matches the documented DOC-R5C3-07 convention. ✅

---

## SUMMARY

- **2 open findings, both Low severity, both doc-only (zero runtime impact):**
  - **F1 (High confidence):** stale `max-age=86400` in `settings-hash.ts:20` docstring — actual served value is `max-age=3600` in all three layers. Doc fix.
  - **F2 (Medium confidence):** CLAUDE.md cites "plan-316 CRT-R5C1-04" for the Stripe async-payment gap; code now tracks it under "Cycle 3/4 RPF" ids. The behavioral claim is correct; only the cross-ref label drifted. Doc fix.
- **The two findings the brief expected to confirm (settings-hash "5 keys", cache() "9 functions") are ALREADY FIXED at HEAD** — CLAUDE.md:264 says 9, CLAUDE.md:361 says 10. Do NOT re-open.
- **All other audited doc claims (≈35 distinct claims) match the code exactly.** CLAUDE.md and AGENTS.md are unusually well-maintained.
- **All library-usage claims verified correct against current authoritative docs** for the installed versions (Sharp 0.34.5 withMetadata GPS hazard, Drizzle 0.45.2 migrator MAX(created_at) silent-skip at dialect.cjs:62, Next 16.2 revalidate=0, Stripe 22 webhook events, next-intl 4.9 ICU plural). No library is being used against deprecated or changed APIs.
- **CLIP guard honored:** verified CLIP docs-vs-code only (image_embeddings table is a stub; not proposing activation).
