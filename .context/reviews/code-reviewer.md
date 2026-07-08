# Run-10 Cycle 34 Code Reviewer Report

Date: 2026-07-08 KST
Review HEAD: `5124d17ec6bf801f302c180cabf6a58539d892c5`
Role: code-reviewer lane
Scope: comprehensive whole-repository code-quality, logic, maintainability, race/shared-state, error-handling, invariant, and cross-file interaction review. Product code was not edited.

## Inventory

Authority and context read first: `AGENTS.md`, `CLAUDE.md`, the current review target, and the existing `.context/reviews/code-reviewer.md` baseline.

Relevant tracked code inventory reviewed:

- 692 tracked implementation/operations files in the active review set: `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/nginx`, `apps/web/docker-compose.yml`, `apps/web/next.config.ts`, and `scripts/check-proxy-topology.mjs`.
- 624 tracked TypeScript/TSX source files under `apps/web/src`: 80 `app` files, 61 component files, 115 library files, 3 DB files, 1 i18n file, 1 type file, and 364 tests.
- 67 tracked operational/schema/config files outside `src`: 29 scripts, 34 migration/meta files, nginx config, Docker Compose, Next config, and the proxy-topology checker.

High-risk cross-file areas examined in detail: admin auth/API wrappers, mutating server-action origin and mutation barriers, public route rate limits, semantic/similar search admission, public data privacy projections, smart collections, topic routes, restore/backup maintenance, background DB writers, pending cleanup queues, image-processing queue, color re-encode backfill, advisory locks, DB pool budgeting, upload/original-file path safety, nginx/proxy assumptions, migration baselining, and source-contract tests.

Intentionally not reviewed as source: `node_modules`, build outputs, runtime uploads/backups, and historical `.context` plans/reviews except where they documented current invariants or prior findings. Final sweep checked that no relevant tracked implementation/config path in the inventory above was skipped.

## Confirmed Issues

### CR34-01: Image queue and admin backfill each reserve live DB headroom independently, so running both can nearly saturate the shared pool

Severity: Medium
Confidence: High
Status: Confirmed resource/race risk

Code regions:

- `apps/web/src/db/index.ts:31-42`
- `apps/web/src/lib/image-queue.ts:121-153`
- `apps/web/src/lib/admin-backfill-runner.ts:106-143`
- `apps/web/src/lib/admin-backfill-runner.ts:716-727`
- `CLAUDE.md:272-285`

Evidence:

The app ships with `POOL_CONNECTION_LIMIT = 10` and `queueLimit: 20` (`db/index.ts:31-42`). `resolveImageQueueConcurrency()` reserves `max(3, ceil(pool / 2))` for live traffic and caps the image queue in isolation (`image-queue.ts:121-153`). `resolveBackfillConcurrency()` uses a similar isolated formula for admin color backfill, including the global backfill lock plus per-image claim/update connections (`admin-backfill-runner.ts:106-143`), and the runner applies that cap when starting the PQueue (`admin-backfill-runner.ts:716-727`). `CLAUDE.md:272-285` documents that these two background consumers do not subtract each other, but the code still has no shared budget, pause, or semaphore between them.

Failure scenario:

On the default 10-connection pool, an active upload/image-processing queue at effective concurrency 2 and an admin-triggered color re-encode at effective concurrency 2 can overlap because they use different locks. The backfill can pin roughly 1 global lock plus 2 workers times 2 connections, while the image queue can pin 2 workers times 2 connections. That leaves about one free pool connection, not the five live connections each formula independently claims to reserve. A live photo page, topic page, search, or admin view with DB fan-out can then queue behind encode-duration holds and hit the pool `queueLimit` under normal maintenance plus upload activity.

Concrete fix:

Introduce a single shared background DB connection budget for all long-running background processors, or make admin backfill explicitly quiesce/pause the image-processing queue before it starts. The invariant should be "combined background work leaves live headroom" rather than "each background worker class leaves live headroom in isolation." Add a regression/source-contract test that proves `imageQueueBudget + backfillBudget + long-held locks` cannot exceed the shared pool budget at `POOL_CONNECTION_LIMIT = 10`.

## Likely Issues

No likely-but-unconfirmed code defects were retained after the final sweep. Older Cycle 25 findings for fail-open color config and restore temp-file cleanup were rechecked against current code and are no longer current: the re-encode paths now call strict detached config accessors, and `runRestore()` transfers temp-file cleanup only after `spawn()` returns and handlers are registered.

## Manual-Validation Risks

### CR34-MV01: Effective per-client rate-limit identity still depends on deployed proxy topology

Severity: Medium
Confidence: Medium
Status: Manual-validation risk, not a confirmed repository-code defect

Code/config regions:

- `apps/web/src/lib/rate-limit.ts:175-216`
- `apps/web/nginx/default.conf:1-29`
- `apps/web/nginx/default.conf:59-71`
- `scripts/check-proxy-topology.mjs:12-16`
- `scripts/check-proxy-topology.mjs:131-133`
- `CLAUDE.md:97-98`
- `CLAUDE.md:248`
- `CLAUDE.md:753`

Evidence:

App-side rate limiting trusts `X-Forwarded-For`/`X-Real-IP` only when `TRUST_PROXY=true`; otherwise `getClientIp()` returns the shared key `"unknown"` and logs once (`rate-limit.ts:175-216`). The shipped nginx limiter keys on `$binary_remote_addr` (`default.conf:1-29`) and the config comments correctly warn that this is only the true client IP when nginx sees the real client as its TCP peer; in an upstream LB/CDN topology, operators must configure real-IP/PROXY protocol for nginx and adjust XFF/hop behavior (`default.conf:59-71`). The repo includes a read-only `check:proxy-topology` script, but its own help/output says it verifies forwarded host/proto spoof resistance and explicitly does not verify the effective client-IP bucket or XFF overwrite (`check-proxy-topology.mjs:12-16`, `131-133`). Running `npm run check:proxy-topology` locally without `--url` / `PROXY_TOPOLOGY_URL` failed before any live validation.

Failure scenario:

If production is behind a CDN or load balancer and nginx still sees only the upstream peer, nginx `limit_req_zone $binary_remote_addr` buckets all visitors together. If app `TRUST_PROXY`/`TRUSTED_PROXY_HOPS` does not match the real chain, app-layer login/search/share/semantic buckets can also collapse to a shared key or select the wrong hop. A small number of failed logins or public requests from one client can then throttle unrelated users, while spoofed or mis-selected forwarding chains weaken per-client limits.

Concrete validation/fix:

On the deployed host, run `npm run check:proxy-topology -- --url <public-origin> [--direct-url <direct-app-url>]` for forwarded host/proto resistance, then verify real-IP behavior with edge logs or a diagnostic that exposes only the effective bucket key class, not raw secrets. If an LB/CDN is in front, configure nginx `set_real_ip_from`/`real_ip_header` or PROXY protocol so `$binary_remote_addr` reflects the client, switch XFF handling to append mode where appropriate, and set `TRUSTED_PROXY_HOPS` to the real trusted-hop count.

## Missed-Issue / File-Skip Sweep

- Re-ran the custom guard scripts: API admin routes are wrapped by `withAdminAuth`, mutating server actions enforce same-origin and mutation-barrier contracts, and public route handlers have the required rate-limit posture or explicit exemption.
- Reviewed restore sequencing across durable maintenance, upload-processing contract lock, backfill locks, image queue quiesce/resume, background DB drains, maintenance sweep drain, admin mutation drain, temp-file cleanup, child-process watchdogs, and post-restore migrations. No current restore data-corruption or temp-file ownership issue was confirmed.
- Reviewed public data projection guards in `data.ts`/`data-timeline.ts`, semantic/similar route output shaping, and smart collection query compilation. No confirmed privacy field leak, SQL injection path, or unbounded public query path was found.
- Reviewed advisory lock call sites and the raw `RELEASE_LOCK` allowlist. Fail-fast pooled lock paths use the shared destroy-on-ambiguous-acquire / destroy-on-release-failure helpers; script-only raw releases remain allowlisted by source-contract tests.
- Reviewed upload/original-file path handling, derivative cleanup, pending file deletions, and serve-upload path safety. No confirmed traversal/symlink cleanup issue was found.
- Reviewed migration journal/baseline contracts and current drizzle files. No confirmed journal ordering, DML-baseline, or reconcile parity issue was found in this pass.

## Verification

Commands run:

- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed.
- `npm test --workspace=apps/web -- --run src/__tests__/rate-limit.test.ts src/__tests__/nginx-config.test.ts src/__tests__/restore-drain-checklist.test.ts src/__tests__/advisory-lock-release-contract.test.ts src/__tests__/admin-backfill-runner-batching.test.ts src/__tests__/image-queue-r10c1-contracts.test.ts` — 6 files / 61 tests passed.
- `npm run check:proxy-topology` — not completed because no `--url` / `PROXY_TOPOLOGY_URL` was provided; retained as manual-validation risk only.

No implementation was performed. The only reportable confirmed code issue from this pass is CR34-01; CR34-MV01 requires live deployment validation.
