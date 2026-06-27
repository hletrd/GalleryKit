# Document-Specialist Review — Cycle 16 (R16C16)

**Agent:** document-specialist (sonnet) · **HEAD:** 1f5fb245 · **Date:** 2026-06-27

## Summary

Full systematic sweep of CLAUDE.md against the installed codebase. Cycle-15 DOC-15-01..04 fixes were verified as applied on disk (settings-hash.ts:42-54, process-image.ts:1157, etc.). One new concrete drift found; all other verified claims are correct.

---

## Confirmed Drifts

### FINDING DOC-16-01 — Wrong public route for smart collections — MEDIUM

**CLAUDE.md claim (line 148):**
> "The public route `/s/[slug]` renders a smart collection the same way as a topic gallery."

**Actual code:**
- Smart collection page: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` (uses `getSmartCollectionBySlugCached`)
- `/s/[key]/` is the shared LINKS route: `apps/web/src/app/[locale]/(public)/s/[key]/`
- `schema.ts:291` comment: "Public collections are reachable at `/[locale]/c/[slug]`"

**Fix:** Replace `/s/[slug]` with `/c/[slug]` on CLAUDE.md line 148.

**Severity:** MEDIUM — an operator or developer following this doc would look for the wrong URL, and a future agent implementing a feature referencing smart collections via a link would generate `/s/...` rather than `/c/...`.

---

### FINDING DOC-16-02 — Repo structure tree omits `c/[slug]/` route — LOW

**CLAUDE.md claim (lines ~29-35):**
```
├── [locale]/
│   │   │   │   ├── admin/    # Admin dashboard (protected routes)
│   │   │   │   ├── p/[id]/   # Photo viewer page
│   │   │   │   ├── g/[key]/  # Shared group pages
│   │   │   │   └── s/[key]/  # Shared link pages
```

**Actual directory listing** of `apps/web/src/app/[locale]/(public)/`:
`[topic]`, `c`, `g`, `map`, `p`, `s`, `timeline`, `uploads`, `year`

The `c/[slug]/` (smart collections), `map/`, `timeline/`, and `year/` route directories are all absent from the tree. The tree is documented as abbreviated, but the `c/` omission is the most operationally misleading because CLAUDE.md explicitly documents smart collections without naming their URL route correctly (DOC-16-01 above).

**Fix:** Add `├── c/[slug]/ # Smart collection pages` entry to the tree, correcting the `/s/[slug]` claim in the same edit.

**Severity:** LOW — the tree is known to be simplified, but in combination with DOC-16-01 the omission reinforces the wrong impression.

---

## Cycle-15 Fixes — Verified Applied

| Fix ID | CLAUDE.md claim | Verified |
|--------|----------------|---------|
| DOC-15-01 | `NEXT_UPLOAD_BODY_MAX_BYTES` default byte value corrected | ✓ |
| DOC-15-02 | `process-image.ts:1157` cite for WI-14 note | ✓ (was :1131-1135) |
| DOC-15-03 | `color-detection.ts:99-108` cite for ProPhoto→gamma18 | ✓ (was :99-107) |
| DOC-15-04 | `settings-hash.ts:42-54` cite for COLOR_IMPACTING_KEYS | ✓ (was :41-53) |

---

## All Other Verified Claims (CORRECT on disk)

| Claim | Code location | Result |
|-------|--------------|--------|
| `IMAGE_PIPELINE_VERSION=7` defined at `gallery-config-shared.ts:21` | line 21 | ✓ |
| 9 `COLOR_IMPACTING_KEYS` at `settings-hash.ts:42-54` | lines 42-54 (9 keys) | ✓ |
| `HASH_LENGTH=8` in `settings-hash.ts` | line 68 | ✓ |
| Default image sizes `[640, 1536, 2048, 4096, 5120, 7680]` | `gallery-config-shared.ts:85` | ✓ |
| 10 `cache()` fns (9 `*Cached` + `getSeoSettings`) | `data.ts:1380,1668-1681,1722` | ✓ |
| Blur placeholder at `resize(16, …)` | `process-image.ts:905` | ✓ |
| `MAX_BLUR_DATA_URL_LENGTH=4096` | `blur-data-url.ts:45` | ✓ |
| `SEMANTIC_SCAN_LIMIT=2000` / `SEMANTIC_TOP_K_MAX=50` | `clip-embeddings.ts:17-18` | ✓ |
| `OG_PHOTO_MAX_BYTES = 1024 * 1024` (1 MiB) | `og-photo-fetch.ts:31` | ✓ |
| `HEAD_REVALIDATE_TIMEOUT_MS=300` | `sw.template.js:38` | ✓ |
| 6 advisory-lock names | `advisory-locks.ts` | ✓ |
| Argon2id memoryCost=65536, timeCost=3, parallelism=4 | `password-hashing.ts` | ✓ |
| `POOL_CONNECTION_LIMIT=10`, queueLimit=20, enableKeepAlive=true | `db/index.ts:23,31-35` | ✓ |
| Backfill cap formula → cap=2 at pool=10 | `admin-backfill-runner.ts:122-123` | ✓ |
| nginx body caps: 2M/64K/250M/216M/216M/2M | `nginx/default.conf` | ✓ |
| `process-image.ts:1088-1089` R8-R8 shared `image` var removal note | lines 1088-1089 | ✓ |
| `process-image.ts:1157` WI-14 fresh-decode note | line 1157 | ✓ |
| `smart_collections.query_json` column at `schema.ts:297` | line 297 | ✓ |
| `avif_10bit` present in `publicSelectFields` | `data.ts:317` (not in omit list) | ✓ |
| NCLX transfer map (all 10 entries: 1,4,5,11,13,14,15,16,17,18) | `color-detection.ts:178-213` | ✓ |
| NCLX matrix map (0,1,8,9,10) | `color-detection.ts:215-221` | ✓ |
| ProPhoto→gamma18 at `color-detection.ts:99-108` | line 108 | ✓ |
| Admin token format `gk_<base64url(32 bytes)>` = 46 chars | `admin-tokens.ts:5,21-22` | ✓ |
| Token header `X-GalleryKit-Token` / `x-gallerykit-token` in `api-auth.ts` | `api-auth.ts:14` | ✓ |
| `image_views` indexes `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` from migration 0021 | `0021_analytics_breakdown_indexes.sql` | ✓ |
| `x-gk-admin-render: 1` in `proxy.ts:129` | line 129 | ✓ |
| `typecheck:app` + `typecheck:scripts` composition | `package.json:15,25-26` | ✓ |
| `WIDE_GAMUT_PRIMARIES` set; `isWideGamutPrimary` helper | `color-primaries.ts` | ✓ |
| Sharp `^0.34.5` | `package.json:65` | ✓ |

---

## Net Finding

One concrete route-name error (DOC-16-01, MEDIUM) + one tree omission (DOC-16-02, LOW). All other CLAUDE.md concrete claims — constants, defaults, line cites, lock names, nginx caps, formula, and behavioral descriptions — are verified correct at HEAD 1f5fb245.
