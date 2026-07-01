# Cycle 81 Deploy/Docs Drift Review

Scope: deploy policy, release ledger accuracy, docs drift, and release evidence for HEAD `4733d475be8f19fbddf4b82b589e28d6ca083992`.

## Inventory

- Guidance read: `AGENTS.md` from the prompt and `CLAUDE.md`, especially the per-iteration deploy directive and disk-hygiene contract.
- Ledger/release files inspected: `.context/plans/README.md`, `.context/plans/cycle-80-2026-07-01-plan.md`, `.context/plans/cycle-80-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`, and `.context/reviews/cycle-80-2026-07-01/_aggregate.md`.
- Deploy docs/scripts inspected: `README.md`, `apps/web/README.md`, `.env.deploy.example`, `package.json`, `scripts/deploy-remote.sh`, and `apps/web/deploy.sh`.
- Git evidence checked: signed HEAD commit, local tracking refs, remote `refs/heads/master`, and HEAD diff scope.

## Findings

### D81-01 - Cycle 80 still reads active and deploy-unchecked after its pushed HEAD

Severity: Medium. Confidence: High.

Evidence:

- `HEAD`, `origin/master`, `origin/HEAD`, and `git ls-remote origin refs/heads/master` all resolve to `4733d475be8f19fbddf4b82b589e28d6ca083992`.
- `git log --show-signature -1 HEAD` reports a good GPG signature for `fix(review): preserve cycle-80 operational invariants`.
- `.context/plans/README.md:5-8` still lists Cycle 80 under "Active Current-Cycle Plans" instead of Recent/closed.
- `.context/plans/cycle-80-2026-07-01-plan.md:46-54` marks implementation and gates complete, but leaves `Commit, pull --rebase, push` and `Deploy with npm run deploy` unchecked.
- The Cycle 80 plan records gate evidence through `git diff --cached --check` at lines 56-67, but it does not record terminal commit/push evidence for `4733d475` or deploy evidence.
- `.context/reviews/_aggregate.md:3-14` points at Cycle 80 findings, which is fine as latest review state, but it does not close Cycle 80 release state.

Impact: Future lanes can correctly see that Cycle 80 code was committed and pushed only by re-running git checks. The committed ledger itself still says the cycle is active and deploy-incomplete, which conflicts with the project policy that every pushed `master` commit should be followed by deploy evidence.

Smallest safe Cycle 81 fix: update only the release ledgers after independent deploy confirmation. Mark Cycle 80 commit/push complete with signed commit and remote-ref evidence for `4733d475`; record either the `npm run deploy` result for `4733d475` or an explicit not-deployed reason; move Cycle 80 from active to recent in `.context/plans/README.md`. Do not modify product code for this finding.

## Non-Findings

- Deploy helper docs match the root script contract: `README.md:120-131` and `.env.deploy.example:1-16` describe root `.env.deploy`, `$HOME/.gallerykit-secrets/gallery-deploy.env` fallback, `DEPLOY_ENV_FILE`, derived SSH fields, `DEPLOY_REMOTE_SCRIPT`, and `DEPLOY_CMD`; `scripts/deploy-remote.sh:22-93` implements those paths and refuses group/world-readable deploy env files.
- The remote deploy script still matches the operational docs: `apps/web/deploy.sh:10-55` runs `git pull --ff-only`, validates private `apps/web/.env.local`, requires `apps/web/src/site-config.json`, and rebuilds with `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`.
- Disk hygiene docs and script are aligned: `CLAUDE.md:473-477`, `README.md:200`, and `apps/web/deploy.sh:79-104` all preserve the key contract: prune after successful `up` plus health check, persistence via bind mounts, host MySQL rather than Docker volume, and `docker volume prune -f` without `-a`.
- I did not re-raise the broad `C80-06` site-config runtime/build-time contract issue. It is already explicitly deferred in `.context/plans/cycle-80-2026-07-01-deferred.md` with an exit criterion.

## Validation Evidence

- `git rev-parse HEAD origin/master origin/HEAD` -> all `4733d475be8f19fbddf4b82b589e28d6ca083992`.
- `git ls-remote origin refs/heads/master` -> `4733d475be8f19fbddf4b82b589e28d6ca083992 refs/heads/master`.
- `git show --stat HEAD` confirms Cycle 80 touched review/plan artifacts plus the intended scanner, shutdown drain, sidecar guard, map-label, and test files.
- Current worktree already contained other Cycle 81 lane artifacts; this lane did not edit or revert them.
- No deploy was run in this review lane, and no source files were edited.
