# Cycle 22 Document-Specialist Review

Role: document-specialist
Reviewed HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`
Status: review-only; no fixes implemented.

## Inventory

Relevant files/categories inspected:

- Authoritative docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`.
- Active cycle ledgers: `.context/plans/cycle-21-2026-07-08-plan.md`, `.context/plans/cycle-21-2026-07-08-deferred.md`, current commit body for `8b795862`.
- Operator runbooks and deploy docs: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`.
- Source/doc cross-check surfaces: `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/components/image-manager.tsx`, `apps/web/messages/{en,ko}.json`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/lib/sql-restore-scan.ts`.
- Tests that claim to pin the new docs/source contracts: `apps/web/src/__tests__/pending-file-deletions-source.test.ts`.

## Findings

### DOC-C22-01 - Cycle 21 release ledger still says commit/push/deploy are pending at current HEAD

Severity: Medium
Confidence: High
Status: confirmed docs drift

Evidence:

- `.context/plans/cycle-21-2026-07-08-plan.md:3` says `Status: IMPLEMENTED; full gates green; commit/push/deploy pending`.
- `.context/plans/cycle-21-2026-07-08-plan.md:221-240` defines WP9 as full gates, commit, push, and per-cycle deploy, then says signed commit/push and per-cycle deploy are still pending.
- `.context/plans/cycle-21-2026-07-08-plan.md:242-253` marks full local gates done but leaves `WP9 signed commit/push and per-cycle deploy` unchecked.
- The actual checked-out HEAD is `8b795862079b0e5318242a09390b4cdff1dc2058`, whose commit body records the Cycle 21 implementation and includes `Not-tested: Production deploy pending until after signed commit is pushed per DEPLOY_MODE=per-cycle.`
- User-supplied review constraint says the Cycle 21 commit-body deploy wording is stale if live smoke says deploy succeeded. There is no tracked ledger update in the inspected files that records such live smoke evidence or supersedes the commit-body trailer.

Operator-confusion scenario:

A Cycle 22 planner sees HEAD `8b795862` and the active Cycle 21 plan, but the plan still says commit/push/deploy pending. If production smoke did pass after the commit, the immutable commit body and mutable plan disagree with live state. If production smoke did not pass, the index still calls Cycle 21 active without a clear deploy blocker. Either way, the next operator cannot tell whether to redeploy, trust production, or treat Cycle 21 as unfinished.

Concrete fix:

Append a Cycle 21 terminal evidence section to `.context/plans/cycle-21-2026-07-08-plan.md` with absolute timestamps, pushed commit, deploy command result, and live smoke result. Mark WP9 complete only if deploy + smoke succeeded; otherwise state the blocker. Add a short note that the `8b795862` commit body's `Not-tested` trailer was written before post-push deploy evidence and is superseded by the ledger. Then move Cycle 21 from "Active Current-Cycle Plans" to "Recently Completed" in `.context/plans/README.md` when Cycle 22 opens.

### DOC-C22-02 - New `pending_file_deletions` operator state is undocumented

Severity: Medium
Confidence: High
Status: confirmed docs/runbook drift

Evidence:

- `apps/web/src/components/image-manager.tsx:142-147` and `apps/web/src/components/image-manager.tsx:171-179` surface cleanup failures only as toast warnings.
- `apps/web/messages/en.json:207` and `apps/web/messages/en.json:228` tell the admin to "Check server logs."
- `apps/web/src/lib/pending-file-deletions.ts:83-88` stores durable `attempts` and `last_error` in `pending_file_deletions` when cleanup fails.
- `CLAUDE.md:161-170` lists key database tables but omits `pending_file_deletions`.
- `CLAUDE.md:504-520` starts the operational playbook with deploy/nginx procedures; no inspected `CLAUDE.md`/README section gives an operator query, script, or recovery procedure for pending deletion rows.
- `apps/web/README.md:59-60` documents DB backups as row-only and filesystem backups as separately required, but does not mention that deletion cleanup failures are now recorded in a DB table while the files remain on disk.

Operator-confusion scenario:

An admin sees "Deleted database records, but N file cleanup steps failed. Check server logs." The logs identify the immediate failure, but the authoritative runbooks do not name the durable table, explain how to inspect rows, explain whether retry is automatic, or tell the operator how to safely drain/clear rows. The database now contains actionable cleanup state that is invisible to normal operations documentation.

Concrete fix:

Add a `pending_file_deletions` entry to `CLAUDE.md`'s database table/runbook sections. Document the invariant: rows mean deleted image DB records whose files may still exist. Include safe inspection SQL, expected retry path once implemented, and manual recovery rules. Update README/operator text if admins are expected to act on the toast warning.

### DOC-C22-03 - The Cycle 21 plan overstates the deletion-ledger completion contract

Severity: Medium
Confidence: High
Status: confirmed likely

Evidence:

- `.context/plans/cycle-21-2026-07-08-plan.md:55-65` describes a ledger retained after cleanup failure "so a later retry can finish cleanup" and accepts "File cleanup failures after DB deletion leave durable retry state."
- `.context/plans/cycle-21-2026-07-08-plan.md:68` marks the work implemented with source contracts.
- `apps/web/src/lib/maintenance-scheduler.ts:34-45` has no pending-deletion retry task.
- `apps/web/src/__tests__/pending-file-deletions-source.test.ts:39-45` asserts source strings for row retention/update/delete, not an executable later-retry path.

Operator-confusion scenario:

Future reviewers read the Cycle 21 plan and assume deletion failures are retryable end-to-end. In source, only the same delete request retries once internally and records a row on failure; no later actor drains it. That makes future planning more likely to defer the missing worker because the ledger wording sounds complete.

Concrete fix:

Amend the Cycle 21 ledger with a forward note: Cycle 21 shipped durable recording and same-request cleanup retry only; automatic or operator-triggered draining remains open. Link it to the next plan/deferred item that implements ARCH-C22-01.

## Confirmed Accurate Docs

- Root deploy-helper docs now match `scripts/deploy-remote.sh`: README says root `.env.deploy` is read first and the script implements that fallback (`README.md:129-140`, `scripts/deploy-remote.sh:22-29`).
- DB TLS docs mention runtime, Drizzle Kit, and backup/restore CLI TLS (`README.md:157`, `apps/web/README.md:52`, `CLAUDE.md:93-94`).
- Site-config build-time inlining is consistently documented across root README, app README, compose comments, and `CLAUDE.md` (`README.md:60`, `apps/web/README.md:50`, `apps/web/docker-compose.yml:28-32`, `CLAUDE.md:157`).
- Public route rate-limit docs now correctly describe App Router route handlers rather than pages in the lint rule, while `CLAUDE.md` separately documents nginx edge page limiting.

## Missed-Issue Sweep

Checked for:

- README/CLAUDE claims that expose unsupported S3/MinIO switching, bundled Lightroom Classic plugin, editing/culling/scoring features, or default production semantic search.
- Runbook drift around DB TLS, site-config, deploy env files, host-nginx application, route rate limits, and DB-only backups.
- Current Cycle 21/README/carry-forward consistency.
- Locale strings introduced by Cycle 21 for missing cancel/try-again and deletion warnings.

No additional confirmed document-specialist findings from that sweep.

## Uninspected Categories

- Live production smoke/deploy transcripts and host logs were not available in tracked files.
- External docs/package-version accuracy was not revalidated because this was a repository/doc drift review, not a dependency update.
- Generated assets, binary uploads, archived historical review trees, and visual screenshots were not re-reviewed.
