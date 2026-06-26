# Document-Specialist Review — Cycle 12

**Date:** 2026-06-27
**HEAD:** 2a9976a1 (docs only; last code commit 92ce7a9e)
**Reviewer:** document-specialist agent
**Scope:** CLAUDE.md claims vs current code; new cycle-12 findings + carry-over status

---

## Summary

| Category | Count |
|---|---|
| CONFIRMED | 25 |
| DRIFT (CLAUDE.md) | 3 |
| CODE COMMENT DRIFT (informational) | 2 |

**Top drifts:**
- R12-DOC-01 (MEDIUM): site-config.json field names documented with wrong camelCase keys throughout CLAUDE.md
- R12-DOC-02 (LOW): smart_collections column documented as `rules` — code uses `query_json`
- R12-DOC-03 (LOW): NEXT_UPLOAD_BODY_MAX_BYTES documented as 279,620,608 — code produces 278,921,216

---

## CONFIRMED Claims

| # | Claim | Source | Verified at |
|---|---|---|---|
| C1 | IMAGE_PIPELINE_VERSION = 7 | `gallery-config-shared.ts:21` | `apps/web/src/lib/gallery-config-shared.ts:21` |
| C2 | DEFAULT_IMAGE_SIZE_VALUES = [640,1536,2048,4096,5120,7680] | `gallery-config-shared.ts` | `apps/web/src/lib/gallery-config-shared.ts` |
| C3 | avif_effort default = '6'; Sharp native default = 4 | `gallery-config-shared.ts:118` | `apps/web/src/lib/gallery-config-shared.ts:118` |
| C4 | COLOR_IMPACTING_KEYS has 9 keys | `settings-hash.ts:41-53` | `apps/web/src/lib/settings-hash.ts` |
| C5 | HASH_LENGTH = 8 | `settings-hash.ts` | `apps/web/src/lib/settings-hash.ts` |
| C6 | Argon2id: memoryCost=65536, timeCost=3, parallelism=4 | `password-hashing.ts` | `apps/web/src/lib/password-hashing.ts` |
| C7 | React cache() wraps 10 functions (ending in Cached + getSeoSettings) | `data.ts` | `apps/web/src/lib/data.ts` |
| C8 | OG_PHOTO_MAX_BYTES = 1 MB (1024*1024) | `og-photo-fetch.ts` | `apps/web/src/lib/og-photo-fetch.ts` |
| C9 | OG card dimensions 1200×630 | `api/og/photo/[id]/route.tsx:220-221` | confirmed |
| C10 | HEAD_REVALIDATE_TIMEOUT_MS = 300 ms | `public/sw.template.js:38` | confirmed |
| C11 | POOL_CONNECTION_LIMIT = 10 | `db/index.ts:23` | `apps/web/src/db/index.ts:23` |
| C12 | resolveBackfillConcurrency cap = 2 at POOL=10 | `admin-backfill-runner.ts` | `apps/web/src/lib/admin-backfill-runner.ts` |
| C13 | SEMANTIC_SCAN_LIMIT = 2000 | `clip-embeddings.ts` | `apps/web/src/lib/clip-embeddings.ts` |
| C14 | SEMANTIC_TOP_K_MAX = 50 | `clip-embeddings.ts` | `apps/web/src/lib/clip-embeddings.ts` |
| C15 | BOOTSTRAP_BATCH_SIZE = 500 | `image-queue.ts:79` | `apps/web/src/lib/image-queue.ts:79` |
| C16 | jina-clip-v2-d512-q8 model name | `clip-embeddings.ts:147` | `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'` |
| C17 | decodeEmbeddingColumn in lib/clip-embeddings.ts | `clip-embeddings.ts:109` | confirmed |
| C18 | SAFE_SEGMENT + ALLOWED_UPLOAD_DIRS + resolvedPath.startsWith() | `serve-upload.ts:15-16,182` | confirmed |
| C19 | lstat + isSymbolicLink() symlink rejection | `serve-upload.ts:175,177` | confirmed |
| C20 | Advisory lock names: 6 locks (LOCK_DB_RESTORE, LOCK_UPLOAD_PROCESSING_CONTRACT, LOCK_TOPIC_ROUTE_SEGMENTS, LOCK_ADMIN_DELETE, LOCK_COLOR_PIPELINE_BACKFILL, per-image) | `advisory-locks.ts` | confirmed |
| C21 | NCLX primaries map: 1=bt709, 9=bt2020, 11=dci-p3, 12=p3-d65 | `color-detection.ts:171-176` | confirmed (CLAUDE.md "12=Display P3" = p3-d65) |
| C22 | NCLX transfer: 4=gamma22, 5=gamma28, 14/15=gamma24, 16=PQ, 17=gamma26, 18=HLG | `color-detection.ts NCLX_TRANSFER_MAP` | confirmed |
| C23 | rAF-debounced resize in masonry grid | `home-client.tsx:53` | confirmed (requestAnimationFrame at line 53) |
| C24 | Histogram uses 256-px canvas | `histogram.tsx:180,122-124` | maxDim=256, 256-bin buckets |
| C25 | lint:public-route-rate-limit available via --workspace=apps/web | `apps/web/package.json:24` | `tsx scripts/check-public-route-rate-limit.ts` |

---

## DRIFT Findings

### R12-DOC-01 — site-config.json field names throughout CLAUDE.md (MEDIUM, NEW)

**Claim (CLAUDE.md Deployment Checklist, step 3, lines ~621-627):**
> The file is a flat JSON object with these key fields: `siteName`, `siteDescription`, `siteUrl` — canonical base URL, `authorName` / `authorUrl` — Atom feed attribution, `social.*` — optional social link URLs, `navLinks` — array of `{ label, href }` objects for the top nav, `footerLinks` — array of `{ label, href }` objects for the footer

**Also CLAUDE.md line ~207 (OG SSRF hardening):**
> if `siteConfig.siteUrl` is missing or invalid, the route returns a 404

**Reality:**
`apps/web/src/site-config.example.json` and `apps/web/src/site-config.json` use flat snake_case/lowercase keys:

```json
{
    "title": "...",
    "description": "...",
    "url": "...",
    "locale": "en_US",
    "author": "...",
    "nav_title": "...",
    "home_link": "/",
    "footer_text": "...",
    "google_analytics_id": ""
}
```

Code reads `siteConfig.title`, `siteConfig.description`, `siteConfig.url`, `siteConfig.nav_title`, `siteConfig.author` (`data.ts:1660-1665`). OG photo route uses `siteConfig.url` (not `siteConfig.siteUrl`).

Fields `siteName`, `siteDescription`, `siteUrl`, `authorName`, `authorUrl`, `navLinks`, `footerLinks` do NOT exist.

**Impact:** A deployer following the checklist would write the wrong keys into site-config.json with no effect — the app silently reads `undefined` from the missing keys, producing blank nav titles, empty OG cards, and broken Atom attribution without any startup-fail warning.

**Suggested fix:** Replace the bullet list in the Deployment Checklist step 3 with the actual field names: `title`, `description`, `url`, `locale`, `author`, `nav_title`, `home_link`, `footer_text`, `google_analytics_id`. Update line ~207 to say `siteConfig.url` instead of `siteConfig.siteUrl`.

**Severity:** MEDIUM (operational: silent misconfiguration)
**Confidence:** HIGH

---

### R12-DOC-02 — smart_collections column name: `rules` vs `query_json` (LOW, CARRY-OVER from C11 Finding #5)

**Claim (CLAUDE.md `smart_collections` entry):**
> Each row stores a name, slug, and a JSON `rules` array that defines matching criteria

**Reality:** `apps/web/src/db/schema.ts:297` names the column `query_json`, not `rules`. The Drizzle column definition is `query_json: text('query_json').notNull()`.

**Impact:** Misleads a maintainer writing raw SQL, a migration, or a backup restore validator about the column name.

**Suggested fix:** Replace "a JSON `rules` array" with "a JSON `query_json` column" in the smart_collections entry.

**Severity:** LOW
**Confidence:** HIGH

---

### R12-DOC-03 — NEXT_UPLOAD_BODY_MAX_BYTES default value (LOW, CARRY-OVER from C11 Finding #9)

**Claim (CLAUDE.md Optional Operational Variables table):**
> `NEXT_UPLOAD_BODY_MAX_BYTES` | `279620608` | Next.js server action body size limit (default ~266 MiB)

**Reality:** `apps/web/src/lib/upload-limits.ts`:

```ts
export const DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES =
  Math.max(DEFAULT_UPLOAD_MAX_TOTAL_BYTES, NGINX_UPLOAD_BODY_LIMIT) + 16 * 1024 * 1024;
// = max(200 MiB, 250 MiB) + 16 MiB
// = 262144000 + 16777216
// = 278,921,216
```

CLAUDE.md states `279,620,608`; actual is `278,921,216`. Off by 699,392 bytes (~683 KiB).

**Impact:** Low — does not affect runtime correctness (env var override does not use this default), but a maintainer computing the correct env value from the docs gets the wrong number.

**Suggested fix:** Update the default value in the env var table to `278921216`.

**Severity:** LOW
**Confidence:** HIGH

---

## Code Comment Drifts (informational — not CLAUDE.md drifts)

These are stale comments in source files. CLAUDE.md itself is correct on both; the issue is maintainer-facing misleading inline documentation.

### CC-01 — semantic/route.ts line 9: stale "(5000)" comment

`apps/web/src/app/api/search/semantic/route.ts:9` contains:
```ts
// Scans up to SEMANTIC_SCAN_LIMIT (5000) embeddings...
```
But `SEMANTIC_SCAN_LIMIT` in `apps/web/src/lib/clip-embeddings.ts` is `2000`. CLAUDE.md correctly states 2000. The route.ts comment is from an earlier value and was not updated.

**Suggested fix:** Change `(5000)` to `(2000)` in the route.ts comment.

---

### CC-02 — image-queue.ts: contradictory permanentlyFailedIds comments

`apps/web/src/lib/image-queue.ts`:
- Line 87: "Eviction is FIFO (insertion-order via **Map.keys()** iteration)" — but `permanentlyFailedIds` is a `Set<number>` (line 162), and eviction uses `.values().next()` (line 560), not `Map.keys()`.
- Line 159: "A Set with **no eviction**" — but eviction exists at lines 558–562.

The runtime behavior is correct (Set insertion-order gives valid FIFO). Both comments are stale residuals from an earlier Map-based design. CLAUDE.md does not document this detail.

**Suggested fix:** Update line 87 to say "Set.values() iteration" and remove the "no eviction" qualifier on line 159.

---

## Carry-Over Status

| Prior ID | Description | Status |
|---|---|---|
| C11 Finding #5 (smart_collections `rules`) | Unchanged → R12-DOC-02 | OPEN |
| C11 Finding #7 (site-config.json field names) | Unchanged → R12-DOC-01 | OPEN |
| C11 Finding #9 (NEXT_UPLOAD_BODY_MAX_BYTES) | Unchanged → R12-DOC-03 | OPEN |
| AGG-L17 (permanentlyFailedIds FIFO/Map.keys) | Code comment only, CLAUDE.md silent → CC-02 | OPEN (code) |
| AGG-L40 (root package.json missing lint:public-rate-limit shortcut) | Apps/web has it; root is missing shortcut alias (not a CLAUDE.md claim) | OPEN (code) |
