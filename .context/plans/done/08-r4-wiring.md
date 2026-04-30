# Plan 08: R4 Wiring — Connect Dead Infrastructure

**Priority:** P1 — Fix within 1 week  
**Estimated effort:** 4-5 hours  
**Sources:** Architecture TD-02/03/05/07, Code M-01/02/03/04/05, Security M-1/M-2

These items were all implemented but never wired into consumers.

---

## 1. Wire MySQL rate limiting into login + search
**Source:** Architecture TD-02, Security M-2, Code M-03  
**Files:**
- `src/app/actions/auth.ts:82-99` — replace in-memory login rate limit with `checkRateLimit`/`incrementRateLimit` calls
- `src/app/actions/public.ts:33-48` — replace in-memory search rate limit with DB-backed calls
- Keep in-memory Maps as optional fast-path cache (check Map first, fall through to DB)
- On successful login: optionally reset via DB delete

## 2. Wire purgeOldBuckets into hourly GC
**Source:** Architecture TD-05, Security M-1  
**Files:**
- `src/lib/image-queue.ts:164` — add `purgeOldBuckets()` call alongside `purgeExpiredSessions()`
- Import from `@/lib/rate-limit`

## 3. Wire audit log — export + write path
**Source:** Architecture TD-03, Code M-04  
**Files:**
- `src/db/index.ts:34` — add `auditLog` to re-exports
- Create `src/lib/audit.ts` — helper `logAuditEvent(userId, action, target?, ip?, metadata?)`
- Wire into: `auth.ts` (login success/failure), `admin-users.ts` (create/delete), `images.ts` (batch delete), `db-actions.ts` (restore)
- Use fire-and-forget `.catch(console.debug)` to avoid blocking

## 4. Adopt ActionResult type or delete
**Source:** Architecture TD-07, Code M-01  
**Decision:** Adopt incrementally — start with simple actions
**Files:**
- `src/app/actions/tags.ts` — `deleteTag`, `updateTag` return ActionResult
- `src/app/actions/sharing.ts` — `revokePhotoShareLink`, `deleteGroupShareLink` return ActionResult
- `src/app/actions/admin-users.ts` — all 3 functions return ActionResult
- Update callers to check `result.success` instead of `result.error`

## 5. Wire IMAGE_BASE_URL into image paths
**Source:** Code M-02  
**Files:**
- Create `src/lib/image-url.ts` — `imageUrl(path: string): string` that prepends `IMAGE_BASE_URL`
- Update `home-client.tsx`, `search.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `g/[key]/page.tsx` to use `imageUrl()`

## 6. Fix unused import in public.ts
**Source:** Code M-05  
**File:** `src/app/actions/public.ts:7` — either use `SEARCH_RATE_LIMIT_MAX_KEYS` or remove import

---

## Verification
- [ ] Login rate limit survives container restart (verify with curl)
- [ ] purgeOldBuckets runs hourly (check logs)
- [ ] Audit log has entries after login + user create + delete
- [ ] ActionResult type used in >= 5 actions
- [ ] IMAGE_BASE_URL=https://cdn.example.com renders correct image URLs
- [ ] npm run build passes
- [ ] npm test passes
