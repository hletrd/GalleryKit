# Debugger — Cycle 43 (2026-04-20)

## Findings

### D43-01: `db-actions.ts` dumpDatabase does not verify backup file integrity after write [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 143-186
After `mysqldump` completes with exit code 0 and the writeStream finishes flushing, the backup is reported as successful. However, the code does not verify that the backup file is non-empty or contains valid SQL content. If `mysqldump` exits 0 but produces no output (e.g., due to a permissions issue that doesn't cause an error code), the backup file would be empty and useless. The restore scanner validates headers, but the dump path has no such check.
**Fix:** After the writeStream finishes, `fs.stat` the output file and verify it's non-empty. Optionally check the first few bytes for the `-- MySQL dump` header that mysqldump always produces.

### D43-02: `restoreDatabase` GET_LOCK advisory lock uses 0 timeout but doesn't handle lock acquisition failure gracefully in all paths [LOW] [LOW confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 218-224
The `GET_LOCK` call uses timeout 0 (immediate). If the lock cannot be acquired, the function returns an error. However, the `BigInt(1)` comparison at line 223 is handling a MySQL BigInt return from `GET_LOCK`. In mysql2, `GET_LOCK` returns a BigInt when the connection is configured with `bigNumberStrings: false` (default). The code handles this correctly with `acquired !== 1 && acquired !== BigInt(1)`. No bug here.

### D43-03: `createGroupShareLink` position values may not match display order if imageIds contain duplicates before dedup [LOW] [LOW confidence]
**File:** `apps/web/src/app/actions/sharing.ts` lines 175, 214-219
At line 175, `uniqueImageIds = Array.from(new Set(imageIds))` deduplicates the IDs. But at line 214, the position values are assigned based on the index in `uniqueImageIds` — `position` goes 0, 1, 2, ... This is correct because positions are sequential for the unique set. However, the positions are set based on the order of `uniqueImageIds` (which preserves insertion order of the Set), not on any explicit sort. If the client sends IDs in a random order, the group's image ordering will match that random order. This is probably fine (the client controls the order), but worth noting.

### D43-04: `LANG`/`LC_ALL` passthrough to mysqldump/mysql child processes causes non-deterministic behavior [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
Same finding as C43-01, CR43-01. If the server locale changes (e.g., after an OS update), mysqldump output encoding could change, potentially causing restore failures when the backup was created under a different locale. Setting explicit `C.UTF-8` would make backups deterministic.

## Summary
1 MEDIUM finding (LANG/LC_ALL passthrough — confirmed by code-reviewer and critic), 1 LOW finding (backup file integrity check). No latent bugs or failure modes found beyond what's already tracked.
