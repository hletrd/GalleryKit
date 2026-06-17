# Document Specialist Review — Run 6 Cycle 10 (HEAD 0502ae86)

## Scope

Spot-checked all load-bearing doc claims in CLAUDE.md against code at HEAD.

---

## Items Verified and Confirmed Correct

| Claim (CLAUDE.md section) | Code source | Result |
|---|---|---|
| `IMAGE_PIPELINE_VERSION = 7` | `gallery-config-shared.ts:21` | PASS |
| `COLOR_IMPACTING_KEYS` covers **9** keys (ETag section, line 264) | `settings-hash.ts:41-53` (9 entries confirmed) | PASS |
| Advisory lock names: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}` | `advisory-locks.ts:19-44` | PASS |
| Login rate limit: 5 attempts / 15-min window, two buckets (per-IP + per-account `acct:` key) | `rate-limit.ts:62-63`, `auth-rate-limit.ts` | PASS |
| Upload caps: 200 MiB/file (`MAX_UPLOAD_FILE_BYTES`), 2 GiB window (`UPLOAD_MAX_TOTAL_BYTES`), 100 files (`UPLOAD_MAX_FILES_PER_WINDOW`) | `upload-limits.ts:1-16` | PASS |
| nginx body caps: 2 MiB default, 64 KiB login, 250 MiB `/admin/db`, 216 MiB dashboard | `nginx/default.conf:31,58,75,92` | PASS |
| Backfill column set: `pipeline_version`, `icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`, `was_downscaled`, `avif_10bit` | `admin-backfill-runner.ts:543-568`, `backfill-color-pipeline.ts:83-105` | PASS |
| `avif_effort` default: 6 | `gallery-config-shared.ts:128` | PASS |
| `image_quality_webp` default: 90, `image_quality_avif` default: 85, `image_quality_jpeg` default: 90 | `gallery-config-shared.ts:97-99` | PASS |
| `QUEUE_CONCURRENCY` env var (PQueue default 1) | `image-queue.ts:168` | PASS |
| `ADMIN_BACKFILL_CONCURRENCY` env var (in-app backfill default 1) | `admin-backfill-runner.ts:662` | PASS |
| `BACKFILL_CONCURRENCY` env var (sidecar script, default 2) | `backfill-color-pipeline.ts` + CLAUDE.md sidecar docker run command | PASS |
| `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env var gates `'production'` mode | `gallery-config.ts:144` | PASS |
| `semantic_search_mode` states: `'disabled'` \| `'stub'` \| `'production'` | `gallery-config-shared.ts:173` | PASS |
| CLIP min query: 3 codepoints client-side (`SEMANTIC_MIN_QUERY_CODEPOINTS`) | `search.tsx:27,165` | PASS |
| Embedding: MEDIUMBLOB, 512-dim float32, 2048 bytes | `clip-embeddings.ts:8-9`, `schema.ts:259` | PASS |
| `PRODUCTION_MODEL_VERSION = 'jina-clip-v2-d512-q8'` | `clip-embeddings.ts:146` | PASS |
| React `cache()` wraps 10 functions | `data.ts:1332,1608-1662` (10 confirmed) | PASS |
| Transfer function enum: `srgb \| gamma22 \| gamma18 \| gamma24 \| gamma26 \| pq \| hlg \| linear \| unknown` | `color-detection.ts:25` | PASS |
| NCLX matrix map `8=bt2020-ncl`, `9=bt2020-ncl`, `10=bt2020-cl` | `color-detection.ts:204-210` | PASS |
| `HASH_LENGTH = 8` (ETag settings hash) | `settings-hash.ts:55` | PASS |
| `--production` flag for CLIP backfill script | `backfill-clip-embeddings.ts:73` | PASS |
| HDR honesty rule: `is_hdr`/`transfer_function`/`matrix_coefficients` admin-only until WI-09 | `CLAUDE.md` describes as admin-only; no public-facing code exposes them | PASS |

---

## Real Finding

**FINDING-DS-C10-01** — Nginx body cap for `/api/admin/lr/upload` not documented; misleads LR plugin operators
Confidence: **H**
Severity: **Operational / deploy-breaking**

### What the doc says

CLAUDE.md line 514 (Important Notes section):

> Keep the reverse proxy body caps aligned with the app limits: the shipped nginx config uses **2 MiB** by default, **64 KiB** for login, **250 MiB** for `/admin/db` restore requests, and **216 MiB** for admin dashboard uploads.

### What the code does

`nginx/default.conf` has a `location ^~ /api/admin/` catch-all at line 124 with `client_max_body_size 2M`. The Lightroom Classic publish-plugin route — `POST /api/admin/lr/upload` — falls under this catch-all. There is no specific location block for `/api/admin/lr/` or `/api/admin/lr/upload` that raises the body limit.

The route itself (`src/app/api/admin/lr/upload/route.ts`) uses `request.formData()` to read a multipart body. Nginx enforces `client_max_body_size` on the entire request before passing it to Node.js, so any LR upload exceeding 2 MiB is rejected by nginx with 413 before the app sees it.

The app-layer code (`upload-limits.ts`) defines `MAX_UPLOAD_FILE_BYTES = 200 * 1024 * 1024` and the LR route does check cumulative tracker limits — but those checks are dead code for real-world photo files (RAW exports are typically 10–50 MB) because nginx has already rejected the request.

### Why it misleads

An operator adding Lightroom Classic integration would:
1. Read "nginx config uses 2 MiB by default, 216 MiB for admin dashboard uploads"
2. Conclude LR upload is covered by one of these
3. Find LR uploads silently fail for any photo > 2 MiB

The doc enumerates all four nginx body limits explicitly and does not mention the `/api/admin/` 2 MiB catch-all applies to LR upload. An operator aligned to the doc table would never look for a missing location block.

### Fix

Add a specific nginx location for the LR upload route with an appropriate body cap, **and** update the doc table. In `nginx/default.conf`, before the `/api/admin/` catch-all:

```nginx
# Lightroom Classic PAT upload — same 216 MiB budget as dashboard uploads.
location ~ ^/api/admin/lr/upload$ {
    client_max_body_size 216M;
    limit_req zone=admin burst=10 nodelay;
    limit_req_status 429;

    proxy_pass http://nextjs;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $gallerykit_forwarded_proto;
}
```

Then update CLAUDE.md line 514 to add: _and **216 MiB** for the Lightroom PAT upload endpoint (`/api/admin/lr/upload`)_.

---

## Conclusion

One real load-bearing mismatch found: CLAUDE.md documents nginx body caps but omits that `/api/admin/lr/upload` falls under the generic `/api/admin/` catch-all at 2 MiB, rendering the Lightroom plugin non-functional for any photo exceeding 2 MiB. All other doc claims verified against code (IMAGE_PIPELINE_VERSION, COLOR_IMPACTING_KEYS count, advisory-lock names, rate-limit buckets, upload caps, backfill column set, env var names, CLIP/semantic-search guards, embedding size, React cache() count, nginx cap values) are accurate.
