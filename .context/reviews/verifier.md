# Verifier Review - Cycle 25

Role: cycle-25 verifier
Workspace: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30
Instruction constraints: read `AGENTS.md` and `CLAUDE.md`; do not commit or push; write this report to `.context/reviews/verifier.md`.

## Scope And File Inventory

I reviewed the current workspace for correctness drift between stated behavior and actual support in docs, scripts, tests, and source. I built the inventory first with `rg --files`; current tracked inventory is 801 files. I then inspected the high-risk support surfaces rather than sampling randomly:

- Workspace rules/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Package/script contract: `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`, `.nvmrc`.
- Deploy/runtime: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `.env.deploy.example`, `apps/web/.env.local.example`.
- Migration/schema: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`.
- Security/privacy gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- Semantic-search and CLIP support: `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`.
- Contract tests inspected or executed: migration journal/reconcile, privacy fields, settings hash, semantic routes/config, deploy script, site-config guard, and the three security lint scanners.

## Confirmed Findings

### 1. Medium - Production semantic-search/live-demo claims are operational assertions with no repo-backed verification

Severity: Medium
Confidence: High
Exact regions: `AGENTS.md:49`, `CLAUDE.md:159`, `README.md:42`, `apps/web/README.md:73-80`, `apps/web/.env.local.example:75-84`, `apps/web/docker-compose.yml:18-23`, `apps/web/Dockerfile:98-102`, `apps/web/src/lib/gallery-config.ts:123-141`

Finding: The docs state that CLIP semantic search is "live in production", that the production deployment runs `semantic_search_mode=production` with `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and that it has "~445" real embeddings. The repository only proves the code path and operator gate. It does not prove current production state, model-weight presence, DB setting, or embedding count. The shipped/default configuration keeps production disabled: `.env.local.example` only comments the opt-in, compose merely loads `.env.local`, Docker only sets `CLIP_MODELS_ROOT`, and `gallery-config.ts` heals stored `production` back to `disabled` unless the env flag is set.

Concrete failure scenario: An operator or future verifier trusts `CLAUDE.md:159` during an incident and assumes natural-language/similar search is active with real embeddings. The repo can still build, test, and deploy with semantic search disabled, missing weights, or an empty production embedding table. The route then returns 503 (`semantic_not_configured` or `semantic_no_embeddings`) despite docs saying the production deployment is active.

Suggested fix: Rephrase the "live in production" and "~445 embeddings" statements as a dated operational note, or add a repo-backed verification command/script such as `npm run verify:semantic-production` that checks env opt-in, DB `admin_settings.semantic_search_mode`, model-weight manifest, and `image_embeddings` count for `PRODUCTION_MODEL_VERSION`. Link that command from the docs and make the docs say "verified by ..." instead of carrying an untestable static production claim.

Supporting evidence:

- Code gate exists and is tested: `gallery-config.ts:123-141` resolves `production` only when `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`; `gallery-config.test.ts` covers both healing and opt-in pass-through.
- Route behavior exists and is tested: semantic route requires `production` rows before serving production results; similar route is production-only.
- Missing support: no tracked deploy config sets `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, no repo test or CI job probes the live demo, and no source-backed check verifies the claimed "~445" row count.

## No Finding After Inspection

The following claims had code/test support or explicit scope limits:

- Deploy pruning/data safety: `apps/web/deploy.sh:32-59`, compose bind mounts at `apps/web/docker-compose.yml:24-28`, and `deploy-script-contract.test.ts` cover prune-after-up, no `docker volume prune -a`, narrow mutable public mounts, config-driven deploy helper, and build-arg forwarding.
- Migration runbook: `migrate.js:731-807` baselines per journal hash and throws on missing hashes; migration tests cover monotonicity, journal tag/file presence, reconcile table/column/index mirrors, and known drop mirrors.
- Privacy field separation: `data.ts` public/admin select split, `search-enrichment-fields.ts:29-46`, and `privacy-fields.test.ts` cover the symmetric sensitive-key contract.
- Security lint gates: scanner scripts match the documented scope, CI runs them, and local execution passed.
- Semantic route gates: same-origin checks, per-IP pre-increment rate limiting, model-version filtering, disabled/stub/production behavior, and client UI gating all have source and test support.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Targeted tests passed: `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/settings-hash.test.ts src/__tests__/migration-journal.test.ts src/__tests__/migration-journal-monotonicity.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/gallery-config.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/ensure-site-config.test.ts` returned 10 test files passed, 157 tests passed.

I did not run the full Vitest suite, Playwright suite, build, typecheck, or a live deploy; the review target was evidence-based doc/source/test correctness, and the targeted gates above directly covered the inspected invariants.

## Final Missed-Issue Sweep

Final sweep searches covered unverified terms and brittle claims across `AGENTS.md`, `CLAUDE.md`, both READMEs, source, scripts, Docker/compose/nginx config, and tests: `live in production`, `~445`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `guarantee`, `MUST`, `blocking in CI`, `no role`, `Storage Backend`, `Stripe/payment`, `Lightroom Classic plugin`, deployment prune, and migration-skip terms.

No critical or high-severity mismatch was found. The one confirmed issue is documentation/operations drift: repo tests prove the semantic-search implementation contract, but not the live-production state claimed by the docs.
