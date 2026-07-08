# Run-10 Cycle 35 Document-Specialist Review

Role: cycle-35 document-specialist subagent
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-07-08 KST
Review HEAD: `7993fa46` on `master`
Scope: documentation-code contract review only. I edited no product code; this file is the only report artifact written.

## Inventory / Scope Reviewed

Required authority read first:

- `AGENTS.md`
- `CLAUDE.md`
- Code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Primary docs and contracts inventoried:

- Live docs: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`
- Runtime/config docs: `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`
- Package and CI contracts: root `package.json`, `apps/web/package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`
- Schema/migration docs and implementation: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`
- Product-boundary surfaces: semantic search, smart collections, PAT upload API, storage abstraction quarantine, payment/Stripe removal notes, no edit/culling/scoring claims
- Current review/provenance docs: root `.context/reviews/*.md`, `.context/reviews/_aggregate.md`, `.context/plans/README.md`

Validation evidence:

- `npm test --workspace=apps/web -- privacy-fields.test.ts` passed: 1 file, 12 tests.
- Route inventory confirmed map/timeline/year, smart collections, admin analytics/tokens/settings, upload fallbacks, OG/search APIs, `/api/live`, and `/api/health` exist.
- Package docs align with current versions: Node 24, Next `^16.2.10`, React `^19.2.5`, TypeScript `^6`.
- Semantic-search gates align with docs: default `semantic_search_mode` is `disabled`, Settings rejects saving `production`, and runtime resolves stored `production` to `disabled` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.

Existing unrelated dirty files observed before writing this report:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/verifier.md`

## Findings

### DOC-C35-01 - nginx public limiter is documented as page-only, but it also catches public API routes

- Severity: Medium
- Confidence: High
- Classification: confirmed documentation/comment mismatch
- Region: `CLAUDE.md:248`; `apps/web/nginx/default.conf:274-295`; public API routes under `apps/web/src/app/api/search/**`, `apps/web/src/app/api/og/**`, `apps/web/src/app/api/health/route.ts`, and `apps/web/src/app/api/live/route.ts`

Current docs say public pages are throttled at the nginx edge and that "static/asset/upload/API locations match longer prefixes and are deliberately excluded." The nginx template has explicit longer matches for admin API, uploads, `_next/static`, and `_next/image`, but no general public `/api/` location. Nginx therefore sends non-admin public API routes through `location /`, where `limit_req zone=public burst=40 nodelay` applies. The in-file comment also says what lands there is page navigation plus same-URL RSC/prefetch requests, which excludes real traffic such as `/api/search/semantic`, `/api/search/similar/[id]`, `/api/og`, `/api/og/photo/[id]`, `/api/health`, and `/api/live`.

Concrete failure scenario:

An operator tunes `zone=public` believing it is a page-navigation limiter only, then unintentionally rate-limits public search, OG card generation, or monitoring endpoints. Conversely, a reviewer may believe public APIs are protected only by app-layer limiters and miss that they are also under the page-zone budget, causing incorrect capacity and abuse-response guidance.

Suggested fix:

Either update `CLAUDE.md` and the `location /` comment to state that this is a catch-all public/non-admin limiter covering public APIs too, or add explicit public API locations with the intended limiter/exemption policy. If public APIs remain in `location /`, rename the prose from "Public SSR page" to "public catch-all" and list the API routes that also inherit the budget.

### DOC-C35-02 - Current review/provenance index still points at Cycle 34 while Cycle 35 root lane reports are active

- Severity: Medium
- Confidence: High
- Classification: confirmed stale provenance/runbook mismatch
- Region: `.context/reviews/_aggregate.md:1-13`; `.context/plans/README.md:34-38`; root lane headers in `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/test-engineer.md`, `.context/reviews/tracer.md`, `.context/reviews/verifier.md`; stale root `.context/reviews/architect.md`

The current aggregate is still titled `Run-10 Cycle 34/100 Aggregate Review` and describes Cycle 34 required lanes. The plans index lists Run-10 Cycle 34 as the active current-cycle plan/deferred pair. At the same time, multiple root lane files now have Cycle 35 headers, while `architect.md` is still Cycle 34. That makes the root review directory a mixed-generation handoff surface.

Concrete failure scenario:

A follow-on planner or aggregator reads root `.context/reviews/*.md` and combines Cycle 35 findings with the Cycle 34 aggregate and stale Cycle 34 architect report. That can duplicate already-scheduled Cycle 34 work, drop a live Cycle 35 lane, or treat Cycle 34 implementation planning as the active control surface for Cycle 35 review results.

Suggested fix:

Create a cycle-scoped Cycle 35 aggregate or root handoff once lanes finish, and update `.context/plans/README.md` so the active review/plan pointer matches the current cycle. Archive or clearly label stale root lane files, or enforce a preflight that rejects mixed `Cycle 34` / `Cycle 35` headers in active root review inputs.

## Aligned Areas Checked

- Deploy docs match `scripts/deploy-remote.sh` and `apps/web/deploy.sh`: root `.env.deploy` precedence, fallback env path, derived SSH command, remote `git pull --ff-only`, health check on `/api/live`, and post-start Docker prune.
- Docker persistence/prune docs match compose and deploy script: mutable data uses bind mounts, MySQL is host-managed, and automatic `docker volume prune` omits `-a`.
- Migration docs match current source: 31 SQL files and journal entries are paired; `migrate.js` uses hash postconditions and reconcile/baseline safeguards; the non-monotonic historical `when` issue is documented.
- Privacy/admin-only field docs match source/tests for the checked schema surface; `avif_10bit` is intentionally public-safe and `privacy-fields.test.ts` passed.
- Semantic-search docs match current code gates and UI posture.
- Product-boundary docs match source for local-only storage support, no bundled Lightroom Classic plugin, no Stripe/payment surface, no edit/culling/scoring features, and smart-collection public read without admin authoring UI.
- Quality-gate docs match package scripts and CI workflow names.

## Final Sweep / Skipped Files

Commonly missed issue classes swept: README/package version drift, env example defaults, deploy helper behavior, Docker pruning safety, nginx route matching, migration/schema checklist, privacy guard comments, semantic-search activation claims, storage/S3 claims, payment/Stripe claims, smart-collection UI claims, PAT upload route docs, service-worker offline claims, and current review/provenance docs.

Skipped or sampled only:

- `.claude/worktrees/**`, `.omc/**`, and `.omx/**` cache/runtime histories were not treated as authoritative live docs.
- Large historical `.context/reviews/archive/**`, `.context/plans/archive/**`, and root `plan/**` histories were sampled for provenance patterns but not exhaustively line-reviewed; current source/tests and live docs were used as authority.
- No live host, deployed nginx, production DB, CLIP model directory, deploy, push, or browser smoke validation was performed in this document-only lane.
