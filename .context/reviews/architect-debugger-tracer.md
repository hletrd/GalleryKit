# Cycle 34 Architect / Debugger / Tracer Review

Reviewer: architect-debugger-tracer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `e1f124a265998ea51297d6716df6c03a2056a96c`
Date: 2026-06-30 KST
Scope: read-only cross-file trace for failure modes, concurrency/race hazards, schema/migration/reconcile drift, deploy/docs drift, and latent regressions. No source, tests, plans, git state, or commits were edited.

## Inventory

- Required governance/context read: `AGENTS.md`; `CLAUDE.md` project overview, security architecture, runtime topology, race-condition protections, migration/schema-drift runbook, operational playbook, deployment checklist, and remote deploy helper sections.
- Cycle 33 baseline read to avoid duplicate deferred architecture items: `.context/plans/cycle-33-2026-06-30-plan.md`, `.context/plans/cycle-33-2026-06-30-deferred.md`, and `.context/reviews/_aggregate.md`.
- Current HEAD confirmed with `git rev-parse HEAD`; worktree was clean at review start.
- Stale candidates in the pre-existing `architect-debugger-tracer.md` were rechecked and found closed at this HEAD: SQL comment-split restore scanning has dual normalized passes and tests; Lightroom enqueue forwards `semanticSearchMode`; semantic search rejects missing `Content-Length` before reading the body and uses byte length after read.
- Source surfaces traced: restore scanner/action, durable restore maintenance, upload-processing contract lock, browser upload action, Lightroom/PAT upload route, image queue, background DB writes, semantic search routes, Drizzle schema, migration journal, `reconcileLegacySchema`, Dockerfile, compose file, deploy scripts, and the LR upload source-contract tests.
- Validation run: `npm test --workspace=apps/web -- --run src/__tests__/lr-upload-hdr-gate.test.ts` passed, 39 tests, showing the current LR source-contract suite does not catch the finding below.

## Findings

### C34-ADT-01 - HIGH - Lightroom multipart parse semaphore leaks on quota early returns and can wedge the upload route

- **Location:** `apps/web/src/app/api/admin/lr/upload/route.ts:60-73`, `apps/web/src/app/api/admin/lr/upload/route.ts:130-185`; test gap at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:267-278`.
- **Severity:** High.
- **Confidence:** High.

The route added a process-global pre-parse semaphore for large Lightroom/PAT multipart parsing:

- `lrMultipartParseInFlight` is incremented by `tryAcquireLrMultipartParseSlot()` at `route.ts:63-73`.
- The slot is acquired at `route.ts:130`.
- Two quota branches can return after acquisition and before any `finally`: `tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW` at `route.ts:147-151`, and `tracker.bytes + declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES` at `route.ts:153-157`.
- The only release is in the `finally` around `request.formData()` at `route.ts:177-185`, which those quota returns never reach.

**Causal chain / failure scenario:** after a PAT/admin reaches the one-hour upload count or cumulative-byte window, the next LR upload request passes header checks, acquires the singleton parse slot, hits one of the quota returns, and exits without calling `releaseMultipartParseSlot()`. `lrMultipartParseInFlight` remains `1` for the life of the Node process. Every later LR upload, including unrelated admins/tokens, fails at `route.ts:130-135` with "Another Lightroom upload is being parsed; retry shortly" until the container restarts.

The existing source-contract test checks that the semaphore exists, is acquired before `request.formData()`, and is released in a `finally` near `formData()` (`lr-upload-hdr-gate.test.ts:267-278`). It does not assert that all returns after acquisition release the slot; the narrow test still passes on this broken control flow.

**Fix:** move `tryAcquireLrMultipartParseSlot()` until after quota early returns and immediately before the upload-tracker preclaim/body parse, or wrap every post-acquire branch in a single `try/finally` that releases on all exits. Add a regression test that extracts the source region between acquisition and `request.formData()` and fails on `return NextResponse` before a release, or add an executable route test that forces the over-window branch and then proves a second request can acquire the slot.

## Final sweep

- Schema/migration/reconcile: checked the Drizzle schema, migration list through `0028_rate_limit_bucket_start_idx`, journal ordering, and `reconcileLegacySchema` coverage. No new missing column/index/drop mirror was found.
- Restore/race paths: restore now holds restore, upload-contract, color-backfill, and semantic-backfill locks; enters durable maintenance before queue/background drains; and releases in finally. No fresh restore-maintenance race was promoted.
- Deploy/docs drift: `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/docker-compose.yml`, and `apps/web/Dockerfile` still match the documented bind-mount/prune/host-network/remote-env contracts. I did not re-raise Cycle 33 deferred items such as Docker CI coverage, `/api/live` deploy readiness semantics, global advisory-lock names, process-local limits, or semantic newest-window scans.
- Public/search/body gates: the old semantic body-read-before-limit finding is fixed at HEAD. Similar search is GET-only and shares the documented scan-window limitation, already deferred in Cycle 33.
- Tests run only where they directly validated the new finding's test gap. Full lint/typecheck/build/Vitest/E2E were not run because this was a read-only review lane, not an implementation lane.
