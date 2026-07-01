# Cycle 96 Document-Specialist Review

Reviewed repository: `/tmp/gallery-recovery-check` at `2f22620c361304ba0408053f546f45e3c74ddfdb`. Review-only: no source edits.

## Inventory

- Governing docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Ledgers: `.context/plans/README.md`, `.context/plans/cycle-95-2026-07-01-plan.md`, `.context/plans/cycle-95-2026-07-01-deferred.md`, `.context/reviews/_aggregate.md`.
- Migration/schema contract: `apps/web/drizzle/meta/_journal.json`, migration SQL files, `apps/web/scripts/migrate.js`, migration journal/reconcile tests.
- Source-contract surfaces: CLIP setup/docs, token admin UI/action, color backfill runbooks, upload API docs, deploy/disk hygiene docs, privacy/data guards.

Journal/SQL parity was checked during the lane and reported clean: 29 journal entries and 29 SQL files.

## Confirmed Findings

### DOC-96-01 - Release/context ledgers are one commit behind current `master`

- Severity/confidence: Medium / High.
- Evidence: current HEAD is `2f22620c361304ba0408053f546f45e3c74ddfdb`; `.context/plans/README.md:5-8`, `.context/plans/cycle-95-2026-07-01-plan.md:46-56`, and `.context/reviews/_aggregate.md:27-29` record terminal/deploy evidence ending at `2178046587484fb301bc731f855699e44888d2e6`.
- Failure scenario: future agents treat `217804...` as the latest deployed/reviewed state and repeatedly re-open ledger-only drift.
- Suggested fix: update cycle 96 ledgers and the aggregate to record the current starting baseline and final cycle evidence.

### DOC-96-02 - CLIP backfill sidecar example is stale

- Severity/confidence: Medium / High.
- Evidence: CLIP runbook sidecar commands in `CLAUDE.md` describe mounting source/scripts into the runtime image for one-off scripts, while package scripts and current runtime conventions have moved toward explicit sidecar command contracts. The lane flagged the CLIP backfill sidecar example as stale against current script/deploy practice.
- Failure scenario: an operator follows stale sidecar instructions and runs CLIP backfill with the wrong mount or working directory, causing model path or dependency failures.
- Suggested fix: refresh the CLIP backfill command to match the current sidecar/runbook convention and validate it in a non-production dry run.

### DOC-96-03 - CLIP manifest pointer comment is stale

- Severity/confidence: Low-Medium / Medium.
- Evidence: the document lane reported a stale CLIP manifest pointer comment in the CLIP documentation/source-contract surface. The affected docs should be checked alongside `CLAUDE.md` CLIP sections and CLIP script comments before editing.
- Failure scenario: operators seed or inspect the wrong manifest path while diagnosing semantic-search activation.
- Suggested fix: align the comment with the current manifest path and add a source-contract assertion if the path is used operationally.

### DOC-96-04 - Token label length docs/source contract mismatch browser behavior

- Severity/confidence: Low / High.
- Evidence: server/tests define the label limit in Unicode code points (`apps/web/src/app/actions/lr-tokens.ts:60-69`, `apps/web/src/__tests__/lr-tokens-action.test.ts:136-143`), while UI browser `maxLength={128}` uses UTF-16 code units (`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:209-223`).
- Failure scenario: documentation/tests claim 128-code-point labels work, but the UI rejects valid non-BMP labels.
- Suggested fix: align UI validation with the server contract.

### DOC-96-05 - Color backfill runbook predicate mismatch

- Severity/confidence: Medium / Medium.
- Evidence: the document lane reported that color backfill runbook predicates are stale relative to the current script candidate selection and retry behavior. Relevant source is `apps/web/scripts/backfill-color-pipeline.ts`.
- Failure scenario: an operator estimates or scopes a color backfill from stale predicates and misses rows or overloads the sidecar.
- Suggested fix: update the runbook predicate to match current candidate selection and include the operational limit guidance.

## Likely / Manual-Validation Risk

### DOC-96-R1 - Drizzle Kit snapshot metadata may be stale

- Severity/confidence: Low-Medium / Medium.
- Evidence: the lane reported possible stale Drizzle Kit snapshot metadata relative to current schema; journal/SQL parity is clean, so this is a tooling metadata risk rather than an applied migration mismatch.
- Exit check: compare generated snapshot metadata against `schema.ts` and migrations with Drizzle tooling in a non-production workspace.

## Non-Findings

- Migration SQL/journal parity is clean.
- Deploy prune docs match script guarantees.
- Upload API docs match route contract.
- Historical CLIP docs are bannered as historical/non-current.

## Final Sweep

Reviewed ledgers, runbooks, CLIP docs, migration metadata, token contracts, deploy docs, and upload/source-contract surfaces. No tests/build/deploy were run in this review-only lane.
