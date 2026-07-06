# Document Specialist Review — Doc/Code Mismatch Audit (Run-10 Cycle 3)

Date: 2026-07-07
Scope: root `CLAUDE.md`, `apps/web/README.md`, `apps/web/.env.local.example`, `.env.deploy.example`,
`apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `package.json`
(root + apps/web), `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`,
`apps/web/messages/en.json` vs `ko.json`, `.context/plans/README.md`. Code is treated as the source
of truth throughout.

## Method

Predecessor `.context/reviews/cycle-2-2026-07-07/document-specialist.md` audited this same doc set
line-by-line and found zero mismatches. Rather than re-walk every already-matched claim, this pass:

1. Re-read the cycle-2 predecessor review and both deferred registers (`cycle-2-2026-07-07-deferred.md`,
   `cycle-1-2026-07-06-deferred.md`) to avoid re-reporting closed/deferred items.
2. Diffed the seven named behavior-changing commits from cycle-2 (`02bea8d6`, `af3b2f7d`, `3b8d05c8`,
   `e39ad990`, `911cb0f5`, `b4e986c3`) plus the doc batch (`cc400622`) against current `HEAD`, and
   verified every new prose claim added by `cc400622` against the current source, not just the state
   at commit time.
3. Cross-checked commits between `cc400622` and `HEAD` (`7c1c0a03`, `2fe8f556`, `a4a2d250`, `9ce5cf96`,
   `9d6675ee`, `fa35fc78`, `4e2ca838`, `faa6f0e5`, `f899edec`, `911cb0f5`, `b4e986c3`, and the cycle-2
   closing docs commits `247caacd`/`a0696f01`/`e08b6f97`) for any behavior change that contradicts or
   omits an existing documented claim.
4. Re-verified i18n key parity (`en.json` vs `ko.json`) and the `COLOR_IMPACTING_KEYS` count
   programmatically rather than trusting the prior pass's numbers.

## Findings

### DOC3-01 — `QUEUE_CONCURRENCY` silently pool-clamped; undocumented, and CLAUDE.md's own cross-reference to it is currently false
- **Severity:** Medium (operational — a documented "override with `QUEUE_CONCURRENCY`" env var silently
  does much less than an operator would expect at default pool size).
- **Confidence:** High (mechanism + numeric outcome both confirmed directly in source and in a passing
  test).
- **Status:** New this cycle (introduced by `02bea8d6`, "C2-08"; the cycle-2 doc batch `cc400622` did
  not update the `QUEUE_CONCURRENCY` row even though it added a *reference* to this exact formula
  elsewhere in the same file — see below).
- **Doc:** `CLAUDE.md:100` (table row) and `CLAUDE.md:269` (pipeline step 3):
  > `QUEUE_CONCURRENCY` \| `1` \| Background image-processing jobs concurrency in this web process
  >
  > 3. Enqueued to `PQueue` (default concurrency: 1; override with `QUEUE_CONCURRENCY`) for background
  >    processing
  Both read as: set the env var, get that many concurrent workers (bounded only by the parser's
  documented `max: 8`).
- **Code:** `apps/web/src/lib/image-queue.ts:124-145`:
  ```ts
  const DEFAULT_DB_POOL_CONNECTION_LIMIT = 10;
  export const IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS = (poolLimit: number): number =>
      Math.max(3, Math.ceil(poolLimit / 2));

  export function resolveImageQueueConcurrency(requested: number, poolLimit = DEFAULT_DB_POOL_CONNECTION_LIMIT): number {
      const limit = Number.isFinite(poolLimit) ? poolLimit : DEFAULT_DB_POOL_CONNECTION_LIMIT;
      const reserved = IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS(limit);
      const cap = Math.max(1, Math.floor((limit - reserved) / 2));
      const req = Math.max(1, Math.floor(requested) || 1);
      return Math.min(req, cap);
  }
  const REQUESTED_QUEUE_CONCURRENCY = parseBoundedPositiveInteger(process.env.QUEUE_CONCURRENCY, { fallback: 1, max: 8 });
  const QUEUE_CONCURRENCY = resolveImageQueueConcurrency(REQUESTED_QUEUE_CONCURRENCY, POOL_CONNECTION_LIMIT);
  ```
  At the shipped default pool (`POOL_CONNECTION_LIMIT = 10`): `reserved = max(3, ceil(10/2)) = 5`,
  `cap = max(1, floor((10-5)/2)) = 2`. So `QUEUE_CONCURRENCY=8` (the documented max the parser accepts)
  silently resolves to an *effective* concurrency of **2**, with no warning logged (unlike the sibling
  `ADMIN_BACKFILL_CONCURRENCY` clamp path in `admin-backfill-runner.ts`, which does log a warning when
  clamping down). Locked by `apps/web/src/__tests__/image-queue-concurrency-cap.test.ts:42-44`:
  `resolveImageQueueConcurrency(8, 10)` / `(5, 10)` / `(100, 10)` all return `2`.
- **The doc already assumes this formula is documented, but it isn't:** `cc400622` added a new
  "Budget note (TRC-07, run-10 c2)" right after the connection-pool line, at `CLAUDE.md:257-258`:
  > Connection pool: 10 connections, queue limit 20, keepalive enabled. Budget note (TRC-07, run-10 c2):
  > **the documented image-queue / backfill concurrency formulas** model only their own claim
  > connections vs live requests — …
  This sentence explicitly refers to "the documented image-queue … concurrency formula" as an existing
  thing to reason from. No such formula is documented anywhere in `CLAUDE.md` for `QUEUE_CONCURRENCY` —
  only the **backfill** formula (`ADMIN_BACKFILL_CONCURRENCY`) gets the full write-up, under
  "Concurrency env vars (distinct — AGG-R7-08)" in the Color & HDR Pipeline section. So the same doc
  batch that hardened the pool-budget note for topic/restore locks also introduced a dangling
  cross-reference to a formula the file never states.
- **Impact:** An operator raising `QUEUE_CONCURRENCY` to speed up bulk processing (e.g. after a large
  batch upload) on the default 10-connection pool gets, at most, 2x parallelism regardless of the value
  set, silently. There is no log line pointing this out (contrast with the backfill runner, which warns
  on clamp). This is a real behavior surprise, not just missing prose.
- **Suggested fix:** Add a short parenthetical to the `QUEUE_CONCURRENCY` table row and pipeline-step-3
  bullet mirroring the `ADMIN_BACKFILL_CONCURRENCY` treatment, e.g. "clamped by pool budget — effective
  cap is `max(1, floor((POOL_CONNECTION_LIMIT - max(3, ceil(POOL_CONNECTION_LIMIT/2))) / 2))`, which is
  **2** at the shipped pool of 10 (`resolveImageQueueConcurrency` in `image-queue.ts`)." Alternatively,
  if a mismatch between prose and code is preferred to be resolved on the code side, add a
  `console.warn` on clamp-down for parity with the backfill runner (operator-visibility fix, not just a
  doc fix) — CODE is arguably the surprising half here (no log) even though the doc omission is what
  makes it invisible to a reader of `CLAUDE.md`.

## Re-verified, unchanged since cycle-2 (no action needed)

- GPS-strip HEIC/HEIF fail-closed wording (`CLAUDE.md` Privacy section) matches
  `apps/web/src/app/actions/images.ts:414-421` and the LR upload route's identical branch exactly —
  `stripGpsFromOriginal` returning `false` triggers `deleteOriginalUploadFile` + reject, not a retry/re-encode.
- Bidi/zero-width enforcement points (`requireCleanInput` / `sanitizeAdminString`) are confirmed to live
  in `apps/web/src/lib/sanitize.ts:82-93,161-181`, both built on `UNICODE_FORMAT_CHARS` imported from
  `validation.ts` — matches the VER-02 correction exactly.
- CLIP pre-activation test gate commands (`CLIP_OFFLINE_LOAD=1 … clip-offline-load.test.ts`,
  `CLIP_INTEGRATION=1 … clip-semantic-integration.test.ts`) match the `describe.skip` gating in both
  test files (`src/__tests__/clip-offline-load.test.ts:32-41`, `clip-semantic-integration.test.ts:30-31`).
- `site-config.json` build-time-inlined note and the matching `docker-compose.yml:28-31` mount comment
  are consistent with each other and with the 15 `import siteConfig from '@/site-config.json'` call sites.
- Single-writer boot guard: `apps/web/src/lib/single-writer-guard.ts` exports
  `startSingleWriterGuard`/`stopSingleWriterGuard`, wired via dynamic `import()` in
  `apps/web/src/instrumentation.ts` (fire-and-forget, `.catch` only for unhandled-rejection safety) —
  matches the "warn-only, never blocks startup" claim. `gallerykit_web_singleton` is defined in
  `advisory-locks.ts:56` and present in the advisory-lock scope-note list.
- Public SSR page edge rate limiting: `nginx/default.conf` defines `zone=public:10m rate=10r/s` and
  applies `limit_req zone=public burst=40 nodelay` only on the catch-all `location /` (line 245+) —
  matches the C2-06 doc claim, and `deploy.sh` contains no nginx reload/restart step, matching "deploys
  do not touch host nginx."
- `b4e986c3`'s migrate.js behavior change (pending-new-migrations vs. true-drift split) already shipped
  its own `CLAUDE.md` update **in the same commit** (`CLAUDE.md:446`) — the current runbook prose
  matches `prepareLegacyDatabaseIfNeeded` in `scripts/migrate.js:764-834` exactly, including the
  swallowed-tail warning behavior and the `__tests__/migrate-pending-migrations.test.ts` citation
  (file confirmed present).
- `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` (`gallery-config-shared.ts:75-85`) still has exactly 9
  entries, matching the "**9** `COLOR_IMPACTING_KEYS`" claim.
- ISOBMFF walker bounds (`color-detection.ts:227,231`): `MAX_SCAN_BYTES = 1024*1024`, max depth 5 —
  still match the doc's "(max box depth 5, max scan 1 MB)" parenthetical; `9ce5cf96`'s new
  container-end bound is an additive hardening that doesn't contradict the existing parenthetical
  (which was never claimed to be exhaustive).
- Build-time vs. runtime `IMAGE_BASE_URL`/CSP validation are two distinct code paths and both docs are
  accurate for their respective path: `next.config.ts:8,27` calls `parseImageBaseUrl` →
  `parseCspImageBaseUrl` at module-eval (build) time and still throws/aborts the build on a malformed
  value, matching `apps/web/README.md:49`'s "production builds reject" claim; `a4a2d250` only changed
  the *separate* per-request middleware path (`proxy.ts` / `content-security-policy.ts`'s
  `buildCspSafely`) to degrade instead of 500, which is a distinct runtime behavior the README doesn't
  claim anything about.
- i18n key parity re-checked programmatically: `en.json` and `ko.json` both flatten to exactly **856**
  leaf keys with zero one-sided keys (count moved from the predecessor's 854 because of `4e2ca838`'s
  new restore-blocker / re-encode-notice keys, added symmetrically to both locales).
- `.context/plans/README.md`'s "Active Current-Cycle Plans" section still lists Run-10 Cycle 2 as
  active even though cycle-2 closed (`247caacd`) before cycle-3 started — not reported as a finding
  since this file is under active edit as part of this same cycle's own plan/ledger workflow (visible
  in this session's `git status` as a pending modification), the same end-of-cycle pattern documented
  for cycle-2's own closure.

## Audited / Skipped

**Audited:** all files in Scope above, plus targeted diffs of `02bea8d6`, `af3b2f7d`, `3b8d05c8`,
`e39ad990`, `911cb0f5`, `b4e986c3`, `cc400622`, `7c1c0a03`, `2fe8f556`, `a4a2d250`, `9ce5cf96`,
`9d6675ee`, `fa35fc78`, `4e2ca838`, `faa6f0e5`, `f899edec`, `223b3836`.

**Skipped:** full re-audit of claims cycle-2 already verified with no intervening code change (DB pool
size, login rate-limit windows, admin token format, OG fetch constants, SW revalidation timeout, blur
data URL cap, ETag format, nginx body-size caps, `package.json` script wiring, PAT header constant, CLIP
model constants, `site-config.example.json` key list) — re-confirmed only where a cycle-2/3 commit
touched the owning file.

