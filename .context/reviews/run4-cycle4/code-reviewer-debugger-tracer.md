# Run-4 Cycle 4 — code-reviewer + debugger + tracer angle

Inventory for this angle: regression diff of every commit since the run4-cycle3
review-artifacts commit (`cd97b4b0`, `e0ce57bb`, `7fa8f18f`, `c7d3db1a`,
`74d70974`, `b7681b9a`, `baeb6f08`, `b313f673` — the five R4C3 fixes were
self-authored by cycle 3 and had no independent reviewer until now); full reads
of `serve-upload.ts`, `settings-hash.ts`, `api/stripe/webhook/route.ts`,
`api/download/[imageId]/route.ts`, `api/checkout/[imageId]/route.ts`,
`api/admin/lr/upload/route.ts`, `actions/sales.ts`, `actions/lr-tokens.ts`,
`lib/admin-tokens.ts`, `db/index.ts` (pool flags), `db/schema.ts` (entitlements
unique keys), `lib/image-queue.ts` (failure path 330-515), browser upload
action `actions/images.ts:175-525`, `lib/smart-collections.ts` (full),
`api/search/semantic/route.ts` (full), `lib/analytics.ts` (full), `proxy.ts`,
`actions/public.ts` (structure), plus repo-wide pattern sweeps
(`toISOString` near writes, unguarded `JSON.parse`, `setInterval`,
`Math.random`, `affectedRows` consumers, `onKeyDown Enter` handlers).

## Regression verdict on the six unreviewed commits — ALL SOUND

- `cd97b4b0` (HEAD pass-through): correct; the new
  `uploads-route-method-wiring.test.ts` locks both twins. Verified the locale
  twin still passes `'HEAD'`.
- `e0ce57bb` (settings-hash debounce): functionally correct and the ETag
  R8-H1 semantics are preserved — but see PERF-R4C4-01 below for a
  resilience gap its own docstring overclaims.
- `7fa8f18f` (webhook log gating): verified `affectedRows === 1` semantics
  against the actual pool config — `db/index.ts:13-26` sets no `flags`, so
  mysql2's default (no CLIENT_FOUND_ROWS) applies and the dup-key no-op
  loser reports 0/2, never 1. Verified `session_id` is the ONLY unique key
  on `entitlements` (`schema.ts:283`), so no other constraint can trigger
  the dup-key path. Correct.
- `c7d3db1a` (token-branch no-store): correct; `has()` guard preserves
  handler-set headers; 401 path covered by test.
- `74d70974` (usedRow heuristic): correct. Traced the refunded-never-
  downloaded token: it now falls to 404 "Token not found" rather than 410
  "already used" — accurate for mistyped tokens; for the genuine refunded
  buyer the 404 is the best achievable answer because the hash is cleared
  (cannot tie the request to the row) and a `refunded`-row heuristic would
  re-introduce the exact multi-buyer mislabel this fix removed. No further
  action.
- `b7681b9a`/`baeb6f08`/`b313f673`: mechanical; sound.

## Findings

### COR-R4C4-02 — refundEntitlement never converges DB state on `charge_already_refunded` (LOW-MED / Medium confidence)
`apps/web/src/app/actions/sales.ts:136` maps `charge_already_refunded` to the
`'already-refunded'` error code, and the catch (215-233) returns WITHOUT
touching the DB row. Failure scenario (concrete):
1. Admin clicks Refund → Stripe refund POST succeeds → the process crashes /
   DB hiccups before `db.update(...).set({ refunded: true, downloadTokenHash:
   null })` at 209-212 lands. (Or: the operator refunds directly in the Stripe
   dashboard.)
2. Within 24 h the idempotency key (`refund-${entitlementId}`) replays the
   same successful refund and the UPDATE lands — fine.
3. AFTER the 24 h idempotency window (or for a dashboard-side refund), the
   retry attempts a NEW refund → Stripe throws `charge_already_refunded` →
   the action returns the error WITHOUT updating the row.
Result: `refunded` stays false and `downloadTokenHash` stays set forever —
the customer can still download a purchase Stripe refunded, and every admin
retry shows the "already refunded" toast while the row visibly says
not-refunded (operator dead-end; the UI offers no other lever).
Fix: in the catch, when the mapped code is `'already-refunded'`, perform the
same convergence UPDATE (`refunded: true, downloadTokenHash: null`) in a
nested try and return `{ success: true }` — Stripe is the source of truth
that the charge IS refunded; converge local state. Keep the error return only
if the convergence UPDATE itself fails.

### COR-R4C4-03 — LR upload route: unguarded throw window between tracker claim and the insert catch (LOW-MED / Medium confidence)
`apps/web/src/app/api/admin/lr/upload/route.ts:286-392`. The browser path
wraps the ENTIRE per-file body in try/catch (`actions/images.ts:270-475`) so
any throw cleans up the saved original and the final settle reconciles the
quota. The LR route only wraps `saveOriginalAndGetMetadata` (245-265) and the
insert (381-392). Throw-capable calls in between are bare:
- `extractExifForDb(data.exifData)` (286)
- `cleanupOriginalIfRestoreMaintenanceBegan(...)` (312) — fs/DB-state probe
- `assertBlurDataUrl(data.blurDataUrl)` (337) — THROWS by contract on
  producer drift (that is its entire purpose, AGG2-L03)
A throw there: (a) leaks the pre-claimed tracker quota for the rest of the
1-hour window (claim at 231-233 never settled), (b) orphans the on-disk
original, (c) returns a Next.js default 500 (non-JSON) that the Lightroom
plugin cannot parse — three failures the browser path contains. Likelihood is
low (requires producer drift or fs error), but the asymmetry is exactly the
parity-gap class that produced 8 prior LR-route fixes (R4C1 COR-R4C1-02…05,
run-3 cycles 1-4). Fix: widen the existing insert try block to open before
`extractExifForDb` so its catch (delete original + settle(false) + JSON 500)
contains the whole window. The HDR-reject / restore-cleanup early-returns
inside the widened block settle themselves before returning and are
unaffected.

### COR-R4C4-06 — download route consumes the token before the stream-open failure can be detected; the catch that claims to handle it cannot fire (LOW-MED / Medium confidence)
`apps/web/src/app/api/download/[imageId]/route.ts:206-282`. The atomic
single-use claim (207-213) precedes `createReadStream(resolvedFilePath)`
(226). `createReadStream` does NOT throw synchronously when the file vanished
between the lstat (172) and the open — the open happens asynchronously and
the error surfaces as a stream `'error'` event AFTER `new
NextResponse(webStream)` has already been returned, so the catch at 269-282
(whose comment says it "handles a rare race where the file disappears between
lstat and stream open" and maps ENOENT to a clean 404) is unreachable for
exactly that race. Observable behavior when it fires: 200 + aborted body +
token consumed — the customer's single-use token is burned with no file
delivered, which is the precise outcome C3-RPF-05 reordered the route to
avoid. Fix: `fsp.open(resolvedFilePath, 'r')` BEFORE the atomic claim (open
ENOENT → 404 with token intact), then stream from
`fileHandle.createReadStream()` after the claim; close the handle on the 410
already-used path. This zeroes the lstat→open race window and makes the
ENOENT-handling comment true.

### HARD-R4C4-07 — smart-collections validateNode never type-checks predicate values (LOW / Medium confidence)
`apps/web/src/lib/smart-collections.ts:318-342`: structural validation checks
presence (`n.value !== undefined`, `lo`/`hi` present, `values` array length)
but `return n as unknown as Predicate` lets `value: {…}`, `value: [..]`,
`value: null`, `lo: {…}` etc. through to the compiler, which binds them as
drizzle params (`eq(col, pred.value)`, ``sql`${col} BETWEEN ${p.lo} AND
${p.hi}` ``). mysql2's value escaping expands plain objects into `` `key` =
'val' `` SQL fragments — not attacker-grade injection (keys are
backtick-escaped, and only root admins can write `query_json`), but it breaks
the module's declared invariant ("Drizzle parameter binding for all values —
no raw string concatenation" + the TS types say `string | number`) and a
malformed stored query can compile into semantics-shifting SQL on the PUBLIC
`/c/[slug]` page instead of failing loudly at validation. Fix: enforce
`typeof === 'string' | 'number'` (finite) for `value`/`lo`/`hi` and every
`values[]` element in `validateNode`, with tests. Aligns runtime with the
declared types; rejects at write time (`parseSmartCollectionQuery` is called
by the admin create/update action).

### LOW-R4C4-09 — extractTldPlusOne mangles trailing-dot FQDN referrer hosts (LOW / Low confidence)
`apps/web/src/lib/analytics.ts:102-115`: `new URL('https://github.com./x')`
yields hostname `github.com.`; `split('.')` produces a trailing empty label
and the function returns `"com."` — the analytics row records a bare TLD
instead of the site. Rare (trailing-dot FQDN referrers), data-quality only.
Fix: strip one trailing dot before splitting (`host.replace(/\.$/, '')`).

## Verified-clean (explicitly traced, no issue)
- `.toISOString()` near DB writes: only legitimate uses remain (Atom feed
  timestamps, backup filename, CSV export filename, JSON-LD date). Class
  stays CLOSED.
- All `JSON.parse` sites are guarded (admin-tokens, smart-collections,
  semantic route, wide-gamut-hint).
- No `Math.random` in security paths; the only `setInterval` is the queue GC
  with state-scoped handle.
- `affectedRows` consumers (sharing, collections, queue, admin-backfill,
  admin-tokens): all on the correct mysql2 default-flag semantics.
- `verifyToken` (`lib/admin-tokens.ts:136-166`): well-formed-token gate,
  hash-indexed lookup, constant-time re-compare, expiry check, fire-and-
  forget last_used touch — sound.
- Semantic search route: same-origin + maintenance + content-type +
  content-length + rate-limit ordering (Pattern 2 rollbacks) all correct.
- Browser upload action claim/settle pairing: symmetric; per-file catch
  contains all throw points (the LR route is the outlier — COR-R4C4-03).
- `image-queue` permanent-failure path: persist via `toMySqlDateTime`,
  conditional UPDATE, claim release in finally, retry-map pruning — sound.
- proxy.ts admin guard + matcher: unchanged, sound; API routes documented as
  self-authenticating (lint:api-auth enforces).
