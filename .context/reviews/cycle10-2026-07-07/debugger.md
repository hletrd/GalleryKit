# Cycle 10 Debugger Review — 2026-07-07

## Scope And Inventory

Debugger pass focused on latent bug surfaces, regressions, failure modes, race conditions, error handling, data consistency, and edge cases. I did not edit source.

Inventory built before findings:

- Workspace guidance: project `AGENTS.md` instructions supplied in prompt; `CLAUDE.md` architecture/security/runtime overview inspected.
- Git/worktree: existing cycle 10 review artifacts were present in `.context/reviews/cycle10-2026-07-07/`; no source changes were made.
- Source surface: app/action/API/lib TypeScript and TSX inventory is about 180 files under `apps/web/src`.
- High-risk paths inspected: uploads and file serving, image queue, upload actions, Lightroom upload API, public actions, sharing, topics/tags, semantic search, restore/import, migrations, schema, rate limiting, background DB writes, instrumentation shutdown drains.
- Test inventory inspected: public action tests, background DB write tests, topic action tests, source contract tests, semantic/similar search tests, restore tests, cursor/pagination tests, privacy-field tests, action-origin lint tests.

## Findings

### D10-DBG-01 — Analytics view recording defers request-scoped data until after queueing

- Severity: Medium
- Confidence: High
- Location:
  - `apps/web/src/app/actions/public.ts:436-462` (`recordPhotoView`)
  - `apps/web/src/app/actions/public.ts:465-496` (`recordTopicView`)
  - `apps/web/src/app/actions/public.ts:499-534` (`recordSharedGroupView`)
  - `apps/web/src/lib/background-db-writes.ts:34-65` (`trackAnalyticsDbWrite` queue/pump)
  - Related tests: `apps/web/src/__tests__/background-db-writes.test.ts:53-81`, `apps/web/src/__tests__/rate-limit-saturated-fast-path.test.ts:165-185`

Failure scenario:

`recordPhotoView`, `recordTopicView`, and `recordSharedGroupView` enqueue an async closure first, then call `headers()` and `checkViewRecordRateLimit(...)` inside that deferred closure. `trackAnalyticsDbWrite` only runs two analytics writes concurrently and stores the rest in a module-level queue. Queued callbacks can later be invoked from `pumpAnalyticsQueue()` inside another callback's `finally`, not from the original request action that created the closure.

That creates two failure modes:

1. `headers()` is request-context scoped. When the queued closure runs later, the original request context may be gone or replaced by the async context of the write that pumped the queue. The view record can be dropped with the existing warning path, or worse, attributed with the wrong request metadata.
2. Per-IP view limiting is not evaluated until the queued callback starts. A single caller can enqueue up to the global `ANALYTICS_DB_WRITE_MAX_PENDING` backlog before the persistent limiter runs, starving legitimate analytics writes and spending the bounded queue on work that may later be rejected.

Existing tests verify the queue cap and verify an over-limit fast path when the mocked queue executes immediately, but they do not cover delayed execution after the request context is unavailable or queue admission before rate limiting.

Concrete fix:

- Capture request-derived data before enqueueing:
  - `const requestHeaders = await headers();`
  - `const params = await buildViewParams(requestHeaders);`
- Pass plain `params` into the queued write. The queued callback should not call `headers()`.
- Add a pre-queue admission guard for view recording. Either run `checkViewRecordRateLimit(params.ip, Date.now())` before `trackAnalyticsDbWrite` and update the action-origin lint rule/tests to accept this shape, or add a cheap per-IP pending counter before the global analytics queue and keep the persistent limiter inside the callback as a final guard.
- Add regression coverage that saturates `trackAnalyticsDbWrite`, queues a view recorder, makes `headers()` fail or return a different value when executed after enqueue, and asserts the recorder uses the captured request params. Add a queue-admission test proving over-limit view calls do not consume the global analytics backlog.

### D10-DBG-02 — Topic deletion fails open when smart collection predicates are unparseable

- Severity: Low
- Confidence: Medium
- Location:
  - `apps/web/src/app/actions/topics.ts:451-484` (`deleteTopic`)
  - Specific fail-open catch: `apps/web/src/app/actions/topics.ts:472-478`
  - Existing positive coverage: `apps/web/src/__tests__/topics-actions.test.ts:575-625`

Failure scenario:

`deleteTopic` correctly blocks deletion when a parseable smart collection query references the topic slug. If any `smart_collections.query_json` row is malformed, however, the catch block logs a warning and continues deleting the topic:

```ts
console.warn(
    `[deleteTopic] smart_collection ${collection.id} has unparseable query_json — skipping topic-reference delete guard`,
    err,
);
```

Smart collections are operator-authored through direct DB rows in this project, so malformed JSON is a plausible import/manual-edit failure mode. If the malformed predicate was intended to reference the topic being deleted, the guard cannot prove safety, but the destructive delete still proceeds. The result is a stale or broken smart collection predicate and loss of the topic row that would have made repair straightforward.

Concrete fix:

- Fail closed on unparseable `smart_collections.query_json` during topic deletion. Return a localized error such as `cannotDeleteTopicWithInvalidSmartCollection` instructing the operator to repair or remove the smart collection first.
- Keep the existing “referenced by collection” guard for parseable queries.
- Add a regression test next to `apps/web/src/__tests__/topics-actions.test.ts:575-625` where a malformed smart collection row causes `deleteTopic('travel')` to return an error and not call `tx.delete(topics)`.

## Missed-Issues Sweep

No Critical or High-confidence High severity findings were identified in this pass.

Areas checked and not filed:

- Upload file serving: `serveUploadFile` validates path shape, rejects traversal/control bytes, resolves symlinks, enforces realpath containment, handles HEAD without opening a file descriptor, and varies ETags by public settings hash.
- Browser and Lightroom uploads: quota preclaim/settle paths, topic validation, disk checks, original cleanup, and post-commit queueing were inspected. The ignored `enqueueImageProcessing(...)` return is intentionally paired with bootstrap recovery comments in the Lightroom route and restore/startup queue recovery elsewhere, so I did not file it as a current bug.
- Image deletion: DB delete happens before strict derivative cleanup; cleanup failures are surfaced as partial success/logged rather than silently claiming full cleanup. Batch delete handles stale rows conservatively.
- Restore/import: durable maintenance marker, admin mutation slots, queue/background write drains, SQL scanner, migration post-checks, and lifecycle cleanup all have explicit barriers. No concrete restore race was found in this pass.
- Semantic/similar search: abort handling, content-type/length validation, public rate limiting, production-mode gating, and embedding-copy tests cover the main failure modes.
- Cursor pagination: invalid cursor handling and MySQL/ISO timestamp variants have direct tests.
- Privacy fields: public/admin field projection and privacy key symmetric guard tests cover the sensitive-column surface.

## Validation Evidence

- Read-only review of docs/source/tests plus this markdown artifact.
- Existing targeted tests inspected for the two findings:
  - `background-db-writes.test.ts` covers queue bounds but not request-context capture.
  - `rate-limit-saturated-fast-path.test.ts` covers immediate mock execution but not real queue admission under backlog.
  - `topics-actions.test.ts` covers parseable smart collection references but not malformed `query_json`.
- Full test suite was not run because this was a no-source-edit review pass; the report is based on static inspection and existing test coverage review.
