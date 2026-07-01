# Cycle 67 Code Quality / Correctness Review

Current HEAD: `3e8ab924b5ed714f8a0f1dbfe1f9739d6fe25886`.

## Inventory

- Read `AGENTS.md`, `CLAUDE.md`, and Cycle 66 aggregate/plan/deferred artifacts.
- Reviewed Settings warning state, byte-impacting settings hash, upload HDR gates, current source-contract tests, recent commit diff, route/action inventory, migration journal tail, and scripts inventory.
- No files edited in this review lane.

## Findings

### C67-01 - HDR ingest toggle is treated as an existing-derivative re-encode setting

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:52`, `apps/web/src/app/actions/images.ts:375`, `apps/web/src/app/api/admin/lr/upload/route.ts:396`, `apps/web/src/lib/settings-hash.ts:47`.
- Evidence: `COLOR_HDR_BACKFILL_KEYS` includes `allow_hdr_ingest`, but `allow_hdr_ingest` gates future HDR uploads; it does not alter existing derivative bytes and is not in the authoritative `COLOR_IMPACTING_KEYS` hash list.
- Failure scenario: an admin enables HDR ingest for future uploads and sees a "Backfill required" banner for existing photos, encouraging an unnecessary and potentially expensive re-encode.
- Fix direction: reuse a client-safe byte-impacting settings contract for the warning key set and exclude upload-admission settings.

## Final Sweep

No additional correctness findings were confirmed. `C65-02` remains the broader durable settings-only re-encode marker and was not re-raised.
