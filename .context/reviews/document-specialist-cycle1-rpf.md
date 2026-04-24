# Document Specialist Review — Cycle 1 (review-plan-fix prompt 1)

## Scope
Repository documentation and config were checked against runtime/code behavior with a focus on README files, deploy docs/scripts, env examples, user-facing policy docs, comments, and tests-as-docs.

## Inventory Examined
I reviewed the following docs/config/policy surfaces and their corresponding behavior code where relevant:

- `README.md`
- `apps/web/README.md`
- `CLAUDE.md`
- `.env.deploy.example`
- `apps/web/.env.local.example`
- `scripts/deploy-remote.sh`
- `apps/web/deploy.sh`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/next.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/drizzle.config.ts`
- `.github/dependabot.yml`
- `.nvmrc`
- `apps/web/src/site-config.example.json`
- `apps/web/src/site-config.json`
- `apps/web/nginx/default.conf`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/app/actions/public.ts`
- targeted behavior tests: `next-config.test.ts`, `rate-limit.test.ts`, `request-origin.test.ts`, `health-route.test.ts`, `live-route.test.ts`, `backup-filename.test.ts`, `db-pool-connection-handler.test.ts`, `csv-escape.test.ts`, `session.test.ts`, `public-actions.test.ts`

## Findings

### Confirmed issue 1 — `CLAUDE.md` overstates auth coverage for all server actions
**Severity:** Medium  
**Confidence:** High  
**Files / regions:** `CLAUDE.md:127-130` vs `apps/web/src/app/actions/public.ts:11-98`

The policy doc says “Every server action independently verifies auth via `isAdmin()`,” but the public server actions are intentionally unauthenticated:
- `loadMoreImages(...)`
- `searchImagesAction(...)`

Those functions do rate limiting and sanitization, but they do not call `isAdmin()`.

**Concrete failure scenario:** a maintainer reading `CLAUDE.md` may assume the entire `app/actions` surface is already auth-gated and skip a required auth review when adding a new public server action, creating a misleading security expectation.

**Suggested fix:** narrow the statement to “Every mutating admin server action independently verifies auth via `isAdmin()`; public actions are intentionally anonymous.”

---

### Confirmed issue 2 — `CLAUDE.md` documents image-queue concurrency as 1, but the code defaults to 2
**Severity:** Medium  
**Confidence:** High  
**Files / regions:** `CLAUDE.md:167-174` vs `apps/web/src/lib/image-queue.ts:109-112`

`CLAUDE.md` says the queue runs with concurrency 1. The implementation actually creates:

- `new PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2 })`

So the default is 2, not 1.

**Concrete failure scenario:** operators sizing a small host from the docs may underestimate peak CPU/memory pressure during uploads because two image jobs can run at once. That makes troubleshooting “why is upload processing spikier than documented?” harder.

**Suggested fix:** update the doc to say the default is 2 with `QUEUE_CONCURRENCY` as the override, or change the code if single-job processing is the intended contract.

---

### Confirmed issue 3 — `CLAUDE.md` calls the in-memory rate-limit eviction policy LRU, but the code evicts oldest entries
**Severity:** Low  
**Confidence:** High  
**Files / regions:** `CLAUDE.md:123-125` vs `apps/web/src/lib/rate-limit.ts:101-117`

The doc says the bounded Maps use LRU eviction. The code does not refresh key order on access; it iterates `Map.keys()` and deletes the earliest inserted keys. That is oldest-entry/FIFO eviction, not true LRU.

**Concrete failure scenario:** a maintainer may believe “hot” keys are protected from eviction when they are not. Under sustained load, an active key can still be evicted before a newer idle one, increasing DB lookups and making cache capacity tuning misleading.

**Suggested fix:** either change the doc to say “bounded Map with oldest-entry eviction” or implement a true LRU structure if that was the intent.

---

### Likely risk — `TRUST_PROXY` is documented mainly as a rate-limit setting, but it also affects same-origin checks
**Severity:** Low  
**Confidence:** Medium  
**Files / regions:** `README.md:138-139`, `apps/web/README.md:31-34` vs `apps/web/src/lib/request-origin.ts:20-78`

The setup docs explain `TRUST_PROXY` in terms of rate limiting only. The code also uses it when deriving the expected origin/host for mutating admin actions and `/api/admin/db/download`.

**Concrete failure scenario:** if someone adapts the proxy chain and assumes `TRUST_PROXY` only changes IP-based throttling, they can end up with unexpected 403s on admin mutations or backup downloads because the forwarded host/proto are not trusted the way the code expects.

**Suggested fix:** add one sentence to the env/setup docs stating that `TRUST_PROXY` also affects same-origin validation for mutating admin routes and the DB download route, and that the proxy must forward `Host` / `X-Forwarded-Proto` correctly.

## Missed-issues sweep
I rechecked the main setup/docs surfaces after the findings above and found no additional doc/code mismatches beyond the items listed here. The following targeted behavior tests all passed and supported the code-state assumptions used in this review:

- `next-config.test.ts`
- `rate-limit.test.ts`
- `request-origin.test.ts`
- `health-route.test.ts`
- `live-route.test.ts`
- `backup-filename.test.ts`
- `db-pool-connection-handler.test.ts`
- `csv-escape.test.ts`
- `session.test.ts`
- `public-actions.test.ts`

### Verification result
Targeted Vitest runs passed: 10 files, 75 tests.
