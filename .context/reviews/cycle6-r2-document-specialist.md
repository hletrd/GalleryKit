# Document Specialist Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: document-specialist
## Scope: Doc/code mismatches against authoritative sources

---

### C6R2-DOC01: CLAUDE.md describes storage as if it works (MEDIUM)

**File:** `CLAUDE.md`

The CLAUDE.md document describes the image processing pipeline as if files are stored locally:
- "Original saved to `public/uploads/original/`"
- "Processed files in `public/uploads/{avif,webp,jpeg}/`"
- "Images stored in `apps/web/public/uploads/` — ensure persistence in Docker"

These are all still accurate because the storage abstraction isn't integrated yet. However, the document doesn't mention the StorageBackend abstraction at all, the `storage_backend` admin setting, or the S3/MinIO options. This creates a gap: a developer reading CLAUDE.md would not know that a storage abstraction exists.

**Fix:** Add a "Storage Backend" section to CLAUDE.md documenting the abstraction, the `storage_backend` setting, and the current integration status (i.e., "abstraction exists but is not yet integrated into the processing pipeline").

**Confidence:** HIGH

---

### C6R2-DOC02: Storage module JSDoc claims it's usable (LOW)

**File:** `apps/web/src/lib/storage/index.ts:1-11`

The JSDoc says:
```
Usage:
  import { getStorage } from '@/lib/storage';
  const storage = getStorage();
  await storage.writeBuffer('webp/foo.webp', buffer, 'image/webp');
```

This implies the API is ready to use, but no consumer actually uses it. A developer following this documentation would write code that calls `getStorage()`, which would work but would be disconnected from the actual upload pipeline.

**Fix:** Add a note that the storage backend is not yet integrated into the processing pipeline, and that direct fs operations are still used.

**Confidence:** MEDIUM

---

### C6R2-DOC03: `gallery-config-shared.ts` JSDoc is accurate (CONFIRMED)

**File:** `apps/web/src/lib/gallery-config-shared.ts:1-6`

The JSDoc correctly states "This module contains ONLY pure constants, types, and validators. It has NO database imports and is safe for use in client components." This is accurate — the module only exports constants, types, and pure functions.

**Confidence:** HIGH
