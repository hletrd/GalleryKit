# Tracer Report — GalleryKit Run-9 Cycle-3

HEAD: c2d3857a  
Date: 2026-06-21  
Role: end-to-end flow tracing — confirmation re-runs + one fresh flow

---

## Flows Re-Traced (Confirmation Runs)

### Flow 2 — color-column → public/admin field separation

**Observation target:** Do admin-only color/HDR columns stay out of all public-facing queries?

**Evidence gathered:**

- `apps/web/src/lib/data.ts:208–280` — `adminSelectFields` is the full union including `color_pipeline_decision` (l.240), `transfer_function` (l.242), `matrix_coefficients` (l.243), `is_hdr` (l.244), `has_gain_map` (l.245), `pipeline_version` (l.258), `uploaded_by` (l.269), `color_space`, `icc_profile_name` (implied by omission blocks), `bit_depth`, `was_downscaled`. `avif_10bit` sits at l.275 after a comment explicitly marking it public-safe (R10-M4).

- `apps/web/src/lib/data.ts:317–357` — `publicSelectFields` is derived by destructure-omission. The omit list explicitly names: `latitude`, `longitude`, `filename_original`, `user_filename`, `original_format`, `original_file_size`, `processed`, `color_pipeline_decision`, `is_hdr`, `has_gain_map`, `was_downscaled`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `uploaded_by`, `processing_error`, `failed_at`, `color_space`, `icc_profile_name`, `pipeline_version`. The remainder (`publicSelectFieldCore`) is spread into `publicSelectFields`. `avif_10bit` is not in the omit block and therefore stays in the public set.

- `apps/web/src/lib/data.ts:394–417` — `PrivacySensitiveKeys` type union lists all 19 admin-only fields; `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>`. The compile-time guard `_privacyGuard` is asserted `true` only when that Extract resolves to `never`. This makes any accidental re-inclusion of a sensitive key a hard `tsc` error.

- `publicMapSelectFields` (l.360–392) applies the same omit-then-spread pattern and carries the same admin-only exclusions with an additional comment (R27-CP-HIGH-1 / R27-CP-MED-2).

- All public listing queries (l.731, l.780, l.830, l.896, l.962, l.1126, l.1205, l.1356) use `...publicSelectFields`. No public query spreads `adminSelectFields` directly.

**Conclusion:** CONFIRMED SAFE. The derivation model + compile-time guard remains intact at HEAD. `avif_10bit` is correctly included in the public set (by design, R10-M4). No regression introduced.

---

### Flow 3 — backfill delete-during-reencode race

**Observation target:** Does the in-app runner correctly detect a row deleted mid-reencode, clean up derivatives, and avoid orphaned files?

**Evidence gathered:**

- `apps/web/src/lib/admin-backfill-runner.ts:559–607` — two UPDATE paths exist:
  - **Success branch (l.559–575):** after `processImageFormats` and `detectColorSignals` both succeed, executes `UPDATE images SET pipeline_version = ${IMAGE_PIPELINE_VERSION}, …` and checks `affectedRows === 0`. On zero, calls `cleanupDeletedMidReencodeVariants(row)` and returns `{ ok: false, reason: 'deleted-mid-reencode' }`. (`cleanupDeletedMidReencodeVariants` is the per-runner wrapper around `deleteImageVariants` with full-dir scan.)
  - **Detection-failed branch (l.581–607):** encode succeeded but detection failed; still executes `UPDATE images SET was_downscaled = …, avif_10bit = …` and checks `affectedRows === 0`. On zero, same `cleanupDeletedMidReencodeVariants(row)` call and `deleted-mid-reencode` return.
  
- `apps/web/src/lib/admin-backfill-runner.ts:426–438` — `cleanupDeletedMidReencodeVariants` calls `deleteImageVariants(UPLOAD_DIR_WEBP, …)`, `deleteImageVariants(UPLOAD_DIR_AVIF, …)`, `deleteImageVariants(UPLOAD_DIR_JPEG, …)` each with empty size-list `[]` (triggering full directory scan). Errors are logged as warnings but not re-thrown so they don't mask the deleted-mid-reencode classification.

- `apps/web/src/lib/admin-backfill-runner.ts:419` — return type union includes `'deleted-mid-reencode'`, counted correctly at l.720.

- `apps/web/src/lib/admin-backfill-runner.ts:464` — `pipeline_version` is NOT advanced on detection failure; comment explains the recovery rationale precisely.

**Conclusion:** CONFIRMED SAFE. Both the success-then-deleted and the encode-success/detection-failed-then-deleted paths handle `affectedRows === 0` with full-scan variant cleanup. No regression.

---

### Flow 4 — session → middleware → isAdmin

**Observation target:** Does the auth chain hold cryptographically, with no bypass between the middleware fast-check and the per-action full verification?

**Evidence gathered:**

- `apps/web/src/lib/session.ts:16–35` — `getSessionSecret()`: in `NODE_ENV=production`, throws hard if `SESSION_SECRET` env var is absent or shorter than 32 chars. No DB fallback in production. Dev-only fallback uses `INSERT IGNORE` + re-fetch pattern.

- `apps/web/src/lib/session.ts:94–151` — `verifySessionToken()`: split on `:` → 3 parts; reconstruct `data = timestamp:random`; compute `expectedSignature = HMAC-SHA256(secret, data)`; compare lengths first (non-equal-length buffers fail immediately, avoids the invalid-length `timingSafeEqual` throw); then `timingSafeEqual(sig, expected)`. Format assertions (`/^[0-9a-f]{32}$/`, `/^[0-9a-f]{64}$/`) only run AFTER the HMAC check so they cannot be used as a timing oracle. Token age bounded to 24 h. DB lookup via `hashSessionToken` (SHA-256 of the raw token) → sessions table → expiry check.

- `apps/web/src/proxy.ts:82–114` — middleware fast-check: validates cookie presence and `token.length >= 100`; then checks `split(':').length === 3` with no empty parts. This is explicitly documented as "basic token format check; full cryptographic validation happens in verifySessionToken()". Malformed tokens redirect to login. Structurally valid-looking tokens pass through to the server action layer where the full HMAC runs.

- `apps/web/src/app/actions/auth.ts:33–58` — `getCurrentUser()` calls `getSession()` which calls `verifySessionToken()` (full HMAC); `isAdmin()` returns `!!(await getCurrentUser())`. Both are `cache()`-wrapped for per-request deduplication.

- `apps/web/src/lib/action-guards.ts:37–44` — `requireSameOriginAdmin()`: calls `hasTrustedSameOrigin(requestHeaders)` before returning null (success). Every mutating action must call this AND `isAdmin()`.

- `apps/web/src/lib/request-origin.ts:6,55–103` — `hasTrustedSameOriginWithOptions` fails closed by default: requires an explicit `Origin` or `Referer` header, computes expected origin from `X-Forwarded-Host`/`Host` + protocol, compares canonically. No empty-header bypass.

**Notable observation on middleware vs action gap:** The middleware only checks token presence and structural validity (3 non-empty colon-separated parts, length ≥ 100). It does not perform HMAC verification. This is intentional and documented. The consequence is that a structurally valid but HMAC-invalid token passes middleware and reaches the server action — but the action's `isAdmin()` then calls the full HMAC verification and rejects it. No authenticated action relies on middleware alone; every mutation requires `isAdmin()` independently.

**Conclusion:** CONFIRMED SAFE. Defense-in-depth holds. No regression introduced.

---

## Fresh Flow — image-view analytics write → view-retention GC

**Observation target:** Trace the full path from a public page load triggering a view insert through to the GC sweep that eventually deletes old rows, and validate each handoff.

### Handoff 1: public page load → recordPhotoView() rate check

- `apps/web/src/app/actions/public.ts:320–405` — three analytics actions: `recordPhotoView(imageId)`, `recordTopicView(topicSlug)`, `recordSharedGroupView(groupId)`. All are `@action-origin-exempt` (excluded from the `requireSameOriginAdmin` gate by the action-origin lint scanner's basename exclusion for `public.ts`).

- Input validation: `imageId` checked with `typeof === 'number' && Number.isInteger && > 0`. `topicSlug` checked with `typeof === 'string' && length > 0 && <= 255 && isValidSlug()`. `groupId` integer check same as imageId.

- Per-IP rate limiting: `isViewRecordRateLimited(ip, Date.now())` uses `viewRecordRateLimit` — a `createResetAtBoundedMap` with cap `VIEW_RECORD_MAX_KEYS = 2000`, window `VIEW_RECORD_WINDOW_MS = 60_000` ms, and `VIEW_RECORD_MAX_REQUESTS = 120` per window. Exceeding returns `true` and the function returns early before any DB write.

- Country lookup and bot detection from IP/UA occur in `buildViewParams`. Full IP is never stored; only `country_code`.

### Handoff 2: rate-check pass → DB insert

- DB inserts are fire-and-forget: `db.insert(imageViews).values({...}).catch(...)`. A failed insert is logged at DEBUG level and does not surface to the client. This is intentional (analytics must not block page render). The FK on `topic_views.topic → topics.slug` rejects inserts for deleted topics at the DB level.

### Handoff 3: GC sweep — image-queue.ts → purgeOldViewEvents()

- `apps/web/src/lib/image-queue.ts:695–718` — the hourly background job calls `purgeOldViewEvents()` fire-and-forget at lines 702 and 718. Two call sites exist: the steady-state hourly timer (l.695-702) and the initial startup sweep that runs on first process start if the timer has never fired (l.714-718), per the comment "purges never fired — the timer kept getting reset".

### Handoff 4: purgeOldViewEvents() internals

- `apps/web/src/lib/view-retention.ts:57–86` — `resolveRetentionMs()` validates the optional `maxAgeMs` parameter and the `VIEW_RETENTION_DAYS` env var: a non-positive or non-finite value falls back to `DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000`. This prevents a negative retention from computing a future cutoff that would wipe all rows.

- `cutoff = new Date(Date.now() - resolveRetentionMs())`. Cutoff is always in the past.

- DELETE executes against `imageViews`, `topicViews`, `sharedGroupViews` with `lt(col, cutoff)`. Chunked at `VIEW_PURGE_BATCH = 5000` rows, max `MAX_BATCHES_PER_TABLE = 200` iterations per table per sweep (bounding a worst-case backlog to 1 M rows per table per hour, with remainder deferred to next sweep).

- `affectedRows` is read from the mysql2 result header (cast via `as unknown as { affectedRows?: number }`) with a `?? 0` fallback if the field is absent. The loop breaks when `affected < VIEW_PURGE_BATCH`.

**Findings in this flow:** None. The full chain is safe.

- Rate limiting prevents bot flooding (120 req/min/IP, 2000-key bounded map).
- Input validation prevents junk inserts from reaching the DB.
- Retention math is guarded against negative/non-finite values.
- Chunked DELETE prevents long table locks on large backlogs.
- Two call sites in image-queue.ts ensure the GC runs even if the process starts cold and the first scheduled tick hasn't fired.

**CONFIRMED SAFE.**

---

## Fresh Flow — upload → process-image derivative serving → ETag/cache

**Observation target:** From a processed derivative being served via the route handler, validate path traversal prevention, symlink rejection, ETag construction, and conditional-GET correctness.

### Handoff 1: route handler → serveUploadFile()

- `apps/web/src/app/uploads/[...path]/route.ts` — `GET` passes `pathSegments`, `if-none-match` header value, `'GET'`, and `request.signal`. `HEAD` passes `'HEAD'` (HEAD fast-path fix from R20-L1).

- The locale-prefixed twin at `app/[locale]/(public)/uploads/[...path]/route.ts` mirrors this structure.

### Handoff 2: serveUploadFile() — path safety

- `apps/web/src/lib/serve-upload.ts:138` — `topLevelDir` must be in `ALLOWED_UPLOAD_DIRS = {'jpeg', 'webp', 'avif'}`. Others → 404.
- l.155–162 — each segment validated: non-empty, ≤ `MAX_SEGMENT_LENGTH`, not `'.'` or `'..'`, matches `SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/`. The SAFE_SEGMENT regex allows dots but the overall path is then constructed with `path.join` which normalizes; the `..` literal check guards against that specific traversal before join.
- l.175 — `lstat()` (not `stat()`) detects the symlink at the leaf before following it.
- l.177 — `stats.isSymbolicLink() || !stats.isFile()` → 403. Both conditions checked.
- l.182 — `realpath()` resolves the full path; `resolvedPath.startsWith(resolvedRoot + path.sep)` containment check. The `path.sep` suffix prevents a `/uploads/jpeg` prefix from matching `/uploads/jpeg-evil/...`.

### Handoff 3: ETag construction

- `apps/web/src/lib/serve-upload.ts:214–215` — ETag is `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`. `IMAGE_PIPELINE_VERSION` is imported from `gallery-config-shared.ts` (single source of truth). `settingsHash` comes from `getServingColorSettingsHash()` which has a 5 s module-level TTL cache (not per-request).

- `apps/web/src/lib/settings-hash.ts:42–53` — `COLOR_IMPACTING_KEYS` (9 entries: 5 color, 3 quality, 1 size). Compile-time guard ensures every key is a valid `GallerySettingKey`. Hash built from resolved `GalleryConfig` values (R8-H1 fix), not raw DB strings, so invalid DB values (e.g. quality=150) don't create ETag misalignment.

### Handoff 4: conditional GET / 304 response

- `apps/web/src/lib/serve-upload.ts:222–234` — `If-None-Match` header parsed: split on `,`, trim, check for `'*'` or exact `etag` match → 304 with ETag + Cache-Control headers preserved. Handles comma-separated multi-tag lists correctly.

- `Cache-Control: public, max-age=3600, must-revalidate` is set consistently on all responses (200, 304, HEAD). No `immutable` directive — intentional, since a backfill re-encodes files in place under the same filenames and the mtime change drives re-validation.

**Findings in this flow:** None. Path traversal prevention is multi-layered (segment regex + dot/dotdot check + lstat symlink + realpath containment). ETag construction is correct and backed by a single source of truth. Conditional GET handles multi-tag `If-None-Match` correctly.

**CONFIRMED SAFE.**

---

## Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Status |
|------|------------|------------|-------------------|--------|
| 1 | Flow 2 regression: admin field leaks into public query | Low pre-trace | Strong (compile-time guard + code read) | REFUTED — guard intact |
| 2 | Flow 3 regression: orphaned derivatives on delete-during-reencode | Low pre-trace | Strong (two affectedRows===0 paths both clean up) | REFUTED — both paths correct |
| 3 | Flow 4 regression: session bypass possible | Low pre-trace | Strong (HMAC + timingSafeEqual + per-action isAdmin) | REFUTED — chain intact |
| 4 | Analytics view flood unbounded | Low pre-trace | Strong (rate-limit + bounded map + chunked GC) | REFUTED — bounded at all layers |
| 5 | Path traversal through serve-upload | Low pre-trace | Strong (4-layer defense: regex, dot check, lstat, realpath) | REFUTED — all layers present |

---

## Summary

**NEW ACTIONABLE FINDINGS: ZERO.**

All re-traced flows (2, 3, 4) confirm safe at HEAD c2d3857a. Both fresh flows (analytics write → GC; upload derivative serving → ETag) are safe across every handoff examined.

### Re-confirmation statements

- **Flow 2 (color-column / public field separation):** CONFIRMED SAFE. Compile-time guard `_SensitiveKeysInPublic extends never` is the primary enforcement; `avif_10bit` is correctly public. No regression.
- **Flow 3 (backfill delete-during-reencode race):** CONFIRMED SAFE. Both the success-path and detection-failed-path UPDATE checks test `affectedRows === 0` and both call `cleanupDeletedMidReencodeVariants`. No regression.
- **Flow 4 (session → middleware → isAdmin):** CONFIRMED SAFE. Middleware performs structural fast-check only; full HMAC runs in `verifySessionToken()` via `isAdmin()` in every action. Production `SESSION_SECRET` guard refuses DB fallback. `requireSameOriginAdmin()` applies universally on mutating actions. No regression.
- **Fresh flow A (view analytics → GC):** CONFIRMED SAFE. Rate-limiting, input validation, bounded map size, chunked GC with non-finite guard all intact.
- **Fresh flow B (derivative serving → ETag/cache):** CONFIRMED SAFE. 4-layer path-traversal defense, symlink rejection, correct ETag construction (single source-of-truth `IMAGE_PIPELINE_VERSION` + resolved settings hash), correct conditional-GET 304 handling.

### Critical unknown

None identified. Remaining uncertainty is at the system boundary (network-level browser behavior for `(color-gamut: p3)` MQ on Firefox, already documented in CLAUDE.md) — not an in-codebase control-flow gap.

### Discriminating probe

No discriminating probe required — no open ambiguity found across all traced flows.
