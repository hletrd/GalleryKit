# Cycle 22 — Document-Specialist Review

**Date:** 2026-06-29
**Scope:** CLAUDE.md factual accuracy verification — exact numbers, env var defaults, advisory lock names, schema columns, Key Files table, line refs.
**Cycle-21 closure check:** All four cycle-21 doc findings (DOC21-M1, G1, G2, G3) verified closed in current on-disk CLAUDE.md.

---

## Cycle-21 Closure Verification

| Finding | Status |
|---------|--------|
| DOC21-M1: advisory lock scope note "topic renames" broadened to include createTopic/alias | CLOSED |
| DOC21-G1: color_space / icc_profile_name / bit_depth admin-only labels in images table | CLOSED |
| DOC21-G2: Race Condition Protections missing advisory lock for topic CREATE/alias | CLOSED |
| DOC21-G3: SHARP_CONCURRENCY default formula not documented | CLOSED |

---

## Verified MATCHES

All values below were verified against the cited code files.

| Claim (CLAUDE.md) | Code site | Result |
|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` | MATCH |
| `COLOR_IMPACTING_KEYS` count = 9 | `settings-hash.ts:45-57` (9 entries) | MATCH |
| `HASH_LENGTH = 8` | `settings-hash.ts:71` | MATCH |
| Connection pool 10 / queue 20 | `db/index.ts:23` `POOL_CONNECTION_LIMIT=10`, `db/index.ts:33` `queueLimit:20` | MATCH |
| Login rate limit: 5 attempts / 15-min window | `rate-limit.ts:61` `LOGIN_MAX_ATTEMPTS=5`, `rate-limit.ts:60` `LOGIN_WINDOW_MS=15*60*1000` | MATCH |
| `VIEW_RETENTION_DAYS` default = 395 days | `lib/view-retention.ts:29` `DEFAULT_VIEW_RETENTION_MS = 395 * 24 * 60 * 60 * 1000` | MATCH |
| `AUDIT_LOG_RETENTION_DAYS` default = 90 days | `lib/audit.ts:95` "Default retention: 90 days. Override with AUDIT_LOG_RETENTION_DAYS env var." | MATCH |
| Upload cap: 200 MiB / file | `lib/upload-limits.ts:3` `MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024` | MATCH |
| Upload cap: 2 GiB batch | `lib/upload-limits.ts:1` `DEFAULT_MAX_TOTAL_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024` | MATCH |
| Upload cap: 100 files per window | `lib/upload-limits.ts:2` `DEFAULT_MAX_FILES_PER_WINDOW = 100` | MATCH |
| Nginx body caps: 2M default / 64K login / 250M admin/db / 216M uploads / 216M lr/upload | `nginx/default.conf:31,58,75,92,132` | MATCH |
| Admin token format: `gk_<base64url(32 bytes)>`, 46 chars, SHA-256-hashed | `lib/admin-tokens.ts:19-22` `TOKEN_PREFIX='gk_'`, `TOKEN_RANDOM_BYTES=32`, `TOKEN_PLAINTEXT_LENGTH=46` | MATCH |
| Token header: `x-gallerykit-token` | `lib/api-auth.ts:14` `const TOKEN_HEADER = 'x-gallerykit-token'` | MATCH |
| `SEMANTIC_SCAN_LIMIT` default = 2000 | `lib/clip-embeddings.ts:30-31` | MATCH |
| `SEMANTIC_TOP_K_MAX` default = 50 | `lib/clip-embeddings.ts:30-31` | MATCH |
| Advisory lock names: 6 named locks | `gallerykit_db_restore`, `_upload_processing_contract`, `_topic_route_segments`, `_admin_delete`, `_color_pipeline_backfill`, `image-processing:{jobId}` — all confirmed in source | MATCH |
| `image_views(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` indexes — migration 0021 | `drizzle/0021_analytics_breakdown_indexes.sql:7-8` | MATCH |
| `schema.ts:297` — `smart_collections.query_json` | `db/schema.ts:297` `query_json: text("query_json").notNull()` | MATCH |
| Deployment Checklist site-config keys are snake_case (title, description, url, locale, author, nav_title, home_link, footer_text, google_analytics_id) | `src/site-config.example.json` has identical snake_case keys | MATCH |
| `MAX_RESTORE_FILE_BYTES = 250 MiB` | `lib/upload-limits.ts:4` `MAX_RESTORE_FILE_BYTES = 250 * 1024 * 1024` | MATCH (matches nginx 250M) |
| `SERVER_ACTION_BODY_OVERHEAD_BYTES = 16 MiB` | `lib/upload-limits.ts:5` `SERVER_ACTION_BODY_OVERHEAD_BYTES = 16 * 1024 * 1024` | MATCH |

---

## MISMATCHES

### DOC22-M1 — `NEXT_UPLOAD_BODY_MAX_BYTES` default numeric literal is wrong
**Severity:** LOW

**CLAUDE.md claim (Optional Operational Variables table):**
```
| `NEXT_UPLOAD_BODY_MAX_BYTES` | `279620608` | Next.js server action body size limit (default ~266 MiB) |
```

**Code reality (`lib/upload-limits.ts:4-6`):**
```ts
export const MAX_RESTORE_FILE_BYTES = 250 * 1024 * 1024;           // 250 MiB = 262,144,000 bytes
export const SERVER_ACTION_BODY_OVERHEAD_BYTES = 16 * 1024 * 1024; // 16 MiB = 16,777,216 bytes
const DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES =
    Math.max(MAX_UPLOAD_FILE_BYTES, MAX_RESTORE_FILE_BYTES)         // max(200, 250) MiB = 250 MiB
    + SERVER_ACTION_BODY_OVERHEAD_BYTES;                            // + 16 MiB = 266 MiB
// = 266 * 1024 * 1024 = 278,921,216 bytes
```

The correct computed default is **278,921,216** (exactly 266 MiB). CLAUDE.md says **279,620,608**, which differs by 699,392 bytes.

The description "~266 MiB" is correct. Only the exact literal is stale.

**Fix:** Change `279620608` → `278921216` in the Optional Operational Variables table.

---

### DOC22-M2 — `process-image.ts` line refs are stale
**Severity:** LOW

**CLAUDE.md claim (Image Processing Pipeline / Color Pipeline section):**
> "(`process-image.ts:1088-1089` removes the shared `image` var; the per-path WI-14 note is at `:1157`)"

**Code reality:**
- Lines 1088-1089 of `process-image.ts` are the mmap/stream comment:
  ```
  1088: // Use file path so Sharp can mmap/stream instead of buffering on the heap.
  1089: // CM-HIGH-3: failOn:'error' rejects truncated/corrupt input; sequentialRead:true
  ```
- The R8-R8 "shared `image` variable removed" comment is at lines **1093-1094**.
- The WI-14 comment is at line **1162** (not 1157):
  ```
  1162: // WI-14 / R8-R8: fresh sharp instance per format for ALL paths,
  ```
- Line 1157 is a continuation of the DCI-P3 / WI-12 ICC rationale (`//     adaptation.`), not the WI-14 note.

**Fix:** Update the inline reference to `:1093-1094` (R8-R8 shared-var removal) and `:1162` (WI-14). Note that line numbers will continue to drift; consider removing pinned line numbers from prose and relying on grep anchors instead.

---

### DOC22-M3 — "validated at startup" for `siteConfig.url` is inaccurate
**Severity:** MEDIUM

**CLAUDE.md claims (two locations):**

*Security Architecture / OG SSRF hardening (line 212):*
> "The `url` field is validated at startup (must be absolute HTTPS without credentials), so a misconfigured deployment fails loud at build time rather than silently serving broken OG cards."

*Deployment Checklist (line 631):*
> "`url` — canonical base URL (must match `BASE_URL` env var); **validated at startup as absolute HTTPS without credentials**"

**Code reality:**
- `src/instrumentation.ts`: no validation of `siteConfig.url` — only `assertNoLegacyPublicOriginalUploads`, `bootstrapImageProcessingQueue`, geoip-lite pre-warm, and SIGTERM handler.
- `next.config.ts`: no site-config URL validation.
- `content-security-policy.ts` validates `IMAGE_BASE_URL` (the CDN prefix), not `siteConfig.url`.
- Actual behavior: `src/app/api/og/photo/[id]/route.tsx:113` wraps `new URL(siteConfig.url)` in a try/catch at **request time** and returns 404 when the URL is invalid. This is correct fail-closed behavior, but it is per-request, not at startup.

**Operator impact:** An operator who mistyped the `url` field in `site-config.json` would expect an immediate container startup failure (which would be visible in `docker compose logs`). Instead, the container starts normally and the failure surfaces only when an OG image is requested — as a silent 404, not a loud crash.

**Fix:** Replace "validated at startup … fails loud at build time" with an accurate description, e.g.:
> "The OG image routes validate `siteConfig.url` at request time with a fail-closed pattern: if the field is missing or not a valid HTTPS URL, the route returns 404 rather than generating a broken or SSRF-exploitable image. A misconfigured `url` does NOT cause a startup failure — the error surfaces as 404 on OG image requests."

And remove the "validated at startup as absolute HTTPS without credentials" phrase from the Deployment Checklist bullet (line 631).

---

## GAPS

### DOC22-G1 — `admin_tokens` functional scope system undocumented
**Severity:** LOW

**CLAUDE.md claim (`admin_tokens` row in Database Schema):**
> "Each token is … scoped to one admin user, stored SHA-256-hashed in the DB."

**Code reality (`lib/admin-tokens.ts:24-36`):**
```ts
export type AdminTokenScope = 'lr:upload' | 'lr:read' | 'lr:delete';
export const ALL_SCOPES: readonly AdminTokenScope[] = ['lr:upload', 'lr:read', 'lr:delete'] as const;

export interface AdminTokenRecord {
    scopes: AdminTokenScope[];
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    // ...
}
```

Tokens are not only scoped to a user — they also carry a mandatory non-empty function scope (`lr:upload` / `lr:read` / `lr:delete`), an `expires_at` optional expiry, and `last_used_at` tracking. The phrase "scoped to one admin user" only captures the user-association, not the capability subset model.

Additionally, `createToken` enforces at least one scope: `if (cleanScopes.length === 0) throw new Error('At least one scope is required')`.

**Impact:** A developer adding a new LR plugin endpoint must know that token verification checks both user ownership and the specific scope. The scope check is in `api-auth.ts` via `withAdminAuth` + `tokenHasScope`.

**Fix:** Extend the `admin_tokens` row to read, e.g.:
> "Each token is granted one or more functional scopes (`lr:upload`, `lr:read`, `lr:delete`), stored as a JSON array in the `scopes` column. Tokens also carry optional `expires_at` and a best-effort `last_used_at` timestamp. The token verifier (`lib/admin-tokens.ts:verifyToken`) enforces both user ownership and scope when called from `withAdminAuth`."

---

## Summary

| Category | Count |
|----------|-------|
| MATCH | 21 |
| MISMATCH | 3 |
| GAP | 1 |

**Operator-misleading findings:**

- **DOC22-M3 (MEDIUM)** — The "validated at startup" / "fails loud at build time" claim for `siteConfig.url` is false. No startup or build-time validation exists. A misconfigured deployment will start silently and only surface OG 404s at request time. This is the highest-priority fix.

**Low-priority cleanup:**

- **DOC22-M1** — `NEXT_UPLOAD_BODY_MAX_BYTES` default literal: change `279620608` → `278921216`.
- **DOC22-M2** — `process-image.ts` line refs: `:1088-1089` → `:1093-1094`; `:1157` → `:1162`. Consider replacing with grep-stable anchors (comment text) to avoid future drift.
- **DOC22-G1** — Document the `lr:upload/lr:read/lr:delete` scope model and `expires_at` / `last_used_at` columns in the `admin_tokens` schema row.
