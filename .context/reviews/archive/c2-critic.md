# Critic — Cycle 2 Deep Review

## C2-CT-01 (High/High): `permanentlyFailedIds` not cleaned on image deletion — multi-agent consensus

- **File**: `apps/web/src/app/actions/images.ts:482-483`, `584-588`
- **Issue**: Flagged by code-reviewer, security-reviewer, debugger, test-engineer, and architect. The deletion paths don't clean up `permanentlyFailedIds`, creating a silent bootstrap exclusion bug after DB restore + auto-increment reuse. This is the highest-signal finding of this cycle (5 agents agree).
- **Fix**: Add `queueState.permanentlyFailedIds.delete(id)` in both `deleteImage()` and `deleteImages()`.
- **Confidence**: High (5-agent consensus)

## C2-CT-02 (Medium/High): `normalizeStringRecord` bypasses the Unicode formatting rejection policy

- **File**: `apps/web/src/lib/sanitize.ts:35-55`
- **Issue**: Flagged by code-reviewer, security-reviewer, and architect. The function strips Unicode formatting characters but doesn't reject them, creating a gap in the C7R-RPL-11 defense-in-depth chain. Admin SEO settings are the primary affected surface. Three agents agree this is a real architectural inconsistency.
- **Fix**: Add a `rejected` field to `normalizeStringRecord`'s return type, matching `sanitizeAdminString`.
- **Confidence**: High (3-agent consensus)

## C2-CT-03 (Medium/Medium): Admin user creation password length check may happen before control-char stripping

- **File**: `apps/web/src/app/actions/admin-users.ts`
- **Issue**: Flagged by security-reviewer and debugger. If the password length check occurs before `stripControlChars`, passwords with control characters could pass the >= 12 check but have a shorter effective length. This undermines the minimum password length security guarantee.
- **Fix**: Verify the ordering and fix if needed.
- **Confidence**: Medium (2-agent consensus, needs verification)

## C2-CT-04 (Medium/Medium): Rate-limit pattern inconsistency across the codebase

- **File**: Multiple files
- **Issue**: Flagged by architect. Three distinct rate-limit rollback patterns exist with no centralized documentation. The inconsistency was partially addressed in cycle 1 (removing rollback on infrastructure errors in auth), but the documentation gap remains.
- **Fix**: Add documentation in `lib/rate-limit.ts` explaining when to use each pattern.
- **Confidence**: Medium

## C2-CT-05 (Medium/Medium): `loadMoreImages` re-throws error without client-side error handling

- **File**: `apps/web/src/app/actions/public.ts:105-108`
- **Issue**: Flagged by code-reviewer and debugger. The server action re-throws on `getImagesLite` failure, but the client component may not handle this gracefully, leaving the "Load More" button in a broken state.
- **Fix**: Add client-side error handling with a toast notification.
- **Confidence**: Medium (2-agent consensus)

## Summary

- Total findings: 5
- High: 1 (5-agent consensus)
- Medium: 4
