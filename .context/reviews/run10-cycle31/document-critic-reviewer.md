# Run-10 Cycle 31/100 Document Specialist + Critic Review

Date: 2026-07-08 KST
Reviewed HEAD: `707470083a27c78e1c9d1da176ade75f94ad6af4`
Role lane: document-specialist/critic reviewer

## Inventory

Built a document-first inventory before reviewing:

- Project rules and operating docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Operational runbooks/scripts: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `.env.deploy.example` (not the secret `.env.deploy`).
- Migration/schema docs vs code: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, migration tests.
- Plan/review ledgers: `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/run10-cycle27..30/*`, `.context/plans/cycle-10b-2026-07-08-*`, `.context/reviews/run10-cycle27..30/*`, `.context/reviews/cycle-10b-2026-07-08/*`.
- Source-comment/doc spot checks: LR upload API, CLIP/semantic-search activation, storage quarantine, paid-download removal, auto-alt-text honesty, pending file deletions, public route rate-limit scope, deploy disk hygiene, site-config/IMAGE_BASE_URL build-time notes.

## Findings

### DOC-C31-01 - Current plan index still advertises Cycle 29 as active and omits the newer Cycle 30/10b terminal reality

Severity: Medium
Confidence: High

Citations:

- `.context/plans/README.md:34-39` lists only Cycle 29 and loop-B Cycle 10b under "Active Current-Cycle Plans".
- `.context/plans/run10-cycle29/plan.md:3` says Cycle 29 is implemented, signed, pushed, deployed, and live-smoked.
- `.context/plans/run10-cycle29/plan.md:92-99` has all Cycle 29 progress boxes complete, including signed commit/push and per-cycle deploy/live smoke.
- `.context/plans/run10-cycle29/plan.md:113-119` records terminal evidence for signed commit, push, deploy, `/api/live`, and missing-photo smoke.
- `.context/reviews/run10-cycle30/_aggregate.md:36-41` records a completed Cycle 30 review disposition after Cycle 29.
- `git log --oneline -6` at reviewed HEAD shows `70747008`, `93ed70f8`, `bc43633b`, `f4174c7e`, `615398cb`, and `4bab5270` after the Cycle 29 implementation commit.

Problem:

The index's active-current section is stale. It still points future agents at Cycle 29 as active even though the Cycle 29 plan itself is terminal-closed, and it does not list Cycle 30 as recently completed or describe the current HEAD's post-Cycle-30 loop-B commits coherently.

Scenario:

A Cycle 31 planner starts from `.context/plans/README.md`, follows the "active" Cycle 29 pointer, and either re-audits already-closed release work or misses Cycle 30/10b ledger state. This is the same operational ambiguity class as prior terminal-ledger findings, but the specific stale surface is current at HEAD and not the already-fixed Cycle 28 item.

Fix:

Move Cycle 29 out of "Active Current-Cycle Plans" into recently completed, add/close Cycle 30 with its actual terminal state, and make the loop-B Cycle 10b entry reflect whether it is still active or already implemented/pushed/deploy-pending. Keep the index as a pointer, but make its current-cycle section agree with the newest plan/deferred pair and `origin/master`.

Dedupe notes:

Not a refile of `AGG-C29-03` (Cycle 28 stale terminal ledger) or `C30-01` (Cycle 10b aggregate disposition conflict). Those were different ledger inconsistencies. This finding is the current index state at HEAD `70747008`.

### DOC-C31-02 - Cycle 30 and loop-B Cycle 10b implementation plans still show pending terminal work after their implementation commits are on `origin/master`

Severity: Medium
Confidence: High

Citations:

- `.context/plans/run10-cycle30/plan.md:3` says `pending signed push and deploy`.
- `.context/plans/run10-cycle30/plan.md:48-53` leaves signed commit/push and per-cycle deploy/live smoke unchecked.
- `.context/plans/run10-cycle30/plan.md:57-65` records local gate evidence only; there is no terminal evidence section.
- `.context/plans/cycle-10b-2026-07-08-plan.md:93-106` defines gates, commit/push, and per-cycle deploy as required work.
- `.context/plans/cycle-10b-2026-07-08-plan.md:145-147` still says build is running, e2e is pending, and commit/push/deploy come after those gates.
- `git log --oneline -6` shows the Cycle 30 ledger commit `f4174c7e`, loop-B implementation commits `615398cb`, `bc43633b`, `93ed70f8`, and the plan/deferred registration commit `70747008` all present on `origin/master`.

Problem:

The plans no longer describe the repository state. Cycle 30's plan still claims signed push/deploy are pending, even though the Cycle 30 fix commit exists. The loop-B Cycle 10b plan still stops mid-gate, even though its scheduled WP-A/WP-C/WP-D outputs are now committed. Neither plan records whether per-cycle deploy/live smoke happened or was intentionally superseded by a later deploy.

Scenario:

An operator cannot distinguish "source was committed but production deploy was skipped" from "deploy happened but the ledger was not updated." Under this repo's per-iteration deploy policy, that uncertainty can produce false production confidence or repeated release-only work in the next review-plan-fix cycle.

Fix:

For Cycle 30 and Cycle 10b, add terminal evidence or an explicit gap: signed commit hash/signature status, push state, deploy result, live smoke result, and any superseding deploy. If deploy was not run, leave it visibly open and schedule it instead of implying completion through later commits.

Dedupe notes:

Cycle 30 already fixed the `AGG-C10b-03` disposition conflict; this does not re-open that content. Cycle 10b deferred rows `D10b-01..05` are not counted as new findings; they are preserved in `.context/plans/cycle-10b-2026-07-08-deferred.md` and `.context/plans/deferred-carry-forward.md`.

### DOC-C31-03 - Carry-forward register includes D10b rows but still labels its checkpoint/table as Cycle 29

Severity: Low-Medium
Confidence: High

Citations:

- `.context/plans/deferred-carry-forward.md:3-7` says the table must be updated every cycle.
- `.context/plans/deferred-carry-forward.md:19` still labels the top checkpoint as `run-10 c29`.
- `.context/plans/deferred-carry-forward.md:120` still labels the age column `Age @ r10c29`.
- `.context/plans/deferred-carry-forward.md:319-323` contains the newer D10b rows.
- `.context/plans/deferred-carry-forward.md:325-333` contains a Cycle-10b age-budget check below the table.

Problem:

The register content was partially updated for loop-B Cycle 10b, but the canonical checkpoint and age column still say Cycle 29. That makes the mechanical age budget ambiguous: the rows include Cycle 10b state, while the header says the table is only current as of Cycle 29.

Scenario:

A later reviewer uses the table header to calculate whether High or Medium deferred items crossed the 8/16-cycle thresholds and treats D10b rows as out-of-band or mis-aged. That weakens the register's stated purpose: one mechanically checkable surface for open deferred work.

Fix:

Promote the Cycle-10b check to the top checkpoint, update the age header to the current review basis (or split run-10 vs loop-B basis explicitly), and keep D10b rows in the table with their preserved severity/confidence and exit criteria.

Dedupe notes:

This is not `AGG-C29-04`: Cycle 27/28 deferred rows are present now. The new issue is a partial refresh after D10b rows were added.

## Non-Findings / Final Sweep

- No new doc/code mismatch found for LR upload API required fields: docs say `file` + `topic`; route rejects missing `file` and invalid/missing `topic`.
- No new migration-rule mismatch found: journal entry `0030_pending_file_deletions`, schema, migration SQL, and `reconcileLegacySchema` all include the pending-file-deletion table/indexes.
- No new semantic-search honesty mismatch found: docs correctly say production mode is operator-enabled, env-gated, offline after seeding, and not a one-click Settings UI toggle.
- No new storage-backend or Lightroom-plugin claim mismatch found: docs correctly describe local filesystem support only and a server-side PAT upload API, not a bundled plugin.
- Existing open items in run10-cycle27/28 and D10b carry-forward were treated as already-known unless the ledger surface itself changed.

## Verification

Static documentation/source review only. `git status --short` was clean before writing this artifact. No app code changed and no test suite was required for this document-review output.
