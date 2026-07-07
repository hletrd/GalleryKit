# Cycle 17 Document-Specialist Review - 2026-07-08

Reviewer: document-specialist. Repo: `/Users/hletrd/flash-shared/gallery`. HEAD reviewed: `fc15b235` (`origin/master` matched).

Mode: documentation/code mismatch review only. I did not implement fixes, deploy, modify source/config, inspect gitignored secrets, or change other review-lane reports. Pre-existing dirty review files were left untouched.

## Inventory and Coverage

Documentation-relevant inventory was built first. Authoritative/current surfaces reviewed:

- Governance and operator docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Current plan/review ledgers: `.context/plans/README.md`, `.context/plans/cycle-16-2026-07-08-plan.md`, `.context/plans/cycle-16-2026-07-08-deferred.md`, current `.context/reviews/*.md`, root `plan/**` active/done files.
- Historical docs with current labels checked for contradiction: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, and historical `.context/plans/**` / `.context/reviews/**` where current indexes pointed or keyword sweeps surfaced operator claims.
- Package/env/deploy/config: `package.json`, `package-lock.json`, `apps/web/package.json`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `.github/workflows/*.yml`, `.github/dependabot.yml`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `scripts/check-proxy-topology.mjs`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`.
- Schema/migration runbooks: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/init-db.ts`, migration tests.
- Tests-as-docs/source comments/UI copy: `apps/web/src/__tests__/*.test.ts(x)`, `apps/web/e2e/*.spec.ts`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, admin settings/tokens/upload/search UI, CLIP/color/backfill scripts, privacy/data selectors, storage comments, service worker/cache comments, upload/restore/action guards.

Inventory metrics:

- Markdown/examples under the authoritative checkout, excluding `.git`, `node_modules`, generated build output, `.claude/worktrees`, `.omx/state/sessions`: 3,271 doc/example candidates. The tracked committed markdown inventory includes `.context/plans` 269 files, `.context/reviews` 2,272 files, and many archived historical reports.
- Test surface: 355 executable Vitest files in `apps/web/src/__tests__`, 3,063 literal `it(`/`test(` declarations plus 40 parameterized `*.each` declarations; 9 executable Playwright specs under `apps/web/e2e`.
- Migration surface: 30 SQL migrations and 30 Drizzle journal entries; latest journal entry is `0029_feed_updated_indexes`.

Skipped deliberately: local secret env files (`.env.deploy`, `apps/web/.env.local`), runtime upload/data directories, binary fixtures/screenshots except as inventory names, `node_modules`, `.next`, `.git`, `.claude/worktrees`, and generated OMX/OMC session/cache state. No external framework/API lookup was needed for the confirmed findings; they are repo-local mismatches. Historical docs clearly labeled as historical were not treated as current runbooks.

## Confirmed Issues

### C17-DOC-01 - Current plan ledger still advertises Cycle 16 as active and commit/push/deploy pending after `origin/master` advanced

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- Files/regions:
  - `.context/plans/README.md:34-37` lists Run-10 Cycle 16 as the active current-cycle plan/deferred register at start HEAD `4b237f7e`.
  - `.context/plans/cycle-16-2026-07-08-plan.md:3` says `IMPLEMENTED - GATES GREEN; COMMIT/PUSH/DEPLOY PENDING`.
  - `.context/plans/cycle-16-2026-07-08-plan.md:131-137` leaves `WP5 gates green; commit, push, and deploy pending` unchecked.
  - Local evidence: `git rev-parse HEAD origin/master` returned the same `fc15b235ca7a244d79b54981bd059926ca7c745a`, and `git log -6` shows Cycle 16 fix/docs commits through `fc15b235` on `master`.
- Why this is a problem: the plan index is explicitly the orientation surface for agents, and the cycle plan is the release ledger. Both now mix stale and current truth: push is no longer pending, gates are recorded as green later in the same file, while deploy completion remains unproven. A future agent cannot tell whether it should close Cycle 16, perform a deploy, or start from Cycle 17 review artifacts without re-deriving state from git and logs.
- Concrete failure scenario: an implementation agent reads `.context/plans/README.md`, treats Cycle 16 as still active, and reruns or re-commits already-pushed work instead of planning from Cycle 17 findings. Conversely, another agent sees "commit/push/deploy pending" and may assume all three are unfinished, even though push is already complete and only deploy evidence is unknown.
- Suggested fix: update the Cycle 16 plan ledger with exact terminal evidence: commit hash(es), `origin/master` match, gate evidence already present at lines 141-150, and either deploy success evidence or an explicit "deploy not verified" carry-forward. Move Cycle 16 from "Active Current-Cycle Plans" to recently completed/superseded in `.context/plans/README.md`, and point the active section at the current Cycle 17 review/planning state once the aggregate exists.

### C17-DOC-02 - Public config example omits the implemented Atom feed `copyright` field documented in CLAUDE.md

- Severity: Low
- Confidence: High
- Status: Confirmed issue
- Files/regions:
  - `CLAUDE.md:732-743` documents `site-config.json` keys and includes optional `copyright` for Atom `<rights>` / feed copyright text.
  - `README.md:58-72` presents the root config snippet but omits `copyright`.
  - `apps/web/src/site-config.example.json:1-11` also omits `copyright`.
  - Code support exists in `apps/web/src/app/feed.xml/route.ts:125-131`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:149-154`, and `apps/web/src/lib/atom-feed.ts:79-82`.
- Why this is a problem: the deploy checklist tells operators that `copyright` is a valid flat snake_case key, but the public README snippet and the copied example file do not show it. Since `site-config.json` is build-time inlined, an operator who follows the example may ship feeds with only the fallback `© {year} {author}` and miss the chance to set the intended rights text before build.
- Concrete failure scenario: a photographer wants a specific feed rights statement, copies `site-config.example.json`, edits only shown keys, builds/deploys, and later sees Atom `<rights>` generated from the fallback author instead of the desired copyright text. Fixing it requires another edit plus rebuild/deploy.
- Suggested fix: add `"copyright": "© 2026 Your Name"` or a clearly empty optional value to `apps/web/src/site-config.example.json` and the root README config snippet, or explicitly state in the README that `copyright` is an optional additional key supported by feeds.

## Likely Issues

No additional likely documentation/code mismatches were promoted. The previous Cycle 16 document-specialist findings for the CLIP sidecar example and storage comments are fixed in current HEAD: `apps/web/scripts/backfill-clip-embeddings.ts:14-21` now includes `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, and `apps/web/src/lib/storage/types.ts:51-76` now says future/intended integration rather than live pipeline use.

## Risks Needing Manual Validation

### C17-DOC-MV-01 - Deploy completion for Cycle 16 remains a ledger risk, not a repo-local fact

- Severity: Low
- Confidence: High
- Status: Manual-validation risk
- File/region: `.context/plans/cycle-16-2026-07-08-plan.md:129`, `.context/plans/cycle-16-2026-07-08-plan.md:137`; deploy policy in `AGENTS.md:15-20` and `CLAUDE.md:505-507`.
- Why this needs validation: git proves commit/push completion, but this static repo review cannot prove whether `npm run deploy` actually ran after `fc15b235`, whether it succeeded, or whether production is serving that commit.
- Concrete failure scenario: docs get updated to "complete" based only on `origin/master`, while production still serves an older image because the per-cycle deploy failed or never ran.
- Suggested fix: run or inspect the deploy transcript, record the exact deploy command result and post-deploy smoke evidence in the Cycle 16 ledger, then update the plan index.

### C17-DOC-MV-02 - Live operator claims still depend on external host state

- Severity: Low
- Confidence: High
- Status: Manual-validation risk
- Files/regions: CLIP runbooks in `README.md:48`, `apps/web/README.md:65-91`, `CLAUDE.md:553-631`; proxy/nginx runbook in `README.md:171-174`, `CLAUDE.md:509-521`, `apps/web/nginx/default.conf:59-71`.
- Why this needs validation: the repo documentation and source agree on the intended CLIP activation gates and trusted-proxy topology, but the actual deployed model weights, DB settings, env values, and host nginx/edge headers live outside the repository.
- Concrete failure scenario: an operator treats the repository as proof that production semantic search or edge rate limiting is active, but the host lacks CLIP weights/env/embeddings or has not applied the checked-in nginx template.
- Suggested fix: keep the existing "verify host state" wording, and require live evidence for activation claims: `npm run test:clip:preflight`, a production semantic/similar search smoke, `npm run check:proxy-topology -- <url>`, nginx `-t`/reload evidence, and burst-limit verification where relevant.

## Final Sweep

I re-swept for stale setup/deploy commands, env/config description drift, migration journal/reconcile drift, admin-only privacy checklist drift, CLIP semantic-search runbook drift, storage-abstraction honesty, i18n key/copy mismatch, source comments that overclaim current behavior, tests-as-docs contradictions, and active/deferred ledger state drift.

Files not exhaustively line-read: archived `.context/plans/archive/**`, historical `.context/reviews/run*/**`, generated runtime `.omx`/`.omc` notes, binary fixtures/screenshots, and build/dependency output. They were inventoried and keyword-swept where relevant, but current root/app docs, active plan/review ledgers, source, scripts, migrations, config, tests, and user-facing copy were the decision surface.
