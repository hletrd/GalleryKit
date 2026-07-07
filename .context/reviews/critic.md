# Cycle 14 Critic + Document-Specialist Review

Date: 2026-07-07
Reviewer: critic + document-specialist
Mode: PROMPT 1, read-only review except this report.

## Inventory And Coverage

Inventory was built before finding selection.

- Working tree inventory excluding dependency/build outputs (`.git`, `node_modules`, `.next`, coverage, Playwright reports): 7,658 files.
- Tracked repository inventory: 3,443 files.
- Review-relevant tracked inventory: 3,216 files across root docs, `CLAUDE.md`, `AGENTS.md`, `.context`, `docs`, `package*.json`, `.github/workflows`, `apps/web` source/tests/scripts/e2e/messages/nginx/Docker/deploy/drizzle, and root scripts.
- Text/code surface counted for review: about 382,738 lines across tracked Markdown, JSON, TS/TSX/JS/MJS/CJS, SQL, CSS, shell, YAML, and nginx/conf files.
- Generated/dependency/build outputs were excluded. Historical `.context` review/plan files were inventoried and searched/read where they still influence current planning, provenance, or operator docs; current indexes, active plans, aggregate reports, and deferred registers were read directly.

Primary files and surfaces examined:

- Root docs and project contract: `README.md`, `CLAUDE.md`, `AGENTS.md`, `package.json`, `package-lock.json`.
- App docs/config: `apps/web/README.md`, `apps/web/package.json`, `apps/web/.env.local.example`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Planning/review corpus: `.context/plans/README.md`, active/current-cycle plan and deferred files, `.context/reviews/_aggregate.md`, existing per-lane review reports.
- CI/deploy/ops scripts: `.github/workflows/quality.yml`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `scripts/check-proxy-topology.mjs`, `apps/web/scripts/*` relevant to migrations, E2E, CLIP, auth/origin/rate-limit checks, and DB maintenance.
- Source behavior: public/admin routes and actions, rate limiting/client IP extraction, upload path handling, semantic/similar search, map page, queue/backfill/restore paths, migration runner, site config, i18n layout, service worker, and tests that encode these contracts.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Full lint/typecheck/build/unit/e2e/deploy were not run because this prompt is review-only and the requested output is the report.

## Confirmed Findings

### C14-CRITDOC-01 - Cycle 14 plan/deferred provenance points at a Cycle 13 aggregate and the plan index points at Cycle 13

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region:
  - `.context/plans/cycle-14-2026-06-30-plan.md:1-9`
  - `.context/plans/cycle-14-2026-06-30-plan.md:15-35`
  - `.context/plans/cycle-14-2026-06-30-plan.md:41-57`
  - `.context/plans/cycle-14-2026-06-30-deferred.md:1-9`
  - `.context/plans/cycle-14-2026-06-30-deferred.md:13-253`
  - `.context/reviews/_aggregate.md:1-34`
  - `.context/plans/README.md:34-38`
- Problem: The Cycle 14 implementation plan says its source is `.context/reviews/_aggregate.md` plus Cycle 14 per-agent reports, but the checked-in `_aggregate.md` is titled `Cycle 13 Aggregate Review` and contains `C13-AGG-*` findings. The Cycle 14 plan and deferred register cite many `AGG-C14-*` IDs that are not present in the active aggregate. The plan header says `Status: TODO`, while every scheduled row is marked `DONE`, and the verification/commit/deploy sections still read like a future Prompt 3 implementation plan. The plans index still lists Run-10 Cycle 13 plan/deferred files as the active current-cycle ledgers.
- Concrete failure scenario: A future agent following the documented current-cycle pointers can start from the Cycle 13 aggregate while trying to operate on Cycle 14, or treat all Cycle 14 scheduled work as already done without a traceable Cycle 14 aggregate. That breaks review provenance: an `AGG-C14-*` finding cannot be resolved back to the canonical active aggregate, and plan status can be interpreted both as pending and complete.
- Suggested fix: Update the planning docs as one provenance unit. Either publish/update the Cycle 14 aggregate at the path referenced by the Cycle 14 plan/deferred files, or repoint those files to the actual Cycle 14 aggregate artifact. Update `.context/plans/README.md` so the active current-cycle plan/deferred pair matches the newest cycle. Make each plan's status coherent with its row statuses and remove future Prompt 3/deploy wording from a completed ledger. Add a lightweight freshness check that fails when a plan cycle, aggregate title, and cited aggregate ID prefix disagree.

### C14-CRITDOC-02 - Nginx multi-hop proxy comments still recommend the opposite of the tested/documented contract

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region:
  - `apps/web/nginx/default.conf:20-28`
  - `apps/web/nginx/default.conf:59-71`
  - `apps/web/nginx/default.conf:100-112`
  - `README.md:168-174`
  - `apps/web/README.md:50-58`
  - `apps/web/.env.local.example:60-70`
  - `CLAUDE.md:97-98`
  - `apps/web/src/__tests__/nginx-config.test.ts:33-44`
  - `apps/web/src/lib/rate-limit.ts:175-198`
- Problem: The live nginx template comments still tell operators that, in an upstream-LB topology, they `MUST` switch `X-Forwarded-For` from `$remote_addr` to `$proxy_add_x_forwarded_for` and set `TRUSTED_PROXY_HOPS` to the real hop count. The root README, app README, env example, CLAUDE env table, and nginx config tests all define the supported shipped contract differently: nginx overwrites incoming XFF with `$remote_addr`, operators keep `TRUSTED_PROXY_HOPS=1`, and any outer trusted edge must be normalized with nginx `real_ip` before headers are forwarded to the app. The test suite explicitly rejects `$proxy_add_x_forwarded_for` in the committed template.
- Code-validated behavior: `getClientIp()` selects the address immediately before the trusted suffix in XFF. With a naive append topology like `client, lb` and `TRUSTED_PROXY_HOPS=2`, `clientIndex` becomes negative, so the function falls back to `X-Real-IP`. The nginx template also sets `X-Real-IP $remote_addr`, which is the LB address in this topology. App-layer per-IP budgets therefore collapse to the LB instead of the real client.
- Concrete failure scenario: An operator copies the nginx comment for `client -> LB -> nginx -> app`, changes all locations to `$proxy_add_x_forwarded_for`, and sets `TRUSTED_PROXY_HOPS=2`. Login/search/share budgets can then be keyed to the LB for all users; legitimate traffic can be throttled globally, and operational debugging will be confusing because the READMEs and tests say the opposite contract was intended.
- Suggested fix: Align `apps/web/nginx/default.conf` comments with the supported and tested contract: use `real_ip` or PROXY protocol at nginx to normalize `$remote_addr`, keep overwriting XFF to the app, and keep `TRUSTED_PROXY_HOPS=1` for the shipped nginx-app hop. If append-mode support is desired instead, change the config, READMEs, env example, tests, proxy checker, and `TRUSTED_PROXY_HOPS` examples together with concrete before/after header-chain examples.

## Likely Issues

No likely-but-unconfirmed issue was strong enough to promote beyond the confirmed findings above. The review found several risks that need production data or operator validation, listed below.

## Risks Needing Manual Validation

These are not filed as fresh confirmed findings in this report because they are already documented as deferred/manual-validation risks or require production-scale evidence.

1. Public map scale and accessibility remain production-data dependent.
   - Current code still returns up to `MAP_MAX_MARKERS = 10000` rows and renders every marker and list entry on one page (`apps/web/src/lib/data.ts:1741-1791`, `apps/web/src/app/[locale]/(public)/map/page.tsx:50-110`, `apps/web/src/components/map/map-client.tsx:98-140`).
   - Existing deferred coverage: `.context/plans/cycle-14-2026-06-30-deferred.md:13-27`.
   - Manual validation needed: browser trace and screen-reader/keyboard review with production-sized GPS-visible galleries before clustering, viewport fetching, or accessible-list redesign.

2. Production Docker and host-nginx path remain separate from the main quality workflow.
   - The quality workflow runs source lint/typecheck/security gates/unit tests/E2E/build (`.github/workflows/quality.yml:54-83`) but does not build the production Docker image or apply/reload host nginx.
   - The deployed shape is defined by `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, and `apps/web/nginx/default.conf`; `CLAUDE.md:247` states host nginx reloads are operator-owned and not part of normal container deploys.
   - Manual validation needed: periodic Docker build smoke and host nginx `nginx -t`/reload proof in the operator environment, especially after dependency or nginx-template changes.

3. Real CLIP/offline model behavior is intentionally gated outside default CI.
   - Real semantic ranking only runs with `CLIP_INTEGRATION=1` (`apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`).
   - Offline seeded-weight loading only runs with `CLIP_OFFLINE_LOAD=1` and a seeded `CLIP_MODELS_ROOT` (`apps/web/src/__tests__/clip-offline-load.test.ts:15-41`).
   - Manual validation needed: run the gated CLIP suites before CLIP dependency/model upgrades or production semantic-search activation changes.

4. Trusted-proxy and single-instance assumptions need live topology validation.
   - Compose forces `HOSTNAME: 127.0.0.1` and `TRUST_PROXY: "true"` (`apps/web/docker-compose.yml:20-22`).
   - CLAUDE documents the shipped deployment as single web-instance/single-writer with process-local coordination and warns not to horizontally scale without shared stores (`CLAUDE.md:244-247`).
   - Manual validation needed: verify the live proxy chain, source IP preservation, and instance count before adding an outer LB/CDN, blue-green deployment, multiple web processes, or alternate proxy.

5. Archived `.context` files can still mislead agents if linked as active guidance.
   - The plans index says the newest plan/deferred pair and latest review aggregate are the authoritative state (`.context/plans/README.md:1-12`), but the active-current pointers are stale as described in C14-CRITDOC-01.
   - Manual validation needed: whenever historical `.context/**` artifacts are referenced by a new plan, confirm the cycle number, aggregate title, and cited IDs before treating them as current instructions.

## Final Sweep Notes

- The prior Cycle 13 E2E `BASE_URL` concern appears fixed in current code: Playwright defaults to a local URL and the E2E server child sets runtime `BASE_URL` to the localhost server (`apps/web/playwright.config.ts:15-30`, `apps/web/scripts/run-e2e-server.mjs:90-112`).
- The proxy topology checker now sends JSON and uses allowlisted status classification, so the old "never reaches IP/rate-limit code" checker issue was not refiled (`scripts/check-proxy-topology.mjs` was inspected).
- Previously scheduled Cycle 14 fixes for original upload path containment, similar-photo processed-image filtering, invalid share-key prevalidation, and DB child-process timeout handling were spot-checked against source behavior and not refiled.
- Route/action guardrails passed the three lightweight policy scripts listed above, so no fresh admin API auth, same-origin action, or public mutating/expensive route rate-limit finding is filed here.
- Commonly missed surfaces swept: raw SQL usage, dangerous HTML injection sites, spawn/exec/unlink paths, route exports, exemption comments, migration journal shape, Docker/compose/nginx deploy contracts, CLIP model activation paths, map/GPS exposure, public share keys, and `.context` plan/review provenance.
