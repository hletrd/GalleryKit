# Cycle 77/100 Aggregate Review

Start HEAD: `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5`.

## Review Fan-Out

Cycle 77 ran independent review lanes from the deployed `master` start commit and preserved their reports in this directory.

- Code review lane: no new confirmed source findings; focused backfill and OG tests plus custom guard gates passed in that lane.
- Verifier/test-engineer lane: three focused test-depth findings around per-photo OG freshness, re-encode timestamp persistence, and sidecar row-existence wiring.
- Architect/debugger/tracer lane: one high-severity restore concurrency design finding around foreground admin mutations.
- Security lane: no confirmed security findings; auth/origin/public-rate-limit gates, production audit, focused security tests, and typecheck passed in that lane.
- Performance lane: no new confirmed performance findings; existing expensive-shape backlog remains deferred.

## Deduplicated Findings

### C77-01 - Per-photo OG pipeline-version freshness is not behavior-pinned

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:64`, `apps/web/src/app/api/og/photo/[id]/route.tsx:76`, `apps/web/src/app/api/og/photo/[id]/route.tsx:149`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:234`
- Problem: Cycle 76 includes `pipelineVersion` in the per-photo OG ETag helper, but the route tests only prove settings-hash invalidation.
- Failure scenario: a future refactor drops the pipeline-version input while matching-ETag and settings-change tests remain green, allowing stale `304` responses after an image pipeline bump.
- Disposition: scheduled for Cycle 77.

### C77-02 - Re-encode freshness bumps are not regression-locked

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:145`, `apps/web/src/lib/admin-backfill-runner.ts:625`, `apps/web/src/lib/admin-backfill-runner.ts:654`, `apps/web/scripts/backfill-color-pipeline.ts:469`, `apps/web/scripts/backfill-color-pipeline.ts:479`
- Problem: Cycle 76 made re-encode updates write `updated_at = CURRENT_TIMESTAMP`, but focused tests do not assert that success, detection-failure, and sidecar branches retain that write.
- Failure scenario: a cleanup removes the timestamp bump while counters and cleanup behavior still pass tests, leaving same-settings derivative rewrites with stale per-photo OG validators.
- Disposition: scheduled for Cycle 77.

### C77-03 - Sidecar row-existence confirmation is only helper/source-shape covered

- Severity: Medium
- Confidence: Medium
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:485`, `apps/web/scripts/backfill-color-pipeline.ts:487`, `apps/web/scripts/backfill-color-pipeline.ts:491`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:65`
- Problem: sidecar cleanup helpers require confirmed row absence, but the closure wiring that derives `rowStillExists` from `rowExists(result.id)` is not directly behavior-tested.
- Failure scenario: a future edit sets `rowStillExists` incorrectly or probes the wrong id while still passing source-shape tests, reintroducing live-row derivative deletion after a same-value update.
- Disposition: scheduled for Cycle 77.

### C77-ARCH-01 - Restore maintenance does not fence in-flight non-upload admin mutations

- Severity: High
- Confidence: High
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`
- Problem: restore maintenance fences uploads, color backfills, semantic backfills, queue work, and tracked background writes, but ordinary foreground admin mutations only check maintenance at function entry.
- Failure scenario: a long admin action passes its entry check, restore then writes the durable marker and starts import, and the older action later writes into the restore window or restored snapshot.
- Disposition: deferred for a dedicated barrier design. The safe fix requires a whole-action foreground mutation lease across all mutating admin actions or an equivalent DB-backed protocol; a partial point check would not close the race.

## Carry-Forward

- `C76-04` remains deferred: bottom-sheet dropdown portal coverage is source-shaped only.
- `C76-05` remains deferred: `getImageProcessingState` tests would miss processed-predicate drift.
- `C75-08` remains deferred: bulk-edit validation alert association.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix items remain covered by prior deferred artifacts unless their exit criteria are hit.

## Agent Failures

None.
