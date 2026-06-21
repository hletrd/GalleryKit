# Trace Report — GalleryKit run-9 cycle-2

**Date:** 2026-06-21
**HEAD:** 1ef54aaa (run-9 cycle-1 review docs; only source changes since run-8 convergence are two new test files)
**Scope:** Four end-to-end data flows; adjudicated flows A/B/D/E not re-opened.

---

## Preamble — What Changed Since run-8 Convergence

`git diff HEAD~2 --name-only` shows only:

- `.context/reviews/run9-cycle1/` (review artifacts)
- `apps/web/src/__tests__/upload-tracker-state.test.ts` (new test, TE-R9C1-01)
- `apps/web/src/__tests__/upload-processing-contract-lock.test.ts` (new test, TE-R9C1-02)
- `apps/web/public/sw.js` (SW version stamp)

No production logic changed. Expectation: convergence.

---

## Flow 1 — Admin String Input → Validation → DB → All Render Surfaces

### Observation

Admin-controlled persistent string fields (`topic.alias`, `tag.name`, `topic.label`,
`image.title`, `image.description`, SEO fields `seo_title` / `seo_description` /
`seo_nav_title` / `seo_author`) are written through server actions, stored in MySQL,
and rendered back on: admin tables, public nav, photo viewer (`<CardDescription>`,
EXIF pane), JSON-LD `<script>` tag, OG image Satori renders, and `<head>` metadata.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | All write paths reject / strip bidi+zero-width at entry; all render paths are covered by safeJsonLd or sanitizeForOg where EXIF input is not validator-gated | High | Strong |
| 2 | A render surface exists that receives a validator-gated field raw (skipping sanitizeForOg) with bidi/zero-width passing through | Low | Weak |

### Evidence For (Hypothesis 1 — SAFE)

**Write-side guards (reject on input):**

- `validation.ts:58` — `UNICODE_FORMAT_CHARS` covers U+180E, U+200B-200F, U+202A-202E, U+2060, U+2066-2069, U+FEFF, U+FFF9-FFFB.
- `validation.ts:105-110` — `isValidTopicAlias` tests `UNICODE_FORMAT_CHARS` and returns false on match.
- `validation.ts:118-124` — `isValidTagName` trims then tests `UNICODE_FORMAT_CHARS`.
- `sanitize.ts:17` — `UNICODE_FORMAT_CHARS_RE` is derived from `UNICODE_FORMAT_CHARS.source` (no drift). `sanitizeAdminString` (line 161) calls `stripControlChars` which applies both C0/C1 and `UNICODE_FORMAT_CHARS_RE`.
- `images.ts:818-819` — `updateImageMetadata` calls `sanitizeAdminString(title)` and `sanitizeAdminString(description)`; rejected flag returns error before DB write.
- `images.ts:933,942` — bulk edit title/description paths also call `sanitizeAdminString`.
- `sanitize.ts:54-60` — `normalizeStringRecord` rejects bidi/zero-width in SEO settings before DB write (`normalizeStringRecord` → `UNICODE_FORMAT_CHARS.test`).

**Render-side — OG images:**

- `og-sanitize.ts:28-29` — `sanitizeForOg` calls `stripUnicodeFormatting` (global-flag twin derived from `UNICODE_FORMAT_CHARS.source`) then strips C0 control chars.
- `api/og/route.tsx:82-88` — topic label, site title, tag list all pass through `sanitizeForOg`.
- `api/og/photo/[id]/route.tsx:81,83` — site title and photo display title pass through `sanitizeForOg`.

**Render-side — JSON-LD (`p/[id]/page.tsx`):**

- Line 8 imports `safeJsonLd`; line 14 imports `sanitizeForOg`.
- Lines 224-228: EXIF-derived `camera_model`, `lens_model`, `exposure_time` (NOT validator-gated at write) pass through `sanitizeForOg` before entering the JSON-LD object.
- Lines 219-221: `name` (displayTitle), `description`, `keywords` do NOT call `sanitizeForOg` — this is deliberate and correct: they are write-time validator-gated (bidi rejected at `sanitizeAdminString` / `isValidTagName`), and the entire object is serialized through `safeJsonLd` (line 266, `__html: safeJsonLd(jsonLd)`), which escapes `</script>` and U+2028/U+2029. The comment at lines 209-218 documents this asymmetry explicitly.
- `safe-json-ld.ts:14-18` — `safeJsonLd` uses `JSON.stringify` (which escapes all C0 chars < 0x20 and produces valid JSON) then replaces `<`, U+2028, U+2029.

**EXIF strings (camera_model, lens_model) at write time:**

- `process-image.ts:28,586` — `cleanString` calls `stripUnicodeFormatting` on EXIF string values before they are stored as `camera_model` and `lens_model`. So these fields are stripped at ingest.
- Additionally, at render time they go through `sanitizeForOg` (line 224-225 of `p/[id]/page.tsx`) — double protection.

**Render-side — photo viewer component:**

- `photo-viewer.tsx:775,781` — `camera_model` and `lens_model` are rendered as React text nodes (`{image.camera_model}`, `{image.lens_model}`). React's JSX text-node rendering HTML-escapes `<`, `>`, `&` but does NOT strip bidi/zero-width. These fields are already stripped of bidi chars by `cleanString`/`stripUnicodeFormatting` at ingest (`process-image.ts:586`).
- `photo-viewer.tsx:764` — `image.description` rendered as React text node; protected by write-time `sanitizeAdminString` rejection.

**Compile-time guard:**

- `data.ts:415-417` — `_SensitiveKeysInPublic` compile-time guard: `Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys> extends never` — a typo adding a sensitive key to `publicSelectFields` fails `tsc`.

### Evidence Against / Gaps

- Hypothesis 2: No render surface found that bypasses both validator rejection and sanitizeForOg/safeJsonLd. The JSON-LD asymmetry (no sanitizeForOg on write-gated fields) is explicitly documented as intentional and correct.
- `JSON.stringify` does NOT strip bidi/zero-width (U+202A-202E etc. are above 0x1F). However, write-time rejection at `sanitizeAdminString` / `isValidTopicAlias` / `isValidTagName` prevents these characters from ever reaching the DB, making the JSON-LD render path safe for write-gated fields.

### Rebuttal Round

Best challenge: could a future loosened validator let bidi chars reach `description`, bypass `sanitizeForOg` on the JSON-LD path, and render into the `<script>` block?

Why the leader stands: `safeJsonLd` escapes `</script>` break-out. Bidi chars in a JSON string literal inside a `<script>` tag cannot execute code — they affect visual rendering of the page source, not the parsed JSON value. The security impact is cosmetic, not exploitable. The `og-sanitize.ts` module is wired as a defense layer for Satori rendering where font rendering of bidi chars is a real visual concern. For JSON-LD the `safeJsonLd` escaping is the correct defense. The comment at `p/[id]/page.tsx:209-218` documents this reasoning.

### Current Best Explanation

Flow 1 traces CONFIRMED-SAFE. All write surfaces reject or strip bidi/zero-width/C0 chars. All render surfaces that receive non-validator-gated input (EXIF strings) apply `sanitizeForOg`. Validator-gated fields that skip `sanitizeForOg` on the JSON-LD path are protected by `safeJsonLd` against the actual attack vector (`</script>` injection), and bidi in a JSON string literal inside a script block has no code-execution impact.

---

## Flow 2 — Upload → Color Detection → DB Columns → publicSelectFields / adminSelectFields → API Response

### Observation

`processImageFormats` detects color signals and writes 10+ color/HDR columns to the `images` table. These columns split into admin-only (PII/internal) and public-safe. Public API responses use `publicSelectFields`; admin API responses use `adminSelectFields`.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | PII/admin-only color columns are absent from publicSelectFields; compile-time guard catches drift | High | Strong |
| 2 | A column added to adminSelectFields was not consciously excluded from publicSelectFields | Low | Weak — no evidence found |

### Evidence For (Hypothesis 1 — SAFE)

**Field exclusion (data.ts):**

- `data.ts:324-351` — destructuring from `adminSelectFields` into void vars for public omission covers: `latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, `processed`, `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `was_downscaled`, `transfer_function`, `matrix_coefficients`, `bit_depth` (public), `uploaded_by`, `processing_error`, `failed_at`, `color_space`, `icc_profile_name`, `pipeline_version`.
- `data.ts:353` — `publicSelectFields` is constructed by explicit enumeration (not spread of adminSelectFields), so fields are opt-in for public exposure.
- `data.ts:414` — `PrivacySensitiveKeys` type union covers all the above.
- `data.ts:415-418` — `_SensitiveKeysInPublic extends never` compile-time guard; `_privacyGuard` assigned `true`. Any typo inserting a sensitive key into `publicSelectFields` fails `tsc`.
- `data.ts:427-430` — `_mapPrivacyGuard` applies same discipline to `publicMapSelectFields`.
- `data.ts:731,780,830,896,962,1126` — all public queries spread `publicSelectFields`.

**`avif_10bit` is correctly public-safe:**

CLAUDE.md documents `avif_10bit` as "public-safe (R10-M4) — describes encoded output, not source PII; present in `publicSelectFields`". This is intentional: it describes the delivery format, not source characteristics.

**Auth routes use adminSelectFields:**

- `data.ts:787` — admin query joins `adminUsers` and uses admin fields including `uploaded_by` display name. Only served on authenticated admin routes.

### Evidence Against / Gaps

No gap found. The compile-time guard is the definitive evidence.

### Current Best Explanation

Flow 2 traces CONFIRMED-SAFE. The `_SensitiveKeysInPublic` compile-time guard at `data.ts:415-417` structurally prevents sensitive field leakage into public queries. All public data access functions verified to spread `publicSelectFields`.

---

## Flow 3 — Backfill Re-encode → Delete-During-Reencode Race → File Cleanup

### Observation

During a backfill, `deleteImage` can run concurrently with `processImageFormats` re-encoding a file (no per-image processing lock in `deleteImage`). This could orphan freshly written derivative files if the DB row disappears mid-encode.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Both backfill paths (in-app runner and sidecar script) detect affectedRows===0 after UPDATE and clean up derivatives | High | Strong — file:line evidence from both paths |
| 2 | One of the two paths misses the cleanup | Low | Refuted by direct code read |

### Evidence For (Hypothesis 1 — SAFE)

**In-app runner (`admin-backfill-runner.ts`):**

- Line 430 — `cleanupDeletedMidReencodeVariants` calls `deleteImageVariants` for WEBP, AVIF, JPEG dirs with `[]` sizes (full scan).
- Lines 573-574 — success-path UPDATE: checks `affectedRows === 0` → calls `cleanupDeletedMidReencodeVariants(row)` → returns `{ ok: false, reason: 'deleted-mid-reencode' }`.
- Lines 605-607 — detection-failure path UPDATE: same check → same cleanup → same return.
- Both UPDATE paths covered.

**Sidecar script (`backfill-color-pipeline.ts`):**

- Line 53 import — `deleteImageVariants` imported.
- Lines 119-131 (AGG-C5-01) — `cleanupDeletedMidReencodeVariants` exported module-level helper.
- Lines 136-144 — `collectDeletedMidReencodeFiles` partitions `updateResults` by `affectedRows === 0`.
- Lines 160-162 — `countDeletedMidReencodeDetectionFailures` corrects the detection-failure counter for deleted rows.
- Lines 401-458 — `flushBatch`: collects `updateResults` for both success and derivative-only UPDATE paths; after transaction commits, calls `collectDeletedMidReencodeFiles`, then `Promise.all(deletedMidReencodeFiles.map(cleanupDeletedMidReencodeVariants))`.
- AGG-C4-04: also corrects the `detectionFailures` counter so exit code is not spuriously non-zero for deleted rows.

**ENOENT tolerance:** `deleteImageVariants` is documented as ENOENT-tolerant, so races where `deleteImage` has already removed the files before `cleanupDeletedMidReencodeVariants` runs do not throw.

**Test coverage:** `__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` locks the cleanup helpers. `__tests__/admin-backfill-runner-detection-failure.test.ts` locks the in-app runner's detection-failure path.

### Evidence Against / Gaps

No gap found. Both paths handle all UPDATE outcomes (success-path deleted and detection-failure deleted).

### Current Best Explanation

Flow 3 traces CONFIRMED-SAFE. Both backfill entry points detect `affectedRows === 0` on every UPDATE and invoke ENOENT-tolerant variant cleanup. The sidecar uses a batched transaction model that also handles the detection-failure slice separately (AGG-C4-04).

---

## Flow 4 — Session Token Mint → Cookie → Middleware Guard → Server Action isAdmin()

### Observation

A session is created at login, a signed HMAC-SHA256 token placed in an `admin_session` cookie, checked by the middleware in `proxy.ts` for format, and cryptographically verified by `verifySessionToken` inside `isAdmin()` for all mutating server actions.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength |
|------|-----------|-----------|-----------------|
| 1 | Token lifecycle is sound: HMAC-SHA256 signed, constant-time compared, DB-backed, expiry-checked; middleware format-checks; every mutating action calls both requireSameOriginAdmin + isAdmin() | High | Strong |
| 2 | A mutating action exists that checks isAdmin() but not requireSameOriginAdmin(), or vice versa | Low | Would need exhaustive action scan |
| 3 | Middleware format check is bypassable for API routes (middleware matcher excludes /api/) | Medium — known design; API routes have own guards | Strong — design is documented |

### Evidence For (Hypothesis 1 — SAFE)

**Token generation (`session.ts:82-88`):**

- `timestamp:random:signature` format. `random` = 16 cryptographic random bytes as 32-char hex. `signature` = HMAC-SHA256(secret, `timestamp:random`).

**Token verification (`session.ts:94-150`):**

- Split on `:` → exactly 3 parts (line 100).
- HMAC recomputed; `timingSafeEqual` used (line 117) — timing-safe.
- `signatureBuffer.length !== expectedSignatureBuffer.length` checked before `timingSafeEqual` (line 113-115) — prevents length-extension shortcut.
- Random format check `[0-9a-f]{32}` and signature format check `[0-9a-f]{64}` run AFTER HMAC check (lines 124-125) so they cannot serve as timing oracle.
- Token age check: ≤ 24 hours, not negative (line 132).
- DB lookup on `hashSessionToken(token)` = SHA-256 of full token (line 136-138) — DB stores hash, not raw token.
- Expiry check against `session.expiresAt` (line 145).
- Wrapped in React `cache()` for per-request deduplication.

**Production secret requirement (`session.ts:30-36`):**

- In production, `NODE_ENV === 'production'` → throws if `SESSION_SECRET` env var absent or < 32 chars. Dev-only DB fallback is explicitly blocked in production.

**Middleware (`proxy.ts:54-116`):**

- `isProtectedAdminRoute` covers both locale-prefixed (`/en/admin/...`) and default-locale (`/admin/...`) paths; login page itself (`/en/admin` exactly) is excluded from protection (correct — unauthenticated access to login required).
- Format check: token must exist, length ≥ 100, split on `:` yields exactly 3 non-empty parts (lines 90, 103).
- This is a fast-fail filter — cryptographic verification is NOT done in middleware (Edge Runtime constraint); it defers to `verifySessionToken` in server actions.
- **Known design:** middleware matcher `/((?!api|_next|_vercel|.*\\..*).*)` excludes `/api/*` routes. All `/api/admin/*` routes must implement their own auth via `withAdminAuth` — the `lint:api-auth` script enforces this.

**isAdmin() / requireSameOriginAdmin() in actions:**

- `auth.ts:54-56` — `isAdmin()` = `!!(await getCurrentUser())` = `!!(await getSession())` = verifies HMAC + DB + expiry.
- `action-guards.ts:37-43` — `requireSameOriginAdmin()` checks `hasTrustedSameOrigin` (Origin/Referer + Host) — CSRF-layer defense in depth.
- `images.ts:26,118,552,648,806,876-877,1074-1077` — all mutating exports call `requireSameOriginAdmin()` before or alongside `isAdmin()`.
- `lint:api-auth` script scans `/api/admin/**` routes and requires `withAdminAuth(...)` wrapper on every HTTP method export.

### Evidence Against / Gaps

- Hypothesis 3 (API routes bypass middleware): Confirmed as known design. `lint:api-auth` is the compensating control. No new API admin routes exist in this cycle's diff.
- Hypothesis 2 (action missing one guard): Full exhaustive scan of all action files not done in this trace. The `lint:action-origin` script (`check-action-origin.test.ts`) enforces `requireSameOriginAdmin()` on all mutating server action exports automatically — this is the structural compensating control.

### Rebuttal Round

Best challenge: could `requireSameOriginAdmin()` pass while `isAdmin()` fails, or vice versa, allowing an authed-origin but unauthenticated mutation?

Why the leader stands: `requireSameOriginAdmin` only checks origin headers — it does not authenticate. `isAdmin()` is always called in addition. In practice, reversing the order (origin first, then isAdmin) is the documented standard pattern in `images.ts:877-879`. If origin check fails, the action returns early without calling `isAdmin()`, which is correct — no mutation occurs. If origin passes but session is invalid, `isAdmin()` returns false and the action returns early. Neither branch allows mutation.

### Current Best Explanation

Flow 4 traces CONFIRMED-SAFE. Token is HMAC-SHA256 signed with a production-required env-var secret, constant-time verified, DB-hash-backed with expiry. Middleware provides fast-fail format filtering. Server actions apply defense-in-depth with both `requireSameOriginAdmin()` (CSRF) and `isAdmin()` (full session verification). Structural lint gates enforce coverage of both layers.

---

## Summary

| Flow | Result | Key Evidence |
|------|--------|-------------|
| 1 Admin strings → all render surfaces | CONFIRMED-SAFE | Write-side: sanitizeAdminString rejects bidi/zero-width. EXIF at ingest: cleanString strips. OG: sanitizeForOg on all fields. JSON-LD: safeJsonLd escapes </script>; EXIF fields get extra sanitizeForOg; write-gated fields protected by rejection. |
| 2 Color columns → public vs admin field split | CONFIRMED-SAFE | publicSelectFields is opt-in; _SensitiveKeysInPublic compile-time guard at data.ts:415-417 catches drift at tsc. All 19 PII/admin-only fields excluded. |
| 3 Backfill → delete-during-reencode → cleanup | CONFIRMED-SAFE | Both in-app (admin-backfill-runner.ts:573-574, 605-607) and sidecar (backfill-color-pipeline.ts flushBatch) check affectedRows===0 on every UPDATE path and call ENOENT-tolerant deleteImageVariants. |
| 4 Session mint → middleware → isAdmin() | CONFIRMED-SAFE | HMAC-SHA256, timingSafeEqual, DB hash, expiry, production env-var requirement. Middleware format-filters; lint:api-auth enforces withAdminAuth on API routes; lint:action-origin enforces requireSameOriginAdmin on server actions. |

**NEW FINDINGS: 0**

All four traced flows are safe. No production logic changed since run-8 convergence. Convergence confirmed.
