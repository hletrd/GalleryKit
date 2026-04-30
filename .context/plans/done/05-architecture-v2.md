# Plan 05: Architecture & Code Quality

**Priority:** P1 (items 1-4), P2 (items 5-12)  
**Estimated effort:** 8-12 hours  
**Sources:** Architecture 3/5/7/10/13/14/16.2, Code H-01/H-02/H-07/M-01/M-02/M-04/S-01

---

## P1 — High Priority

### 1. Split `actions.ts` God Object (1682 lines)
**Source:** Architecture 16.2, Code H-01  
**File:** `apps/web/src/app/actions.ts`
Split into:
```
app/actions/
  auth.ts          — login, logout, session, rate limiting, password
  images.ts        — upload, delete, batch delete, update metadata
  topics.ts        — create, rename, delete, reorder, aliases
  tags.ts          — create, rename, delete, batch add
  sharing.ts       — share links, group links, revocation
  admin-users.ts   — create, delete admin users
  search.ts        — searchImagesAction, loadMoreImages
  index.ts         — re-export all for backward compatibility
```
Extract shared utilities:
```
lib/image-queue.ts     — PQueue, bootstrap, enqueue logic
lib/auth.ts            — getSessionSecret, generateSessionToken, verifySessionToken, getSession, isAdmin, getCurrentUser
lib/rate-limit.ts      — loginRateLimit Map, pruneLoginRateLimit, getClientIp
```

### 2. Move bootstrap queue to instrumentation hook
**Source:** Code H-07  
**Files:**
- Create `apps/web/src/instrumentation.ts`:
```typescript
export async function register() {
    const { initProcessingQueue } = await import('./lib/image-queue');
    await initProcessingQueue();
}
```
- Remove `void bootstrapImageProcessingQueue()` from actions.ts module level
- Remove ECONNREFUSED suppression (no longer needed at build time)

### 3. Fix always-truthy condition in uploadImages
**Source:** Code H-02  
**File:** `apps/web/src/app/actions.ts:745`
- Replace `if (insertedImage)` with `if (!result.insertId) { continue; }` before creating `insertedImage`

### 4. Add `/api/health` endpoint
**Source:** Architecture 14, Performance P1-08  
**File:** Create `apps/web/src/app/api/health/route.ts`
```typescript
export async function GET() {
    const dbOk = await db.execute(sql`SELECT 1`).then(() => true).catch(() => false);
    const queueState = getProcessingQueueState();
    return Response.json({
        status: dbOk ? 'ok' : 'degraded',
        db: dbOk,
        queue: { pending: queueState.enqueued.size, bootstrapped: queueState.bootstrapped }
    }, { status: dbOk ? 200 : 503 });
}
```

---

## P2 — Medium Priority

### 5. Fix `getTags()` naming collision
**Source:** Architecture 3.1, Code M-16  
**File:** `apps/web/src/app/actions.ts` (admin getTags)
- Rename to `getAdminTags()`
- Update all imports

### 6. Combine search queries into UNION
**Source:** Architecture 3.4  
**File:** `apps/web/src/lib/data.ts:391-467`
- Replace two parallel queries + JS dedup with single `UNION` query
- Reduces connection pool usage from 2 to 1 per search

### 7. Extract shared LOCALES constant
**Source:** Architecture 10.2  
**File:** Create `apps/web/src/lib/constants.ts`
```typescript
export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
```
Update 5 files: `proxy.ts:6,16`, `layout.tsx:63`, `i18n/request.ts:7`, `sitemap.ts:9`

### 8. Graceful shutdown handler
**Source:** Architecture 9.3  
**File:** `apps/web/scripts/entrypoint.sh` or `server.js` post-hook
- Add SIGTERM handler to drain PQueue, close DB pool, clear session purge interval
```typescript
process.on('SIGTERM', async () => {
    queue.pause(); queue.clear();
    await pool.end();
    process.exit(0);
});
```

### 9. Proper drizzle migrations
**Source:** Architecture 13  
- Generate new migration with `drizzle-kit generate` for current schema state
- Stop using `drizzle-kit push` in production
- Remove manual `CREATE TABLE IF NOT EXISTS` from `migrate.js` once migration is comprehensive

### 10. Structured logging
**Source:** Architecture 14  
- Add `pino` dependency
- Replace `console.log/warn/error` with structured logger
- Add request correlation IDs via middleware
- JSON format for Docker log aggregation

### 11. Remove `<style jsx global>` from nav-client.tsx
**Source:** Code M-04, UX m4  
**File:** `apps/web/src/components/nav-client.tsx:119-127`
- Move scrollbar-hiding CSS to `globals.css`:
```css
@layer utilities {
    .scrollbar-hide::-webkit-scrollbar { display: none; }
    .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
}
```
- Remove the `<style jsx global>` block entirely

### 12. Fix `colorScheme`/`themeColor` deprecation
**Source:** Code M-15, UX m1  
**File:** `apps/web/src/app/[locale]/layout.tsx:45-49`
- Move from `metadata` export to `viewport` export:
```typescript
export const viewport: Viewport = {
    colorScheme: 'light dark',
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#ffffff' },
        { media: '(prefers-color-scheme: dark)', color: '#09090b' },
    ],
};
```

---

## Verification
- [ ] `actions.ts` no longer exists (or is just a re-export barrel)
- [ ] No module-level side effects in any action file
- [ ] `/api/health` returns `{ status: "ok", db: true, queue: {...} }`
- [ ] `npm run build` produces no deprecation warnings for colorScheme
- [ ] Search uses a single DB query (check with MySQL slow query log)
- [ ] All 5 locale references point to shared `LOCALES` constant
