# Document-Specialist Review — Run-2 Cycle 1 (HEAD eaee58dc)

Angle: CLAUDE.md / AGENTS.md / code-comment claims vs implementation.

## DOC-01 — Backfill resume-claim comment is inaccurate for the detection-failure path (MED, High confidence)

**Doc location:** `admin-backfill-runner.ts:31-37` header comment + CLAUDE.md "Backfill" section ("Idempotent: skips rows already at current version"). The comment promises "the next invocation will pick up where this one left off." **Code reality:** a row whose encode succeeded but whose `detectColorSignals` threw is bumped to `pipeline_version = 7` (lines 253-263), so it is NOT re-picked and its color columns stay stale — the opposite of "pick up where it left off." See DBG-01 / CVT-01 / CR-03. This is a doc/code mismatch on a correctness-relevant claim. **Fix:** either correct the behavior (preferred — DBG-01 fix) or amend the comment to state that detection failures permanently strand color metadata. Tied to a real bug, so fix the code.

## DOC-02 — CLAUDE.md "Backfill" section omits the in-app runner path (LOW, Medium confidence)

**Doc:** CLAUDE.md "Color & HDR Pipeline → Backfill" documents ONLY the sidecar `--rm` script (`backfill-color-pipeline.ts`) as the operational backfill path. The in-app runner (`admin-backfill-runner.ts`, R27-UX-HIGH-1) and the admin Settings "Re-encode existing photos" button shipped this run but are NOT mentioned in that section. An operator reading CLAUDE.md wouldn't know the button exists, or that (per ARCH-01) the two currently produce divergent `avif_10bit`. **Fix:** after unifying the two paths (ARCH-01), add a one-line note that the admin Settings button is the in-app equivalent of the sidecar script.

## VERIFIED-ACCURATE claims (spot-checked against code)
- `IMAGE_PIPELINE_VERSION = 7` — `gallery-config-shared.ts:21` (single source of truth; `process-image.ts:294` re-exports). ✓
- `avif_effort` default `6`, validator range 0-9 — `gallery-config-shared.ts:128, 191`. ✓ (CLAUDE.md "Sharp native default is 4; we ship 6" — consistent.)
- `wide_gamut_max_source_pixels` default `50_000_000` — `gallery-config-shared.ts:134` (`'50000000'`). ✓
- Advisory lock names list — all six match `advisory-locks.ts` exactly: `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:${jobId}`. ✓
- `_PrivacySensitiveKeys` admin-only column union (`data.ts:390`) matches the CLAUDE.md admin-only color/HDR column table; `avif_10bit` is documented public (data.ts:252-253) and correctly absent from the guard. ✓
- Backfill candidate selection `pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION` matches the documented idempotency rule (modulo DOC-01). ✓
- analytics-data.ts shared-group counting comment matches CLAUDE.md runtime-topology note (initial-load-only increment). ✓
