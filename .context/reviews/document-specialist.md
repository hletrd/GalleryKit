# Document Specialist — Cycle 4 Deep Review (2026-04-28)

**HEAD:** `2e98281`
**No commits made.**

## Inventory and method

Reviewed the repository surfaces most likely to drift out of sync with docs or repo rules:

- Top-level docs and operating instructions: `README.md`, `CLAUDE.md`, `AGENTS.md`
- App docs and env examples: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`
- Deployment scripts/config: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`
- Build/runtime guards and supporting code: `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/{content-security-policy,request-origin,rate-limit,process-image,image-queue,db-restore,mysql-cli-ssl}.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`
- API/auth/readiness surfaces and tests: `apps/web/src/app/api/{live,health,admin/db/download}/route.ts`, `apps/web/src/app/actions/{auth,settings,seo}.ts`, selected tests under `apps/web/src/__tests__/`, and Playwright surfaces in `apps/web/playwright.config.ts` and `apps/web/e2e/**`
- UI-facing copy/i18n: `apps/web/messages/{en,ko}.json`, admin-facing copy in `apps/web/src/app/[locale]/admin/**`, and related tests
- Uncommitted worktree files from `git status`: `.context/reviews/{_aggregate,architect,designer,perf-reviewer,test-engineer,tracer,verifier}.md`, `.gitignore`, `apps/web/playwright.config.ts`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/components/lightbox.tsx`, `apps/web/vitest.config.ts`

Final sweep re-ran targeted checks for `BASE_URL`, `IMAGE_BASE_URL`, `SHARP_CONCURRENCY`, `QUEUE_CONCURRENCY`, `TRUST_PROXY`, `E2E_ADMIN_PASSWORD`, `/api/live`, `/api/health`, and the touch-target audit language, then rechecked the deployment/build guards and Playwright helper code against the docs.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| DS-01 | MEDIUM | High | Confirmed | Root/app README overstate production base-URL validation: the build guard only rejects placeholder `site-config.json.url` when `BASE_URL` is unset, so a bad `BASE_URL` still passes. |
| DS-02 | LOW | High | Confirmed | `.env.local.example` implies `SHARP_CONCURRENCY` is a direct override, but runtime caps it to `cpuCount - 1`, so the example should say it is an upper bound. |

## Detailed findings

### DS-01 — Root/app README overstate production base-URL validation

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:** `README.md:142-143`, `apps/web/README.md:36-38`, `apps/web/scripts/ensure-site-config.mjs:12-39`
- **Why this is a problem:** The docs say production builds require a real absolute public URL and that placeholder examples are rejected. The build guard does reject the checked-in placeholder `site-config.json.url` when `BASE_URL` is absent, but it does **not** validate `BASE_URL` itself when that env var is present.
- **Concrete failure scenario:** A deployer sets `BASE_URL=https://example.com` or even `BASE_URL=foo` in production. `ensure-site-config.mjs` exits 0, so the build proceeds despite the docs claiming placeholder or non-absolute URLs are rejected. The app can then ship with broken canonical/OG URLs and misleading metadata rather than failing fast.
- **Suggested fix:** Tighten the docs to say the guard only validates the file-backed fallback when `BASE_URL` is unset, or tighten the script so it validates any provided `BASE_URL` before build. If you keep the current code, the docs should explicitly call out that `BASE_URL` itself is trusted as-is.

### DS-02 — `SHARP_CONCURRENCY` example reads like a direct override, but runtime caps it

- **Status:** Confirmed
- **Severity:** LOW
- **Confidence:** High
- **Files/regions:** `apps/web/.env.local.example:32-34`, `apps/web/src/lib/process-image.ts:17-26`
- **Why this is a problem:** The env example says `SHARP_CONCURRENCY=10` "override[s] Sharp thread pool size", but the implementation takes `Math.min(envConcurrency, maxConcurrency)` where `maxConcurrency` is `cpuCount - 1`. The env var is therefore only an upper bound, not a direct setting.
- **Concrete failure scenario:** On a 4-core host, an operator copies the example and expects 10 Sharp workers. The process actually runs with 3 workers, so they may misread the example as ignored or assume the runtime has a separate bug.
- **Suggested fix:** Reword the example to something like "Upper bound for Sharp thread pool size; runtime caps at CPU parallelism minus one." That keeps the example honest without changing behavior.

## Final sweep

Rechecked the remaining likely drift surfaces after the two findings:

- `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, and `apps/web/docker-compose.yml` still match the deployment instructions.
- `apps/web/messages/en.json` / `apps/web/messages/ko.json` and the admin-facing copy inspected for this cycle did not expose any new doc/code mismatch.
- The modified `apps/web/playwright.config.ts`, `apps/web/src/__tests__/touch-target-audit.test.ts`, `apps/web/src/components/lightbox.tsx`, and `apps/web/vitest.config.ts` stayed consistent with the surrounding comments and tests.

No additional high-confidence documentation/code mismatches surfaced in the final sweep.
