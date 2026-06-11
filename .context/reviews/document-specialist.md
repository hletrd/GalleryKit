# Document Specialist Review — R5C1
Generated: 2026-06-11

## Scope
Full documentation audit: CLAUDE.md, AGENTS.md, README files, .env.local.example, package.json scripts,
in-code comments, i18n key parity, and key external platform claims.

---

## Findings

### DOC-R5C1-01 — CLAUDE.md: settingsHash ETag formula lists only 3 keys, actual hash covers 10
- **Doc location:** CLAUDE.md line 257 (ETag/cache invalidation section)
- **Code location:** `apps/web/src/lib/settings-hash.ts` — `COLOR_IMPACTING_KEYS` constant
- **Mismatch:** CLAUDE.md states the settings hash "covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`". The actual `COLOR_IMPACTING_KEYS` array covers 10 keys: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`.
- **Also:** CLAUDE.md writes `settingsHash.slice(0,8)` in the ETag formula, but `getServingColorSettingsHash()` already returns exactly 8 chars (it calls `.slice(0, HASH_LENGTH)` internally). The ETag code uses `${settingsHash}` directly — no extra `.slice(0,8)` at the call site. The formula in the docs is misleading but the output is correct.
- **Why it matters:** An operator or developer who adds a new quality setting assumes the 3-item list is complete and may not add their new key, causing a cache-invalidation gap where browsers keep stale derivatives after a setting flip.
- **Suggested fix:** Update CLAUDE.md to reference the full `COLOR_IMPACTING_KEYS` list (or simply say "all color-impacting admin settings — see `settings-hash.ts`"), and remove the spurious `.slice(0,8)` from the ETag formula since it's already done inside the hash function.
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Classification:** Doc omission + misleading formula

---

### DOC-R5C1-02 — CLAUDE.md: BACKFILL_CONCURRENCY env var name mismatch between sidecar script and admin runner
- **Doc location:** CLAUDE.md — Backfill section (sidecar docker command uses `-e BACKFILL_CONCURRENCY=2`)
- **Code locations:**
  - `apps/web/scripts/backfill-color-pipeline.ts` line 287: `process.env.BACKFILL_CONCURRENCY` (default 2)
  - `apps/web/src/lib/admin-backfill-runner.ts` line 308: `process.env.ADMIN_BACKFILL_CONCURRENCY` (default 1)
- **Mismatch:** The two backfill entry points use *different* env var names. The sidecar CLI script uses `BACKFILL_CONCURRENCY`; the in-app admin button runner uses `ADMIN_BACKFILL_CONCURRENCY`. CLAUDE.md documents only `BACKFILL_CONCURRENCY` in the sidecar docker command — the admin runner's `ADMIN_BACKFILL_CONCURRENCY` is undocumented entirely. The defaults also differ (2 vs 1).
- **Why it matters:** An operator who sets `BACKFILL_CONCURRENCY=1` to throttle resource usage when running the in-app backfill has no effect. Conversely, they cannot tune the admin runner without knowing the undocumented `ADMIN_BACKFILL_CONCURRENCY` name. Both CLAUDE.md and .env.local.example are silent about `ADMIN_BACKFILL_CONCURRENCY`.
- **Suggested fix:** (1) Align the two runners to use the same env var (or document both clearly with their distinct defaults), (2) add `ADMIN_BACKFILL_CONCURRENCY` to .env.local.example with a comment.
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Classification:** Doc omission + naming inconsistency

---

### DOC-R5C1-03 — CLAUDE.md: Deployment Checklist step 3 omits `src/` subdirectory for site-config.json
- **Doc location:** CLAUDE.md — Deployment Checklist, step 3: "Copy `site-config.example.json` to `site-config.json`"
- **Code location:** `apps/web/scripts/ensure-site-config.mjs` line 4: `path.resolve(process.cwd(), 'src', 'site-config.json')`; actual file at `apps/web/src/site-config.example.json`
- **Mismatch:** The checklist says `site-config.example.json → site-config.json` without mentioning the `src/` prefix. Both the example file and the expected destination are under `apps/web/src/`. A reader following the checklist from the repo root would copy to the wrong location, causing a build-time failure.
- **Why it matters:** First-time deployers following the checklist will create `apps/web/site-config.json` (or `site-config.json` at root), the build guard will still fail, and the error message from `ensure-site-config.mjs` ("Missing required src/site-config.json") may not be immediately obvious.
- **Suggested fix:** Change to: "Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json` and customize it."
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Classification:** Misleading path in deployment instructions

---

### DOC-R5C1-04 — .env.local.example: Multiple production-relevant env vars entirely absent
- **Doc location:** `apps/web/.env.local.example`
- **Code locations:** various `src/` files
- **Mismatch:** The following env vars are read in production code but not documented in `.env.local.example`:
  - `UPLOAD_ORIGINAL_ROOT` — controls where original uploads are stored (critical for Docker volume mapping; explicitly used in the sidecar backfill command in CLAUDE.md)
  - `UPLOAD_ROOT` — controls where processed derivatives are stored (defaults to `public/uploads`, but can be overridden)
  - `ADMIN_BACKFILL_CONCURRENCY` — controls in-app backfill concurrency (see DOC-R5C1-02)
  - `IMAGE_CLEANUP_CONCURRENCY` — controls batch delete concurrency (default 5); relevant for NAS deployments
  - `NEXT_PUBLIC_HDR_FEATURE_FLAG` — feature flag for HDR UI; `true` enables HDR UI paths; no documentation anywhere
  - `NEXT_PUBLIC_GA_ID` — used in CSP generation alongside `site-config.json`'s `google_analytics_id`; their interaction is undocumented
  - `NEXT_UPLOAD_BODY_MAX_BYTES` — overrides the Next.js server action body size limit (calculated from upload caps); absent from docs
- **Why it matters:** Operators cannot tune these without reading source code. `UPLOAD_ORIGINAL_ROOT` is particularly important: the Docker example in CLAUDE.md already passes it as a sidecar env var, but neither .env.local.example nor the main deployment instructions mention it for the primary container.
- **Suggested fix:** Add commented-out entries for all of these to `.env.local.example` with their defaults and effect descriptions.
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Classification:** Doc omission (env vars)

---

### DOC-R5C1-05 — CLAUDE.md: React cache() claim uses old (non-`Cached`) function names
- **Doc location:** CLAUDE.md line 347: "React `cache()` wraps `getImage`, `getTopicBySlug`, `getTopicsWithAliases` for SSR deduplication"
- **Code location:** `apps/web/src/lib/data.ts` lines 1558–1562: cached variants are exported as `getImageCached`, `getTopicBySlugCached`, `getTopicsWithAliasesCached`, etc.
- **Mismatch:** The documented names (`getImage`, `getTopicBySlug`, `getTopicsWithAliases`) are the *unwrapped* functions. The `cache()`-wrapped variants have a `Cached` suffix and are distinct exports. Using the non-`Cached` names in server components bypasses request-level deduplication.
- **Why it matters:** A developer adding a new page who follows CLAUDE.md and calls `getImage()` directly instead of `getImageCached()` will bypass the cache and issue duplicate DB queries per request. The performance claim in the docs is misleading about the actual API surface.
- **Suggested fix:** Update CLAUDE.md to reference the `*Cached` export names, or clarify that the `cache()` wrapping is available via the `Cached`-suffixed exports.
- **Severity:** LOW
- **Confidence:** HIGH
- **Classification:** Stale function name reference

---

### DOC-R5C1-06 — CLAUDE.md: "Vitest 1300+ unit tests" — actual count is lower
- **Doc location:** AGENTS.md line: "Vitest 1300+ unit tests including the touch-target audit"
- **Code location:** `apps/web/src/__tests__/` directory
- **Mismatch:** File count: 186 test files; `it`/`test`/`describe` block count: 346. Even counting all assertions, "1300+" is a significant overstatement if interpreted as individual test cases.
- **Why it matters:** Misleads developers about the depth of test coverage; may lead to overconfidence in the test suite's completeness.
- **Suggested fix:** Update to reflect actual counts. If "1300+" refers to assertions rather than test cases, clarify this.
- **Severity:** LOW
- **Confidence:** MEDIUM (automated counting of describe/it blocks may undercount; some tests use `it.each` or dynamic generation not captured by line grep)
- **Classification:** Numerical overstatement

---

### DOC-R5C1-07 — CLAUDE.md: Serving precedence claim about `app/uploads/[...path]` executing "only for locale-prefixed URLs and for files missing from public/" — code has BOTH a non-locale and a locale-prefixed route
- **Doc location:** CLAUDE.md line 255: "The `app/uploads/[...path]` route … executes only for locale-prefixed `/{locale}/uploads/...` URLs and for files missing from `public/`."
- **Code location:** Two route files exist:
  - `apps/web/src/app/uploads/[...path]/route.ts` — non-locale-prefixed `/uploads/...`
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts` — locale-prefixed `/{locale}/uploads/...`
- **Mismatch:** The documentation only acknowledges the locale-prefixed twin and says the non-locale route "executes only for files missing from public/". In fact both routes exist and serve requests independently. The non-locale route (`/uploads/[...path]`) is the *primary* dynamic route (processes HEAD correctly per its own comments), and the locale-prefixed one is a twin. The CLAUDE.md description conflates the two and implies the primary path is only a fallback.
- **Why it matters:** Developers adding caching logic, security headers, or auth to the upload route may edit only one of the two routes, leaving the other unpatched.
- **Suggested fix:** Clarify that two upload routes exist: the primary non-locale `/uploads/[...path]` and the locale-prefixed `/{locale}/uploads/[...path]`, both delegating to `serveUploadFile`.
- **Severity:** LOW
- **Confidence:** HIGH
- **Classification:** Incomplete/misleading serving topology description

---

### DOC-R5C1-08 — CLAUDE.md: settings-hash.ts "covers `wide_gamut_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`" in Key Files table is incomplete (same root cause as DOC-R5C1-01 but in a different location)
- **Doc location:** CLAUDE.md line 100 (Key Files table): "`apps/web/src/lib/settings-hash.ts` | 8-char SHA-256 prefix over color-impacting admin settings…"
- **Code location:** `apps/web/src/lib/settings-hash.ts` `COLOR_IMPACTING_KEYS`
- **Mismatch:** The Key Files table description is generic enough ("color-impacting admin settings") to not enumerate keys, so this is less misleading than the ETag section. The ETag section (DOC-R5C1-01) is the more actionable finding; this is a note for completeness.
- **Severity:** LOW
- **Confidence:** HIGH
- **Classification:** Doc omission (minor — key files table entry)

---

### DOC-R5C1-09 — CLAUDE.md: "React `cache()` deduplication" table entry and "getTopicsWithAliases" inconsistency — `getTopics` cached not `getTopicsWithAliases` exclusively
- **Doc location:** CLAUDE.md line 347: lists only `getImage`, `getTopicBySlug`, `getTopicsWithAliases`
- **Code location:** `apps/web/src/lib/data.ts` lines 1558–1610: additionally `getTopicsCached`, `getTagsCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSeoSettings`, `getSmartCollectionBySlugCached` are all wrapped
- **Mismatch:** The documented list is incomplete — only 3 of 9 cache-wrapped functions are named.
- **Why it matters:** Same impact as DOC-R5C1-05 — developer following docs may call unwrapped versions.
- **Suggested fix:** Either list all cached exports or say "several data-access functions are wrapped — see `data.ts` exports ending in `Cached`."
- **Severity:** LOW
- **Confidence:** HIGH
- **Classification:** Incomplete enumeration

---

### DOC-R5C1-10 — .env.local.example documents `SHARP_CONCURRENCY` comment incorrectly: says "Upper bound for Sharp/libvips threads; runtime caps at CPU parallelism - 1" but code may differ
- **Doc location:** `apps/web/.env.local.example`: `# SHARP_CONCURRENCY=10  # Upper bound for Sharp/libvips threads; runtime caps at CPU parallelism - 1`
- **Code location:** `apps/web/src/lib/process-image.ts` lines 41–44
- **Note:** The "CPU parallelism - 1" runtime cap description cannot be directly verified from the snippet alone; this requires checking sharp API. Sharp's `concurrency()` method does accept an integer override. The claim in the comment is generally accurate per Sharp's documented behavior. Marking as informational — not a confirmed mismatch.
- **Severity:** INFO
- **Confidence:** LOW
- **Classification:** Unverified claim (likely correct)

---

### DOC-R5C1-11 — CLAUDE.md: "Deployment Checklist" is missing `npm install` step and uses ambiguous workspace context
- **Doc location:** CLAUDE.md — Deployment Checklist (numbered list)
- **Mismatch:** The checklist jumps from env config to `docker compose up --build` without an explicit `npm install` step. The "Common Commands" section at top says `npm install` should be run first. This is minor since Docker handles it, but the checklist itself doesn't clarify that Docker handles install.
- **Severity:** INFO
- **Confidence:** HIGH
- **Classification:** Incomplete workflow documentation (minor)

---

### DOC-R5C1-12 — i18n key parity: VERIFIED CLEAN
- EN: 829 keys, KO: 829 keys, zero discrepancies.
- **No findings.**

---

### DOC-R5C1-13 — Firefox `color-gamut` MQ claim: VERIFIED ACCURATE
- CLAUDE.md states Firefox has no `(color-gamut: p3)` MQ support. Web search (caniuse.com, MDN, mdn/browser-compat-data#21422) confirms this remains the case as of mid-2026. The "no implementation as of Firefox 137" note is accurate; the bug is open.
- **No findings.**

---

### DOC-R5C1-14 — Sharp 0.33+ `withMetadata` behavior: VERIFIED ACCURATE
- CLAUDE.md and gps-exif-strip.ts comments both correctly state that `withMetadata()` in Sharp 0.33+ keeps all EXIF. Current version is `^0.34.5`. The claim is accurate.
- **No findings.**

---

### DOC-R5C1-15 — SESSION_SECRET described as "required in production" but .env.local.example says it's "not an init-time requirement"
- **Doc location:** CLAUDE.md: "Session secret: `SESSION_SECRET` env var is required in production" vs. apps/web/README.md: "`SESSION_SECRET` is required for production runtime session signing, but it is not an init-time requirement."
- **Mismatch:** Not a contradiction — both are consistent. CLAUDE.md says required in production runtime; README.md clarifies not needed at `npm run init` time. Both are accurate. Documenting for completeness.
- **No findings.**

---

### DOC-R5C1-16 — CLAUDE.md: `app/uploads/[...path]` route described as executing "for locale-prefixed URLs" — but the non-locale-prefixed route is the primary one
- Already captured in DOC-R5C1-07.

---

### DOC-R5C1-17 — CLAUDE.md: DB pool described as "keepalive enabled" — VERIFIED ACCURATE
- `apps/web/src/db/index.ts`: `enableKeepAlive: true, keepAliveInitialDelay: 30000`. Matches.
- **No findings.**

---

### DOC-R5C1-18 — CLAUDE.md: Session purge described as "hourly background job" — VERIFIED ACCURATE  
- `apps/web/src/lib/image-queue.ts` line 661: `setInterval(…, 60 * 60 * 1000); // every hour`. Matches.
- **No findings.**

---

### DOC-R5C1-19 — CLAUDE.md: "login rate limiting: 5 attempts / 15-min window" — VERIFIED ACCURATE
- `apps/web/src/lib/rate-limit.ts`: `LOGIN_WINDOW_MS = 15 * 60 * 1000`, `LOGIN_MAX_ATTEMPTS = 5`. Matches.
- **No findings.**

---

### DOC-R5C1-20 — CLAUDE.md: IMAGE_PIPELINE_VERSION = 7 — VERIFIED ACCURATE
- `apps/web/src/lib/gallery-config-shared.ts` line 21: `export const IMAGE_PIPELINE_VERSION = 7;`. Matches.
- **No findings.**

---

### DOC-R5C1-21 — CLAUDE.md: "admin-configurable up to 8 sizes" — VERIFIED ACCURATE
- `gallery-config-shared.ts` line 137: `MAX_IMAGE_SIZE_COUNT = 8`. Matches.
- **No findings.**

---

### DOC-R5C1-22 — CLAUDE.md: default image sizes "640, 1536, 2048, 4096, 5120, 7680" — VERIFIED ACCURATE
- `gallery-config-shared.ts` line 90: `DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096, 5120, 7680]`. Matches.
- **No findings.**

---

### DOC-R5C1-23 — CLAUDE.md: nginx body caps (2 MiB default, 64 KiB login, 250 MiB /admin/db, 216 MiB admin dashboard) — VERIFIED ACCURATE
- `apps/web/nginx/default.conf` confirms all four values. Matches.
- **No findings.**

---

### DOC-R5C1-24 — CLAUDE.md: "blur_data_url capped at 4 KB" — Technically 4096 *characters* not 4096 bytes
- **Doc location:** CLAUDE.md: "the payload is capped at 4 KB"
- **Code location:** `apps/web/src/lib/blur-data-url.ts` line 45: `MAX_BLUR_DATA_URL_LENGTH = 4096` (characters)
- **Mismatch:** The cap is 4096 characters (string length), not 4096 bytes. Base64 encodes ~3 bytes per 4 chars, so the actual data cap is ~3072 bytes. "4 KB" is slightly misleading.
- **Severity:** INFO
- **Confidence:** HIGH
- **Classification:** Minor unit imprecision

---

### DOC-R5C1-25 — AGENTS.md: ".context/plans/ is gitignored" — VERIFIED ACCURATE
- `.gitignore` contains `.context/*` with only `!.context/reviews/` and `!.context/reviews/**` exceptions, so `.context/plans/` is indeed gitignored. Matches.
- **No findings.**

---

### DOC-R5C1-26 — AGENTS.md: "Vitest 1300+ unit tests" (same as DOC-R5C1-06, also appears in AGENTS.md)
- Already captured in DOC-R5C1-06.

---

### DOC-R5C1-27 — Root package.json `build` script uses `--workspaces` (plural) but `dev`/`start`/etc. use `--workspace=apps/web`
- **Doc location:** CLAUDE.md Common Commands: "`npm run build` — Build for production" (from repo root)
- **Code location:** `/Users/hletrd/flash-shared/gallery/package.json` scripts
- **Note:** Root `build` is `npm run build --workspaces` which builds all workspaces; `dev` is `npm run dev --workspace=apps/web`. This is not a doc bug — the behavior is intentional for a monorepo — but CLAUDE.md doesn't note that `build` from root builds all workspaces. Informational only.
- **Severity:** INFO
- **Confidence:** HIGH
- **Classification:** Undocumented monorepo behavior

---

### DOC-R5C1-28 — CLAUDE.md: `npm run deploy` documented as reading `.env.deploy` — VERIFIED ACCURATE
- Root `package.json`: `"deploy": "./scripts/deploy-remote.sh"`. AGENTS.md and CLAUDE.md both say it reads `.env.deploy`. Consistent.
- **No findings.**

---

## Summary Table

| ID | Severity | Confidence | Description |
|----|----------|-----------|-------------|
| DOC-R5C1-01 | MEDIUM | HIGH | settingsHash ETag docs list only 3 of 10 COLOR_IMPACTING_KEYS; spurious `.slice(0,8)` in formula |
| DOC-R5C1-02 | MEDIUM | HIGH | BACKFILL_CONCURRENCY (script) vs ADMIN_BACKFILL_CONCURRENCY (admin runner) — different names, different defaults, only one documented |
| DOC-R5C1-03 | MEDIUM | HIGH | Deployment Checklist step 3 omits `src/` prefix for site-config.json path |
| DOC-R5C1-04 | MEDIUM | HIGH | 7 production-relevant env vars absent from .env.local.example |
| DOC-R5C1-05 | LOW | HIGH | React cache() docs use non-`Cached` function names; actual exports have `Cached` suffix |
| DOC-R5C1-06 | LOW | MEDIUM | "1300+ unit tests" overstated; grep shows ~346 test blocks in 186 files |
| DOC-R5C1-07 | LOW | HIGH | Serving topology docs acknowledge only locale-prefixed upload route; two routes exist |
| DOC-R5C1-08 | LOW | HIGH | Key Files table settings-hash.ts description incomplete (minor, see DOC-R5C1-01) |
| DOC-R5C1-09 | LOW | HIGH | React cache() wrapper list only names 3 of 9 cached functions |
| DOC-R5C1-24 | INFO | HIGH | "4 KB" blur cap is actually 4096 chars (~3 KB data) |
| DOC-R5C1-12 | CLEAN | — | i18n EN/KO parity: 829/829 keys, zero discrepancies |
| DOC-R5C1-13 | CLEAN | — | Firefox color-gamut MQ claim verified accurate |
| DOC-R5C1-14 | CLEAN | — | Sharp 0.33+ withMetadata claim verified accurate |
| DOC-R5C1-18 | CLEAN | — | Hourly session purge verified accurate |
| DOC-R5C1-19 | CLEAN | — | Login rate limit 5/15-min verified accurate |
| DOC-R5C1-20 | CLEAN | — | IMAGE_PIPELINE_VERSION = 7 verified accurate |

## Counts by Severity
- **CRITICAL:** 0
- **HIGH:** 0
- **MEDIUM:** 4 (DOC-R5C1-01 through DOC-R5C1-04)
- **LOW:** 5 (DOC-R5C1-05 through DOC-R5C1-09)
- **INFO:** 3 (DOC-R5C1-24, DOC-R5C1-27, DOC-R5C1-11)
- **CLEAN/VERIFIED:** 9

