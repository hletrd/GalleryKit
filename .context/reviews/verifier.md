# Verifier Review — Cycle 1 Deep Review Fan-out

## Inventory first

- Repo: `/Users/hletrd/flash-shared/gallery`
- Branch/status at start: `master...origin/master`; working tree already had other-agent edits in `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, and `.context/reviews/perf-reviewer.md`. I did not read/write those files after noticing they were modified.
- Owned write scope honored: this report writes only `.context/reviews/verifier.md`.
- Primary contract sources inspected: `README.md`, `CLAUDE.md`, `apps/web/README.md`, `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/nginx/default.conf`, `apps/web/src/db/schema.ts`, auth/session/rate-limit code, server actions, image upload/queue/serving code, public data queries, DB backup/restore code, and the unit/lint guard surface.

## Verification commands

- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm run lint:action-origin --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ — 72 files / 479 tests passed
- `npm run typecheck --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅
- `BASE_URL=http://localhost:3000 npm run prebuild --workspace=apps/web` ✅ expected failure — confirmed the production placeholder-URL build guard is currently wired through the normal `prebuild` script.

Note: an initial `npm test --workspace=apps/web -- --runInBand` attempt failed because Vitest does not support Jest's `--runInBand`; the correct Vitest command above passed.

## Positive verifications

- Production URL guard is now active on normal builds: `apps/web/package.json:10` runs `NODE_ENV=production node scripts/ensure-site-config.mjs`, and the guard rejects placeholder hosts when `NODE_ENV=production` in `apps/web/scripts/ensure-site-config.mjs:13-42`.
- API admin route auth lint is green; the only admin API route is wrapped by `withAdminAuth`.
- Mutating server-action origin lint is green; the scanner reports every mutating action stores and returns early on `requireSameOriginAdmin()`.
- Public privacy select shape still omits GPS/original filename/user filename in `apps/web/src/lib/data.ts:179-224`.
- Upload originals are private by default and public serving remains whitelisted to `jpeg`, `webp`, and `avif` via `apps/web/src/lib/upload-paths.ts:24-46` and `apps/web/src/lib/serve-upload.ts:37-49`.

## Findings

### VER-C1-01 — Login per-account rate-limit is DB-backed only, but the security contract says both login buckets use bounded Maps

- **Severity:** Low-Medium
- **Confidence:** High
- **Category:** Documentation / implementation mismatch with a narrow security fallback gap

**Evidence**

- `CLAUDE.md:125` states login rate limiting has two buckets — per-IP and per-account — and that “Both buckets use bounded Maps with oldest-entry eviction when caps are exceeded.”
- The implementation has a bounded in-memory map only for the IP bucket: `apps/web/src/lib/rate-limit.ts:36-40` exports `loginRateLimit`, while `buildAccountRateLimitKey()` only constructs the account DB key at `apps/web/src/lib/rate-limit.ts:69-72`.
- In `login()`, the per-IP fast path reads and writes the in-memory map at `apps/web/src/app/actions/auth.ts:100-122`. The account bucket is only persisted/checked through `incrementRateLimit(accountRateLimitKey, 'login_account', ...)` and `checkRateLimit(accountRateLimitKey, 'login_account', ...)` at `apps/web/src/app/actions/auth.ts:123-145`.
- A repo-wide search for `login_account` / `acct:` shows no account-scoped bounded map; it only appears in DB-backed increment/check/reset/decrement paths.

**Why it matters**

The code does enforce account-scoped throttling when the `rate_limit_buckets` DB path is healthy, so the normal path is protected. The mismatch is in the fallback and the documentation: if the rate-limit table/operations fail while the rest of auth DB access still works, `auth.ts:145-147` falls back to the in-memory limiter, but that limiter is only per-IP. A distributed attacker could then keep each IP under 5 attempts while targeting the same username, contrary to the documented account-bucket fallback behavior.

**Concrete failure scenario**

A migration/permission issue or table-level failure affects `rate_limit_buckets` but not `admin_users`. Login still reaches Argon2 verification, but the account bucket check throws and is swallowed. The per-IP map remains effective, but many low-volume IPs can collectively attempt more than 5 guesses against one username inside 15 minutes.

**Suggested fix**

Choose one of these and align docs/tests accordingly:

1. Add an account-scoped bounded in-memory map keyed by `buildAccountRateLimitKey(username)` and update it/check it alongside `loginRateLimit` before Argon2 verification; or
2. Change `CLAUDE.md` to state the account bucket is DB-backed only and that DB-unavailable fallback is per-IP only.

If option 1 is chosen, add a unit test that simulates DB rate-limit failures while `admin_users` lookup still works and verifies the account map blocks distributed attempts.

## Final sweep

After the finding above, I rechecked the surrounding auth/session code, action-origin/API-auth lint gates, upload/private-original serving boundary, image queue processing contract, backup/restore path, docs for build/deploy setup, and current test output. I did not find another evidence-backed correctness failure strong enough to report in this pass.
