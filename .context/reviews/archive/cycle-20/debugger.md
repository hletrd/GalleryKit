# Debugger Review — Cycle 20
**Date:** 2026-06-27
**HEAD:** 9af705f4
**Findings:** 4 (2 MEDIUM, 2 LOW)

---

## Methodology

Surfaces audited this cycle:
- `parseInt` vs `Number()` pattern sweep across all of `lib/` (except files confirmed clean in cycle 19)
- `lib/audit.ts` full read (retention parsing + DELETE chunking parity with view-retention)
- `lib/process-image.ts:330-340` — `IMAGE_MAX_INPUT_PIXELS` / `IMAGE_MAX_INPUT_PIXELS_TOPIC` / `SHARP_CONCURRENCY` parsing
- `lib/upload-limits.ts` — `parsePositiveIntEnv` helper
- `lib/session.ts` — `parseInt(timestamp, 10)` in `verifySessionToken`
- Cycle-19 F2 re-verification: `gps-exif-strip.ts` `walkAborted` guard + `stripGpsFromOriginal` Tier 2 caller path

Deferred/known items from `cycle-19-deferred.md` and `_aggregate.md` consulted first. None of the findings below duplicate known items.

---

## Finding F1 — `AUDIT_LOG_RETENTION_DAYS` parsed with `parseInt`, same class as cycle-19 F1

**File:** `apps/web/src/lib/audit.ts:111`
**Severity:** MEDIUM
**Confidence:** High

```ts
const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10);
effectiveMaxAgeMs = Number.isFinite(retentionDays) && retentionDays > 0
    ? retentionDays * 24 * 60 * 60 * 1000
    : DEFAULT_MAX_AGE_MS;
```

`Number.parseInt('1e3', 10)` stops at `'e'` and returns `1`, not `1000`. The guard `Number.isFinite(1) && 1 > 0` is true, so `effectiveMaxAgeMs = 86_400_000` ms = **1 day**. On the next hourly GC sweep (`image-queue.ts` calls `purgeOldAuditLog()`) the audit log is pruned to the last 24 hours, silently discarding months of admin-action history.

Cycle-19 found and fixed the identical bug in `lib/view-retention.ts:50` (cycle-19 F1). That fix was NOT applied to `audit.ts`.

**Trigger:** `AUDIT_LOG_RETENTION_DAYS=1e3` in `.env.local` (operator intending 1000-day retention).

**Root cause:** `audit.ts` and `view-retention.ts` have parallel retention-guard logic. The cycle-19 fix was applied only to the specific file reported, not as a pattern sweep across the codebase.

**Fix (one line):**
```ts
// audit.ts:111
const retentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? '');
```
`Number('1e3')` returns `1000`. The existing `Number.isFinite && > 0` guard still rejects NaN/negative/zero correctly.

---

## Finding F2 — `IMAGE_MAX_INPUT_PIXELS` / `IMAGE_MAX_INPUT_PIXELS_TOPIC` parsed with `parseInt`

**File:** `apps/web/src/lib/process-image.ts:330, 339`
**Severity:** MEDIUM
**Confidence:** High

```ts
const envMaxInputPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS ?? '', 10);
const maxInputPixels = Number.isFinite(envMaxInputPixels) && envMaxInputPixels > 0
    ? envMaxInputPixels
    : 256 * 1024 * 1024;
```

`Number.parseInt('256e6', 10)` stops at `'e'` and returns `256`. The guard `Number.isFinite(256) && 256 > 0` is true, so `maxInputPixels = 256`. Sharp's `limitInputPixels: 256` caps at **256 total pixels**. Every real photo exceeds this and throws `VipsError: Input image exceeds pixel limit`, causing all upload jobs to fail.

`IMAGE_MAX_INPUT_PIXELS_TOPIC` at line 339 has the same pattern.

CLAUDE.md documents the default as `268435456` (plain integer), so scientific notation is unlikely. However the env var description invites large values ("decompression bomb protection cap, default 256M pixels"); an operator reading "256M pixels" might naturalistically write `256e6`.

**Fix (two lines):**
```ts
// process-image.ts:330
const envMaxInputPixels = Number(process.env.IMAGE_MAX_INPUT_PIXELS ?? '');
// process-image.ts:339
const envTopicPixels = Number(process.env.IMAGE_MAX_INPUT_PIXELS_TOPIC ?? '');
```
`SHARP_CONCURRENCY` at line 45 has the same `parseInt` but the impact is benign (parses as 1 = min threads).

---

## Finding F3 — `purgeOldAuditLog` uses unbounded DELETE (no LIMIT chunking)

**File:** `apps/web/src/lib/audit.ts:117`
**Severity:** LOW
**Confidence:** High

```ts
await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
```

Single unbounded `DELETE FROM audit_log WHERE created_at < ?` with no `LIMIT`. By contrast, `purgeOldViewEvents` in `view-retention.ts:77-86` uses a `LIMIT 5000` batch loop bounded by `MAX_BATCHES_PER_TABLE = 200`, explicitly to avoid a long table lock on the single MySQL writer.

The audit log is low-write-rate (admin actions only), so a multi-million-row backlog is unlikely in normal operation. The risk surface is an instance that ran with a misconfigured short retention (see F1) for a long time then had retention extended — the first correct sweep hits all accumulated rows in one lock.

**Fix:** Apply the same `LIMIT`-based chunking pattern from `view-retention.ts`. Not urgent; flagging for parity.

---

## Finding F4 — `parsePositiveIntEnv` in `upload-limits.ts` uses `parseInt`

**File:** `apps/web/src/lib/upload-limits.ts:11`
**Severity:** LOW
**Confidence:** High

```ts
function parsePositiveIntEnv(name: string, fallback: number): number {
    const rawValue = process.env[name]?.trim();
    if (!rawValue) return fallback;
    const parsed = Number.parseInt(rawValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
```

Used for `UPLOAD_MAX_TOTAL_BYTES`, `UPLOAD_MAX_FILES_PER_WINDOW`, and `NEXT_UPLOAD_BODY_MAX_BYTES`. If `UPLOAD_MAX_TOTAL_BYTES='2e9'` (2 billion bytes / 2 GiB), `parseInt('2e9', 10)` returns `2`. Guard passes (`isFinite(2) && 2 > 0`), so `MAX_TOTAL_UPLOAD_BYTES = 2 bytes`. Every upload batch is immediately rejected as exceeding quota.

Lower severity than F2 because the error surfaces as a quota rejection rather than an opaque Sharp exception, and operators are likely to copy the documented plain-integer default (`2147483648`).

**Fix (one line):**
```ts
const parsed = Number(rawValue);
```

---

## Cycle-19 Fixes Verified

| Fix | Location | Status |
|-----|----------|--------|
| F1 — view-retention `parseInt` to `Number()` | `lib/view-retention.ts:50` | Confirmed. `Number(process.env.VIEW_RETENTION_DAYS ?? '')` |
| F2 — gps-exif-strip `walkAborted` returns null | `lib/gps-exif-strip.ts:393,405,411,466` | Confirmed. `walkAborted = true` on all three early-exit paths; `if (walkAborted) return null;` at line 466 fires before the clean-verdict return |
| CQ19-01 — OG fetch total budget cap | `lib/og-photo-fetch.ts:47,101,106` | Confirmed. `OG_PHOTO_TOTAL_BUDGET_MS = 10_000`; `if (Date.now() >= deadline) break;` |

**Cycle-19 F2 caller-path re-verification (`stripGpsFromOriginal`, `process-image.ts:1629-1714`):** `scrubbed = null` from `stripGpsFromIsobmffBuffer` correctly falls through to Tier 2 re-encode. Temp file lifecycle is clean: written to `tmpPath` then atomically renamed, or cleaned by `safeUnlink(tmpPath)` in the catch block. The HEIC/HEIF Tier 2 early-return path (no HEVC encoder) correctly returns before writing `tmpPath` — no orphan risk.

---

## Non-Findings (investigated, not bugs)

- **`session.ts:128 parseInt(timestamp, 10)`** — Safe. Timestamp is always `Date.now().toString()` (pure decimal integer string, never scientific notation). `parseInt("1719481234567", 10)` returns the correct value.
- **`rate-limit.ts:144 Number.parseInt(value, 10)` for `TRUSTED_PROXY_HOPS`** — If `'1e3'` misparses as 1, impact is the safe default (1 hop = standard nginx forward). Benign.
- **OG photo route `parseInt(id, 10)` (`api/og/photo/[id]/route.tsx:55`)** — Pre-guarded by `/^\d+$/` regex before `parseInt`; scientific notation rejected at the regex.
- **`image-queue.ts:212 QUEUE_CONCURRENCY`** — Uses `Number(process.env.QUEUE_CONCURRENCY) || 1` — correct.
- **`admin-backfill-runner.ts:665 ADMIN_BACKFILL_CONCURRENCY`** — Uses `Number(process.env.ADMIN_BACKFILL_CONCURRENCY) || 1` — correct.
- **`isLosslessWebpByChunk` zero-progress guard** — `if (next <= offset) return false` is dead code in JS (next >= offset + 8 always), but loop terminates safely via `while (offset + 8 <= buf.length)`. Harmless.

---

## Summary

| ID | File:line | Finding | Severity |
|----|-----------|---------|----------|
| F1 | `audit.ts:111` | `parseInt` for `AUDIT_LOG_RETENTION_DAYS`; `'1e3'` gives 1-day retention, silently near-empties audit log on next hourly GC | MEDIUM |
| F2 | `process-image.ts:330,339` | `parseInt` for `IMAGE_MAX_INPUT_PIXELS`; `'256e6'` gives 256-pixel bomb cap, rejects all uploads with opaque VipsError | MEDIUM |
| F3 | `audit.ts:117` | Unbounded DELETE in `purgeOldAuditLog`; no LIMIT chunking unlike `purgeOldViewEvents` | LOW |
| F4 | `upload-limits.ts:11` | `parseInt` in `parsePositiveIntEnv`; `'2e9'` gives 2-byte upload cap, blocks all uploads | LOW |
