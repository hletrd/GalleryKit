# Plan 10: R4 Architecture Fixes

**Priority:** P1-P2  
**Estimated effort:** 3-4 hours  
**Sources:** Architecture TD-01/04/06/08/11/12/13

---

## 1. Fix instrumentation.ts Symbol.for → direct import (P1)
**Source:** Architecture TD-04  
**File:** `src/instrumentation.ts:11-13`
- Replace `Symbol.for` + untyped cast with `const { getProcessingQueueState } = await import('@/lib/image-queue')`
- `image-queue.ts` has no `'use server'` — direct import is valid and type-safe

## 2. Fix capture_date DDL drift in 3 files (P1)
**Source:** Architecture TD-01  
**Files:**
- `drizzle/0000_nappy_madelyne_pryor.sql:27` — change `varchar(255)` to `datetime DEFAULT NULL`
- `scripts/init-db.ts:77` — same
- `scripts/migrate.js:81` — same
- These must match `schema.ts:33` which already says `datetime`

## 3. Fix bucketStart int → bigint (Y2K38) (P2)
**Source:** Architecture TD-06  
**File:** `src/db/schema.ts:137` — change `int("bucket_start")` to `bigint("bucket_start", { mode: 'number' })`
- Table is new and empty on most deployments — zero-cost change

## 4. Fix tags.ts catch block missing error object (P2)
**Source:** Architecture TD-08  
**File:** `src/app/actions/tags.ts:28-30` — add `err` parameter to catch

## 5. Add stop_grace_period to docker-compose (P2)
**Source:** Architecture TD-13  
**File:** `docker-compose.yml` — add `stop_grace_period: 30s`
- Gives SIGTERM handler time to drain Sharp jobs

## 6. Fix CLAUDE.md connection pool docs (P2)
**Source:** Architecture TD-11  
Already done in earlier commit — verify `8 connections, queue limit 20` is current

## 7. Fix shared group expiry timezone handling (P2)
**Source:** Architecture Finding 6  
**File:** `src/lib/data.ts:366`
- Use MySQL `NOW()` comparison instead of JS `new Date()` to avoid timezone mismatch
- `sql\`${sharedGroups.expires_at} < NOW()\`` instead of JS comparison

---

## Verification
- [ ] instrumentation.ts uses typed import (grep for Symbol.for → zero matches)
- [ ] All 3 DDL files say `datetime` for capture_date
- [ ] bucketStart column is bigint in schema
- [ ] Docker stop completes gracefully (check logs for "[Shutdown] Queue drained")
- [ ] Build passes
