# Run-10 Cycle 36 Document-Specialist Review

Date: 2026-07-08 KST
Role: cycle-36 document-specialist review worker
Workspace: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `c62c8c1e` on `master` / `origin/master`
Mode: documentation/provenance review only; no production-code edits

## Inventory

Required authority read first: `AGENTS.md`, `CLAUDE.md`, and the code-review skill instructions.

Documentation/source contract surfaces reviewed:

- Current docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`.
- Provenance docs: `.context/reviews/_aggregate.md`, root `.context/reviews/*.md`, `.context/plans/README.md`, `.context/plans/run10-cycle35/{plan,deferred}.md`.
- Config/deploy docs against source: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `.github/workflows/*`.
- Schema/privacy docs against source/tests: `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`.
- Product-boundary docs: no edit/culling/scoring, local-only storage, no bundled LR client plugin, semantic search operator activation, checked-in site config behavior, service-worker offline limits, and public edge/proxy contracts.

## Findings

### DOC-C36-01 - Cycle 35 plan status still says push/deploy are pending after the signed push landed

- Classification: confirmed documentation/provenance mismatch
- Severity: Medium
- Confidence: High
- Region: `.context/plans/run10-cycle35/plan.md:1-3`; `.context/plans/run10-cycle35/plan.md:154-162`; `.context/plans/README.md:34-38`; git evidence from `c62c8c1e`
- Failure scenario: `origin/master` is already at signed commit `c62c8c1e` (`git show --show-signature` reports good signature), but the cycle-35 plan still says `Status: IMPLEMENTED - gates/deploy pending` and leaves `Signed commit pushed` unchecked. The same file records full gates as green. A follow-on planner can misread the active ledger as pre-push and either duplicate release work or fail to distinguish "push complete, deploy evidence absent" from "nothing after implementation completed."
- Suggested fix: update the Cycle 35 plan status/checklist to the precise state, for example "implemented, signed push complete, deploy evidence absent/pending" unless deploy evidence is added. If a deploy was run outside committed logs, add the terminal deploy/live-smoke evidence; otherwise leave only the deploy checkbox open and move signed push to completed.

### DOC-C36-02 - Checked-in deployment-specific site config can become fresh-install production metadata

- Classification: risk
- Severity: Medium
- Confidence: High
- Region: `README.md:31`; `README.md:60-77`; `README.md:171-172`; `apps/web/src/site-config.json:1-10`; `apps/web/scripts/ensure-site-config.mjs:11-42`
- Failure scenario: the README says the linked Atik deployment may have deployment-specific branding and then documents generic fresh-install config values. The tracked `apps/web/src/site-config.json` is not generic; it contains `Atik Gallery` and `https://gallery.atik.kr`. `ensure-site-config.mjs` rejects empty, malformed, or placeholder production URLs, but it accepts the checked-in Atik URL. A self-hosting operator who clones and runs a production build without setting `BASE_URL` or replacing `site-config.json` ships Atik canonical metadata, OpenGraph fallback, footer/nav branding, and any file-backed non-DB-overridable fields into their image.
- Suggested fix: either track only `site-config.example.json` and require an explicit local `site-config.json`, or make production builds reject the known deployment-specific Atik config unless an explicit override such as `ALLOW_DEPLOYMENT_SITE_CONFIG=true` is present. At minimum, add a prominent README/`ensure-site-config` warning that the tracked file is for the example deployment and must be replaced for distribution.

## Aligned Areas Checked

- Current package/version docs align with local manifests: Node 24 via `.nvmrc`, Next 16, React 19, TypeScript 6, MySQL 8.0+.
- The previous C35 public-nginx-limiter mismatch is fixed: `CLAUDE.md:248` and `apps/web/nginx/default.conf:274-295` now describe the public catch-all as covering public non-admin API routes without longer locations.
- Deploy docs align with helper scripts for root `.env.deploy` precedence, fallback deploy env path, derived SSH command, remote `git pull --ff-only`, runtime env permission checks, `/api/live` health, and post-health Docker prune.
- Docker persistence/prune docs align with compose and deploy script: persistent data is bind-mounted, host MySQL is outside Docker volumes, and automatic volume prune does not use `-a`.
- Migration docs align with current source: journal/sql pairing, fresh DB reconcile, DML baseline refusal, and post-migrate hash assertion are present.
- Semantic-search activation docs align with code gates: default disabled mode, env-gated production mode, sidecar backfill, offline weights, and model-version honesty are documented.
- Product boundaries align with source for local filesystem storage only, no payment/Stripe surface, no editing/culling/scoring product feature, no bundled Lightroom Classic plugin, and public smart-collection reads without an admin authoring UI.

## Final Missed-Issue Sweep

Swept docs/code mismatch classes: README package badges and manifests, env examples, deploy helper behavior, Docker build args, nginx route comments, quality gate names, CI workflow gates, migration/schema checklist, privacy guard docs, service-worker cache posture, semantic-search runbook, storage/S3 claims, payment/editing claims, PAT upload route docs, and current-cycle provenance.

Skipped or sampled only: historical archive plans/reviews, `.omx`/`.omc` runtime state, binary screenshots, live host nginx, production DB rows, deployed CLIP model directory, and browser/live production smoke. This document lane did not deploy or mutate production state.
