# Critic — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: critic (multi-perspective critique).

## Scope

Critical pass over the cycle-5-rpl changes and the larger code surface,
looking for latent risks, bad patterns, hidden coupling, and areas where
the defense-in-depth is uneven or over-designed.

## Findings

### CR6-01 — Lint-gate scripts are a de facto security surface but live in `apps/web/scripts/` without a security banner
- Files: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- Severity: LOW. Confidence: HIGH.
- These scripts enforce "every mutating server action has a same-origin
  check" and "every admin API route exports wrapped in `withAdminAuth`".
  If a future developer reads the comment header and thinks they're
  disposable lint helpers, they might refactor away the `process.exit(1)`
  or relax the regex without realizing they're downgrading security.
- The top-of-file comment explains the security role, but there's no
  clear visual indicator (e.g., `SECURITY-CRITICAL:` banner). The
  CLAUDE.md "Lint Gates" section added in cycle-5-rpl commit C5R-RPL-07
  helps, but not all contributors read CLAUDE.md before scripts.
- Fix: Prepend a banner: `/* SECURITY-CRITICAL: this lint gate enforces
  defense-in-depth origin / auth checks. Do not downgrade without security
  review. See CLAUDE.md "Lint Gates" section. */` Cycle-5 AGG5R-09
  covered this deferred.

### CR6-02 — Same-origin rollback pattern is consistent in 4 places but has a fifth near-miss at `createGroupShareLink`
- File: `apps/web/src/app/actions/sharing.ts:214-272`.
- Severity: LOW. Confidence: MEDIUM.
- The pattern everywhere else is:
  1. increment in-memory
  2. increment DB
  3. check DB
  4. on over-limit → rollback in-memory + (sometimes) DB
  5. on error → rollback in-memory + (sometimes) DB
- In `createGroupShareLink`, on `ER_NO_REFERENCED_ROW_2` or other retry
  exhaustion, the DB counter is NOT rolled back. See S6-07.
- This is a near-miss but not a bug. The in-memory counter is rolled back;
  the DB counter is slightly ahead and will expire with the window.
  Cosmetic inconsistency. Cycle-5 coverage covered the in-memory rollback
  everywhere; the DB asymmetry is a cycle-6 find.

### CR6-03 — `check-action-origin.ts` hard-codes `app/[locale]/admin/db-actions.ts` but doesn't verify the file exists at scan start
- File: `apps/web/scripts/check-action-origin.ts:60-62`.
- Severity: LOW. Confidence: HIGH.
- `discoverActionFiles()` pushes `REPO_SRC + /app/[locale]/admin/db-actions.ts` onto the list unconditionally. If the file is ever renamed or moved (e.g., if i18n routing changes eliminate `[locale]/`), the scanner would fail at `checkActionFile` via `fs.existsSync` — the existing MISSING FILE handler — but this still exits non-zero and blocks CI.
- Pro: fail-loud is correct; the scanner SHOULD fail if the db-actions
  file moves.
- Con: the hard-coded path is a single point of drift. A less fragile
  alternative is to glob for `**/admin/db-actions.ts` under `src/app/` so
  locale routing changes don't break the scanner. Not urgent; the file
  has been stable for many cycles.
- Fix: glob-discover. Trivial. Observational.

### CR6-04 — Code redundancy: both `uploadTracker` (Map in `images.ts`) and `loginRateLimit` / `searchRateLimit` (Maps in `rate-limit.ts`) re-implement the "Map + prune + hard cap + LRU evict" pattern
- Files: `apps/web/src/app/actions/images.ts:64-81`, `apps/web/src/lib/rate-limit.ts:101-150`, `apps/web/src/lib/auth-rate-limit.ts:90-107`, `apps/web/src/app/actions/sharing.ts:36-50`.
- Severity: LOW. Confidence: HIGH.
- 4 separate implementations. Each has slight variations (e.g., one uses
  `lastAttempt`, another uses `resetAt`, another uses `windowStart`).
- A single `BoundedExpiringMap<K, V>` class would eliminate drift. Trade-off:
  adding an abstraction that must be audited every time rate-limit logic
  changes.
- Fix: deferred — already covered in AGG5R carry-forward (D2-04
  duplicate rate-limit maps). Keep observational.

### CR6-05 — `viewCountBuffer` dual responsibility: acts as both in-memory cache AND retry buffer
- File: `apps/web/src/lib/data.ts:12-96`.
- Severity: LOW. Confidence: MEDIUM.
- On DB success, entries are drained. On DB failure, entries are re-added
  to the same Map. This makes capacity accounting confusing — the
  `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` check is used both for the initial
  admission and for re-buffering, but the semantics differ (new increments
  vs. failed retries).
- Fix: separate into `primaryBuffer` + `retryBuffer` with independent
  caps. More complex but cleaner. Observational.

### CR6-06 — Comment drift: `sharing.ts` line 154 says "Another request may have set it — re-fetch" but the logic is actually retry-on-collision
- File: `apps/web/src/app/actions/sharing.ts:124-163`.
- Severity: LOW. Confidence: HIGH.
- After the conditional UPDATE returns 0 affected rows, the code SELECTs to
  see if another request set the key. If yes, return success. If not,
  retry. The comment is slightly misleading — it's not just "re-fetch", it's
  "re-fetch, and if still null, retry with a new key".
- Fix: clarify comment. Cosmetic.

### CR6-07 — Test naming: `auth-rethrow.test.ts` asserts `unstable_rethrow(e)` is the first statement of every outer catch but the regex is lenient
- File: `apps/web/src/__tests__/auth-rethrow.test.ts:40`.
- Severity: LOW. Confidence: HIGH.
- `const firstRethrow = body.indexOf('unstable_rethrow(e)')` finds the FIRST
  occurrence anywhere in the body. If a future refactor adds an inner
  try/catch that also calls `unstable_rethrow(e)` BEFORE the outer catch's
  own `unstable_rethrow(e)`, the test might pass even if the outer catch
  is missing it. The test should use an AST traversal.
- Fix: use TypeScript compiler API in the test to walk the outer catch
  block's first statement. More robust. Test-infra improvement only.

### CR6-08 — `cleanOrphanedTmpFiles` logs "Removing N files" before unlinks; should log "Removed N/M" after
- File: `apps/web/src/lib/image-queue.ts:30-31`.
- Severity: LOW. Confidence: HIGH.
- Cycle-5 C5-09 (deferred) already noted similar on `readdir` error
  swallow. This is a second instance: the success-path log happens before
  the Promise.all, so it reports discovered files, not removed files.
- Fix: log after `Promise.all`, counting fulfilled vs rejected settlements.

### CR6-09 — `login` action body mixes translation fetch, origin check, rate-limit check, account-scoped check, DB work, Argon2 verify, session creation, and redirect in a single 200-line function
- File: `apps/web/src/app/actions/auth.ts:70-241`.
- Severity: LOW. Confidence: MEDIUM.
- The login function is readable but single-function-testable only via
  full integration. Extracting helpers like `applyLoginRateLimits(ip,
  username)`, `verifyCredentials(username, password)`, `establishSession(userId, locale)` would make unit testing easier and reduce cognitive load.
- Refactor is risky (auth-critical code); explicit repetition aids audit
  trail. Repo rules prefer explicit auth-critical repetition. This is
  observational only. Same rationale as AGG5R-11 (deferred).

### CR6-10 — `db-actions.ts::runRestore` has a `tempPath` that's unlinked in ~7 different places
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:308-449`.
- Severity: LOW. Confidence: HIGH.
- 7 separate `fs.unlink(tempPath).catch(() => {})` calls along the error
  paths. A `try { ... } finally { await fs.unlink(tempPath).catch(() => {}); }`
  wrapper would ensure cleanup even for paths we haven't thought about.
- Fix: wrap the body in a try/finally so the finally handles cleanup
  once. Removes 6 redundant unlinks. Small refactor.

## Summary

- **0 HIGH / MEDIUM** critic findings.
- **10 LOW** findings, all observational or refactor hints. None suggest
  code quality regressions. The codebase is well-structured; most findings
  are "could be cleaner" not "this is broken".
- Most actionable: **CR6-10** (7x unlink duplication in restore pipeline)
  and **CR6-08** (log-before-unlink in cleanOrphanedTmpFiles).
