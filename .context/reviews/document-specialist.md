# Document-Specialist Review — Cycle 14 (R14C14)

**Agent:** document-specialist (sonnet) · **HEAD:** 39cfa889 · **Verdict: CLAUDE.md is accurate.** 41/41 spot-checked claims MATCH; 0 WRONG, 0 DRIFT, 1 informational LOW observation.

## Cycle-13 fix verification (all FIXED)
| Finding | Claim before C13 | Now | Code | Status |
|---|---|---|---|---|
| DOC-13-01 | LR header `X-Admin-Token` | `X-GalleryKit-Token` | `api-auth.ts:14` `TOKEN_HEADER='x-gallerykit-token'` | FIXED |
| DOC-13-02 | "32-char hex" | `gk_<base64url(32)>` 46 chars, SHA-256 | `admin-tokens.ts:19-22,48-52` | FIXED |
| SEC-13-01 | feed `adminUsers.username` | `author_name: sql\`NULL\`` | `data.ts:792-798` | FIXED |
| DOC-13-03 | `process-image.ts:1131-1135` | `:1088-1089` + `:1157` | confirmed | FIXED |
| DOC-13-04 | `settings-hash.ts:41-53` | `:42-54` | confirmed | FIXED |
| DOC-13-05 | `FLUSH_CHUNK_SIZE = 20` | `= 5` | `data.ts:66,147` | FIXED |

## Spot-check (41 claims, all MATCH) — highlights
`IMAGE_PIPELINE_VERSION=7` (`gallery-config-shared.ts:21`); `NEXT_UPLOAD_BODY_MAX_BYTES=278921216` (`upload-limits.ts:6`); 9 `COLOR_IMPACTING_KEYS` (`settings-hash.ts:42-54`); `HASH_LENGTH=8`/`CACHE_TTL_MS=5000`; Argon2id m=65536/t=3/p=4; login 5/15-min (per-IP + per-account); `PASSWORD_CHANGE_MAX_ATTEMPTS=10`; `SEMANTIC_SCAN_LIMIT=2000`/`TOP_K_MAX=50`/`DEFAULT=20`; SW `HEAD_REVALIDATE_TIMEOUT_MS=300`, HTML 24h/50-entry, image 50 MB LRU; nginx 2M/64K/250M/216M/216M; `UPLOAD_MAX_TOTAL_BYTES=2 GiB`/`FILES=100`/`MAX_UPLOAD_FILE_BYTES=200 MiB`; pool 10/queue 20/keepalive; `OG_PHOTO_MAX_BYTES=1 MB`; `AUDIT_LOG_RETENTION_DAYS=90`; `VIEW_RETENTION_DAYS=395`; `BACKFILL_CONCURRENCY=2` (sidecar)/`ADMIN_BACKFILL_CONCURRENCY=1` (in-app, cap=2); `QUEUE_CONCURRENCY=1`; image_sizes default `[640,1536,2048,4096,5120,7680]`; `MAX_IMAGE_SIZE_COUNT=8`; quality webp90/avif85/jpeg90; `avif_effort=6`; `wide_gamut_max_source_pixels=50_000_000`; force_srgb/allow_hdr default false; `semantic_search_mode='disabled'`; `MAX_BLUR_DATA_URL_LENGTH=4096`; `stop_grace_period: 30s`; full NCLX primaries/transfer/matrix code maps; ISOBMFF walker depth 5 / 1 MB; `IMAGE_MAX_INPUT_PIXELS=268435456`/`_TOPIC=67108864`.

## LOW observation (informational, no action)
`SHARP_CONCURRENCY` env-var row accurately describes behavior when SET (`Math.min(env, max(1,cpu-1))`) but omits that the DEFAULT (env absent) is the more conservative `Math.max(1, Math.floor((cpu-1)/3))` divide-by-3 fan-out cap (`process-image.ts:36-48`). The Default column lists "—" (honest, computed value), so this is incompleteness, not error. No correction required.

## Summary
| Category | Count |
|---|---|
| Claims spot-checked | 41 |
| MATCH | 41 |
| WRONG / DRIFT | 0 |
| LOW informational | 1 |

**Cycle-14 verdict:** CLAUDE.md is accurate; all cycle-13 doc fixes confirmed in place; no new mismatches across env-var defaults, line citations, pipeline constants, rate-limit params, NCLX tables, pool config, SW sizing, upload limits.
