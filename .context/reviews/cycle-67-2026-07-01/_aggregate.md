# Cycle 67/100 Aggregate Review

Start HEAD: `3e8ab924b5ed714f8a0f1dbfe1f9739d6fe25886` (current deployed `master` HEAD at cycle start per invocation).

## Review Inputs

- `code-quality.md`
- `security.md`
- `perf-concurrency.md`
- `test-verifier.md`
- `ui-accessibility.md`
- `architecture-docs.md`
- Main-agent source inspection of Cycle 66 changes, `.context` ledgers, Settings byte-impacting contracts, lightbox keyboard handling, and CLIP sidecar scan-limit flow.

## Deduplicated Findings

### C67-01 - HDR ingest toggle is treated as an existing-derivative re-encode setting

- Severity/confidence: Medium / High.
- Cross-agent agreement: code-quality, test-verifier, UI/accessibility.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:52`, `apps/web/src/app/actions/images.ts:375`, `apps/web/src/app/api/admin/lr/upload/route.ts:396`, `apps/web/src/lib/settings-hash.ts:47`.
- Evidence: `COLOR_HDR_BACKFILL_KEYS` includes `allow_hdr_ingest`, but that setting gates future HDR upload admission and is absent from the authoritative byte-impacting `COLOR_IMPACTING_KEYS`.
- Failure scenario: an admin enables HDR ingest for future uploads and receives a re-encode warning for existing photos.
- Fix direction: move/reuse a client-safe byte-impacting settings list and exclude upload-only settings from the warning set.

### C67-02 - CLIP embedding sidecar can stop at a custom scan limit without the rerun notice

- Severity/confidence: Medium / High.
- Cross-agent agreement: performance/concurrency + main-agent verification.
- File/line: `apps/web/scripts/backfill-clip-embeddings.ts:144`, `apps/web/scripts/backfill-clip-embeddings.ts:174`, `apps/web/scripts/backfill-clip-embeddings.ts:223`, `CLAUDE.md:545`.
- Evidence: a non-`BATCH_SIZE`-aligned final limited query can return fewer than `BATCH_SIZE` rows and break before the existing `remainingScanBudget === 0` notice.
- Failure scenario: an operator runs with `SEMANTIC_SCAN_LIMIT=75`, processes 75 rows, sees no rerun notice, and leaves older embeddings unfilled.
- Fix direction: emit the rerun notice immediately when a processed batch exhausts the scan budget.

### C67-03 - Lightbox shortcut handler accepts repeated keydown events

- Severity/confidence: Medium / High.
- Cross-agent agreement: UI/accessibility + main-agent verification.
- File/line: `apps/web/src/components/lightbox.tsx:310`, `apps/web/src/components/photo-viewer.tsx:374`.
- Evidence: `photo-viewer.tsx` blocks repeated keydown events; the lightbox does not.
- Failure scenario: holding Space rapidly toggles slideshow; holding arrows skips photos unexpectedly.
- Fix direction: add an early repeat guard to the lightbox key handler and test it.

### C67-04 - Settings backfill warning regression is still mostly source-contract only

- Severity/confidence: Medium / Medium.
- Cross-agent agreement: test-verifier + main-agent verification.
- File/line: `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:11`, `apps/web/src/lib/settings-submit-payload.ts:23`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:279`.
- Evidence: the current test checks component source strings but does not execute the blank-baseline/default-equivalence comparison that Cycle 66 fixed.
- Failure scenario: a future payload optimization returns `noChanges` before pending-warning clear logic runs, while the source-string test still passes.
- Fix direction: extract/test the warning key/value comparison as a pure helper.

### C67-05 - Similar Photos abort-source test is brittle to harmless formatting

- Severity/confidence: Low / High.
- Cross-agent agreement: test-verifier.
- File/line: `apps/web/src/__tests__/similar-photos-abort-source.test.ts:16`.
- Evidence: the test requires an exact one-line fetch string.
- Failure scenario: a safe multiline refactor still passes `signal: controller.signal` but fails the gate.
- Fix direction: use a whitespace-tolerant source contract.

### C67-06 - Cycle 66 ledger and plan index remain active after signed push/deploy

- Severity/confidence: Medium / High.
- Cross-agent agreement: architecture/docs + main-agent verification.
- File/line: `.context/plans/cycle-66-2026-07-01-plan.md:51`, `.context/plans/cycle-66-2026-07-01-plan.md:52`, `.context/plans/README.md:7`, `.context/reviews/_aggregate.md:3`.
- Evidence: `HEAD`, `origin/master`, and `origin/HEAD` are signed commit `3e8ab924`, and the Cycle 67 invocation states that commit was deployed at cycle start, but Cycle 66 docs still present unfinished/current state.
- Failure scenario: later cycles reopen stale work or cannot verify per-iteration deploy policy.
- Fix direction: close Cycle 66 terminal evidence and update active aggregate/plan pointers to Cycle 67.

## Scheduled This Cycle

- `C67-01`: share the derivative-byte-impacting settings list with the Settings warning logic and exclude `allow_hdr_ingest`.
- `C67-02`: make `backfill-clip-embeddings.ts` log the scan-limit rerun notice for non-batch-aligned limits.
- `C67-03`: ignore repeated lightbox shortcut keydown events.
- `C67-04`: add a pure helper + tests for Settings backfill warning equivalence.
- `C67-05`: make the Similar Photos fetch-signal source contract whitespace-tolerant.
- `C67-06`: update Cycle 66 terminal ledger, Cycle 67 aggregate pointer, and plan index.

## Deferred / Not Scheduled

No new Cycle 67 findings are deferred. Carry-forward deferred items remain tracked in `.context/plans/cycle-67-2026-07-01-deferred.md`.

## Agent Failures / Deviations

- Specialized named reviewer roles were not exposed as callable native agent types; the cycle used available native subagents with explicit reviewer briefs.
- The architecture/docs lane was completed by the main agent after the session hit the native subagent concurrency limit.
- The UI reviewer did not start a browser/dev server; static review plus focused source/tests were sufficient for this cycle's source findings.

## Disposition

Six deduplicated findings, all scheduled this cycle. No new security finding was confirmed.
