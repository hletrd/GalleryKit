# Debugger Review — Cycle 6 (2026-04-23)

## Scope and inventory covered
Reviewed the runtime-facing repository surface end to end: app routes, server actions, database helpers, upload/process queues, shared libs, and the client components that consume those paths. Also verified the current tree with `npm test --workspace=apps/web`, `npm run lint --workspace=apps/web`, and `npm run build --workspace=apps/web`.

## Findings summary
- Confirmed Issues: 1
- Likely Issues: 2
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### DBG6-01 — Image metadata editor keeps stale local values after a successful save
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/image-manager.tsx:226-243`, `apps/web/src/app/actions/images.ts:546-599`
- **Why it is a problem:** The client stores the raw form values back into local state after `updateImageMetadata()` succeeds, but the server action trims and control-char strips before persisting. The row can therefore diverge from the database until a manual refresh.
- **Concrete failure scenario:** An admin edits a title to `"Sunset   "` or includes control characters. The save succeeds, the database stores the normalized value, but the table continues showing the untrimmed/raw text because `setImages(...)` uses `editTitle`/`editDescription` instead of the saved value.
- **Suggested fix:** Refresh the route after success or return the normalized values from `updateImageMetadata()` and use them to update local state.

## Likely Issues

### DBG6-02 — SEO settings form can drift from the sanitized values actually persisted
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Likely
- **Files:** `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:39-56`, `apps/web/src/app/actions/seo.ts:65-127`
- **Why it is a problem:** The save handler updates `initialRef.current` from the raw in-memory form state, but the server trims and control-char strips before storage. The admin UI therefore keeps showing the pre-sanitized text even though public metadata is now using the sanitized version.
- **Concrete failure scenario:** Saving `seo_title` with leading/trailing spaces leaves those spaces visible in the admin input after success, while public pages render the trimmed title. The local diff state can also remain out of sync with the database until a full reload.
- **Suggested fix:** Return the normalized values from `updateSeoSettings()` and rehydrate the form from that response, or refresh the route after a successful save.

### DBG6-03 — Password-change rate-limit rollback loses the bucket if the post-verify transaction fails
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Likely
- **Files:** `apps/web/src/app/actions/auth.ts:342-387`, `apps/web/src/lib/auth-rate-limit.ts:66-84`
- **Why it is a problem:** `clearSuccessfulPasswordAttempts(ip)` deletes the password-change bucket before the password update/session invalidation transaction runs. If that transaction throws, the catch path calls `rollbackPasswordChangeRateLimit(ip)`, but there is no bucket left to decrement, so the pre-incremented attempt is never restored.
- **Concrete failure scenario:** A transient DB error occurs after the current password is verified but before the password update commits. The UI reports a failed password change, yet the IP gets a fresh password-change budget instead of preserving the consumed attempt count.
- **Suggested fix:** Move `clearSuccessfulPasswordAttempts(ip)` until after the transaction commits, or make the rollback path restore the prior count instead of deleting the bucket first.

## Final sweep
No additional missed issues rose above the noise floor after rechecking the remaining route/component surface and the current verification results.
