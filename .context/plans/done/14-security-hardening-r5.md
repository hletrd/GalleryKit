# Plan 14: Security Hardening — Round 5 ✅ DONE

**Priority:** P0 (item 0), P1 (items 1-3), P2 (items 4-9)
**Estimated effort:** 5-6 hours
**Sources:** Comprehensive Review R5 (CR-01, H-05, M-07, M-08, M-09, M-14), Prior Review (S-04, S-07, S-09, S-10, C-16)

---

## 0. Fix SQL restore bypass via conditional comments (P0 — CRITICAL)
**Source:** CR-01 (R5 review)
**File:** `src/app/[locale]/admin/db-actions.ts:226,237-239`

MySQL conditional comments without a space separator (e.g., `/*!50000PREPARE`) bypass both the conditional-comment regex and the word-boundary keyword patterns. This allows executing `GRANT`/`PREPARE`/`EXECUTE` via crafted SQL dumps.

**Fix:**
- Strip conditional comments before pattern matching:
  ```ts
  const strippedChunk = chunk.replace(/\/\*!\d*.*?\*\//gs, ' ');
  for (const pattern of dangerousPatterns) {
      if (pattern.test(strippedChunk)) { /* reject */ }
  }
  ```
- Add `PREPARE`, `EXECUTE`, `DELIMITER` to the conditional-comment keyword list (line 226) as defense-in-depth
- Consider reducing false positives on standalone `EXECUTE` pattern (M-15)

**Verification:**
- [ ] `/*!50000PREPARE stmt FROM 'GRANT...'*/` is rejected
- [ ] `/*!50000EXECUTE stmt*/` is rejected
- [ ] Legitimate dumps with `EXECUTE` in data values still work (or are handled gracefully)
- [ ] All existing test cases pass

---

## 1. Cache session verification per-request (P1)
**Source:** S-04
**File:** `src/lib/session.ts:94-141`

Every `verifySessionToken()` call hits the DB. Within a single request, `isAdmin()` → `getCurrentUser()` → `getSession()` → `verifySessionToken()` can fire multiple times. React `cache()` only deduplicates within a single render, not across server actions.

**Fix:**
- Wrap `verifySessionToken` with React `cache()`:
  ```ts
  const cachedVerifySessionToken = cache(async function verifySessionToken(token: string) { ... });
  ```
- This deduplicates calls within the same React server context (same request).
- Optionally add a short-lived in-memory LRU cache (30-60s TTL) for verified sessions to reduce DB load under high traffic.

**Verification:**
- [ ] Two `isAdmin()` calls in the same request only hit DB once
- [ ] Session revocation (logout) still takes effect immediately (no stale cache)

---

## 2. Document IP spoofing risk and add TRUST_PROXY env var (P1)
**Source:** S-07
**File:** `src/lib/rate-limit.ts:43-58`

`getClientIp` trusts `X-Real-IP` and `X-Forwarded-For` without verification. An attacker can spoof these headers to bypass rate limits.

**Fix:**
- Add `TRUST_PROXY` boolean env var (default: `false` for safety)
- When `TRUST_PROXY` is not set or `false`, ignore `X-Forwarded-For` and `X-Real-IP`, use only `socket.remoteAddress` (or return `'unknown'`)
- When `TRUST_PROXY=true`, current behavior applies (trust last entry in chain)
- Add a startup warning if `TRUST_PROXY=true` is set without a documented reverse proxy
- Document in `CLAUDE.md` and `.env.local.example`

**Verification:**
- [ ] Without `TRUST_PROXY`, rate limiting uses connection IP only
- [ ] With `TRUST_PROXY=true`, header-based IP extraction works as before

---

## 3. Guard API routes against missing auth checks (P1)
**Source:** S-09
**File:** `src/proxy.ts:58-63`

Middleware excludes `/api/*` from the auth matcher. New `/api/admin/*` routes without `isAdmin()` would be open.

**Fix:**
- Add a comment convention at `proxy.ts:61` documenting that all `/api/admin/*` routes MUST call `isAdmin()` internally
- Add a runtime check: create a wrapper `withAdminAuth(handler)` that any `/api/admin/*` route must use:
  ```ts
  export function withAdminAuth(handler: Function) {
      return async (...args: unknown[]) => {
          if (!(await isAdmin())) {
              return Response.json({ error: 'Unauthorized' }, { status: 401 });
          }
          return handler(...args);
      };
  }
  ```
- Wrap existing `/api/admin/db/download/route.ts` with `withAdminAuth`
- Add ESLint rule or a simple script that checks all `/api/admin/*/route.ts` files import `isAdmin` or `withAdminAuth`

**Verification:**
- [ ] All `/api/admin/*` routes use `withAdminAuth` or call `isAdmin()`
- [ ] A new API route without auth is caught by lint/script

---

## 4. Add `strict-dynamic` to CSP script-src (P2)
**Source:** C-16, Plan 09 item 2 (carried forward)
**File:** `next.config.ts:70`

Script-src has `'unsafe-inline'` which weakens XSS protection. Browsers supporting `strict-dynamic` will ignore `'unsafe-inline'` when present.

**Fix:**
- Change: `"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"`
- To: `"script-src 'self' 'strict-dynamic' 'unsafe-inline' https://www.googletagmanager.com"`
- `strict-dynamic` takes precedence in modern browsers; `unsafe-inline` is ignored as fallback
- Old browsers that don't support `strict-dynamic` fall back to `unsafe-inline` (no regression)

**Verification:**
- [ ] CSP header contains `strict-dynamic`
- [ ] GTM scripts still load correctly
- [ ] Build passes

---

## 5. Use DB advisory lock for restore mutex (P2)
**Source:** S-10
**File:** `src/app/[locale]/admin/db-actions.ts:150`

Process-level `restoreInProgress` boolean doesn't protect against concurrent restores in multi-instance deployments.

**Fix:**
- Replace `let restoreInProgress = false` with MySQL `GET_LOCK`:
  ```ts
  const lockAcquired = await db.execute(sql`SELECT GET_LOCK('gallerykit_db_restore', 0)`);
  if (!lockAcquired) return { error: 'Restore already in progress' };
  try { /* ... restore logic ... */ }
  finally { await db.execute(sql`SELECT RELEASE_LOCK('gallerykit_db_restore')`); }
  ```
- `GET_LOCK` with timeout 0 returns immediately if lock is held
- Lock is automatically released on connection close (crash-safe)
- Remove the `restoreInProgress` variable

**Verification:**
- [ ] Concurrent restore attempts are rejected
- [ ] Lock released on error/crash (connection pool handles)
- [ ] Single-instance deployment still works

---

## 6. Make UPLOAD_ROOT configurable via env var (P2)
**Source:** Q-13
**Files:** `src/lib/process-image.ts:27-36`, `src/lib/process-topic-image.ts:15-24`

Current detection uses `process.cwd().endsWith('apps/web')` heuristic. Fragile in Docker with non-standard CWD.

**Fix:**
- Add `UPLOAD_ROOT` env var check as the first priority:
  ```ts
  const UPLOAD_ROOT = process.env.UPLOAD_ROOT
      ?? (process.cwd().endsWith('apps/web') ? simplePath : monorepoPath);
  ```
- Same for `process-topic-image.ts`
- Add `UPLOAD_ROOT` to `.env.local.example` with comment
- Document in `CLAUDE.md`

**Verification:**
- [ ] `UPLOAD_ROOT=/custom/path npm run dev` uses the custom path
- [ ] Without env var, existing heuristic still works
- [ ] Build passes

---

## 7. Add `object-src 'none'` and `manifest-src 'self'` to CSP (P2)
**Source:** H-05, M-14 (R5 review)
**File:** `next.config.ts:68-79`

Missing CSP directives: `object-src` (defaults to `*`, permits plugin content) and `manifest-src` (defaults to `*`, permits external manifests).

**Fix:**
- Add to CSP value array:
  ```ts
  "object-src 'none'",
  "manifest-src 'self'",
  ```

**Verification:**
- [ ] CSP header includes both directives
- [ ] Web app manifest loads correctly
- [ ] No plugin content can be embedded

---

## 8. Add length limit to `isValidTopicAlias` (P2)
**Source:** M-07 (R5 review)
**File:** `src/lib/validation.ts:44-46`

No length constraint on topic alias. `varchar(255)` column can truncate, creating collisions.

**Fix:**
```ts
export function isValidTopicAlias(alias: string): boolean {
    return alias.length > 0 && alias.length <= 255 && /^[^/\\\s?#]+$/.test(alias);
}
```

**Verification:**
- [ ] 300-char alias rejected with clear error message
- [ ] 255-char alias accepted

---

## 9. Cap `searchImages` limit parameter (P2)
**Source:** M-08 (R5 review)
**File:** `src/lib/data.ts:454`

No limit cap on searchImages, unlike getImagesLite/getImages which cap at 500.

**Fix:**
```ts
const effectiveLimit = Math.min(Math.max(limit, 1), 500);
```

**Verification:**
- [ ] `searchImages('test', 1000000)` returns at most 500 results

---

## Carry-forward items (partially done from prior plans)

- **Plan 09 #2**: `strict-dynamic` in CSP — carried into item 4 above
- **Plan 08 #4**: `ActionResult` type adoption — deferred to Plan 16 (code quality)
