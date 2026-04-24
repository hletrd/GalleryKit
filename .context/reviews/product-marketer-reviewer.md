# Product Marketer Reviewer Deep Review — Cycle 2 Recovery (2026-04-24)

## Inventory and method

Agent-tool fan-out was attempted in one batch and retried once, but this session was already at the platform child-agent limit (`agent thread limit reached (max 6)`). Per Prompt 1 recovery rules, this compatibility lane completed the review directly and wrote this per-agent file rather than discarding partial review work. Earlier partial files for `document-specialist`, `perf-reviewer`, `product-marketer-reviewer`, and `tracer` were preserved under `.context/reviews/recovery-cycle2-partials/` before replacement.

Review-relevant inventory was built from `git ls-files` and focused on tracked source, tests, scripts, docs, deploy config, i18n messages, and active plan/context artifacts. Dependency/build/runtime artifacts (`node_modules`, `.next`, binary screenshots/fixtures, `test-results`, tsbuildinfo) were excluded. Key surfaces inspected for this lane included:

- Server actions and auth: `apps/web/src/app/actions/{auth,images,settings,sharing,topics,tags,admin-users,seo,public}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/{action-guards,rate-limit,auth-rate-limit,restore-maintenance,revalidation}.ts`.
- Data/schema/cache: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, public page routes under `apps/web/src/app/[locale]/(public)/**`.
- Upload/processing/config: `apps/web/src/lib/{image-queue,process-image,upload-limits,upload-paths,gallery-config,gallery-config-shared}.ts`, settings UI/messages.
- Tests/gates: Vitest tests under `apps/web/src/__tests__/`, Playwright tests under `apps/web/e2e/`, custom lint scripts, package scripts.
- Docs/deploy: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, `.env.local.example`, Docker/nginx/deploy files.

Final sweep: re-ran targeted `rg` sweeps for `share_key`, `sharedGroupImages`, `revalidateLocalizedPaths`, `checkRateLimit`, `incrementRateLimit`, `DB_SSL`, `--ssl-mode`, `image_sizes`, and setup/init documentation, then checked each finding against current source before recording it.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| AGG2C2-05 | MEDIUM | High | Confirmed | Quick-start docs run DB init before required environment setup |

## Detailed findings

### AGG2C2-05 — Quick-start docs run DB init before required environment setup

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:** `README.md:87-115`, `apps/web/README.md:7-14`, `apps/web/scripts/init-db.ts:14-30`, `apps/web/scripts/mysql-connection-options.js:3-22`, `apps/web/.env.local.example:1-29`.
- **Why this is a problem:** Both root and app quick-start flows list `npm run init` before telling users to copy/edit `.env.local`, but init/migration require DB credentials and bootstrap admin/session configuration.
- **Failure scenario:** A fresh evaluator follows the quick start literally; `npm run init` fails with missing DB env before the docs explain where to set it, creating a broken first-run path.
- **Suggested fix:** Reorder quick-start instructions so MySQL/env/site-config setup comes before `npm run init`, and list the login/upload smoke check after init/dev.

## Final missed-issue sweep

Rechecked the inventory and targeted sweeps listed above after drafting findings. No relevant tracked source/config/doc/test file in this lane was intentionally skipped beyond generated/dependency/binary artifacts.
