# Cycle 24 Document-Specialist Review

Role: `document-specialist`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `4b43fad7` (`origin/master` at review time)
Scope: documentation-vs-code review only. No source code edits, destructive commands, production deploys, or live-host changes.

## Inventory

Authoritative docs/runbooks/configs inventoried first:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `apps/web/README.md`
- `.context/plans/README.md`
- `.context/plans/deferred-carry-forward.md`
- active/recent run-10 plan and deferred ledgers, especially `cycle-23-2026-07-08-*`
- root/app `package.json`
- `.github/workflows/quality.yml`, `.github/workflows/clip-preflight.yml`, `.github/dependabot.yml`
- `.env.deploy.example`, `scripts/deploy-remote.sh`
- `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`
- `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`
- contract-heavy code comments in upload, migration, deploy, semantic-search, color/HDR, rate-limit, PWA, and test-enforcement areas

Source validation surfaces included package scripts, CI gates, deploy helpers, Docker/Compose/nginx, migration reconcile/baseline code, app routes/actions, public/admin lint scanners, privacy/touch-target tests, semantic search gates, site-config validation, CLIP scripts, upload limits, and current review/plan ledgers.

## Confirmed Findings

### DOC-C24-01 - Current-cycle ledger still points agents at Cycle 23 while Cycle 24 review work is already on `master`

Severity: Medium
Confidence: High
Status: confirmed docs/provenance mismatch

Evidence:

- `.context/plans/README.md:34-37` still marks Run-10 Cycle 23 plan/deferred as the active current-cycle pair.
- `.context/plans/cycle-23-2026-07-08-plan.md:3` says `PUSH/DEPLOY PENDING`, and lines `190` and `206` repeat that signed commit/push and per-cycle deploy are pending.
- Git history at review time has `0f3e48e0 fix(cycle23): 🐛 harden restore and review findings` on `origin/master`, followed by `4b43fad7 docs(review): 📝 record Cycle 24 perf risks`.
- No current dated Cycle 24 plan/deferred pair exists under `.context/plans/`; only historical Cycle 24 artifacts are archived, and `.omx/context/review-plan-fix-cycle24-20260630T044942Z.md` is an older lineage snapshot.

Why this is a problem:

The plans index is the handoff surface agents are told to trust for active/current work. It now conflicts with both current workflow context and git history.

Failure scenario:

A Cycle 24 planner or verifier follows `.context/plans/README.md`, reopens Cycle 23 as active, treats Cycle 23 push as pending despite a pushed fix commit, or imports Cycle 23 deferred state instead of aggregating fresh Cycle 24 findings.

Suggested fix:

Update `.context/plans/README.md` when Cycle 24 planning begins: move Cycle 23 to recently completed with terminal commit/push/deploy evidence, and create/list the Cycle 24 plan/deferred pair or explicitly state that Cycle 24 is still in review fan-out with no plan pair yet. Also update `cycle-23-2026-07-08-plan.md` terminal status with exact commit and deploy/supersession evidence.

### DOC-C24-02 - `admin-backfill-runner.ts` still says clamp-down is silent even though the runner now logs a warning

Severity: Low
Confidence: High
Status: confirmed stale code-comment wording

Evidence:

- `apps/web/src/lib/admin-backfill-runner.ts:126-128` says operators who raise `ADMIN_BACKFILL_CONCURRENCY` above the cap are "silently clamped DOWN".
- The same file's top-level contract already says "a warning is logged" at `apps/web/src/lib/admin-backfill-runner.ts:38-39`.
- Runtime code logs that warning at `apps/web/src/lib/admin-backfill-runner.ts:721-724`.
- `CLAUDE.md:375` also documents clamp-down "with a warning log."

Why this is a problem:

The stale lower comment contradicts both the runbook and executable behavior. This is minor, but it is in the arithmetic contract future maintainers are likely to read before changing concurrency behavior.

Failure scenario:

A maintainer trying to reconcile docs may believe the clamp is intentionally silent and remove or ignore the runtime warning, weakening operator visibility when an attempted backfill-concurrency increase has no effect.

Suggested fix:

Change `silently clamped DOWN` to `clamped DOWN with a warning` at `apps/web/src/lib/admin-backfill-runner.ts:126-128`.

## Likely Issues

No additional likely documentation-vs-code issues were strong enough to record as findings. Several broad operator risks remain intentionally documented and deferred rather than stale: live nginx application, exact proxy topology, single-instance/process-local state, DB-only backup/restore, source-contract-heavy tests, public search scale, and semantic vector-index limitations.

## Manual-Validation Risks Checked

- Live deploy/nginx state was not validated; this lane stayed local and non-destructive. The docs correctly mark host nginx as operator-applied rather than automatically changed by deploy (`CLAUDE.md:511-523`, `apps/web/nginx/default.conf:290-293`).
- Production semantic search activation was not validated on the host. Repo docs correctly say fresh installs default disabled and production requires weights, env opt-in, DB mode, and production embeddings.
- Production backup confidentiality and full filesystem rollback were not validated. Docs correctly state SQL backups are plaintext and DB-only.

## Aligned Claims Verified

- Quality gates documented in `AGENTS.md:31-38` and `CLAUDE.md:670-702` map to root/app package scripts and `.github/workflows/quality.yml:54-83`.
- Deploy-helper docs match `scripts/deploy-remote.sh`: root `.env.deploy` preferred, fallback to `$HOME/.gallerykit-secrets/gallery-deploy.env`, `DEPLOY_ENV_FILE` override, permission refusal, derived SSH command.
- Docker deploy docs match `apps/web/deploy.sh`: `git pull --ff-only`, env/site-config checks, Compose build, `/api/live` health wait, then container/image/builder/volume prune without `volume -a`.
- Site-config docs match `apps/web/scripts/ensure-site-config.mjs` and JSON imports: production builds fail on missing/placeholder base URL, and static JSON fields require rebuild.
- Migration docs match `apps/web/scripts/migrate.js`: non-monotonic journal handling, per-entry baselining, post-condition hash assertion, DML-baseline guard, and `reconcileLegacySchema` mirrors through `0030_pending_file_deletions`.
- Upload API docs match the PAT route shape, route file, nginx 216 MiB override, default app upload caps, and admin-token scope model.
- Semantic-search docs match code gates: default disabled, admin UI cannot directly authorize production without env opt-in, production uses `jina-clip-v2-d512-q8`, bounded newest-first scans, and 503 when production embeddings are absent.
- PWA docs are appropriately scoped: installable/offline fallback plus same-origin visited-image caching, not full offline gallery sync.
- Product-boundary docs are aligned: no editing/culling/scoring/payment surface; Stripe/paid downloads are removed and guarded in docs/schema history.

## Final Sweep

Examined file categories: root/app markdown docs, `.context/plans` active/current ledgers, current review aggregate/history, GitHub workflow configs, root/app package scripts, deploy env example/helper, Docker/Compose/nginx/deploy scripts, migration SQL/journal/reconcile code, route/action lint scanners, typecheck/test configs, high-contract code comments, public API routes, semantic search code, site config, upload limits, privacy guards, touch-target audit, CLIP scripts, and major app route directories.

Common missed issues checked: stale active plan pointers, old cycle-name collisions, nonexistent referenced docs, package-script drift, CI-vs-doc gate mismatch, deploy runbook drift, destructive/manual host steps being overstated as automatic, migration journal/reconcile drift, unsupported feature claims, admin-only/privacy-field omissions in docs, semantic-search production honesty, PWA overclaiming, upload size/proxy cap mismatch, and code comments contradicting runbooks.
