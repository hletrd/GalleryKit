# Cycle 19 Tracer Review

Scope: causal tracing of suspicious flows across upload/processing/delete/backfill, search/rate-limit, auth/session/admin actions, backup/restore, public serving/cache, and UI state.

Review posture: read-only for source. No source files were modified. This report replaces the prior tracer artifact only. Current HEAD observed during review: `master...origin/master`; unrelated modified review files were already present in `.context/reviews/`.

## Inventory

Instructions/docs read first:

- `AGENTS.md` workspace rules from the user prompt.
- `CLAUDE.md` project architecture, security model, upload/queue/search/restore/deploy notes.
- Prior review artifact `.context/reviews/tracer.md` to avoid carrying stale cycle-18 conclusions forward.

Primary route/action/library inventory:

- Upload and delete: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/process-image.ts`.
- Queue and backfill: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/queue-shutdown.ts`.
- Search and public rate limits: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`.
- Auth/session/admin actions: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`.
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/scripts/migrate.js`.
- Public serving/cache: `apps/web/src/lib/serve-upload.ts`, upload route handlers under `apps/web/src/app/**/uploads/[...path]/route.ts`, `apps/web/next.config.ts`, `apps/web/src/lib/revalidation.ts`.
- UI state: `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/components/image-manager.tsx`.

Relevant test/docs inventory:

- `apps/web/src/__tests__/semantic-search-route.test.ts`
- `apps/web/src/__tests__/clip-model-contract.test.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/restore-upload-lock.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/touch-target-audit.test.ts`
- `CLAUDE.md` sections covering single-instance deployment, CLIP semantic search, upload privacy/HDR behavior, restore, and operational playbooks.

No test suite was run because this was source-read-only causal tracing. Validation evidence is file/symbol tracing with exact line regions.

## Findings

### TRC19-01: Disconnected semantic-search requests can remain queued and later consume CLIP inference capacity

Severity: Medium

Confidence: High

Files/regions:

- `apps/web/src/app/api/search/semantic/route.ts:168-183` checks an already-aborted request before charging the semantic-search rate limit.
- `apps/web/src/app/api/search/semantic/route.ts:246-257` calls `embedTextReal(query)` and only checks `request.signal.aborted` after embedding returns.
- `apps/web/src/lib/clip-model.ts:65-85` defines global inference concurrency, pending-queue state, queue-full errors, and wait timeouts.
- `apps/web/src/lib/clip-model.ts:94-114` stores pending waiters until a slot is released or the queue wait timeout fires; no `AbortSignal` is accepted or removed.
- `apps/web/src/lib/clip-model.ts:116-127` increments `activeInferenceCount`, runs the model callback, then releases the slot; no abort check happens after slot acquisition.
- `apps/web/src/lib/clip-model.ts:194-216` exposes `embedTextReal(query)` with no signal parameter and calls `withInferenceSlot(() => model(...))`.
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-39` covers bounded queue/timeout behavior but not abort removal.

Causality chain:

1. The semantic route is intentionally rate-limited before config/body-heavy work, then enters production embedding via `embedTextReal(query)`.
2. The route can notice aborts before embedding and after embedding, but it cannot cancel a request that is waiting inside the CLIP inference queue because the signal is not threaded into `embedTextReal`, `withInferenceSlot`, or `waitForInferenceSlot`.
3. A disconnected request that has entered `waitForInferenceSlot()` remains in `inferenceWaitQueue` until the wait timeout or until another request releases a slot.
4. If it obtains a slot before timeout, it still runs the ONNX text model even though the HTTP client is gone. The queue bound prevents unbounded memory growth, but scarce CLIP slots and CPU can be consumed by abandoned work.

Failure scenario:

In production semantic mode with `CLIP_INFERENCE_CONCURRENCY=1`, a burst of clients submits valid semantic-search requests and disconnects while queued. Up to `CLIP_INFERENCE_MAX_PENDING` abandoned waiters can remain alive. As active requests finish, some abandoned waiters acquire the slot and execute CLIP inference, delaying real users and wasting CPU during a burst.

Suggested fix:

Thread `request.signal` through the embedding path, for example `embedTextReal(query, { signal })`, `withInferenceSlot(fn, signal)`, and `waitForInferenceSlot(signal)`. If the signal aborts while queued, remove that waiter, clear its timeout, and reject with an abort-specific error. After acquiring a slot, check the signal again before invoking the model. Add a focused contract test that a queued inference is rejected and removed when its signal aborts, without consuming a later slot.

### TRC19-02: The public mutating-route rate-limit scanner can be bypassed with aliased non-limiter imports

Severity: Medium

Confidence: High

Files/regions:

- `apps/web/scripts/check-public-route-rate-limit.ts:38-42` declares approved rate-limit source modules.
- `apps/web/scripts/check-public-route-rate-limit.ts:96-115` records approved imported helpers by the local binding name, not by the exported symbol name.
- `apps/web/scripts/check-public-route-rate-limit.ts:118-122` treats any approved local binding whose local name starts with `preIncrement`, `checkAndIncrement`, or `assertPublicRateLimit` as a limiter.
- `apps/web/scripts/check-public-route-rate-limit.ts:188-207` accepts an early `return 429` branch guarded by such a helper call as the route's rate-limit proof.
- `apps/web/scripts/check-public-route-rate-limit.ts:366-370` fails the lint gate only when no approved helper call is found.
- `apps/web/src/lib/rate-limit.ts:378-385` exports `rollbackSemanticAttempt`, a valid import from an approved module that is not a pre-increment limiter.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:270-281` checks a direct rollback import is rejected, but there is no alias regression.

Causality chain:

1. The scanner is source-based and intentionally allows only mutating public API routes that call a pre-increment/check helper before mutation.
2. During import collection, an aliased named import such as `rollbackSemanticAttempt as preIncrementSemanticAttempt` is stored under the local alias.
3. Later, the call classifier only checks the local binding name prefix and module allow-list. It does not verify that the exported import was actually a pre-increment/check helper.
4. A route can therefore appear lint-clean while calling a rollback helper or other non-limiter function under a limiter-looking alias. At runtime, such a call would not enforce a limit and could even decrement counters before mutation.

Current exposure:

I did not find an existing route using this alias pattern. This is a tooling failure mode that can admit a future vulnerable route despite the project's blocking lint policy.

Failure scenario:

A future public `POST` route imports `rollbackSemanticAttempt as preIncrementSemanticAttempt` from `@/lib/rate-limit`, then writes:

```ts
if (preIncrementSemanticAttempt(ip)) {
  return NextResponse.json({ error: "Too many requests" }, { status: 429 });
}
```

The scanner accepts it because the local name starts with `preIncrement`, but `rollbackSemanticAttempt()` returns `void`, so the guard never returns 429 and the request proceeds without a real public mutation rate limit.

Suggested fix:

In `collectApprovedRateLimitImports()`, classify named imports by exported symbol (`element.propertyName?.text ?? element.name.text`) and only then record the local binding. Prefer an explicit exported-helper allow-list over prefix matching. Add a regression test with `rollbackSemanticAttempt as preIncrementSemanticAttempt` and expect the scanner to fail.

### TRC19-03: Semantic-search rate-limit comments and tests no longer match the charged implementation

Severity: Low

Confidence: High

Files/regions:

- `apps/web/src/app/api/search/semantic/route.ts:12-16` says disabled/keyword mode returns before rate-limit charging.
- `apps/web/src/app/api/search/semantic/route.ts:172-183` actually charges via `preIncrementSemanticAttempt()` before loading semantic-search config.
- `apps/web/src/app/api/search/semantic/route.ts:185-200` returns disabled/not-configured responses after the charge.
- `apps/web/src/app/api/search/semantic/route.ts:237-244` returns short/long query validation errors after the charge and without rollback.
- `apps/web/src/lib/rate-limit.ts:24-34` documents a "refund pre-work validation failures" semantic pattern for short-query rejections, which contradicts the current route.
- `apps/web/src/__tests__/semantic-search-route.test.ts:230-242` covers short/long query status/body only, not charge/no-rollback semantics.
- `apps/web/src/__tests__/semantic-search-route.test.ts:244-260` already asserts disabled mode still calls `preIncrementSemanticAttempt()` once, contradicting the route header comment.

Causality chain:

1. The implementation currently charges semantic search attempts before config lookup, body parsing completion, and query validation. This is defensible because it protects DB/config and parsing work from repeated probes.
2. The route-level comment and rate-limit library guidance describe an older or intended policy where disabled mode and short-query failures are not charged.
3. The tests partially encode the implementation for disabled mode, but they do not lock the short/long query no-refund behavior.
4. A maintainer following the stale comments could move config reads before the rate limiter or add rollback for short-query probes, weakening the current admission-control posture.

Failure scenario:

A future cleanup "fixes" the implementation to match the comments by checking config before charging and refunding invalid query lengths. Attackers can then repeatedly force config reads and body parsing with disabled-mode or invalid-query requests at little or no rate-limit cost.

Suggested fix:

Update the route header and `rate-limit.ts` semantic-search guidance to describe the current charged policy, including disabled mode and invalid query lengths. Add route tests that short and long semantic queries call `preIncrementSemanticAttempt()` once and do not call rollback. If the intended product policy is actually to refund those cases, make that an explicit design change with tests that cover the new attack surface.

## Confirmed Negative Traces

### Upload, Processing, Delete, Backfill

Browser upload is restore-gated and origin/admin-gated before work (`apps/web/src/app/actions/images.ts:116-126`), claims upload quota before disk-heavy work (`apps/web/src/app/actions/images.ts:191-242`), checks disk/topic validity with rollback paths (`apps/web/src/app/actions/images.ts:247-293`), saves originals only after admission (`apps/web/src/app/actions/images.ts:350-352`), cleans up on HDR rejection (`apps/web/src/app/actions/images.ts:355-360`), strips GPS from originals when configured (`apps/web/src/app/actions/images.ts:379-396`), rechecks restore after file save (`apps/web/src/app/actions/images.ts:398-409`), inserts the DB row (`apps/web/src/app/actions/images.ts:413-461`), enqueues with a full settings snapshot (`apps/web/src/app/actions/images.ts:499-531`), settles quota state (`apps/web/src/app/actions/images.ts:570-596`), and releases the upload contract lock in `finally` (`apps/web/src/app/actions/images.ts:622-623`).

Lightroom upload follows the same causal shape with token-scope auth (`apps/web/src/app/api/admin/lr/upload/route.ts:68-76`), maintenance and transfer limits (`apps/web/src/app/api/admin/lr/upload/route.ts:78-112`), tracker preclaim (`apps/web/src/app/api/admin/lr/upload/route.ts:114-151`), upload contract lock (`apps/web/src/app/api/admin/lr/upload/route.ts:243-259`), post-save HDR/GPS/restore cleanup (`apps/web/src/app/api/admin/lr/upload/route.ts:333-471`), full enqueue snapshot (`apps/web/src/app/api/admin/lr/upload/route.ts:479-516`), and lock release (`apps/web/src/app/api/admin/lr/upload/route.ts:548-552`).

Delete paths clear queue state before DB deletion and clean all known variants afterward (`apps/web/src/app/actions/images.ts:676-709`, `apps/web/src/app/actions/images.ts:789-856`). Queue jobs use per-image advisory locks, verify the row is still pending, process from the resolved original, conditionally update only if the row is still pending, and delete newly generated variants if the image disappeared mid-job (`apps/web/src/lib/image-queue.ts:446-473`, `apps/web/src/lib/image-queue.ts:519-675`). Backfill uses both a global backfill lock and per-image locks, cleans outputs for deleted-mid-reencode rows, and avoids version bumps on color-detection failure (`apps/web/src/lib/admin-backfill-runner.ts:348-453`, `apps/web/src/lib/admin-backfill-runner.ts:455-630`).

### Search And Rate Limits

Keyword search through the server action validates input, pre-increments in-memory and DB rate limits before calling search, and rolls back DB counters if the search operation itself fails (`apps/web/src/app/actions/public.ts:237-318`). Similar search is same-origin and maintenance-gated, charges semantic attempts before config and DB work, and requires production semantic mode before scanning embeddings (`apps/web/src/app/api/search/similar/[id]/route.ts:63-112`). The promoted search issues are limited to CLIP abort behavior and lint-policy drift; I did not find an active unmetered mutating public route in the current source.

### Auth, Session, Admin Actions

Login enforces same-origin, IP/account rate limits before Argon2 verification, dummy-hash timing equalization for absent users, and session rotation inside a DB transaction (`apps/web/src/app/actions/auth.ts:70-258`). Password update validates before charging expensive password-change rate limits, verifies the current hash, rotates sessions, and does not refund infrastructure errors (`apps/web/src/app/actions/auth.ts:283-445`). Session verification requires a production secret, validates HMAC with timing-safe comparison, checks max age, and confirms the DB session row (`apps/web/src/lib/session.ts:16-36`, `apps/web/src/lib/session.ts:94-151`). Admin API auth supports scoped Lightroom tokens while cookie-based admin access still requires same-origin and an admin session (`apps/web/src/lib/api-auth.ts:58-144`). Admin-user deletion uses a DB advisory lock to protect last-admin and self-delete invariants (`apps/web/src/app/actions/admin-users.ts:217-295`).

### Backup And Restore

Backup/restore uses admin and same-origin gates. Backup obtains `LOCK_DB_RESTORE` for the dump window and validates nonempty dump headers before exposing the file (`apps/web/src/app/[locale]/admin/db-actions.ts:119-300`). Restore obtains the DB restore lock, upload contract lock, and backfill lock, begins restore maintenance, flushes view counts, quiesces queue workers, runs the restore, and keeps maintenance enabled on failure (`apps/web/src/app/[locale]/admin/db-actions.ts:309-458`, `apps/web/src/app/[locale]/admin/db-actions.ts:462-648`). Backup download validates names, rejects symlinks, checks realpath containment, emits no-store headers, and streams the resolved file (`apps/web/src/app/api/admin/db/download/route.ts:22-103`).

### Public Serving And Cache

Upload serving validates allowed directories/extensions, rejects unsafe path segments, resolves realpaths under upload roots, builds ETags from pipeline/settings/mtime/size, supports conditional requests and HEAD, and destroys streams on abort (`apps/web/src/lib/serve-upload.ts:127-312`). Next upload headers are cacheable but must revalidate (`apps/web/next.config.ts:56-73`). Revalidation fans out localized route variants after mutations (`apps/web/src/lib/revalidation.ts:11-64`). I did not find an active symlink traversal or stale-cache leak in the traced public upload serving path.

### UI State

Search UI uses request IDs, abort controllers, stale-response guards after fetch and JSON parse, body-scroll cleanup, focus restoration, and keyboard handling (`apps/web/src/components/search.tsx:143-267`, `apps/web/src/components/search.tsx:294-342`). Load-more state resets on query changes and uses mounted/query-version guards around async pagination (`apps/web/src/components/load-more.tsx:31-144`). Upload-dropzone revokes object URLs, enforces client-side count limits, and reads latest topic/tag refs during sequential uploads (`apps/web/src/components/upload-dropzone.tsx:100-276`). Bulk-delete UI waits for delete completion before closing selection state (`apps/web/src/components/image-manager.tsx:374-416`). I did not promote a UI-state finding.

## Missed-Issue Sweep

Final sweep rechecked the main competing hypotheses after drafting findings:

- No active upload/restore writer race found in browser or Lightroom upload paths; the lock and late restore checks cover the traced windows.
- No delete-mid-processing orphan variant path found in queue/backfill; generated outputs are removed when conditional DB updates lose the race.
- No current public mutating route was found using the aliased rate-limit bypass pattern; the issue is in the lint guard.
- No auth/session path was found that bypasses same-origin on cookie admin access; token bypass is scope-gated for Lightroom upload.
- No backup download traversal or cacheable private DB dump response found.
- No public upload route traversal found after realpath and extension checks.
- No UI async-state race was found that crosses into data loss or auth/security behavior.

Finding count: 3.
