# Verifier — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: verifier (evidence-based correctness
check against stated behavior).

## Scope

Verify that stated invariants in CLAUDE.md, comments, and test assertions
hold against the code. Specifically:
- Defense-in-depth scanner coverage (cycle-5-rpl work).
- SQL restore scanner coverage (cycle-5-rpl work).
- Rate-limit rollback symmetry.
- Same-origin check application across all mutating actions.
- Privacy field separation in `data.ts`.

## Verified invariants (PASS)

### V6-P01 — `publicSelectFields` does NOT contain PII
- Check: `Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>`
  is `never`. Compile-time guard at `data.ts:198-200` enforces.
- Result: PASS. `_privacyGuard` assignment compiles.

### V6-P02 — `check-action-origin.ts` passes against ALL mutating action files
- Check: ran `npm run lint:action-origin --workspace=apps/web` → exit 0.
- Files verified: admin-users.ts (7 actions), images.ts (4), seo.ts (2),
  settings.ts (6), sharing.ts (4), tags.ts (4), topics.ts (8),
  db-actions.ts (3). All 38+ mutating actions call
  `requireSameOriginAdmin()`. Auto-exempted getters skipped. Glob discovery
  applied.
- Result: PASS.

### V6-P03 — `check-api-auth.ts` passes against admin API route
- Check: ran `npm run lint:api-auth --workspace=apps/web` → exit 0.
- Single route file: `src/app/api/admin/db/download/route.ts` exports `GET = withAdminAuth(...)`. Route file extension detection extended to `.tsx`/`.mjs`/`.cjs` (cycle-5-rpl-02).
- Result: PASS.

### V6-P04 — SQL restore scanner rejects CALL/REVOKE/RENAME USER statements
- Check: `apps/web/src/__tests__/sql-restore-scan.test.ts` includes fixtures
  for `CALL cleanup_proc()`, `RENAME USER`, `REVOKE ALL`. All flag as
  dangerous.
- Result: PASS.

### V6-P05 — Login rate-limit pre-increment with symmetric in-memory + DB rollback on unexpected error
- Check: `auth.ts::login` catch branch at line 228-238 calls
  `rollbackLoginRateLimit(ip)` (in-memory + DB decrement via
  `rollbackLoginRateLimit`) AND `decrementRateLimit(accountRateLimitKey,
  'login_account', LOGIN_WINDOW_MS)`.
- Result: PASS.

### V6-P06 — Session secret refuses DB fallback in production
- Check: `session.ts::getSessionSecret` throws if env is missing and
  `NODE_ENV === 'production'`.
- Result: PASS. Confirmed by manual inspection at line 30-36.

### V6-P07 — 47/47 vitest test files pass; 256/256 tests pass
- Check: ran `npm test --workspace=apps/web -- --run` → exit 0.
- Result: PASS.

## Partial-pass findings

### V6-F01 — Comment at `data.ts:154-158` claims "any developer adding a sensitive field to adminSelectFields must consciously decide whether to also include it here"
- Issue: the compile-time guard only enforces the NEGATIVE — it rejects
  known PII keys (`_PrivacySensitiveKeys` hardcoded list) if they appear
  in `publicSelectFields`. It does NOT catch a NEW PII field added to
  `adminSelectFields`. If a future schema migration adds
  `images.phone_number` and includes it in `adminSelectFields`, the
  developer must manually remember to EXCLUDE it from
  `publicSelectFields` AND add `'phone_number'` to `_PrivacySensitiveKeys`.
  Without the latter, the guard doesn't protect against the former.
- Severity: LOW. Confidence: HIGH.
- Fix: use a stricter mechanism, e.g., make `publicSelectFields` enumerate
  every field explicitly (current pattern omits via destructuring + spread,
  which is automatic inclusion of unlisted fields). Or add a test that
  diffs `adminSelectFields` keys against `publicSelectFields` keys and
  asserts the difference is exactly `_PrivacySensitiveKeys`.
- Result: PARTIAL — guard protects against known PII but not against
  newly-added sensitive fields.

### V6-F02 — `sharing.ts::createPhotoShareLink` retry loop uses `retries++` on success path for unrelated failure types
- File: `apps/web/src/app/actions/sharing.ts:121-165`.
- Severity: LOW. Confidence: MEDIUM.
- The loop increments `retries` on:
  (a) UPDATE affected 0 rows AND the re-fetch shows null → retry
  (b) UPDATE affected 0 rows AND re-fetch shows another key → return OK
  (c) Caught `ER_DUP_ENTRY` → retry
- (b) returns success before incrementing, so the retries counter is fine.
  But there's no logging/audit event for repeated retries, so a genuinely
  broken DB state (unlikely) would silently loop 5 times and return
  `failedToGenerateKey` without breadcrumbs.
- Fix: log `console.debug` on each retry. Observability improvement.

### V6-F03 — `image-queue.ts::enqueueImageProcessing` MAX_RETRIES = 3, MAX_CLAIM_RETRIES = 10 — the two retry budgets are independent
- File: `apps/web/src/lib/image-queue.ts:148-173`.
- Severity: LOW. Confidence: HIGH.
- A job that hits both claim contention (10 retries × 25s = 250s worst
  case) AND processing errors (3 retries) could be retried up to 13
  times before giving up. Total worst-case wall-clock ~4 minutes of DB+CPU
  for a single failing job. Unbounded by total time, only by retry count.
- Fix: add a hard wall-clock ceiling (e.g., 10 minutes per job total). Or
  document the worst case explicitly.
- Result: observational. Current behavior is acceptable.

### V6-F04 — Claim at top of `images.ts` in audit log: `enqueueImageProcessing` is "fire and forget" but cleanup mid-processing requires the ID being in `state.enqueued`
- File: `apps/web/src/app/actions/images.ts:378-381` + `apps/web/src/lib/image-queue.ts:239-248`.
- Severity: LOW. Confidence: HIGH.
- `deleteImage` removes the ID from `state.enqueued` BEFORE the DB
  transaction. The queue's claim check (`processed=false AND exists`)
  catches the deletion after processing completes (affectedRows=0 → cleanup
  orphaned files).
- Race: if the DB transaction fails AFTER `state.enqueued.delete(id)` but
  BEFORE `images` row deletion, the image is not deleted but the queue
  no longer tracks it. `bootstrapImageProcessingQueue` on restart would
  re-enqueue. OK — recoverable.
- But a subsequent call to `enqueueImageProcessing(job)` with the same id
  between the `.delete(id)` and a fresh transaction commit would proceed
  (the `enqueued.has(id)` check returns false because we just deleted).
  Processing completes, marks `processed=true` — but meanwhile the outer
  transaction has continued. If the transaction then deletes, the queue
  has already marked processed=true, and the variant files exist. The
  queue catches this at the conditional UPDATE (affectedRows=0 → orphan
  cleanup).
- Result: the layered defenses (queue's conditional UPDATE + enqueued set +
  transaction) handle this correctly. Verified.

## Summary

- **7 PASS** invariants confirmed.
- **4 PARTIAL-PASS** findings, all LOW severity. Most actionable: **V6-F01** (PII guard is negative-only; doesn't protect against newly-added sensitive fields).
- Gate run: eslint PASS, lint:api-auth PASS, lint:action-origin PASS, vitest
  47/47 PASS (256 tests).
