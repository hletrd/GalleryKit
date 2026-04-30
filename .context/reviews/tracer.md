# Tracer Review — tracer (Cycle 13)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Causal tracing of suspicious flows

### Trace 1: `batchUpdateImageTags` audit event on zero-mutation path

**Hypothesis H1**: `batchUpdateImageTags` logs a `tags_batch_update` audit event even when the transaction made no changes to the database.

**Trace**:
1. Admin UI calls `batchUpdateImageTags(imageId, ['invalid<name>'], [])` via server action.
2. `batchUpdateImageTags` validates and enters the transaction at line 390.
3. Inside the transaction, the `for` loop at line 400 iterates over `addTagNames`:
   - `requireCleanInput('invalid<name>')` returns `rejected: true` (contains `<`).
   - `nameRejected` is true, so `continue` at line 404 skips the tag.
4. No `added++` or `removed++` occurs.
5. Transaction completes successfully (no throws).
6. After the transaction at line 451-452: `logAuditEvent(...)` fires with `{ added: 0, removed: 0 }`.
7. No data was mutated, but an audit event is recorded.

**Verdict H1**: CONFIRMED — the audit event fires with zero-effect metadata. The metadata is accurate (not misleading like AGG10-01/AGG12-01), but the event itself is unnecessary noise. This is a minor consistency gap in the audit-log gating pattern.

## New Findings

### C13-TR-01 (Low / Low). `batchUpdateImageTags` logs `tags_batch_update` audit event when `added === 0 && removed === 0`

- Location: `apps/web/src/app/actions/tags.ts:452`
- Same class as AGG10-01/AGG11-01/AGG12-01 but with lower impact because the metadata is accurate (no false positive count). The event is just unnecessary noise when no mutation occurred.
- Suggested fix: Gate the audit log on `added > 0 || removed > 0`.

## Carry-forward (unchanged — existing deferred backlog)

- C8-TR-02: `countCodePoints()` not applied to topics.ts / seo.ts — already fixed in C8-AGG8R-02.
