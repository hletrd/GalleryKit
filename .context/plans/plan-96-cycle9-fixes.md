# Plan 96 — Cycle 9 Fixes

**Created:** 2026-04-19 (Cycle 9)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C9-F01 | `original_file_size` bigint mode: 'number' precision | MEDIUM | Medium | DEFER |
| C9-F02 | `batchUpdateImageTags` removed count overcount | LOW | Medium | IMPLEMENT |
| C9-F03 | `searchImagesAction` rate limit check/increment window | LOW | Low | DEFER |
| C9-F04 | `getImage` NULL capture_date logic | LOW | N/A | NO CHANGE (verified correct) |

### Deferred Findings

- C9-F01 (original_file_size BigInt precision): Same class as deferred C30-04/C36-02/C8-01. The practical risk is negligible given the 200MB upload cap. `file.size` is a `number` in the File API, so precision loss requires files > 8 PB which is impossible with current limits. **Exit criterion:** If upload limits are ever raised above 8 PB or if file sizes come from other sources.
- C9-F03 (search rate limit 1-request overshoot): The 1-request overshoot per window across processes is acceptable for a photo gallery search. The in-memory pre-increment prevents larger bursts for the same process. **Exit criterion:** If stricter rate-limit enforcement is needed (e.g., for commercial API usage).

---

## C9-F02: batchUpdateImageTags removed count overcount — IMPLEMENT

**File:** `apps/web/src/app/actions/tags.ts:287-289`

**Current code:**
```ts
await tx.delete(imageTags).where(and(eq(imageTags.imageId, imageId), eq(imageTags.tagId, tagRecord.id)));
removed++;
```

**Fix:** Check `affectedRows` from the delete result before incrementing, matching the C8-10 fix pattern for `added`:

```ts
const [deleteResult] = await tx.delete(imageTags).where(and(eq(imageTags.imageId, imageId), eq(imageTags.tagId, tagRecord.id)));
if (deleteResult.affectedRows > 0) removed++;
```

**Important:** Drizzle ORM's `delete()` within a MySQL transaction returns `[ResultSetHeader]` which includes `affectedRows`. This was verified by the C8-10 fix which uses the same pattern for `insert().ignore()`.

**Progress:** [x] Implemented — commit 74d0c3e

---

## Verification

- [x] C9-F02: `removed` counter only increments when DELETE actually removed a row (commit 74d0c3e)
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes
