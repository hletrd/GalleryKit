# Verifier Review — verifier (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30

## Evidence-based correctness check

### Verified behavior

1. **C14-AGG-01 (audit.ts metadata truncation with ellipsis marker)**: VERIFIED — `audit.ts:38` appends `'…'` to the preview. The `truncated: true` flag and the comment explaining the preview is for human forensic debugging only are both present.

2. **C14-AGG-02 (deleteAdminUser raw SQL rationale comment)**: VERIFIED — `admin-users.ts:195-202` contains a detailed comment explaining why raw SQL is used instead of Drizzle ORM (advisory lock requires a dedicated connection that persists across multiple queries).

3. **Privacy enforcement**: `publicSelectFields` still omits all sensitive fields. Compile-time guard `_SensitiveKeysInPublic` still enforces no leakage. The `_largePayloadGuard` also still prevents `blur_data_url` from leaking into listing queries.

4. **Auth flow**: Login rate limiting still pre-increments before Argon2 verify. Password change validates form fields before consuming rate-limit attempts. Both use `unstable_rethrow` for Next.js control flow signals.

5. **Upload flow**: Full pipeline from FormData to DB insert to queue enqueue verified. `assertBlurDataUrl` contract enforced at both producer (process-image.ts) and consumer (images.ts). Upload tracker pre-increment pattern prevents TOCTOU.

6. **All audit-log gating patterns**: Re-verified every `logAuditEvent` call site — all confirmed correctly gated per the patterns established in cycles 10-13. No new ungated sites found.

7. **Image processing queue**: Per-image advisory lock prevents duplicate processing. Cursor-based bootstrap continuation handles large pending sets. `claimRetryCounts` and `retryCounts` are both pruned.

8. **Topic mutation lock**: Advisory lock `gallerykit_topic_route_segments` serializes create/update/delete to prevent TOCTOU on slug uniqueness checks.

9. **Upload serving security**: `serveUploadFile` applies directory whitelist, extension validation, symlink rejection, `realpath` containment, and content-type header.

10. **Session security**: `GET_LOCK/RELEASE_LOCK` used for `deleteAdminUser` and topic route mutations. Password change rotates all sessions in a transaction.

### Full audit-log site inventory (re-verified)

All sites match the cycle 14 inventory. No new sites added. No sites removed.

### New Findings

#### C15-V-01 (Low / Low). `deleteTopic` has a redundant `deletedRows > 0` audit-log guard

- Location: `apps/web/src/app/actions/topics.ts:354`
- The early return at line 346-348 (`if (deletedRows === 0)`) guarantees `deletedRows >= 1` when line 354 is reached. The `if (deletedRows > 0)` check is always true.
- Cross-agent: same finding as C15-CR-01 and C15-CRIT-01.
- Suggested fix: Remove the guard.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
- C4-CR-03/C5-CR-03/C6-V-01: NULL `capture_date` navigation integration test gap.
