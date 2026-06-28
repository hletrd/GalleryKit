# Document-Specialist Review — Cycle 19 / HEAD 5c559a0f

**Scope:** CLAUDE.md, AGENTS.md — doc/code mismatches and stale line-number references. Method: read on-disk CLAUDE.md, verify each claim against source.

**Result: No remaining doc/code mismatches.** The current on-disk CLAUDE.md is accurate on all 29 verified items. (The system-prompt CLAUDE.md snapshot is a pre-cycle-19 copy; cycle-17/18 doc passes already corrected every item that looked stale from that snapshot.)

## Verified MATCH (29 items, HIGH confidence each)
- IMAGE_PIPELINE_VERSION = 7 (gallery-config-shared.ts:21) ✓
- COLOR_IMPACTING_KEYS = 9 keys at settings-hash.ts:45-57 ✓
- HASH_LENGTH = 8 (settings-hash.ts:71) ✓
- NEXT_UPLOAD_BODY_MAX_BYTES = 278921216 (upload-limits.ts derived) ✓
- IMAGE_MAX_INPUT_PIXELS = 268435456; IMAGE_MAX_INPUT_PIXELS_TOPIC = 67108864 (process-image.ts) ✓
- UPLOAD_MAX_TOTAL_BYTES = 2147483648; UPLOAD_MAX_FILES_PER_WINDOW = 100 ✓
- VIEW_RETENTION_DAYS = 395 (view-retention.ts) ✓
- SEMANTIC_SCAN_LIMIT = 2000; SEMANTIC_TOP_K_MAX = 50 (clip-embeddings.ts:17-18) ✓
- Smart-collection route /c/[slug] (NOT /s/, which is shared-links) ✓
- LR token header X-GalleryKit-Token (lr/upload/route.ts:65); token gk_ + base64url(32 bytes) = 46 chars (admin-tokens.ts:19-22) ✓
- process-image.ts line refs :1088-1089 (shared var removed) + :1157 (WI-14) ✓
- color-detection.ts:99-108 ProPhoto→gamma18 ✓
- smart_collections.query_json column (schema.ts:297), is_public (schema.ts:298) ✓
- Database Indexes — all 9 documented entries present in schema.ts ✓
- DB pool 10 conns / queueLimit 20 / keepalive (db/index.ts) ✓
- React cache() wraps exactly 10 functions + getSeoSettings (data.ts) ✓
- MAX_BLUR_DATA_URL_LENGTH = 4096; HEAD_REVALIDATE_TIMEOUT_MS = 300 ✓
- Advisory lock names match lib/advisory-locks.ts + test ✓
- Backfill cap formula at pool=10 → 2 (admin-backfill-runner.ts:105-106,139) ✓
- OG_PHOTO_MAX_BYTES = 1 MB (og-photo-fetch.ts:31) ✓
- Tech stack: next ^16.2.9, react ^19.2.5, typescript ^6 (package.json) ✓

## AGENTS.md
Read in full. Test commands, deploy workflow, git conventions (gitmoji, Conventional Commits, GPG -S) all consistent. No mismatches.

## Recommendation
No doc corrections needed this cycle. If a future refactor touches settings-hash.ts / process-image.ts / admin-tokens.ts, re-verify the internal line refs (45-57, 1088-1089, 1157).

## Findings
- None (all 29 checked items MATCH; HIGH confidence).
