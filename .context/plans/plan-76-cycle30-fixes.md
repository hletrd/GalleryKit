# Plan 76 — Cycle 30 Fixes (C30-01 through C30-09)

**Created:** 2026-04-19 (Cycle 30)
**Status:** DONE
**Severity:** 8 LOW (4 actionable, 4 deferred)

---

## Problem

Eight LOW severity issues identified in the cycle 30 comprehensive review, centered on three themes:
1. **Error message correctness** — `deleteGroupShareLink` returns wrong error message (1 finding)
2. **Cache consistency gaps** — missing `/admin/users` revalidation in admin user actions (1 finding)
3. **Rate limit precision** — password change rate limit shares login limit instead of having its own (1 finding)
4. **Code clarity** — confusing `purgeOldAuditLog` parameter precedence (1 finding)

---

## Implementation Steps

### Step 1: C30-01 — Fix `deleteGroupShareLink` error message

**File:** `apps/web/src/app/actions/sharing.ts`, line 244

Change:
```ts
return { error: t('failedToCreateGroup') };
```
To:
```ts
return { error: t('failedToDeleteGroup') };
```

**File:** `apps/web/messages/en.json` — add key:
```json
"failedToDeleteGroup": "Failed to delete group"
```

**File:** `apps/web/messages/ko.json` — add key:
```json
"failedToDeleteGroup": "그룹을 삭제할 수 없습니다"
```

### Step 2: C30-09 — Add `/admin/users` revalidation to admin user actions

**File:** `apps/web/src/app/actions/admin-users.ts`, line 51

Change:
```ts
revalidateLocalizedPaths('/admin/dashboard');
```
To:
```ts
revalidateLocalizedPaths('/admin/dashboard', '/admin/users');
```

**File:** `apps/web/src/app/actions/admin-users.ts`, line 88

Change:
```ts
revalidateLocalizedPaths('/admin/dashboard');
```
To:
```ts
revalidateLocalizedPaths('/admin/dashboard', '/admin/users');
```

### Step 3: C30-05 — Clarify `purgeOldAuditLog` parameter precedence

**File:** `apps/web/src/lib/audit.ts`, lines 46-50

Change:
```ts
export async function purgeOldAuditLog(maxAgeMs?: number): Promise<void> {
    const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90;
    const effectiveMaxAgeMs = maxAgeMs ?? retentionDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - effectiveMaxAgeMs);
    await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
}
```
To:
```ts
export async function purgeOldAuditLog(maxAgeMs?: number): Promise<void> {
    // Precedence: 1) explicit parameter, 2) AUDIT_LOG_RETENTION_DAYS env var, 3) default 90 days
    let effectiveMaxAgeMs: number;
    if (maxAgeMs !== undefined) {
        effectiveMaxAgeMs = maxAgeMs;
    } else {
        const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10) || 90;
        effectiveMaxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
    }
    const cutoff = new Date(Date.now() - effectiveMaxAgeMs);
    await db.delete(auditLog).where(lt(auditLog.created_at, cutoff));
}
```

### Step 4: C30-02 — Add dedicated password change rate limit constant

**File:** `apps/web/src/lib/auth-rate-limit.ts`

Add constant:
```ts
export const PASSWORD_CHANGE_MAX_ATTEMPTS = 10;
```

**File:** `apps/web/src/app/actions/auth.ts`, line 236

Change:
```ts
if (limitData.count >= LOGIN_MAX_ATTEMPTS) {
```
To:
```ts
if (limitData.count >= PASSWORD_CHANGE_MAX_ATTEMPTS) {
```

**File:** `apps/web/src/app/actions/auth.ts`, line 240

Change:
```ts
const dbLimit = await checkRateLimit(ip, 'password_change', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
```
To:
```ts
const dbLimit = await checkRateLimit(ip, 'password_change', PASSWORD_CHANGE_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
```

Update import in `auth.ts` to include `PASSWORD_CHANGE_MAX_ATTEMPTS`:
```ts
import { ..., PASSWORD_CHANGE_MAX_ATTEMPTS } from '@/lib/auth-rate-limit';
```

### Step 5: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/actions/sharing.ts` — fix error message in deleteGroupShareLink
- `apps/web/src/app/actions/admin-users.ts` — add /admin/users revalidation
- `apps/web/src/lib/audit.ts` — clarify purgeOldAuditLog parameter precedence
- `apps/web/src/lib/auth-rate-limit.ts` — add PASSWORD_CHANGE_MAX_ATTEMPTS constant
- `apps/web/src/app/actions/auth.ts` — use PASSWORD_CHANGE_MAX_ATTEMPTS in updatePassword
- `apps/web/messages/en.json` — add failedToDeleteGroup key
- `apps/web/messages/ko.json` — add failedToDeleteGroup key

## Risk Assessment

- **Risk:** LOW — All changes are targeted fixes. The error message fix is cosmetic correctness. The revalidation additions ensure cache consistency. The audit log parameter clarity is a non-functional refactor. The password change rate limit increase from 5 to 10 reduces false-positive lockouts for a less risky operation.

---

## Deferred Findings

### C30-03: `flushGroupViewCounts` re-buffers failed increments without retry limit [LOW, Medium Confidence]

- **File+Line:** `apps/web/src/lib/data.ts`, lines 27-52
- **Original Severity/Confidence:** LOW / Medium
- **Reason for deferral:** The current behavior is self-limiting: the buffer has a hard cap of 1000 entries, and the 5-second flush interval prevents a true tight loop. Adding retry counters increases complexity for a scenario (persistent DB outage) that already degrades gracefully (drops increments at buffer cap). The risk of connection pool spikes on DB recovery is low given the small buffer size.
- **Exit criterion:** If view count flushing causes measurable DB connection pool pressure during recovery from outages, this should be re-opened.

### C30-04: `createGroupShareLink` insertId validation inside transaction [LOW, Low Confidence]

- **File+Line:** `apps/web/src/app/actions/sharing.ts`, lines 158-163
- **Original Severity/Confidence:** LOW / Low
- **Reason for deferral:** The `insertId` check is a defense-in-depth measure against a MySQL driver bug that has never been observed. The transaction rollback on failure is actually the correct behavior for data consistency — rolling back the group insert along with the images is safer than leaving an orphaned group. Changing the structure would add complexity for an unlikely scenario.
- **Exit criterion:** If a MySQL driver bug causes invalid `insertId` values, this should be re-opened.

### C30-06: Tag slug regex inconsistency [LOW, Low Confidence]

- **File+Line:** `apps/web/src/app/actions/public.ts`, line 19; `apps/web/src/lib/validation.ts`, line 11
- **Original Severity/Confidence:** LOW / Low
- **Reason for deferral:** Tag slugs are auto-generated by `getTagSlug()` which replaces underscores with hyphens, so underscores never appear in practice. The regex inconsistency has no real-world impact. Harmonizing would require auditing all tag slug usage to ensure no breakage, which is disproportionate to the cosmetic benefit.
- **Exit criterion:** If tags with underscore-containing slugs are manually inserted into the DB, this should be re-opened.

### C30-08: Health endpoint exposes DB connectivity status [LOW, Medium Confidence]

- **File+Line:** `apps/web/src/app/api/health/route.ts`
- **Original Severity/Confidence:** LOW / Medium
- **Reason for deferral:** Unauthenticated health endpoints are a standard pattern for container orchestration (Docker, Kubernetes, load balancers). Removing the `db` field would reduce observability for ops teams. The security risk is low — an attacker monitoring health checks to time an attack during DB outages is a sophisticated scenario with minimal added value over just trying the public endpoints.
- **Exit criterion:** If the health endpoint is abused for targeted attacks during DB outages, this should be re-opened.
