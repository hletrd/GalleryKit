# Cycle 81/100 Code Reviewer

Start HEAD: `4733d475be8f19fbddf4b82b589e28d6ca083992`
Compared against: `8c4999c9294e0196608b4a0bce8078edc3be2366`
Date: 2026-07-01

## Result

No actionable defects found.

## Scope Inspected

- Repository instructions: `AGENTS.md`, `CLAUDE.md`.
- Prior-cycle context to avoid stale re-raises: `.context/reviews/cycle-80-2026-07-01/_aggregate.md`, `.context/reviews/cycle-80-2026-07-01/code-reviewer.md`.
- Cycle 80 fix diff in:
  - `apps/web/scripts/check-public-route-rate-limit.ts:320-338`, `apps/web/scripts/check-public-route-rate-limit.ts:640-712`, `apps/web/scripts/check-public-route-rate-limit.ts:943-960`
  - `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:513-565`
  - `apps/web/scripts/backfill-alt-text.ts:30-115`
  - `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:33-50`
  - `apps/web/src/lib/background-db-writes.ts:5-34`
  - `apps/web/src/instrumentation.ts:35-69`
  - `apps/web/src/__tests__/instrumentation-sigterm.test.ts:44-49`
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:41-62`, `apps/web/src/app/[locale]/(public)/map/page.tsx:89-99`
  - `apps/web/src/components/map/map-client.tsx:15-23`, `apps/web/src/components/map/map-client.tsx:53-73`, `apps/web/src/components/map/map-client.tsx:120-136`
  - `apps/web/src/__tests__/map-thumb-wiring.test.ts:61-75`
- Current public API route set under `apps/web/src/app/api/**/route.*` plus scanner-discovered public route files.
- Existing background write and restore-drain contracts in `apps/web/src/__tests__/background-db-writes.test.ts:17-47` and `apps/web/src/__tests__/restore-upload-lock.test.ts:103-120`.

## Review Notes

- The public-route rate-limit scanner now classifies literal dynamic imports of expensive modules and intentionally fails closed on computed dynamic imports. The sequential gate logic still requires a pre-increment helper before expensive GET/HEAD work, and the current public route set passes the gate.
- The alt-text backfill now checks the durable restore-maintenance marker before settings/candidate reads and before each write batch, matching the sidecar posture used by sibling backfills.
- The shutdown path now includes the tracked background DB write drain inside the bounded SIGTERM/SIGINT drain race. The restore-specific export remains as an alias, preserving existing restore call sites.
- The map page now computes a localized `displayTitle` server-side and uses it for popup image alt text, button labels, and the fallback list, avoiding numeric-only accessible names for untitled markers.

## Validation

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- --run src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/cycle-71-source-contracts.test.ts src/__tests__/instrumentation-sigterm.test.ts src/__tests__/map-thumb-wiring.test.ts src/__tests__/background-db-writes.test.ts` passed: 5 files, 107 tests.
- `git diff --check HEAD~1..HEAD` passed.

## Deferred Items Not Re-Raised

The Cycle 80 aggregate's deferred `C80-06` site-config runtime/build-time contract issue was not re-raised because this Cycle 81 scope did not change its exit criteria or severity. Older deferred items listed in Cycle 80 likewise remain unchanged by the reviewed diff.
