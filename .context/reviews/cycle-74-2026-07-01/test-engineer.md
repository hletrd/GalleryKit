# Cycle 74 Test Engineer / Verifier Review

HEAD reviewed: `92924220`.

## Inventory Examined

- Project guidance, root/app `package.json`, `tsconfig*.json`, `.github/workflows/quality.yml`.
- Recent-cycle evidence: Cycles 64-73 logs, Cycle 73 review/plan artifacts.
- Cycle 73 regression tests: `feed-conditional.test.ts`, `og-route-rate-limit-behavior.test.ts`, `og-photo-fallback.test.ts`, `feed-sized-derivative.test.ts`.
- Current behavior surfaces: root/topic Atom feed routes, per-photo OG route, `lib/data.ts`, `lib/feed-conditional.ts`.
- Previously deferred Cycle 73 items checked but not re-raised: sidecar derivative write-boundary behavior and Settings UI backfill-warning integration.

## Findings

### C74-TE-01 - Pending-photo OG behavior depends on an untested data helper

- Severity: Medium.
- Confidence: High.
- File/line: `apps/web/src/lib/data.ts:1204`, `apps/web/src/lib/data.ts:1209`, `apps/web/src/lib/data.ts:1214`, `apps/web/src/app/api/og/photo/[id]/route.tsx:84`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:167`.
- Problem: Cycle 73 added route-level coverage for pending-photo fallback behavior, but it mocks `getImageProcessingStateCached()` directly. The actual helper must query by `images.id` without `processed = true` so pending rows remain distinguishable from missing IDs.
- Failure scenario: a future refactor copies the processed-only `getImage` predicate into `getImageProcessingState()`. Route tests keep passing via mock, while production collapses pending rows back into permanent misses and applies long success caching.
- Suggested fix: add direct source/behavior coverage for `getImageProcessingState()` and add route coverage for permanent misses retaining the success cache policy.

### C74-TE-02 - Feed conditional-request contract is ambiguous and no longer behavior-tested for If-Modified-Since

- Severity: Medium.
- Confidence: High.
- File/line: `apps/web/src/app/feed.xml/route.ts:43`, `apps/web/src/app/feed.xml/route.ts:141`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:63`, `apps/web/src/lib/feed-conditional.ts:1`, `apps/web/src/__tests__/feed-sized-derivative.test.ts:68`.
- Problem: feed routes now only evaluate `if-none-match`, but comments and the legacy helper still imply `If-Modified-Since` support.
- Failure scenario: IMS-only clients always get 200, while a future maintainer may re-enable the stale IMS short-circuit that Cycle 73 removed.
- Suggested fix: document and test the ETag-only contract, including route-level tests that IMS-only requests return 200.
