# Document-Specialist Review — GalleryKit Cycle 20

**Date:** 2026-06-27 · **HEAD:** 9af705f4 · **Agent:** document-specialist

**Result: 25 MATCH · 5 GAP (0 hard MISMATCH, 5 undocumented/stale)**

---

## VERIFIED — ALL MATCH

| Claim | Source | Result |
|-------|--------|--------|
| `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` | MATCH |
| `COLOR_IMPACTING_KEYS` = 9 entries | `settings-hash.ts:45-57` | MATCH |
| Default image sizes = `[640,1536,2048,4096,5120,7680]` | `gallery-config-shared.ts:85` | MATCH |
| OG home card → `/api/og/photo/${latestId}` | `app/[locale]/(public)/page.tsx:118` | MATCH |
| React `cache()` wraps exactly 10 functions in `data.ts` (complete list correct) | `data.ts:1380,1668-1722` | MATCH |
| Advisory lock names (5 named + per-image formula) | `advisory-locks.ts` | MATCH |
| Nginx body caps: 2M / 64K / 250M / 216M / 216M | `nginx/default.conf` | MATCH |
| `SEMANTIC_SCAN_LIMIT = 2000`, `SEMANTIC_TOP_K_MAX = 50` | `clip-embeddings.ts` | MATCH |
| `AUDIT_LOG_RETENTION_DAYS` default = 90 days | `audit.ts` | MATCH |
| `VIEW_RETENTION_DAYS` default = 395 days | `view-retention.ts` | MATCH |
| `QUEUE_CONCURRENCY` default = 1 | `image-queue.ts` | MATCH |
| `POOL_CONNECTION_LIMIT = 10` | `db/index.ts` | MATCH |
| Admin-backfill concurrency cap formula → 2 at pool=10 | `admin-backfill-runner.ts` | MATCH |
| `NEXT_UPLOAD_BODY_MAX_BYTES` default = `278921216` (max(200MiB,250MiB)+16MiB) | `upload-limits.ts` | MATCH |
| `pickFirstAvailablePhotoBuffer` exists in `og-photo-fetch.ts` | `og-photo-fetch.ts` | MATCH |
| `avif_10bit` is public-safe (in `publicSelectFields`) | `data.ts:286` | MATCH |
| `_SensitiveKeysInPublic` compile-time guard present | `data.ts:463` | MATCH |
| Journal non-monotonic (25 entries, `Monotonic: False`) | `drizzle/meta/_journal.json` | MATCH |
| AGENTS.md quality gates match `apps/web/package.json` scripts exactly | `package.json` | MATCH |
| `IMAGE_PIPELINE_VERSION` re-exported from `process-image.ts` | `process-image.ts:371` | MATCH |
| SW: `MAX_IMAGE_BYTES = 50 MB`, `MAX_HTML_ENTRIES = 50`, `HTML_MAX_AGE_MS = 24h` | `sw.template.js:31-33` | MATCH |
| `was_downscaled` in `PrivacySensitiveKeys`, omitted from `publicSelectFields` | `data.ts:376,461` | MATCH |
| Gain-map detection uses `iinf`, `infe`, `iref` (Key Files table is correct) | `gain-map-detection.ts` | MATCH |
| `color-detection.ts:99-108` covers ProPhoto → gamma18 mapping at line 108 | `color-detection.ts:108` | MATCH |
| `NEXT_UPLOAD_BODY_MAX_BYTES` default in CLAUDE.md matches code (`278921216`) | `upload-limits.ts` | MATCH |

---

## GAPS — Items not mentioned or incomplete in CLAUDE.md

### GAP-1 (MEDIUM): `lib/og-photo-fetch.ts` — 10s total budget undocumented

The Key Files table has no row for `apps/web/src/lib/og-photo-fetch.ts`. The OG route row references `pickFirstAvailablePhotoBuffer` correctly but omits the file's own timeout contract:

- `OG_PHOTO_FETCH_TIMEOUT_MS = 10_000` — per-attempt fetch timeout
- `OG_PHOTO_TOTAL_BUDGET_MS = 10_000` — total chain budget for social-crawler deadline

The task specifically asked about this file. The 10s total budget is the primary architectural constraint (why a chain of smaller files is tried rather than the original) and is invisible to future implementers from the current docs.

**Suggested addition to Key Files table:**
```
| `apps/web/src/lib/og-photo-fetch.ts` | `pickFirstAvailablePhotoBuffer` — tries AVIF→WebP→JPEG derivatives in order within a 10 s total chain budget (`OG_PHOTO_TOTAL_BUDGET_MS`); returns the first buffer ≤ `OG_PHOTO_MAX_BYTES` (1 MB). Per-attempt timeout also 10 s (`OG_PHOTO_FETCH_TIMEOUT_MS`). |
```

### GAP-2 (LOW): `lib/color-label.ts` — Not in Key Files table

Added in R19C19 CQ19-04. Exports `humanizeColorPrimaries` and `humanizeColorPrimariesOrLabel` (pure string helpers extracted from `color-details-section.tsx` for correct tree-shaking — `wide-gamut-hint.tsx` needs the label string without importing the full accordion component).

**Suggested addition:**
```
| `apps/web/src/lib/color-label.ts` | Pure color-primaries label helpers (`humanizeColorPrimaries`, `humanizeColorPrimariesOrLabel`) extracted from `color-details-section.tsx` (R19C19 CQ19-04) to avoid force-bundling the accordion into `WideGamutHint`. |
```

### GAP-3 (LOW): `lib/search-enrichment-fields.ts` — Not in Key Files table

Added in R19C19 A2 / MAJOR-1. Exports `searchEnrichmentSelectFields`, which centralizes the PII-guarded enrichment select used by semantic/similar-image search routes. Without a Key Files entry, a future implementer adding a search route would discover this guard only by reading existing route files.

**Suggested addition:**
```
| `apps/web/src/lib/search-enrichment-fields.ts` | `searchEnrichmentSelectFields` — PII-guarded Drizzle field set for semantic/similar-image search routes (R19C19 A2). Centralizes the privacy contract so new search routes pick it up automatically. |
```

### GAP-4 (MINOR — internal inconsistency): `has_gain_map` column row omits `infe`

The `images` color/HDR columns table (CLAUDE.md line 163) describes `has_gain_map` as:

> Apple HDR gain map detection in HEIF **`iinf`/`iref`** (P4-A1)

But the Key Files table entry for `gain-map-detection.ts` (line 124) and the actual code both include **`infe`**:

> `iinf`/`infe`/`iref`

The column description should read `iinf`/`infe`/`iref` for consistency.

### GAP-5 (MINOR): `was_downscaled` not in `images` color/HDR columns table

`was_downscaled` is:
- In schema (`schema.ts:75`)
- In `PrivacySensitiveKeys` (`data.ts:461`)
- Omitted from `publicSelectFields`
- In the backfill column set (mentioned at CLAUDE.md line 322)
- Part of the color pipeline (set when a 50 MP+ wide-gamut source is downscaled before rgb16 fan-out)

It is **not** listed in the `images color / HDR columns` table that's supposed to document admin-only color-pipeline columns. The table title and guard reference (`_PrivacySensitiveKeys`) suggest it should appear there alongside `color_pipeline_decision`, `transfer_function`, etc.

---

## Notes

- `NEXT_UPLOAD_BODY_MAX_BYTES`: the system-context snapshot at cycle start showed the old stale value `279620608`; the on-disk CLAUDE.md already has the corrected `278921216` (matching the code formula). This was a pre-cycle fix — no action needed.
- `color-detection.ts:99-108` line range: system-context showed a stale `99-107`; current CLAUDE.md already corrected to `99-108` (inclusive of the ProPhoto → gamma18 rule). No action needed.
- `was_downscaled` (GAP-5) is not security-sensitive; the omission from the table is a documentation convenience gap, not an information-leak risk.
