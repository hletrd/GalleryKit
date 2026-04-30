# Plan 09: R4 Security Fixes

**Priority:** P0-P1  
**Estimated effort:** 1-2 hours  
**Sources:** Security H-1, M-3, L-3, L-5

---

## 1. Lower bodySizeLimit from 10gb to 250mb (P0)
**Source:** Security H-1  
**Files:**
- `next.config.ts:28` — change `'10gb'` to `'250mb'`
- `next.config.ts:31` — change `proxyClientMaxBodySize` to `'250mb'`
- `src/app/actions/images.ts:48-49` — change total size cap from 10GB to 2GB
- `nginx/default.conf:16` — change `client_max_body_size 10G` to `10G` (keep nginx high, app validates)
- Note: the upload dropzone sends files individually (3 concurrent), so body limit only needs to cover one file + FormData overhead

## 2. Add strict-dynamic to CSP script-src (L-3)
**Source:** Security L-3  
**File:** `next.config.ts:20` — add `'strict-dynamic'` to script-src
- Browsers that support it will ignore `'unsafe-inline'`
- Browsers that don't will fall back to `'unsafe-inline'` (backward compatible)

## 3. Log shared group view_count errors (L-5)
**Source:** Security L-5  
**File:** `src/lib/data.ts:371` — change `.catch(() => {})` to `.catch(err => console.debug('view_count increment failed:', err.message))`

## 4. Extract safeJsonLd helper (L-4)
**Source:** Security L-4  
**Files:**
- Create `src/lib/safe-json-ld.ts` — `export function safeJsonLd(data: unknown): string`
- Replace 4 `JSON.stringify(x).replace(/</g, '\\u003c')` calls across pages

---

## Verification
- [ ] `curl -X POST -d @/dev/zero --max-time 5 https://gallery.atik.kr/` rejected < 250MB
- [ ] CSP header includes `strict-dynamic`
- [ ] Build passes
