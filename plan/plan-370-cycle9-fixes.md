# Plan 370 - Cycle 9/100 Fixes

Created: 2026-06-29
Source: `.context/reviews/_aggregate.md` and cycle 9 per-agent reports.
Status: DONE

This plan schedules every non-deferred cycle 9 finding for implementation. Deferred findings are recorded in `plan/plan-371-cycle9-deferred.md`. No cycle 9 aggregate finding is silently dropped.

Required gates after implementation:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

Deployment after green gates and pushed commits:

- `npm run deploy`

## Work Items

### 1. Analytics retention purge indexes

Status: DONE
Findings: C9-02
Original severity/confidence: Medium / High
Citations: `apps/web/src/lib/view-retention.ts:56-81`, `apps/web/src/db/schema.ts:231-259`

Implementation:

- Add `viewed_at`-leading purge indexes for `image_views`, `topic_views`, and `shared_group_views`.
- Add a Drizzle migration with a journal `when` strictly greater than the current max.
- Mirror the indexes in `apps/web/src/db/schema.ts` and `apps/web/scripts/migrate.js` reconcile coverage.
- Update retention comments to reference the new purge indexes.
- Add/update tests that assert schema/reconcile coverage includes the new indexes.

Acceptance:

- Migration journal tests and reconcile coverage pass.
- View-retention source comments match the index shape.

### 2. Failed-image retry must preserve failure state on rejected enqueue

Status: DONE
Findings: C9-03
Original severity/confidence: Medium / High
Citations: `apps/web/src/app/actions/images.ts:1196-1239`, `apps/web/src/lib/image-queue.ts:388-400`, `apps/web/src/lib/image-queue.ts:828`, `apps/web/src/__tests__/failed-image-retry.test.ts:99-105`

Implementation:

- Capture the boolean return from `enqueueImageProcessing(...)` in `retryFailedImage`.
- If enqueue is rejected, restore or preserve a visible `processing_error` / `failed_at` state and return an admin-visible error.
- Add a behavioral test where enqueue returns `false` and the action does not report success.

Acceptance:

- Retry success is only returned after the row is re-enqueued.
- A rejected retry remains visible as failed.

### 3. Docker native package architecture normalization

Status: DONE
Findings: C9-04
Original severity/confidence: Medium / High
Citations: `apps/web/Dockerfile:38-51`, `apps/web/README.md:48-49`, `CLAUDE.md:17`, `CLAUDE.md:556-559`

Implementation:

- Normalize Docker `TARGETARCH` to npm native package architecture names before installing native optional packages (`amd64 -> x64`, `arm64 -> arm64`).
- Fail clearly on unsupported architectures.
- Add a source-contract test to reject raw `${TARGETARCH}` interpolation in native npm package names.

Acceptance:

- Dockerfile no longer attempts `linux-amd64` package names.
- The source-contract test fails if this regression returns.

### 4. Lightroom token least-privilege and expiry honesty

Status: DONE
Findings: C9-05
Original severity/confidence: Medium / High
Citations: `apps/web/messages/en.json:781-806`, `apps/web/messages/ko.json:831-856`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:57-61`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:128-181`, `apps/web/src/app/actions/lr-tokens.ts:28-93`, `apps/web/src/lib/admin-tokens.ts:24-25`, `apps/web/src/app/api/admin/lr/upload/route.ts:527`

Implementation:

- Mint UI-created Lightroom tokens with only `lr:upload` until read/delete endpoints and scope selection exist.
- Update English and Korean copy to say upload access only.
- Display explicit "Never expires; revoke to disable" copy for tokens without `expiresAt`.
- Add tests for minted scopes and non-expiring token display/copy where existing test style supports it.

Acceptance:

- Newly created UI tokens are least-privilege for the only implemented route.
- Non-expiring tokens are explicit in the UI.

### 5. Public analytics write validation and shared-group counter consistency

Status: DONE
Findings: C9-06, C9-14
Original severity/confidence: Medium / Medium; Low / High
Citations: `apps/web/src/app/actions/public.ts:319-414`, `apps/web/src/db/schema.ts:220-260`, `apps/web/src/lib/analytics-data.ts:28-53`, `apps/web/src/lib/analytics-data.ts:161-185`, `apps/web/src/lib/data.ts:1312-1327`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:93-119`, `apps/web/src/lib/data.ts:120-125`

Implementation:

- Make public analytics writes verify the target still represents a public/processed/valid object before inserting durable rows.
- For shared groups, avoid raw group-id trust where feasible by using route-resolved validity or by inserting only when the group is unexpired and has processed images.
- Use the same route-level selected-photo validity decision for denormalized shared `view_count` and durable `shared_group_views` rows.
- Add focused tests for invalid photo/topic/group identifiers and invalid `photoId` shared-group URLs.

Acceptance:

- Synthetic internal IDs do not create durable analytics rows unless they represent public valid state.
- Invalid selected-photo share URLs cannot increment only one of the two shared-group counters.

### 6. Semantic embedding retry after processed=true

Status: DONE
Findings: C9-07
Original severity/confidence: Medium / High
Citations: `apps/web/src/lib/image-queue.ts:556-683`, `apps/web/src/lib/image-queue.ts:823-859`, `CLAUDE.md:151`, `apps/web/README.md:53-73`

Implementation:

- Add a durable retry path for processed images missing the active semantic embedding.
- Prefer reusing existing bootstrap/background queue infrastructure to scan a bounded batch of `processed=true` rows missing the active model version and run embedding side effects.
- Keep production gating via the current semantic mode/env/model-version helpers.
- Add tests/source contracts proving missing active-model embeddings are retried after restart/bootstrap.

Acceptance:

- A transient embedding failure after `processed=true` no longer leaves a photo permanently absent from semantic/similar search without manual sidecar backfill.

### 7. Topic map visibility runtime validation

Status: DONE
Findings: C9-08
Original severity/confidence: Medium / High
Citations: `apps/web/src/app/actions/topics.ts:594-614`, `apps/web/src/db/schema.ts:4-12`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:66`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:244-245`

Implementation:

- Reject `mapVisible` values where `typeof mapVisible !== 'boolean'` before persistence/audit logging.
- Add a malformed-value regression test.

Acceptance:

- Public map/GPS visibility accepts only explicit booleans at runtime.

### 8. DB restore temp-file cleanup ownership

Status: DONE
Findings: C9-09
Original severity/confidence: Low / High
Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:434-493`, `apps/web/src/app/[locale]/admin/db-actions.ts:499-585`

Implementation:

- Add one idempotent cleanup owner around the full post-write restore flow.
- Ensure validation/setup exceptions after `pipeline(...)` cannot leave the uploaded SQL temp file behind.
- Add a focused source or behavioral test for cleanup on post-write failure.

Acceptance:

- Every post-write restore path either transfers cleanup to the mysql close handler or unlinks in a finalizer.

### 9. Bulk update existing-row accounting

Status: DONE
Findings: C9-10
Original severity/confidence: Low / Medium
Citations: `apps/web/src/app/actions/images.ts:940-963`, `apps/web/src/app/actions/images.ts:1024-1037`, `apps/web/src/app/actions/images.ts:1091-1134`, `apps/web/src/app/actions/tags.ts:304-343`

Implementation:

- Canonicalize requested IDs to existing image IDs inside the transaction.
- Use the existing-id set for scalar updates, tag insert/remove values, audit metadata, and returned count.
- Return a warning or explicit partial count when requested IDs disappeared.
- Add a concurrent-deletion/stale-ID regression test.

Acceptance:

- Success counts match existing rows actually eligible for mutation.

### 10. Semantic scan limit hard cap

Status: DONE
Findings: C9-12
Original severity/confidence: Medium / Medium
Citations: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:242-280`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`

Implementation:

- Lower `SEMANTIC_SCAN_LIMIT` maximum to a host-budgeted cap suitable for the current brute-force path.
- Update docs/comments/tests to reflect the new cap.

Acceptance:

- Misconfiguration cannot request million-row embedding scans in one public request.

### 11. Lightroom upload generic processor errors

Status: DONE
Findings: C9-15
Original severity/confidence: Low / Medium
Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:284-304`, `apps/web/src/lib/process-image.ts:844-887`

Implementation:

- Return a fixed client-facing message for unknown non-RAW processor failures.
- Keep detailed exception logging server-side.
- Preserve the explicit RAW-file rejection message.
- Add/update route tests for generic versus RAW failure responses.

Acceptance:

- PAT callers do not receive raw internal error strings for unexpected processing failures.

### 12. Sidecar deleted-mid-reencode cleanup resilience

Status: DONE
Findings: C9-16
Original severity/confidence: Low / Medium
Citations: `apps/web/scripts/backfill-color-pipeline.ts:127-132`, `apps/web/scripts/backfill-color-pipeline.ts:400-459`, `apps/web/src/lib/admin-backfill-runner.ts:430-439`

Implementation:

- Catch and log cleanup failures inside the sidecar deleted-mid-reencode cleanup helper.
- Preserve successful committed DB batch results.
- Add a focused test proving cleanup errors do not reject the post-commit flush path.

Acceptance:

- Best-effort orphan cleanup no longer aborts a sidecar run after DB work is committed.

### 13. Rate-limit comment and test-header alignment

Status: DONE
Findings: C9-17
Original severity/confidence: Low / High
Citations: `apps/web/src/lib/rate-limit.ts:17-30`, `apps/web/src/lib/rate-limit.ts:323-340`, `apps/web/src/app/api/search/semantic/route.ts:12-16`, `apps/web/src/app/api/search/semantic/route.ts:181-230`, `apps/web/src/__tests__/semantic-search-route.test.ts:187`, `apps/web/src/__tests__/og-photo-fallback.test.ts:9-10`, `apps/web/src/app/api/og/photo/[id]/route.tsx:126-131`

Implementation:

- Update comments/test headers to match current charged/refunded branches for semantic and OG routes.
- Avoid behavioral code changes unless tests prove comments were hiding a real mismatch.

Acceptance:

- Documentation no longer invites rollback-policy regressions.

### 14. Action-origin documentation alignment

Status: DONE
Findings: C9-18
Original severity/confidence: Medium / High
Citations: `CLAUDE.md:590-602`, `apps/web/src/app/actions/public.ts:311-314`, `apps/web/scripts/check-action-origin.ts:49`, `apps/web/scripts/check-action-origin.ts:360-364`, `apps/web/scripts/check-action-origin.ts:488-490`

Implementation:

- Update `CLAUDE.md` and `actions/public.ts` comments to say `public.ts` is included by `lint:action-origin`.
- Document the narrower public-action contract: public mutating actions need the exempt comment and rate-limit-before-mutation proof.

Acceptance:

- Security docs match scanner behavior.

### 15. Deploy env-file docs alignment

Status: DONE
Findings: C9-19
Original severity/confidence: Low / High
Citations: `AGENTS.md:17-18`, `README.md:108-116`, `CLAUDE.md:648-657`, `.env.deploy.example:1-4`, `scripts/deploy-remote.sh:22-29`, `scripts/deploy-remote.sh:55-58`

Implementation:

- Make `.env.deploy.example`, README/CLAUDE/AGENTS wording, and deploy-helper output agree on the canonical default.
- Preserve support for `DEPLOY_ENV_FILE` and external fallback if still desired.

Acceptance:

- Operators see one primary deploy-env path and one clearly labeled alternative.

### 16. Service worker generated artifact freshness

Status: DONE
Findings: C9-20
Original severity/confidence: Medium / High
Citations: `CLAUDE.md:402-403`, `apps/web/scripts/build-sw.ts:28-47`, `apps/web/package.json:10`, `apps/web/public/sw.js:21-26`

Implementation:

- Regenerate `apps/web/public/sw.js` for current HEAD during implementation.
- Add a test or source contract that catches stale checked-in service-worker stamps, or deliberately adjust the stamp contract if commit-SHA drift is accepted.

Acceptance:

- Checked-in `sw.js` is fresh at commit time and stale artifacts are caught.

### 17. Tracked secret artifact scan

Status: DONE
Findings: C9-21
Original severity/confidence: Low / High
Citations: `.context/plans/done/plan-166-cycle1-admin-upload-test-and-docs.md:22`, `.context/reviews/archive/security-reviewer-cycle1-rpf.md:167-196`, `.context/reviews/archive/security-reviewer-cycle7-rpf.md:36-38`, `.context/reviews/logs-cycle4/designer.log:2467`, `.context/reviews/run7-cycle1/security-reviewer.md:42`, `plan/plan-353-run6-cycle3-deferred.md:168`, `apps/web/src/__tests__/tracked-secrets.test.ts:5-20`

Implementation:

- Redact committed credential-assignment strings to placeholders without preserving values.
- Broaden `tracked-secrets.test.ts` to scan all tracked docs/logs/source/config file types that can carry accidental secrets.
- Add explicit placeholder allowlists rather than hard-coded review-file subsets.

Acceptance:

- Targeted secret scan catches credential assignments anywhere in tracked review/plan/log material.

### 18. Missing tests for semantic malformed rows and audit metadata serialization

Status: DONE
Findings: C9-22 partial
Original severity/confidence: Medium / High
Citations: `.context/reviews/test-engineer.md` findings `TE9-C01`, `TE9-C02`

Implementation:

- Add a semantic-route regression test proving mixed malformed scanned embedding rows are skipped without failing the whole query.
- Add `logAuditEvent` behavior tests for metadata serialization priority/truncation.

Acceptance:

- The two concrete behavior gaps from C9-22 have executable regression coverage.

## Deferred Cross-References

- C9-01, C9-11, C9-13, and broad portions of C9-22 are deferred in `plan/plan-371-cycle9-deferred.md`.
- Manual validation / operational risks from the aggregate are recorded in `plan/plan-371-cycle9-deferred.md`.

## Coverage Assertion

- C9-02 -> Work item 1.
- C9-03 -> Work item 2.
- C9-04 -> Work item 3.
- C9-05 -> Work item 4.
- C9-06 and C9-14 -> Work item 5.
- C9-07 -> Work item 6.
- C9-08 -> Work item 7.
- C9-09 -> Work item 8.
- C9-10 -> Work item 9.
- C9-12 -> Work item 10.
- C9-15 -> Work item 11.
- C9-16 -> Work item 12.
- C9-17 -> Work item 13.
- C9-18 -> Work item 14.
- C9-19 -> Work item 15.
- C9-20 -> Work item 16.
- C9-21 -> Work item 17.
- C9-22 TE9-C01 and TE9-C02 -> Work item 18.

