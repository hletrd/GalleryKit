# Cycle 47 Test / Verifier Review

## Findings

### C47-SW-01 - 304 image-cache validation does not refresh the stale-age marker

- Severity: Low
- Confidence: High
- Citations: `apps/web/public/sw.template.js:311`, `apps/web/src/__tests__/sw-template-contract.test.ts:218`
- Problem: the service-worker image cache now expires unverified cached derivatives after one hour, but a successful `HEAD 304` only refreshed LRU metadata. It did not refresh the cached response's `sw-cached-at` header.
- Failure scenario: a derivative is validated fresh by the server, then a later temporary offline/failed probe evicts that same still-valid cached derivative based on the original cache timestamp and returns 503.
- Suggested fix: rewrite the cached response with a new `sw-cached-at` on the 304 branch and pin the behavior in the source-contract test plus generated `sw.js`.

### C47-BF-01 - Sidecar row-exists wiring is not pinned

- Severity: Low
- Confidence: High
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:506`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode-encode-failure.test.ts:64`
- Problem: Cycle 46 added `reprocessRow(..., rowExists)` coverage, but the production loop wiring that passes the DB-backed callback was not pinned.
- Failure scenario: a future refactor can call `reprocessRow(row, backfillSettings)` from the sidecar main loop and silently re-open the deleted-mid-reencode encode-failure leak.
- Suggested fix: add a source-contract assertion that the production loop calls `reprocessRow(row, backfillSettings, rowExists)`.
