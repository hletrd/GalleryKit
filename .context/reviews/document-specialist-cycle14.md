# Document Specialist Review — Cycle 14

**Reviewer:** document-specialist
**Date:** 2026-04-20
**Scope:** CLAUDE.md accuracy, README accuracy, comment accuracy, API documentation gaps, documentation-code mismatches

---

## Findings

### DS-14-01: `adminSelectFields` does not exist in codebase

**File:** `CLAUDE.md:146`
**Claim:** "`adminSelectFields` provides full data only to authenticated admin routes"
**Mismatch:** The codebase uses `selectFields` (line 93 of `apps/web/src/lib/data.ts`) for both public and admin queries. There is no separate `adminSelectFields` export or variable anywhere in the code. The `selectFields` constant intentionally omits `latitude`, `longitude`, `filename_original`, and `user_filename` — it is NOT a "full data" field set. The `publicSelectFields` is just an alias for `selectFields` (line 134). Admin routes that need full data (e.g., `deleteImage`) select specific columns inline rather than using a shared "admin fields" constant.

**Confidence:** High
**Suggested Fix:** Replace "`adminSelectFields` provides full data only to authenticated admin routes" with something like "Admin routes that need sensitive columns (e.g., filenames for deletion) select them inline; `selectFields` intentionally omits `latitude`, `longitude`, `filename_original`, and `user_filename` for all queries by default."

---

### DS-14-02: Session secret — production refuses DB fallback, CLAUDE.md says "auto-generated and stored in DB"

**File:** `CLAUDE.md:117`
**Claim:** "Session secret: auto-generated via `crypto.randomBytes`, stored in `admin_settings` table"
**Mismatch:** The actual behavior in `apps/web/src/lib/session.ts:30-36` is:
- In **production**: `SESSION_SECRET` env var is **required** (min 32 chars). If missing, the app throws an error and refuses to start. The DB fallback is explicitly blocked in production to prevent session forgery on DB compromise.
- In **development** only: Falls back to DB-stored secret via the `INSERT IGNORE` + re-fetch pattern.

The CLAUDE.md description is misleading — it implies the DB-stored secret is the primary/default behavior, when in fact it's a dev-only fallback.

**Confidence:** High
**Suggested Fix:** Change to: "Session secret: `SESSION_SECRET` env var required in production (min 32 chars); dev-only fallback auto-generates via `crypto.randomBytes` and stores in `admin_settings` table (`INSERT IGNORE` + re-fetch for multi-process safety)."

---

### DS-14-03: Upload total size limit is 2GB, not 10GB

**File:** `CLAUDE.md:198`
**Claim:** "Max upload size: 200MB per file, 10GB total per batch, 100 files max (configurable)"
**Mismatch:** `apps/web/src/lib/upload-limits.ts:1` sets `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024` (2 GiB). The `.env.local.example` also documents this as `2147483648` (2 GiB). The code does not use 10GB anywhere.

**Confidence:** High
**Suggested Fix:** Change "10GB total per batch" to "2GB total per batch".

---

### DS-14-04: `SESSION_SECRET` is not documented in the Environment Variables section

**File:** `CLAUDE.md:70-80`
**Claim:** The Environment Variables section lists `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`.
**Mismatch:** While `SESSION_SECRET` is listed as `<random-64-char-hex>`, the actual `.env.local.example` documents it as `SESSION_SECRET=<generate-with: openssl rand -hex 32>` (which produces 64 hex chars from 32 random bytes). The CLAUDE.md format `<random-64-char-hex>` is acceptable but the env example file also documents several additional important variables not mentioned in CLAUDE.md: `BASE_URL`, `DB_SSL`, `TRUST_PROXY`, `UPLOAD_MAX_TOTAL_BYTES`, `SHARP_CONCURRENCY`, `IMAGE_MAX_INPUT_PIXELS`, `S3_*` / `MINIO_*` storage variables.

**Confidence:** Medium
**Suggested Fix:** Add a note after the env var table: "See `apps/web/.env.local.example` for the complete list of configuration options including S3/MinIO storage, proxy trust, and image processing tuning."

---

### DS-14-05: Queue concurrency default is 2, not 1

**File:** `CLAUDE.md:163`
**Claim:** "Enqueued to `PQueue` (concurrency: 1) for background processing"
**Mismatch:** `apps/web/src/lib/image-queue.ts:61` sets `concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2` — the default is 2, not 1. The `gallery-config-shared.ts` default also shows `queue_concurrency: '2'`.

**Confidence:** High
**Suggested Fix:** Change "concurrency: 1" to "concurrency: 2 (configurable via `QUEUE_CONCURRENCY` env var)".

---

### DS-14-06: Image processing generates configurable sizes, not always "4 sizes each"

**File:** `CLAUDE.md:165`
**Claim:** "Sharp processes to **AVIF/WebP/JPEG in parallel** (`Promise.all`) at 4 sizes each"
**Mismatch:** The number of sizes is configurable via admin settings (`image_sizes`). The default is 4 sizes `[640, 1536, 2048, 4096]` (from `gallery-config-shared.ts:84`), but an admin can change this. The code in `processImageFormats` iterates over the `sizes` parameter which comes from `getGalleryConfig()`.

**Confidence:** Medium
**Suggested Fix:** Change "at 4 sizes each" to "at configurable sizes each (default: 4 — 640, 1536, 2048, 4096)".

---

### DS-14-07: `tags` and `db` admin pages missing `force-dynamic`

**File:** `CLAUDE.md:186`
**Claim:** "admin pages force-dynamic"
**Mismatch:** While most admin pages use `force-dynamic`, the tags page (`apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`) and the db page (`apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`) were not found in the grep results for `force-dynamic`. This may be fine if they use server actions (which are dynamic by default), but the blanket claim "admin pages force-dynamic" is slightly inaccurate.

**Confidence:** Low
**Suggested Fix:** Verify these two pages explicitly. If they lack `force-dynamic`, either add the export or soften the CLAUDE.md claim to "most admin pages use `force-dynamic`".

---

### DS-14-08: Missing database tables from CLAUDE.md schema section

**File:** `CLAUDE.md:95-101`
**Claim:** Lists `images`, `topics`, `tags`/`imageTags`, `adminUsers`/`sessions`, `sharedGroups`/`sharedGroupImages`.
**Mismatch:** The schema (`apps/web/src/db/schema.ts`) defines additional tables not mentioned:
- `topicAliases` — stores alternate slugs for topics (used by `getTopicBySlug`)
- `adminSettings` — stores gallery configuration and session secret
- `auditLog` — stores audit events for admin actions
- `rateLimitBuckets` — MySQL-backed persistent rate limiting

**Confidence:** High
**Suggested Fix:** Add to the Database Schema section:
- `topicAliases` - Alternate slugs for topics (alias → topic mapping)
- `adminSettings` - Key-value store for gallery configuration and secrets
- `auditLog` - Audit trail for admin actions
- `rateLimitBuckets` - Persistent per-IP rate limiting counters

---

### DS-14-09: Key Files table lists `actions.ts` but code has split action modules

**File:** `CLAUDE.md:86`
**Claim:** "`apps/web/src/app/actions.ts` | Server actions for uploads, image CRUD, auth, session management"
**Mismatch:** `actions.ts` is now a barrel re-export file (7 lines). The actual logic lives in split modules:
- `apps/web/src/app/actions/auth.ts` — Auth, sessions, login, logout
- `apps/web/src/app/actions/images.ts` — Upload, delete, update image metadata
- `apps/web/src/app/actions/topics.ts` — Topic CRUD
- `apps/web/src/app/actions/tags.ts` — Tag management
- `apps/web/src/app/actions/sharing.ts` — Share links and groups
- `apps/web/src/app/actions/admin-users.ts` — Admin user management
- `apps/web/src/app/actions/public.ts` — Public-facing actions
- `apps/web/src/app/actions/seo.ts` — SEO settings

**Confidence:** High
**Suggested Fix:** Update the Key Files table to list the actual action modules instead of the barrel file, or at minimum note that `actions.ts` is a barrel re-export and point to the individual modules.

---

### DS-14-10: Login rate limiting uses dual-layer (in-memory + DB), CLAUDE.md only mentions in-memory

**File:** `CLAUDE.md:119`
**Claim:** "Login rate limiting: 5 attempts per 15-minute window per IP, with bounded Map + LRU eviction"
**Mismatch:** The actual implementation (`apps/web/src/lib/rate-limit.ts` and `apps/web/src/app/actions/auth.ts`) uses a **dual-layer** approach:
1. In-memory `Map` as fast-path cache (bounded by `LOGIN_RATE_LIMIT_MAX_KEYS = 5000`)
2. MySQL-backed `rateLimitBuckets` table as persistent source of truth (survives restarts)

The login action checks both layers: the in-memory Map first, then falls back to DB for accuracy across restarts. The DB layer is not mentioned at all.

**Confidence:** High
**Suggested Fix:** Change to: "Login rate limiting: 5 attempts per 15-minute window per IP, with dual-layer enforcement — in-memory Map (fast path, bounded at 5K keys) + MySQL `rate_limit_buckets` table (persistent across restarts)"

---

### DS-14-11: Session cookie `secure` attribute logic differs from documentation

**File:** `CLAUDE.md:116`
**Claim:** "Cookie attributes: `httpOnly`, `secure` (in production), `sameSite: lax`, `path: /`"
**Mismatch:** The actual code in `apps/web/src/app/actions/auth.ts:172-174` sets `secure` based on:
```ts
const forwardedProto = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
const requestIsHttps = forwardedProto === 'https';
const requireSecureCookie = requestIsHttps || process.env.NODE_ENV === 'production';
```
So `secure` is set when **either** the request comes via HTTPS (checking `X-Forwarded-Proto`) **or** in production mode. This is slightly broader than "in production" — it also applies to any HTTPS connection in development.

**Confidence:** Low
**Suggested Fix:** Change to "Cookie attributes: `httpOnly`, `secure` (when behind HTTPS or in production), `sameSite: lax`, `path: /`"

---

### DS-14-12: `site-config.json` path differs from Key Files table

**File:** `CLAUDE.md:93`
**Claim:** "`apps/web/src/site-config.json` | Site metadata (title, SEO, links)"
**Mismatch:** The file actually exists at `apps/web/src/site-config.json` (confirmed by `site-config.example.json` glob result), which matches. However, the Deployment Checklist (line 219) says "Copy `site-config.example.json` to `site-config.json`" without specifying the path. The actual example file is at `apps/web/src/site-config.example.json`. This could be confusing for new users.

**Confidence:** Medium
**Suggested Fix:** In the Deployment Checklist, change step 3 to: "Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json`"

---

### DS-14-13: Image processing pipeline step order differs between two documented sections

**File:** `CLAUDE.md:103-109` vs `CLAUDE.md:159-169`
**Claim:** The "Image Upload Flow" section (lines 103-109) says:
1. Upload → 2. Save original → 3. Sharp processes → 4. EXIF extracted → 5. Processed files saved

The "Image Processing Pipeline" section (lines 159-169) describes a different order:
1. Upload → 2. Save original → 3. Enqueue to PQueue → 4. Claim → 5. Process formats → 6. Extract EXIF → 7. Verify → 8. Mark processed

**Mismatch:** The Upload Flow section is a simplified overview but is misleading because:
- EXIF extraction happens **before** format processing (in `saveOriginalAndGetMetadata`), not after (step 4 in Upload Flow implies sequential order after Sharp processing)
- The queue/enqueue step is completely missing from the Upload Flow section
- Blur placeholder generation happens during `saveOriginalAndGetMetadata`, not as a separate step after processing

**Confidence:** High
**Suggested Fix:** Add a note to the "Image Upload Flow" section that it's a simplified overview and point to the "Image Processing Pipeline" section for the detailed sequence. Or update the Upload Flow to include the enqueue step.

---

### DS-14-14: `uploadImages` server action doc says "async queue" but actual flow is fire-and-forget queue

**File:** `CLAUDE.md:107`
**Claim:** "Sharp processes to AVIF/WebP/JPEG (async queue)"
**Mismatch:** The upload flow is: save original → insert DB row as `processed: false` → enqueue to PQueue → return immediately to client. The actual Sharp processing happens later in the queue worker. The word "async queue" is ambiguous — it could be interpreted as "Sharp processes asynchronously within the request" rather than "the job is queued for later background processing."

**Confidence:** Medium
**Suggested Fix:** Change "Sharp processes to AVIF/WebP/JPEG (async queue)" to "Image enqueued for background Sharp processing (AVIF/WebP/JPEG)"

---

### DS-14-15: Connection pool `keepalive` config uses different property names

**File:** `CLAUDE.md:157`
**Claim:** "Connection pool: 10 connections, queue limit 20, keepalive enabled."
**Mismatch:** The actual config in `apps/web/src/db/index.ts:18-23` uses `enableKeepAlive: true` and `keepAliveInitialDelay: 30000`. While functionally correct, the property is `enableKeepAlive` (two words), not "keepalive" (one word). Minor terminology difference.

**Confidence:** Low
**Suggested Fix:** Change "keepalive enabled" to "keepAlive enabled (30s initial delay)" for precision.

---

### DS-14-16: Repo structure shows `apps/web/src/app/actions.ts` but actual structure has `actions/` directory

**File:** `CLAUDE.md:31`
**Claim:** Repository structure shows `└── actions.ts    # Server actions (uploads, CRUD)`
**Mismatch:** In addition to `actions.ts` (barrel re-export), there is an `actions/` directory containing the split modules: `auth.ts`, `images.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `admin-users.ts`, `public.ts`, `seo.ts`.

**Confidence:** Medium
**Suggested Fix:** Update the repository structure to show:
```
│   │   │   ├── actions.ts    # Barrel re-export for server actions
│   │   │   └── actions/      # Split server action modules
```

---

## Summary

| ID | Severity | Category | Confidence | File |
|----|----------|----------|------------|------|
| DS-14-01 | High | Factual error | High | CLAUDE.md:146 |
| DS-14-02 | High | Misleading description | High | CLAUDE.md:117 |
| DS-14-03 | High | Factual error | High | CLAUDE.md:198 |
| DS-14-04 | Medium | Incomplete docs | Medium | CLAUDE.md:70-80 |
| DS-14-05 | High | Factual error | High | CLAUDE.md:163 |
| DS-14-06 | Medium | Imprecise description | Medium | CLAUDE.md:165 |
| DS-14-07 | Low | Potentially imprecise | Low | CLAUDE.md:186 |
| DS-14-08 | High | Missing documentation | High | CLAUDE.md:95-101 |
| DS-14-09 | High | Stale documentation | High | CLAUDE.md:86 |
| DS-14-10 | High | Incomplete description | High | CLAUDE.md:119 |
| DS-14-11 | Low | Slightly imprecise | Low | CLAUDE.md:116 |
| DS-14-12 | Medium | Ambiguous path | Medium | CLAUDE.md:219 |
| DS-14-13 | High | Contradictory sections | High | CLAUDE.md:103-109 vs 159-169 |
| DS-14-14 | Medium | Ambiguous wording | Medium | CLAUDE.md:107 |
| DS-14-15 | Low | Terminology mismatch | Low | CLAUDE.md:157 |
| DS-14-16 | Medium | Stale structure | Medium | CLAUDE.md:31 |

**Total findings:** 16 (8 High, 5 Medium, 3 Low)

**Top priority fixes:** DS-14-01, DS-14-03, DS-14-05, DS-14-08, DS-14-09 — these are factual errors or missing information that could mislead developers or AI assistants.
