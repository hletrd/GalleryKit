# Plan 20: Security Critical Fixes — Round 6 ✅ DONE

**Priority:** P0 (items 0-1), P1 (items 2-4)
**Estimated effort:** 2-3 hours
**Sources:** Comprehensive Review R6 (C-01, C-02, H-04, M-06, M-07, M-09)

---

## 0. Fix SQL restore bypass via regular multi-line comments (P0 — CRITICAL)
**Source:** C-01 (R6 review)
**File:** `src/app/[locale]/admin/db-actions.ts:260`
**Confidence:** HIGH

The scanner strips conditional comments (`/*!...*/`) but not regular multi-line comments (`/* ... */`). MySQL strips both before parsing. An attacker splits any blocked keyword with an inline comment:

```sql
GR/**/ANT ALL ON *.* TO 'attacker'@'%';
```

The scanner sees `GR` and `ANT` as separate tokens — neither matches `\bGRANT\b`. MySQL strips `/**/` and executes `GRANT ALL`. Same technique works for every blocked keyword: `PRE/**/PARE`, `CREATE/**/ USER`, `DROP/**/ DATABASE`, etc.

**Fix:** Replace the conditional-comment-only regex with one that strips all multi-line comments:
```ts
const strippedChunk = chunk.replace(/\/\*.*?\*\//gs, ' ');
```

**Verification:**
- [ ] `GR/**/ANT ALL` is rejected after stripping
- [ ] `PRE/**/PARE stmt FROM ...` is rejected after stripping
- [ ] Legitimate dumps with `/* comment */` in data still work (comments stripped, SQL intact)
- [ ] Conditional comments (`/*!50000...*/`) still stripped (covered by broader regex)
- [ ] Build passes

---

## 1. Fix blur_data_url buffer pool bloat (P0 — CRITICAL)
**Source:** C-02 (R6 review)
**Files:** `src/db/schema.ts:51`, `src/lib/data.ts:39`
**Confidence:** HIGH

The `blur_data_url` column stores ~500-800 byte base64 strings per row. With 10,000 images, this adds 150-250MB of blob data to the InnoDB buffer pool, pushing actual query data out of memory. On the listing queries, `blur_data_url` is selected for every image in the grid, adding ~20KB of base64 to the SSR HTML per page.

**Fix — Option A (exclude from listing):**
- Remove `blur_data_url` from `selectFields` / `getImagesLite` listing queries
- Only include it in the individual `getImage` query (needed for photo viewer)
- This is the minimal fix — no schema migration required

**Fix — Option B (compact encoding, larger scope):**
- Add a `blurhash` column (~30 bytes per image) alongside `blur_data_url`
- Migration script: decode base64 → BlurHash encode → store
- Update `process-image.ts` to generate BlurHash instead of base64
- Update components to decode BlurHash client-side
- This is a larger refactor — defer if Option A is sufficient

**Recommendation:** Start with Option A (quick win). Option B can be a separate future plan.

**Verification:**
- [ ] `getImagesLite` query no longer fetches `blur_data_url`
- [ ] Homepage grid still shows blur placeholders (CSS background or lazy load)
- [ ] Individual photo page still has blur placeholder from `getImage`
- [ ] InnoDB buffer pool usage reduced
- [ ] Build passes

---

## 2. Rate limit shared 'unknown' bucket when TRUST_PROXY not set (P1)
**Source:** H-04 (R6 review)
**File:** `src/lib/rate-limit.ts:43-61`
**Confidence:** HIGH

Without `TRUST_PROXY=true`, `getClientIp()` returns `'unknown'` for ALL requests behind a reverse proxy. All users share one rate-limit bucket. An attacker making 5 rapid requests locks out every admin globally.

**Fix:**
- In `getClientIp()`, when result is `'unknown'` and `NODE_ENV === 'production'`, log a warning:
  ```ts
  if (ip === 'unknown' && process.env.NODE_ENV === 'production') {
      console.warn('[rate-limit] IP is "unknown" — set TRUST_PROXY=true if behind a reverse proxy');
  }
  ```
- Document `TRUST_PROXY` requirement prominently in deployment docs / CLAUDE.md
- Consider: when IP is `'unknown'`, use a per-session or per-cookie identifier as fallback (lower priority)

**Verification:**
- [ ] Warning logged when IP is 'unknown' in production
- [ ] No warning in development
- [ ] `TRUST_PROXY=true` documentation added to CLAUDE.md

---

## 3. SQL restore X'...' hex string bypasses 0x pattern (P1)
**Source:** M-06 (R6 review)
**File:** `src/app/[locale]/admin/db-actions.ts:246-247`
**Confidence:** MEDIUM

`SET @cmd = X'4752414E54'` assigns "GRANT" but isn't caught by the `0x` pattern. Not directly exploitable (PREPARE/EXECUTE are blocked), but defense-in-depth gap.

**Fix:** Add pattern to catch hex string variable assignments:
```ts
/\bSET\s+@\w+\s*=\s*X'/i
```

Add alongside existing `0x` hex literal patterns.

**Verification:**
- [ ] `SET @cmd = X'4752414E54'` is rejected
- [ ] Normal `SET @offset = 0` is not rejected
- [ ] Build passes

---

## 4. Uploaded original files written with default permissions (P1)
**Source:** M-07 (R6 review)
**File:** `src/lib/process-image.ts:238`
**Confidence:** HIGH

`createWriteStream(originalPath)` uses default 0o644. Any local user can read full-resolution private originals.

**Fix:** Add `{ mode: 0o600 }` to `createWriteStream`:
```ts
createWriteStream(originalPath, { mode: 0o600 })
```

Note: This was partially addressed in R5 (temp file permissions for DB restore), but the upload file path was missed.

**Verification:**
- [ ] Uploaded original files have 0o600 permissions
- [ ] Processed variant files remain accessible by the Next.js server
- [ ] Build passes

---

## 5. Add CI/lint rule enforcing auth on /api/admin/* routes (P2)
**Source:** M-09 (R6 review)
**File:** `src/proxy.ts:60-62`
**Confidence:** HIGH

No programmatic check that all admin API routes use `withAdminAuth`. Relies on developer discipline.

**Fix:** Add a simple script that checks all route files:
```ts
// scripts/check-api-auth.ts
const routeFiles = glob.sync('src/app/api/admin/*/route.ts');
for (const file of routeFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    if (!content.includes('withAdminAuth') && !content.includes('isAdmin')) {
        console.error(`MISSING AUTH: ${file} does not use withAdminAuth or isAdmin`);
        process.exitCode = 1;
    }
}
```
- Add to `package.json` as `lint:api-auth` script
- Run in CI alongside `npm run lint`

**Verification:**
- [ ] Script detects API routes missing auth
- [ ] Existing routes all pass the check
- [ ] Added to CI pipeline

---

## Priority Order

1. Item 0 — CRITICAL: Regular comment bypass in SQL restore
2. Item 1 — CRITICAL: blur_data_url buffer pool bloat
3. Item 4 — Original file permissions
4. Item 2 — Rate limit unknown bucket warning
5. Item 3 — Hex string SQL bypass
6. Item 5 — API auth lint rule
