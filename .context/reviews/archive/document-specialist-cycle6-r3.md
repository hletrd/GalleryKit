# Document Specialist -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Doc/code mismatches against authoritative sources. Mature codebase with 46+ prior cycles.

## Findings

### DS6R3-01: CLAUDE.md says "Storage" is configurable but doesn't note it's not yet integrated [LOW] [HIGH confidence]
**File:** `CLAUDE.md` (Tech Stack section), `apps/web/src/lib/storage/index.ts` (NOTE comment)
**Description:** The CLAUDE.md Tech Stack section doesn't mention the storage backend abstraction. The `storage/index.ts` has a NOTE explaining that the storage backend is not yet integrated into the image processing pipeline. The admin settings page (`settings.ts` + `settings-client.tsx`) allows selecting storage_backend but the selection has no practical effect on file I/O. There's a documentation gap: neither CLAUDE.md nor the settings UI informs developers/admins that the storage backend setting is not yet functional.
**Fix:** Add a note to CLAUDE.md under "Key Files & Patterns" or a new section: "Storage Backend: The `@/lib/storage` module provides a `StorageBackend` abstraction (local, MinIO, S3), but it is **not yet integrated** into the upload/processing/serving pipeline. The `storage_backend` admin setting switches the singleton but actual file I/O still uses direct `fs` operations in `process-image.ts` and `serve-upload.ts`."

### DS6R3-02: `exportImagesCsv` memory comment is misleading [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 76-79
**Description:** The comment says "Release reference to allow GC" but the `csvLines` array still holds all the string data derived from `results`. The memory benefit is limited to releasing the structured DB result objects (with their field names and type metadata) while the CSV string representation remains in memory.
**Fix:** Update the comment to accurately reflect the memory situation.

## Summary

Minor documentation findings. DS6R3-01 is the most useful — documenting the storage backend's non-integration status would prevent confusion for developers and admins.
