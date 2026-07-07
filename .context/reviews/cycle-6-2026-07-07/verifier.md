# verifier review — cycle 6

## Summary (2-4 lines)
Angle: evidence-based correctness — do the repo's stated behaviors (CLAUDE.md, code comments, test
names) actually hold in the committed code at HEAD `583277fb`? I exhaustively verified all six
assigned contracts (ETag/settings-hash, COLOR_IMPACTING_KEYS count, migration post-conditions,
rate-limit bucket math, privacy select-field guards, advisory-lock scoping) plus a wide sweep of
quantitative claims. Documentation-to-code fidelity is very high: every core numeric/behavioral
claim I checked matches. One genuine NEW drift found: the settings-hash *no-arg fallback* path only
half-implements the R8-H1 "invalid DB value" protection its own docstring cites (F1, LOW). Everything
else in scope is verified-correct (evidence catalogued below).

## Findings

### F1 — settings-hash no-arg fallback breaks the R8-H1 "invalid DB value" invariant for numeric keys  [SEV: LOW | CONF: Med | apps/web/src/lib/settings-hash.ts:82-116]

**Claim under test.** `settings-hash.ts`'s R8-H1 docstring/comment (lines 79-81) states the hash is
built "from resolved GalleryConfig values instead of raw DB strings. This prevents ETag misalignment
when invalid DB values are stored (e.g. `image_quality_avif=150`) but the encoder falls back to
defaults." The intent: the settings hash must track the ACTUAL encoded bytes, and the encoder clamps
invalid values to defaults.

**Problem — the protection exists only on the config-arg path.** `getColorSettingsHash` has two forms
that are documented as computing the same hash:
- config-arg `buildHashFromConfig(config)` (:82-95) — uses the RESOLVED `GalleryConfig`, so an
  out-of-range `image_quality_avif=150` becomes the default `85` (`validatedNumber` →
  `isValidSettingValue` rejects, returns default; `gallery-config.ts:97-101`,
  `gallery-config-shared.ts:166-168` range `1..100`, `:200` effort `0..9`). Hash reflects `85`.
- no-arg `fetchHashFromDb()` (:97-116) — reads RAW `admin_settings` strings into `map` and hashes
  them directly. The C4-19 fix (:105-115) normalizes ONLY `image_sizes` (`parseImageSizes`); the
  numeric keys (`image_quality_{webp,avif,jpeg}`, `avif_effort`, `wide_gamut_max_source_pixels`) are
  hashed verbatim. A stored `150` hashes as `image_quality_avif=150`.

So for any out-of-range-but-non-empty stored numeric value, `buildHashFromConfig` and
`fetchHashFromDb` produce DIFFERENT hashes — the exact `image_quality_avif=150` case the docstring
claims is protected against. The stated invariant is only partially true.

**Failure scenario.** In `serve-upload.ts`, the primary hash is the config-arg form
(`getServingColorSettingsHash` → `getGalleryConfig()` → `getColorSettingsHash(config)`, :85-86). The
no-arg form is reached only on the cold-start error fallback (`serve-upload.ts:92`, the sole no-arg
call site in the repo). If an out-of-range value is persisted AND that fallback fires, the ETag flips
relative to the config-path ETag, so clients whose `If-None-Match` carries the config-path tag get a
spurious `304 → 200` full re-download of byte-identical derivatives until the config path re-warms.
No wrong bytes are served — impact is cache thrash on the route-handler fallback path only.

**Why severity is LOW.** The admin write path validates every value with `isValidSettingValue`
before persisting (`apps/web/src/app/actions/settings.ts:78-79`, rejects with `invalidSettingValue`),
so `150` is not reachable through the UI/action. Triggering F1 requires (a) a persisted invalid value
via direct DB edit / seed bug / a future validator regression, AND (b) the cold-start/DB-error
fallback to fire. Both are unusual; combined they are rare. It is a genuine defense-in-depth
asymmetry, not an exploitable bug.

**Fix.** Make `fetchHashFromDb` normalize the numeric keys through the same validator the config path
uses before hashing — e.g. run the raw `map` through `buildGalleryConfig`/`isValidSettingValue`
(coercing invalid values to `DEFAULTS[key]`) so both forms hash identical inputs, closing the residual
the C4-19 image_sizes-only normalization left open. Alternatively, have the no-arg form resolve a
`GalleryConfig` and delegate to `buildHashFromConfig` so there is a single normalization authority.

---

## Verified-correct contracts (evidence; the bulk of this cycle's value given doc accuracy)

All checked against committed HEAD `583277fb`. Peer-dirty files (`data.ts`, `image-queue.ts`,
`schema.ts`, `clip-embeddings.ts`, etc.) were verified via `git show HEAD:<path>`.

**ETag / settings-hash (in scope).**
- `COLOR_IMPACTING_KEYS` = `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` = exactly **9** keys
  (`gallery-config-shared.ts:75-85`), matching the CLAUDE.md "9" and the `buildHashFromConfig`
  value map (`settings-hash.ts:83-93`). `_ColorKeysAreSettingKeys` compile guard present (:56-59).
- ETag formula single-sourced via `buildDerivativeEtag` = `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${hash}"`
  (`serve-upload.ts:122-124`); no `.slice(0,8)` at the ETag site (hash already 8-char `HASH_LENGTH`).
  304/HEAD/body all share the formula. `IMAGE_PIPELINE_VERSION = 7` (`gallery-config-shared.ts:22`),
  and generated `public/sw.js` is stamped `36c91deb-p7`. Cache policy is `public, max-age=3600,
  must-revalidate` on every branch (not `immutable`), matching the doc.

**Migration post-conditions (in scope).**
- `runMigrations` post-condition throws `Drizzle silently skipped N migration(s): tags…`
  (`scripts/migrate.js:963-972`) exactly as documented. FDR-01 pending-vs-drift split (:889-911),
  C3-01 mixed-case tail left un-baselined (:919-946), C4-01 DML-baseline refusal guard (:810-831),
  and C3-01 above-cursor cursor guard (:797-808) all present as described.
- Journal integrity: 30 migration `.sql` files == 30 journal entries, zero files-without-entry and
  zero entries-without-file. The documented non-monotonic `when` is real and isolated to
  `0007_image_reactions` (0006 is dated later); MAX(when) cursor correctly sits at
  `0029_feed_updated_indexes`, so the machinery's stated workaround holds.

**Rate-limit bucket math (in scope).**
- `LOGIN_WINDOW_MS = 15min`, `LOGIN_MAX_ATTEMPTS = 5` (`rate-limit.ts:66-67`). Login enforces BOTH
  per-IP and per-account (`acct:` key) buckets, in-memory + DB-backed, incremented before Argon2,
  rolled back on rejection (`actions/auth.ts:111-170`). Matches "5 attempts / 15-min, two buckets".

**Privacy select-field guards (in scope).**
- `publicSelectFields` derived from `adminSelectFields` by explicit destructure-omission
  (HEAD `data.ts:374-406`); `_PrivacySensitiveKeys`/`_SensitiveKeysInPublic` compile guards present.
  `was_downscaled` omitted + listed sensitive; `avif_10bit` intentionally public and rendered in the
  public Color Details audit (`color-details-section.tsx:256,266,493`). HDR badge gated explicitly on
  `isAdmin && (transfer_function==='pq'|'hlg')` (`lightbox-color-pip.tsx:84`), per AGG-M3.

**Advisory-lock scoping (in scope).**
- `advisory-locks.ts` registry matches the documented names 1:1 (`db_restore`,
  `upload_processing_contract`, `topic_route_segments`, `admin_delete`, `image-processing:{jobId}`,
  `color_pipeline_backfill`, `semantic_embedding_backfill`) — all server-scoped — and the
  single-writer guard is deliberately DB-scoped via `getSingleWriterLockName` =
  `gallerykit_web_singleton_<sha256(DB_NAME) 16-hex>` (:69-72).

**Wider sweep (all match):**
- Argon2id `memoryCost 65_536 / timeCost 3 / parallelism 4` (`password-hashing.ts:11-14`).
- Admin token `gk_` + base64url(32 bytes)=43 → 46 chars (`admin-tokens.ts:20-23`).
- OG photo fetch: `OG_PHOTO_MAX_BYTES = 1 MB`, `FETCH_TIMEOUT 3500` < `TOTAL_BUDGET 10000`
  (`og-photo-fetch.ts:31,41,54`). Home `og:image` → `/api/og/photo/${latestId}` via
  `getLatestImageForOgCached` (`page.tsx:99,124`; `data.ts:1798`).
- `MAX_BLUR_DATA_URL_LENGTH = 4096` (`blur-data-url.ts:45`).
- SW: `MAX_IMAGE_BYTES 50MB`, `HEAD_REVALIDATE_TIMEOUT_MS 300`, `HTML_MAX_AGE 24h`,
  `MAX_HTML_ENTRIES 50` (`public/sw.template.js:31,33,34,39`).
- NCLX primaries/transfer/matrix maps exact, incl. `5=gamma28`, `14/15=gamma24`, `17=gamma26`,
  `8=ycgco` (`color-detection.ts:171-221`).
- GPS strip fail-closed: anomalous HEIC/HEIF and unknown ext → `return false`
  (`process-image.ts:1807-1811`); JPEG/WebP/TIFF/AVIF/PNG re-encode with `keepIccProfile`+autoOrient.
- CSV escape strips C0/C1 + bidi + zero-width + prefixes `=+-@` with leading-whitespace tolerance
  (`csv-escape.ts:44-62`).
- nginx caps: default 2M, login 64K, `/admin/db` 250M, `/admin/dashboard` 216M,
  `/api/admin/lr/upload` 216M, generic `/api/admin/` 2M; zones `public 10r/s burst=40`,
  `nextimage 30r/s burst=120` (`nginx/default.conf`).
- `NEXT_UPLOAD_BODY_MAX_BYTES` default = max(200MiB,250MiB)+16MiB = 266MiB = 278,921,216
  (`upload-limits.ts:1-21`).
- Config defaults: webp/jpeg 90, avif 85, avif_effort 6, wide_gamut_jpeg_chroma 4:4:4,
  sdr_jpeg_chroma 4:2:0, force_srgb/allow_hdr/force_show_chips false, semantic_search_mode disabled
  (`gallery-config-shared.ts:108-140`).
- Retention: `VIEW_RETENTION_DAYS` 395 (`view-retention.ts:29`), `AUDIT_LOG_RETENTION_DAYS` 90
  (`audit.ts:121`); both fall back to default on negative/non-finite (never a future cutoff).
- `IMAGE_MAX_INPUT_PIXELS` 256M / topic 64M (`process-image.ts:356,368`).
- Queue concurrency clamp = `floor((pool − max(3,ceil(pool/2)))/2)` → **2** at pool 10
  (HEAD `image-queue.ts:119-140`); correctly DISTINCT from the backfill runner's `−1` variant
  (`admin-backfill-runner.ts:33-34`). `POOL_CONNECTION_LIMIT = 10` (`db/index.ts:31`).
- `sanitizeForOg` shared by exactly 3 consumers (both OG routes + JSON-LD `p/[id]/page.tsx`).
- `hdr-filenames.ts` genuinely NOT wired (only imported by its own test) — honesty invariant holds.
- Stripe/paid-download fully removed: zero `stripe|license_tier|entitlement|download-token` residue
  in source; `0023_remove_paid_downloads.sql` present.

## Files examined (inventory)
settings-hash.ts, serve-upload.ts, gallery-config-shared.ts, gallery-config.ts, actions/settings.ts,
scripts/migrate.js, drizzle/*.sql + meta/_journal.json, rate-limit.ts, auth-rate-limit.ts,
actions/auth.ts, advisory-locks.ts, single-writer-guard.ts (grep), password-hashing.ts,
admin-tokens.ts, og-photo-fetch.ts, blur-data-url.ts, public/sw.template.js, public/sw.js,
color-detection.ts, gps-exif-strip.ts, process-image.ts (stripGpsFromOriginal + pixel caps),
csv-escape.ts, nginx/default.conf, upload-limits.ts, view-retention.ts, audit.ts,
color-details-section.tsx, lightbox-color-pip.tsx, app/[locale]/(public)/page.tsx,
HEAD:data.ts (privacy guards), HEAD:image-queue.ts (concurrency), db/index.ts. Prior context:
.context/plans/deferred-carry-forward.md, .context/reviews/_aggregate.md.

## Final sweep (commonly-missed) notes
- Peer-dirty discipline: F1 lives in `settings-hash.ts` (NOT peer-dirty); the config-resolution and
  privacy-guard corroborating code in `gallery-config.ts`/`data.ts` were cross-checked but `data.ts`
  is peer-dirty so I read it via `git show HEAD`. No fix proposed against peer-dirty files.
- Doc-precision non-findings (not worth logging as findings): the ETag doc writes `${mtimeMs}` while
  code emits `mtimeMs.toFixed(0)` (integer ms) — harmless. GIF/BMP GPS strip returns `true` without
  action (no EXIF/GPS carriage) — defensible, matches doc intent.
- Not re-reported (already known/deferred): non-monotonic-journal machinery (C3-35), Drizzle text vs
  MEDIUMBLOB embedding modeling (AGG-C10-06), reconcile name-only coverage (AGG-C10-07), host-nginx
  drift (AGG-C10-14/C3-08op). F1 is not present in the aggregate or the carry-forward register.
