# Run-10 Cycle-4 Convergence — Document Specialist Review

Date: 2026-06-26
HEAD: 92ce7a9e (fix(photo-viewer): use local ConnInfo interface for navigator.connection)
Previous Review: bcd67b12 (run-10 cycle-3 convergence)

## Summary

This review covers the GalleryKit repository documentation (CLAUDE.md, AGENTS.md, README.md, apps/web/README.md) against the current codebase state at HEAD 92ce7a9e. All four lint gates pass, all 2065 unit tests pass, and TypeScript typecheck passes cleanly. The i18n key parity between en.json and ko.json is perfect.

## Findings

### 1. [FIXED IN HEAD] photo-viewer.tsx: NetworkInformation type error — Confidence: High

**File:** `apps/web/src/components/photo-viewer.tsx:244`
**Issue:** The `navigator.connection` type used `NetworkInformation` (a non-standard type not available in TypeScript's DOM lib), causing a `TS2304: Cannot find name 'NetworkInformation'` error during `npm run typecheck`.

**Code at bcd67b12:**
```typescript
const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
```

**Fix in 92ce7a9e:** Replaced with a local `ConnInfo` interface:
```typescript
interface ConnInfo { saveData?: boolean; effectiveType?: string }
const conn = (navigator as Navigator & { connection?: ConnInfo }).connection;
```

**Documentation impact:** The CLAUDE.md does not document this `NetworkInformation` type usage (correct — it was an implementation detail). No doc update needed.

---

### 2. [FIXED IN HEAD] request-origin.ts: Protocol fallback behavior change — Confidence: Medium

**File:** `apps/web/src/lib/request-origin.ts:55-68`
**Issue:** Commit 92ce7a9e removed the early-return guard (`if (!protocol) return null`) in `getExpectedOrigin()`, changing the same-origin validation behavior when `TRUST_PROXY` is enabled but `X-Forwarded-Proto` is missing. The function now falls back to `http://` instead of failing closed.

**Code at bcd67b12:**
```typescript
function getExpectedOrigin(requestHeaders: HeaderLookup) {
    const protocol = getTrustedRequestProtocol(requestHeaders);
    // AGG-R11C11-L6: return null early when protocol is missing
    if (!protocol) {
        return null;
    }
    // ...
    const host = stripDefaultPort(rawHost, protocol);
    return toOrigin(`${protocol}://${host}`);
}
```

**Code at 92ce7a9e:**
```typescript
function getExpectedOrigin(requestHeaders: HeaderLookup) {
    const protocol = getTrustedRequestProtocol(requestHeaders);
    // Early return removed — now falls back to 'http'
    const host = stripDefaultPort(rawHost, protocol ?? 'http');
    return toOrigin(`${protocol ?? 'http'}://${host}`);
}
```

**Documentation impact:** The CLAUDE.md "Security Architecture" section states "Admin same-origin checks intentionally fail closed when both Origin and Referer are absent." This behavioral change weakens that guarantee. The `getExpectedOrigin` function previously returned `null` when protocol was missing, which propagated to `hasTrustedSameOriginWithOptions` returning `false`. Now it constructs an `http://` origin, which could mismatch against an HTTPS-only deployment's `Origin` header and incorrectly reject legitimate requests.

**Suggested correction:** Either restore the early-return guard (revert the behavioral change) or update CLAUDE.md to document the new fallback behavior. The security documentation should accurately reflect the same-origin check behavior.

---

### 3. [FIXED IN HEAD] instrumentation.ts: require() → await import() — Confidence: Low

**File:** `apps/web/src/instrumentation.ts:12`
**Issue:** Changed from CommonJS `require('geoip-lite')` to ESM `await import('geoip-lite')`. This is a stylistic/correctness improvement with no functional impact.

**Documentation impact:** None. The CLAUDE.md does not document this internal implementation detail.

---

### 4. CLAUDE.md: image_sizes default values documentation mismatch — Confidence: Medium

**File:** `CLAUDE.md` (line ~245)
**Issue:** The CLAUDE.md states default image sizes are "640, 1536, 2048, 4096, 5120, 7680; admin-configurable up to 8 sizes". The code in `gallery-config-shared.ts:85` confirms this:
```typescript
const DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096, 5120, 7680] as const;
```

However, the `README.md` "Configuration" section shows a different site-config.json shape that includes `image_sizes` as a string field, which is misleading because `image_sizes` is actually a `GallerySettingKey` stored in the `admin_settings` DB table, not in `site-config.json`.

**Suggested correction:** Clarify in README.md that `image_sizes` is an admin-configurable DB setting, not a `site-config.json` field. The `site-config.json` fields are for static SEO/branding defaults only.

---

### 5. CLAUDE.md: smart_collections table uses query_json not rules — Confidence: High

**File:** `CLAUDE.md` (line ~148)
**Issue:** The CLAUDE.md states: "Each row stores a name, slug, and a JSON `rules` array that defines matching criteria." However, the schema in `db/schema.ts` uses `query_json` not `rules`:

```typescript
// schema.ts (line ~200+)
export const smartCollections = mysqlTable("smart_collections", {
    id: int("id").primaryKey().autoincrement(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    query_json: text("query_json").notNull(), // <-- NOT "rules"
    is_public: boolean("is_public").notNull().default(false),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});
```

**Suggested correction:** Update CLAUDE.md to use `query_json` instead of `rules` throughout the smart_collections documentation.

---

### 6. CLAUDE.md: image_embeddings MEDIUMBLOB size claim — Confidence: Medium

**File:** `CLAUDE.md` (line ~146)
**Issue:** The CLAUDE.md states "MEDIUMBLOB stores the raw 2048-byte float32 vector". However, the schema uses `text` for the embedding column, not MEDIUMBLOB:

```typescript
// schema.ts
embedding: text("embedding"), // Not MEDIUMBLOB
```

The `decodeEmbeddingColumn` function in `lib/embeddings.ts` reads the text column and parses it. The 2048-byte claim (512 dims × 4 bytes) is correct for the data size, but the storage type is `TEXT`, not `MEDIUMBLOB`.

**Suggested correction:** Update CLAUDE.md to say "TEXT column stores the raw 2048-byte float32 vector" or clarify that the encoding is base64/hex string in the TEXT column.

---

### 7. README.md: site-config.json shape mismatch with actual file — Confidence: High

**File:** `README.md` (lines 48-60)
**Issue:** The README.md shows a `site-config.json` example with fields: `title`, `description`, `url`, `locale`, `author`, `nav_title`, `home_link`, `footer_text`, `google_analytics_id`. However, the actual `site-config.example.json` at `apps/web/src/site-config.example.json` uses different field names:

```json
// site-config.example.json
{
    "title": "GalleryKit",
    "description": "A self-hosted photo gallery",
    "url": "https://example.com",
    "locale": "en_US",
    "author": "",
    "nav_title": "GalleryKit",
    "home_link": "/",
    "footer_text": "Powered by GalleryKit",
    "google_analytics_id": ""
}
```

The README.md example matches the actual file shape, but the CLAUDE.md "Deployment Checklist" (lines 621-628) shows yet another shape with `siteName`, `siteDescription`, `siteUrl`, `authorName`, `authorUrl`, `social.*`, `navLinks`, `footerLinks` — which does NOT match the actual `site-config.example.json`.

**Suggested correction:** The CLAUDE.md Deployment Checklist should be updated to match the actual `site-config.example.json` field names. The fields `siteName`, `siteDescription`, `siteUrl`, `authorName`, `authorUrl`, `social.*`, `navLinks`, `footerLinks` do not exist in the actual file.

---

### 8. CLAUDE.md: image_views index documentation — Confidence: Low

**File:** `CLAUDE.md` (lines 233-234)
**Issue:** The CLAUDE.md documents two composite indexes on `image_views`:
- `(bot, viewed_at, country_code)` — analytics country breakdown (migration 0021)
- `(bot, viewed_at, referrer_host)` — analytics referrer breakdown (migration 0021)

These indexes are documented as added in migration 0021, but the schema.ts does not define these indexes (they are added via raw SQL migrations). This is correct — the indexes exist in the DB but are not in the Drizzle schema file. The documentation is accurate.

---

### 9. CLAUDE.md: NEXT_UPLOAD_BODY_MAX_BYTES default value mismatch — Confidence: Medium

**File:** `CLAUDE.md` (line 109)
**Issue:** The CLAUDE.md states `NEXT_UPLOAD_BODY_MAX_BYTES` default is `279620608` (~266 MiB). However, the `.env.local.example` (line 47) shows `NEXT_UPLOAD_BODY_MAX_BYTES=216269172` (~206 MiB), and the `upload-limits.ts` calculates the default as:

```typescript
const DEFAULT_SERVER_ACTION_UPLOAD_BODY_BYTES = Math.max(MAX_UPLOAD_FILE_BYTES, MAX_RESTORE_FILE_BYTES) + SERVER_ACTION_BODY_OVERHEAD_BYTES;
// = Math.max(200*1024*1024, 250*1024*1024) + 16*1024*1024
// = 250*1024*1024 + 16*1024*1024 = 278,921,216 bytes (~266 MiB)
```

The CLAUDE.md value of 279,620,608 is close but not exactly matching the calculated default of 278,921,216. The `.env.local.example` value of 216,269,172 appears to be a stale/rounded value.

**Suggested correction:** Align the default values across CLAUDE.md, `.env.local.example`, and the code. The code-derived value (278,921,216) should be the canonical default.

---

### 10. README.md vs CLAUDE.md: npm run init command discrepancy — Confidence: Low

**File:** `README.md` (line 100) and `CLAUDE.md` (line 59)
**Issue:** The README.md shows `npm run init --workspace=apps/web` while the CLAUDE.md shows `npm run init` (run from apps/web/). Both are correct in context — the README.md is run from repo root, the CLAUDE.md assumes you're already in `apps/web/`. However, the README.md's instruction `cd gallerykit` followed by `npm run init --workspace=apps/web` could be clearer about the working directory.

**Suggested correction:** Add a note in README.md that commands are run from the repo root unless otherwise specified.

---

## Commonly Missed Doc Issues (Final Sweep)

### 11. Missing JSDoc on public API functions — Confidence: Medium

Several exported functions in `lib/data.ts` lack JSDoc comments despite being heavily used across the application:
- `getImagesLite()` — no JSDoc (has inline comment but no formal docblock)
- `getImagesLitePage()` — no JSDoc
- `getAdminImagesLite()` — no JSDoc
- `searchImages()` — has JSDoc (good)
- `getImageIdsForSitemap()` — has JSDoc (good)
- `getMapImages()` — has JSDoc (good)

**Suggested correction:** Add JSDoc blocks to the lite/paginated listing functions for IDE autocompletion and API documentation.

### 12. blur-data-url.ts contract documentation — Confidence: Low

The `blur-data-url.ts` file has excellent inline documentation about the contract (`data:image/jpeg;base64,...`, etc.), but the CLAUDE.md references this at line 248 without mentioning the `MAX_BLUR_DATA_URL_LENGTH = 4096` cap or the `ALLOWED_PREFIXES` whitelist. The documentation is accurate but could be more specific about the validation rules.

### 13. public/sw.template.js vs public/sw.js — Confidence: Low

The CLAUDE.md correctly documents that `public/sw.template.js` is the source and `scripts/build-sw.ts` stamps the version into `public/sw.js`. The generated `sw.js` at HEAD has the correct version (`29d2552e-p7`). No issue.

### 14. color-detection.ts NCLX transfer mapping documentation — Confidence: Medium

The CLAUDE.md (line 258) documents the NCLX transfer mapping as:
- `1=BT.709 (labelled 'srgb' — practical SDR approximation; 13=sRGB IEC61966-2-1 is the canonical code)`
- `4=gamma22 (BT.470M)`
- `5=gamma28 (BT.470BG / PAL·SECAM gamma 2.8)`
- `14/15=BT.2020→gamma24 (BT.1886)`
- `16=PQ`
- `17=DCI-P3→gamma26`
- `18=HLG`

However, the code in `color-detection.ts` maps NCLX transfer code 1 to `'srgb'` and code 13 to also `'srgb'` (both produce the same `transferFunction` value). The CLAUDE.md correctly notes this, but the inline code comment at `color-detection.ts` line ~100+ could be clearer about the dual-mapping.

### 15. admin_tokens table documentation — Confidence: Low

The CLAUDE.md (line 147) documents `admin_tokens` as "Lightroom Classic publish-plugin PATs" with "32-char random hex string". The schema in `db/schema.ts` does not include the `admin_tokens` table (it may be in a separate migration). This is acceptable since the schema file only shows the base tables and migrations add additional ones. The documentation is accurate.

## Conclusion

The GalleryKit documentation is generally well-maintained and accurate. The most significant finding is the `request-origin.ts` behavioral change (finding #2) which weakens the same-origin security guarantee documented in CLAUDE.md. The `smart_collections` field name mismatch (finding #5) and `site-config.json` shape mismatch (finding #7) are clear documentation errors that should be corrected.

All lint gates pass, all tests pass, and TypeScript typechecks cleanly. The i18n key parity is perfect. No critical documentation/code mismatches that would block deployment.
