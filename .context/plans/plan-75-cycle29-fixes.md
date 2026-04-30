# Plan 75 — Cycle 29 Fixes (C29-01 through C29-06)

**Created:** 2026-04-19 (Cycle 29)
**Status:** DONE
**Severity:** 1 MEDIUM, 4 LOW (1 LOW deferred)

---

## Problem

Six actionable issues identified in the cycle 29 comprehensive review, centered on two themes:
1. **Audit logging gap** — `dumpDatabase` lacks audit logging (1 finding)
2. **Cache consistency gaps** — missing `/admin/dashboard` and `/admin/tags` revalidation paths in sharing and tag operations (3 findings)
3. **Operational hygiene** — no audit log purge/rotation mechanism (1 finding)

---

## Implementation Steps

### Step 1: C29-01 — Add audit logging to dumpDatabase

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`

After successful dump (after line 146, before `resolve({ success: true, ...})`):
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'db_backup', 'database', DB_NAME, undefined, { filename }).catch(console.debug);
```

Note: `getCurrentUser` and `logAuditEvent` are already imported.

### Step 2: C29-02 — Add /admin/dashboard revalidation to createPhotoShareLink

**File:** `apps/web/src/app/actions/sharing.ts`, line 87

Change:
```ts
revalidateLocalizedPaths(`/p/${imageId}`);
```
To:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/admin/dashboard');
```

### Step 3: C29-03 — Add /admin/dashboard revalidation to revokePhotoShareLink

**File:** `apps/web/src/app/actions/sharing.ts`, line 212

Change:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, `/s/${oldShareKey}`);
```
To:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, `/s/${oldShareKey}`, '/admin/dashboard');
```

### Step 4: C29-04 — Add /admin/tags revalidation to batchUpdateImageTags

**File:** `apps/web/src/app/actions/tags.ts`, line 301

Change:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
```
To:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
```

### Step 5: C29-06 — Add audit log purge mechanism

**File:** `apps/web/src/lib/audit.ts`

Add a `purgeOldAuditLog` function:
```ts
export async function purgeOldAuditLog(maxAgeMs: number = 90 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
}
```

Note: Will need to import `lt` from `drizzle-orm`.

**File:** `apps/web/src/lib/image-queue.ts`, lines 273-280

Add the `purgeOldAuditLog` call to the GC interval:
```ts
import { purgeOldAuditLog } from '@/lib/audit';
// In the GC interval callback and startup:
purgeOldAuditLog().catch(err => console.debug('purgeOldAuditLog failed:', err));
```

Also add `AUDIT_LOG_RETENTION_DAYS` env var support:
```ts
const auditRetentionMs = (Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90) * 24 * 60 * 60 * 1000;
purgeOldAuditLog(auditRetentionMs).catch(err => console.debug('purgeOldAuditLog failed:', err));
```

### Step 6: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/[locale]/admin/db-actions.ts` — add audit logging to dumpDatabase
- `apps/web/src/app/actions/sharing.ts` — add /admin/dashboard revalidation to createPhotoShareLink and revokePhotoShareLink
- `apps/web/src/app/actions/tags.ts` — add /admin/tags revalidation to batchUpdateImageTags
- `apps/web/src/lib/audit.ts` — add purgeOldAuditLog function
- `apps/web/src/lib/image-queue.ts` — call purgeOldAuditLog from hourly GC

## Risk Assessment

- **Risk:** LOW — All changes are targeted fixes. The audit logging is additive (fire-and-forget with `.catch(console.debug)`). The revalidation additions ensure cache consistency. The audit log purge is a standard GC operation with a generous default retention period (90 days).
