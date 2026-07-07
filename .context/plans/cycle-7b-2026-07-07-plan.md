# Run-10 Cycle 7 (loop-B) Implementation Plan — "cycle-7b"

Date: 2026-07-07
Naming note: TWO review-plan-fix loops share this worktree and both use `.context/plans/cycle-N-*`
naming. The peer loop's own cycle 7 already owns `cycle-7-2026-07-07-plan.md` (start HEAD
`cae5fbd9`). THIS file is the OTHER loop's cycle 7 — the loop whose prior artifacts are
`cycle-{1..6}-2026-07-0{6,7}-plan.md` and whose review dir is `.context/reviews/cycle-7-2026-07-07/`.
Suffix "b" disambiguates; nothing else differs from that loop's conventions.

Source aggregate: `.context/reviews/cycle-7-2026-07-07/_aggregate.md` (23 deduped findings; 22 open,
1 closed-by-peer). Deferred register: `cycle-7b-2026-07-07-deferred.md` (1 item).
Baseline at planning: HEAD `602a41d8`. Shared worktree: peer session active. Stage ONLY files this
plan touches; `git pull --rebase` before every push.

Repo rules read before deferral decisions: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`,
`README.md`, `apps/web/README.md`. No `.cursorrules` / `CONTRIBUTING.md` exist. Policy: GPG-signed
conventional-commit + gitmoji, no Co-Authored-By, blocking gates, per-cycle deploy, security/
correctness/data-loss findings not deferrable (none deferred here are in that class).

Every open finding from the aggregate is either scheduled in a WP below or recorded in the deferred
register. C7-21 was closed by peer commit `b4f57c6f` before planning (no action).

## WP1 — C7-02 (HIGH/Med-High, 3 lanes): destroy-don't-release on failed `RELEASE_LOCK` at every remaining pooled advisory-lock site

The peer's `3acf638a` fixed `topics.ts` only. A failed `RELEASE_LOCK` on a connection then
`release()`d back to the pool leaks the advisory lock (held server-side by a live pooled
connection). For `LOCK_DB_RESTORE` (fail-fast `GET_LOCK(...,0)`) one transient failure wedges the
entire backup/restore feature until process restart; for the per-image claim it permanently blocks
that image's reprocessing.

- [ ] Shared helper (new `apps/web/src/lib/advisory-lock-release.ts`):
      `releasePooledAdvisoryLocks(conn, lockNames[], label)` — attempts `RELEASE_LOCK` per name;
      all success → `conn.release()`; any failure → loud `console.error` naming the lock(s) +
      `conn.destroy()`. Never throws.
- [ ] Migrate sites:
  - `apps/web/src/lib/image-queue.ts:659-667` `releaseImageProcessingClaim`
  - `apps/web/src/lib/admin-backfill-runner.ts:344-353` `releaseBackfillLock`, `:381-390`
    `releaseImageProcessingClaim`
  - `apps/web/src/lib/upload-processing-contract-lock.ts:45-65` (both release paths)
  - `apps/web/src/app/actions/admin-users.ts:300-310` (`gallerykit_admin_delete`)
  - `apps/web/src/app/actions/embeddings.ts:200-210` (`LOCK_SEMANTIC_EMBEDDING_BACKFILL`)
  - `apps/web/src/app/[locale]/admin/db-actions.ts` — ALL ~12 release sites (backup finally `:390`,
    early-returns `:449/:462/:481/:485`, restore finally `:606/:611/:617`, setup fallbacks
    `:633/:638/:643`). Restore conn holds up to 3 chained locks — use the multi-name variant so one
    failed release destroys once at the end.
  - `apps/web/src/app/actions/topics.ts` — refactor the peer's inline fix onto the shared helper
    (identical behavior; one pattern in the codebase, not two).
  - NOT in scope: `single-writer-guard.ts` (dedicated NON-pool connection; verify + comment).
- [ ] Tests: helper unit test (fail → destroy not release; success → release; multi-lock partial
      failure → destroy). Source-contract test: no raw `RELEASE_LOCK` call site outside the
      helper + single-writer-guard, so a 9th divergent site cannot ship silently.
- [ ] Update existing shape-pinning tests as needed (topics-actions, restore-upload-lock,
      admin-backfill-runner-leak, image-queue contracts, embeddings-action-behavior, db-restore).

## WP2 — C7-01 (MED-HIGH/High, 5-lane agreement): logout during restore window must not silently drop session revocation

- [ ] New `apps/web/src/lib/pending-session-revocations.ts`: bounded process-local Set of token
      hashes (cap + oldest-eviction), enqueue/flush API.
- [ ] `apps/web/src/app/actions/auth.ts:279-294`: when the maintenance marker or mutation-barrier
      window blocks the DB delete, enqueue the token hash instead of dropping it.
- [ ] Flush points: (a) where the restore path clears the maintenance marker (success AND failure
      exits in db-actions.ts) — semantically correct since the restore import REPLACES the sessions
      table (a pre-import delete would be undone); (b) hourly maintenance sweep as backstop.
- [ ] Comment the residual risk (process crash loses the set; cookie already cleared; only matters
      for an exfiltrated token — same as pre-existing exposure).
- [ ] Behavioral test: maintenance-active logout → row NOT deleted + hash queued; flush → delete
      issued for queued hash.

## WP3 — C7-03 (MED/High, 2 lanes): warn-once when `IMAGE_BASE_URL` fails sanitization

- [ ] `apps/web/src/lib/content-security-policy.ts` `sanitizeImageBaseUrlSafely`: once-per-process
      `console.error` when a NON-EMPTY raw value is rejected (mirror `buildCspSafely` latch).
      Keep returning `''` (fail-safe unchanged). Log server-side only
      (`typeof window === 'undefined'`) to avoid client spam.
- [ ] Test: rejected value logs exactly once; accepted/empty logs nothing.

## WP4 — C7-04 (MED/High, 2 lanes): 44 px width floor for the collapsed nav search trigger

- [ ] `apps/web/src/components/search.tsx:371-389`: add `min-w-11` to the production-semantic-mode
      trigger so the icon-only (<lg) rendering is ≥44 px wide.

## WP5 — C7-05 (MED/High, 2 lanes): `getConfiguredBaseOrigin()` must honor the `siteConfig.url` fallback  (+ C7-13 comment rider)

- [ ] `apps/web/src/lib/request-origin.ts:45-48`: use the same effective-base-URL formula as the
      six sibling sites (`process.env.BASE_URL || siteConfig.url`) — reuse `BASE_URL` from
      `constants.ts` if the import graph allows, else import site-config directly.
- [ ] Test: with `BASE_URL` env unset, `getExpectedOrigin()` anchors to `siteConfig.url`'s origin.
- [ ] C7-13 (INFO): one-line comment near the Host-preference branch — shipped nginx sets Host and
      X-Forwarded-Host identically; the canonical anchor is the primary defense.

## WP6 — C7-10 (MED/High): `SimilarThumb` label disambiguator parity

- [ ] `apps/web/src/components/similar-photos.tsx`: append the `#{id}` disambiguator to thumbnail
      `aria-label`/`title` exactly as `search.tsx` `SearchResultItem` does (peer `4d37daa4`
      directive: keep result labels aligned).
- [ ] Extend the existing source-contract test with the sibling pin.

## WP7 — C7-11 (LOW/High): bottom Save button focus-restore

- [ ] `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:859`: restore focus
      to the Save button the user actually activated (track last-clicked ref, or per-button refs).

## WP8 — C7-20 (LOW-MED/High): memoize the client-side sanitized image base

- [ ] `apps/web/src/lib/image-url.ts:26-31`: lazily cache the sanitized browser value in module
      scope on first client call (server branch + SSR/hydration contract unchanged).

## WP9 — C7-08 (LOW/High): single owner for the default-environment expression

- [ ] `apps/web/next.config.ts:8-10`: `parseImageBaseUrl(rawValue, environment?)` forwards the
      optional param verbatim; `parseCspImageBaseUrl` alone owns the default.

## WP10 — C7-12 + C7-19 (LOW): sql-restore-scan rolling raw tail + case fixtures

- [ ] `apps/web/src/lib/sql-restore-scan.ts`: persistent rolling raw tail (last N raw bytes of the
      CUMULATIVE stream, N ≥ longest dangerous token) prepended to each chunk's scan window —
      closes the short-read 3-read keyword split (C7-12).
- [ ] Tests: `DROP TABLE` split across three short reads; mixed-case fixtures (C7-19).

## WP11 — C7-09 (LOW-MED/Med-High, + C7-23 rider): `searchImages` tag-branch `tag_names` parity

- [ ] `apps/web/src/lib/data.ts:1693-1713`: filter tag matches via an EXISTS subquery while keeping
      the UNFILTERED `LEFT JOIN` + `tagNamesAgg` aggregation for `tag_names`. Do NOT use a raw-SQL
      correlated scalar subquery (that shape broke production before — CLAUDE.md `tagNamesAgg`).
- [ ] C7-23: remove the two provably-unreachable `remainingLimit <= 0` ternaries in the same
      function.
- [ ] Extend `data-tag-names-sql.test.ts` to pin the new shape.

## WP12 — test batch (C7-15 HIGH, C7-16 MED, C7-17 MED, C7-18 MED)

- [ ] C7-15: behavioral test for `armDbChildProcessWatchdog` (fake child + fake timers): timeout
      fires after grace-timer armed; settle-before-timeout cancels; no double-settle.
- [ ] C7-16: behavioral test for the `drizzle.config.ts` TLS-CA throw (non-local DB_HOST, no
      DB_SSL_CA).
- [ ] C7-17: settings-hash `image_sizes` order-independence (`[640,1536]` vs `[1536,640]`).
- [ ] C7-18: `purgeOldViewEvents` stops at `MAX_BATCHES_PER_TABLE` (mock db yielding full batches).

## WP13 — C7-22 (MED/High): retire the dead recovery script + parity pin

- [ ] Verify `apps/web/scripts/restore-maintenance-recovery.ts` has zero references (package.json,
      Dockerfile, docs, tests); delete it (git-recoverable).
- [ ] Parity test pinning the shipped `.mjs` marker path/name against
      `restore-maintenance-durable.ts` constants so the two cannot drift silently.

## WP14 — docs & boundary guards (C7-06 doc half, C7-14, C7-07)

- [ ] C7-06 doc half: CLAUDE.md `IMAGE_BASE_URL` row — build-time-frozen half (`next/image`
      `remotePatterns`); changing it requires a rebuild (`npm run deploy`), not a container restart
      (parallel to site-config's ARCH-03 note).
- [ ] C7-14: same row — scope "absolute HTTPS" to production (dev/test allow http), matching
      `.env.local.example` / `apps/web/README.md`.
- [ ] C7-07: boundary comment at top of `content-security-policy.ts` (three consumer contexts) +
      cheap source-guard test (no `node:`/server-only imports).

## WP15 — ledger

- [ ] `.context/plans/README.md`: add cycle-7b to active plans.
- [ ] `deferred-carry-forward.md`: add the single cycle-7b deferral row (file committed/clean at
      planning; if peer dirties it mid-cycle, record only in the cycle-7b register + note conflict).
- [ ] Commit the aggregate + this plan + deferred register.

## Progress ledger (updated during PROMPT 3)

- [x] WP1 — `ae197531` shared destroy-don't-release helper + all pooled sites migrated + unit/source-contract tests (peer co-authored dependent test updates in-worktree)
- [x] WP2 — `c882e82d` pending-session-revocations queue + logout enqueue + restore-clear/hourly flush + tests
- [x] WP3 — `ceb7c8a5` sanitizeImageBaseUrlSafely warn-once (server-side)
- [x] WP4 — `878508e3` search trigger min-w-11
- [x] WP5 — `ceb7c8a5` getConfiguredBaseOrigin siteConfig.url production fallback (+C7-13 comment); peer added the production-branch test (NODE_ENV stubbing fixed in `f3cafa9c`)
- [x] WP6 — `878508e3` SimilarThumb #id disambiguator (peer pinned in cycle-21 source contracts)
- [x] WP7 — `878508e3` per-button save focus restore
- [x] WP8 — `ceb7c8a5` client image-base memoization (keyed on raw attribute)
- [x] WP9 — `ceb7c8a5` parseImageBaseUrl forwards optional environment
- [x] WP10 — `9f416f01` cumulative rolling raw suffix + three-short-read + case fixtures
- [x] WP11 — `584417f5` (peer-committed from this worktree) + `f3cafa9c` EXISTS tag filter, unfiltered aggregation, dead ternaries removed, NODE_ENV test typing
- [x] WP12 — `515a25bd` watchdog extraction + behavioral tests, drizzle TLS behavior tests, image_sizes order-independence (surfaced a real gap — buildHash now normalizes for every caller), purge cap test
- [x] WP13 — `510eea49` dead .ts recovery twin removed + .mjs/durable parity pins
- [x] WP14 — CLAUDE.md IMAGE_BASE_URL row: production-scoped HTTPS wording (C7-14) + build-time-frozen remotePatterns callout (C7-06 doc half); C7-07 boundary comment + C7-13 topology comment landed in `ceb7c8a5`
- [x] WP15 — this ledger + README/carry-forward updates (`bb67c6a5`)
- [x] Gates (all green on the full tree, 2026-07-07 23:10-23:25 KST):
      eslint PASS; typecheck PASS (app + scripts); vitest 3235 passed / 4 skipped;
      build PASS (exit 0); lint:api-auth PASS; lint:action-origin PASS;
      lint:public-route-rate-limit PASS; playwright e2e 45 passed / 2 skipped
      (first full run had 5 contention flakes while the peer session ran heavy
      work concurrently; each failing spec passed individually and the full
      re-run was clean — exit 0).
- [x] Deploy (per-cycle): `npm run deploy` succeeded 2026-07-07 ~23:26 KST (no concurrent
      peer run; "Deployment Complete!", post-prune disk 14% used). Post-deploy verification:
      `/api/live` 200, `/` 307 locale redirect, `/en` 200. DEPLOY: per-cycle-success.

### Shared-worktree note (for provenance)

The peer session converged on this plan in near-lockstep throughout PROMPT 3: it committed
matching test updates (advisory-lock suite, request-origin production-branch test, cycle-21
SimilarThumb pins, data-tag-names EXISTS pin), the `584417f5` data.ts landing, and the
`normalizeHashValue` settings-hash normalization. Where its uncommitted edits blocked
`git pull --rebase`, this loop pushed directly after verifying the tree; no peer work was
reverted or clobbered.
