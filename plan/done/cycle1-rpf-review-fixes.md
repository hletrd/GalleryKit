# Cycle 1 RPF — review fixes plan

Source aggregate: `.context/reviews/_aggregate.md`.

## Repo-policy inputs consulted

- `CLAUDE.md`: Node 24+ / TypeScript 6+, formal gates, security-critical scanner guidance, deploy helper `.env.deploy` must remain gitignored.
- `AGENTS.md`: commit and push all changes, gitmoji commit messages, keep diffs small/reversible, no new dependencies without explicit request.
- `.context/**` / existing `plan/**`: prior cycle plans preserve commit hygiene, avoid force-push/history rewrites for normal fix cycles, and explicitly defer broad architecture/product decisions to focused cycles.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/` policy files: absent.

## Implementation tasks

### C1RPF-01 — Harden image queue filename safety and retry semantics
- **Source findings:** AGG1-01, AGG1-02.
- **Files:** `apps/web/src/lib/image-queue.ts`, new/updated queue tests.
- **Plan:** validate every DB-sourced filename before resolving/joining filesystem paths; throw on derivative verification failure so retry handling runs; add regression coverage for invalid filenames and verification-failure retry.
- **Progress:** [x] implemented — queue filenames are validated before enqueue, derivative verification now throws for retry handling, and invalid DB filename coverage was added.

### C1RPF-02 — Fix rate-limit rollback leaks
- **Source findings:** AGG1-06, AGG1-07.
- **Files:** `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/public.ts`, focused tests.
- **Plan:** decrement the DB `user_create` bucket on over-limit; roll back both in-memory and DB search counters if `searchImages()` throws.
- **Progress:** [x] implemented — public search and admin-user over-limit paths now roll back DB-backed buckets with regression tests.

### C1RPF-03 — Restore typecheck and low-level validation gates
- **Source findings:** AGG1-03, AGG1-04, AGG1-05, AGG1-08.
- **Files:** `package.json`, `apps/web/package.json`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/__tests__/sql-restore-scan.test.ts`, `apps/web/src/lib/storage/local.ts`, storage tests, `apps/web/src/app/actions/images.ts`, tag tests.
- **Plan:** make the privacy guard type-clean; add typecheck scripts; block SQL `DO`; reject empty/dot storage keys; prevent upload tags with invalid generated slugs.
- **Progress:** [x] implemented — typecheck script/typing fixed, SQL `DO` is blocked, local storage rejects empty/dot/traversal keys, and empty-slug tags are rejected.

### C1RPF-04 — Delete all historical variants and make image fallback behavior truthful
- **Source findings:** AGG1-09, AGG1-10, AGG1-33.
- **Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/components/optimistic-image.tsx`, focused tests where feasible.
- **Plan:** call `deleteImageVariants(..., [])` on delete paths to scan all prefix variants regardless of current size config; use `fallbackSrc` when provided and stop retrying local upload URLs blindly.
- **Progress:** [x] implemented — delete paths prefix-scan all derivative variants and optimistic images honor fallback sources with bounded local retries.

### C1RPF-05 — Strengthen scanner, E2E, and CI gates
- **Source findings:** AGG1-11, AGG1-12, AGG1-13, AGG1-14, AGG1-15, AGG1-16.
- **Files:** `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`, scanner tests, `apps/web/e2e/*.spec.ts`, root `package.json`, `.github/workflows/quality.yml`.
- **Plan:** reject aliased exports in security scanners; replace vacuous E2E assertions with route/DOM invariants; clean up admin-upload E2E state or assert a disposable path; add root delegating scripts and CI workflow for lint, typecheck, tests, custom lint gates, and Playwright.
- **Progress:** [x] implemented — security scanners reject aliased exports, E2E assertions now check DOM/route invariants, upload E2E cleans up, root scripts and CI workflow were added, and the Playwright `NO_COLOR` warning was removed.

### C1RPF-06 — Add focused behavior tests for touched critical branches
- **Source findings:** AGG1-17, AGG1-18, AGG1-19, AGG1-20.
- **Files:** relevant tests under `apps/web/src/__tests__/`.
- **Plan:** cover the critical branches touched in this cycle (search failure rollback, admin-user over-limit DB rollback, tag empty-slug rejection, storage invalid key rejection). Broader auth/settings/sharing behavioral expansion is deferred in `plan/cycle1-rpf-deferred.md`.
- **Progress:** [x] implemented — focused tests cover search rollback, admin-user rollback, empty-slug tag rejection, invalid storage keys, scanner aliases, and queue filename rejection.

### C1RPF-07 — Fix UI accessibility issues with narrow diffs
- **Source findings:** AGG1-21, AGG1-22.
- **Files:** `apps/web/src/components/info-bottom-sheet.tsx`, category/tag/image admin dialog files, translations if needed.
- **Plan:** let scrollable sheet content scroll normally and add an explicit close control; add persistent labels/aria-labels to placeholder-only admin taxonomy/tag inputs.
- **Progress:** [x] implemented — the info sheet drag handle no longer captures all touch scrolling, an explicit close button was added, and admin inputs now have persistent labels.

### C1RPF-08 — Correct docs mismatches
- **Source findings:** AGG1-24, AGG1-25, AGG1-26, AGG1-27.
- **Files:** `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- **Plan:** narrow server-action auth wording, document queue concurrency default 2, describe oldest-entry eviction instead of LRU, and explain TRUST_PROXY same-origin impact.
- **Progress:** [x] implemented — docs now match auth scanner scope, queue concurrency default, oldest-entry eviction, and TRUST_PROXY same-origin behavior.

### C1RPF-09 — Add audit-log retention index
- **Source findings:** AGG1-28.
- **Files:** `apps/web/src/db/schema.ts`, new Drizzle migration if repository migration style permits.
- **Plan:** add standalone `audit_log.created_at` index for retention purge.
- **Progress:** [x] implemented — audit-log retention now has a standalone `created_at` index in schema, migration, and legacy migration reconciliation.

### C1RPF-10 — Make `logout()` same-origin posture explicit
- **Source findings:** AGG1-36.
- **Files:** `apps/web/src/app/actions/auth.ts`, tests if existing structure permits.
- **Plan:** apply the same-origin helper to logout if compatible with call sites; otherwise document/justify exemption in the scanner/docs. Preferred path is enforcement.
- **Progress:** [x] implemented — logout now checks trusted same-origin headers before mutating session state.

## Quality gates to run before commit/deploy

- `npm run lint --workspace=apps/web`
- `npm exec --workspace=apps/web tsc -- --noEmit`
- `npm run build --workspaces`
- `npm run test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`


## Completion evidence

Implemented in cycle 1 and archived after the full gate suite passed.

- `npm run lint --workspace=apps/web` — passed.
- `npm exec --workspace=apps/web tsc -- --noEmit` — passed.
- `npm run build --workspaces` — passed; retained Next.js edge-runtime/static-generation warning deferred in `plan/cycle1-rpf-deferred.md` as D1-17.
- `npm run test --workspace=apps/web` — 52 files / 307 tests passed.
- `npm run test:e2e --workspace=apps/web` — 19 tests passed.
- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
