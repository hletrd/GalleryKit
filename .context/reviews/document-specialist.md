# Cycle 26 Document Specialist Review

Reviewer: cycle-26 document-specialist
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `d13d66377e6952ae974a6ee3d29ce52f0aa77640` on `master`
Scope: documentation/code mismatch review against authoritative repo docs, scripts, deployment, migrations, runtime env docs, and `docs/superpowers`.

## Inventory First

I read `AGENTS.md` and `CLAUDE.md` first, then built a fresh file inventory before reviewing.

Inventory evidence:

- Git-tracked files: 2588 total.
- Raw workspace files excluding `.git`, `node_modules`, `apps/web/.next`, `dist`, and `coverage`: 6743 total.
- Primary docs reviewed: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.env.deploy.example`, `apps/web/.env.local.example`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, and `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`.
- Source anchors checked: root/app `package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, CLIP model/path/backfill scripts, semantic/similar search routes, env/upload-limit helpers, and migration tests.
- `git status --short`, `git diff --stat`, and `git diff --name-only` produced no pre-existing unstaged change output before this report rewrite.

## Findings

### C26-DOC-01 - `docs/superpowers` conflicts with current semantic-search activation contract

Severity: Medium
Confidence: High
Region: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:17`, `CLAUDE.md:159`, `CLAUDE.md:541-545`, `README.md:42`, `apps/web/README.md:71-78`

Failure scenario:

The superpowers spec states semantic search is "SHIPPED & ACTIVATED in production" and currently serving live English/Korean and similar-photo results over a concrete embedding count. The plan repeats that the feature is activated live. Current authoritative docs now describe the safer contract: semantic search is disabled by default, production serving requires `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, a DB row, seeded weights, and real embeddings, and `CLAUDE.md` explicitly says the repo proves code gates/runbooks, not current live production row count. An operator or agent following the superpowers file can skip the required host verification or misdiagnose a correctly disabled fresh install as broken.

Concrete fix:

Update the superpowers spec/status banner to say it is a historical implementation record, not live-state authority. Replace the row-count/current-activation claim with "was activated on the demo deployment on 2026-06-15; verify the target host before assuming production mode is active." Add direct links to `CLAUDE.md` "CLIP semantic search - seeding model weights on the deploy host" and `apps/web/README.md` "Going live" for current operator steps. Keep the model/version/threshold implementation facts.

## No-New-Findings Evidence

No other active doc/code mismatch rose to reportable confidence.

Verified areas:

- README/package scripts: root and app scripts align with documented `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, and custom lint gates.
- Deployment docs: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, compose, Dockerfile, and nginx agree on config-driven deploy, localhost host-network app, `/api/live` liveness, body-size caps, and post-health Docker pruning.
- Migration docs: `AGENTS.md` and `CLAUDE.md` migration instructions align with `_journal.json`, migration monotonicity tests, `migrate.js` hash postcondition, and `reconcileLegacySchema` expectations.
- Runtime env docs: DB TLS, proxy trust, health DB readiness opt-in, upload limits, server action body size, CLIP model root, CLIP queue limits, and semantic scan/top-k limits are represented in docs and env examples.
- Feature boundaries: docs correctly keep storage backend as local-only, payment/Stripe as removed, Lightroom/PAT upload as an API contract rather than bundled plugin, and editing/culling/scoring as out of scope.

## Final Missed-Issues Sweep

Final targeted sweep terms: `S3`, `MinIO`, `Stripe`, `payment`, `paid`, `Lightroom`, `plugin`, `vector index`, `semantic`, `production`, `disabled`, `stub`, `CLIP`, `tsx@`, `TypeScript`, `Next.js`, `React`, `Node.js`, `health`, `live`, `TRUST_PROXY`, `DB_SSL`, `UPLOAD_MAX`, `NEXT_UPLOAD`, `bodySizeLimit`, `serverActions`, `public/resources`, `uploads/original`, `site-config`, `deploy`, `docker`, `prune`, migration `when`, and `reconcileLegacySchema`.

Validation note: this was a documentation review. I did not run the full app test suite because no application code was changed.
