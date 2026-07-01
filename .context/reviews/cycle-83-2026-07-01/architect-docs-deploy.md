# Cycle 83/100 Architect / Docs / Deploy Drift Review

Role: architect, document-specialist, deploy-drift reviewer.

Scope: architecture boundaries, deploy/docs drift, migration/schema ledger consistency, plan/review aggregate consistency, release ledger state, `CLAUDE.md` / `AGENTS.md` claims versus source, and whether Cycle 82 is properly closed after current HEAD `cc46b1d6`.

## Finding

### C83-ARCH-01 - Cycle 82 release ledger remains active and deploy-unclosed after its pushed HEAD

- Severity: Medium.
- Confidence: High.
- Citation: `.context/plans/README.md:5` lists "Active Current-Cycle Plans"; `.context/plans/README.md:7` still marks the Cycle 82 implementation plan as "active"; `.context/plans/cycle-82-2026-07-01-plan.md:47` through `.context/plans/cycle-82-2026-07-01-plan.md:50` mark implementation and gates complete but leave commit/push and deploy unchecked; `CLAUDE.md:467` through `CLAUDE.md:469` state the per-iteration policy that every pushed `master` commit is followed by `npm run deploy`.
- Evidence: current git state is `master...origin/master` at signed commit `cc46b1d6` (`fix(a11y): preserve meaningful result labels`), and `git verify-commit cc46b1d6` reports a good signature. The Cycle 82 plan records gate evidence through `git diff --cached --check` at `.context/plans/cycle-82-2026-07-01-plan.md:52` through `.context/plans/cycle-82-2026-07-01-plan.md:63`, but it does not record terminal commit/push evidence for `cc46b1d6` or any deploy evidence/gap for Cycle 82 itself.
- Failure scenario: Cycle 83+ reviewers and operators cannot distinguish "Cycle 82 was pushed and deployed" from "Cycle 82 was pushed but not deployed" without redoing release forensics. This repeats the exact release-ledger ambiguity Cycle 82 closed for Cycle 81, and it conflicts with the project policy that per-iteration deploy state must be tracked after every pushed `master` commit.
- Suggested fix: update `.context/plans/cycle-82-2026-07-01-plan.md` to mark commit/push complete with signed `cc46b1d6`/`origin/master` evidence, then either record `npm run deploy` evidence or explicitly record the deploy-evidence gap and the next cycle that supersedes it. Move Cycle 82 out of the active section in `.context/plans/README.md` and into Recent Plans with its terminal commit/deploy state.

## Verified Surfaces

- Cycle 82 source fixes are present at current HEAD: search imports `getPhotoResultLabel` in `apps/web/src/components/search.tsx:24`, similar photos import it in `apps/web/src/components/similar-photos.tsx:13`, and the helper rejects blank/filename-like titles before description/fallback in `apps/web/src/lib/photo-title.ts:85` through `apps/web/src/lib/photo-title.ts:99`.
- Failed-image retry accessibility is wired: the dashboard derives a row label and error id at `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:85` through `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:88`, then applies localized per-row `aria-label` and `aria-describedby` at lines 122 through 123. English and Korean strings exist at `apps/web/messages/en.json:73` through `apps/web/messages/en.json:74` and `apps/web/messages/ko.json:73` through `apps/web/messages/ko.json:74`.
- Deploy docs match source: root `package.json:22` maps `npm run deploy` to `./scripts/deploy-remote.sh`; `scripts/deploy-remote.sh:22` through `scripts/deploy-remote.sh:30` implement the documented env-file precedence, and `scripts/deploy-remote.sh:31` through `scripts/deploy-remote.sh:53` derive the SSH command from deploy env fields.
- Docker deploy safety claims match source: `apps/web/deploy.sh:55` runs compose up/build before pruning; `apps/web/deploy.sh:99` through `apps/web/deploy.sh:104` run container/image/builder/volume prune after health success; `apps/web/docker-compose.yml:24` through `apps/web/docker-compose.yml:28` use bind mounts for persisted data/config.
- Schema ledger is internally consistent for this review pass: `apps/web/drizzle/meta/_journal.json:201` through `apps/web/drizzle/meta/_journal.json:207` end at `0028_rate_limit_bucket_start_idx`; the filesystem has 29 `NNNN_*.sql` files and 29 journal entries with no missing file/journal tags. The non-monotonic historical `when` sequence is documented as expected in `CLAUDE.md:426` through `CLAUDE.md:438`, and `migrate.js` preserves the hash-based postcondition at `apps/web/scripts/migrate.js:803` through `apps/web/scripts/migrate.js:823`.
- Deferred items were not re-raised: Cycle 82 records no newly deferred findings at `.context/plans/cycle-82-2026-07-01-deferred.md:6` through `.context/plans/cycle-82-2026-07-01-deferred.md:8`, and the carry-forward list remains explicit at lines 10 through 17.
