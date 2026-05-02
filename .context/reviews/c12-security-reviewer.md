# Cycle 12 Security Review

## Review Scope
Authentication, authorization, session management, rate limiting, file upload security, CSP, privacy enforcement, and API route protection.

## Findings

### C12-SR-01 (Medium/High): `restoreDatabase` missing `endRestoreMaintenance()` on error paths creates denial-of-service

- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:293-329`
- **Issue**: Two error paths after `beginRestoreMaintenance()` (lines 301-319 and 323-329) do not call `endRestoreMaintenance()`. The `isRestoreMaintenanceActive()` flag is a module-level boolean that guards all mutating actions (uploads, topic/image/share mutations, password changes). If either error path is hit, the process enters a permanent "restore in progress" state. Every subsequent mutating admin action returns "restore in progress" — effectively a self-inflicted DoS that persists until process restart. This is especially dangerous because:
  1. `acquireUploadProcessingContractLock(0)` can fail when an upload is in progress (legitimate race condition).
  2. `quiesceImageProcessingQueueForRestore()` can throw when the DB is under load.
  Both are plausible production scenarios, not just theoretical edge cases.
- **Fix**: Add `endRestoreMaintenance()` before both early returns.
- **Confidence**: High — traced the flag lifecycle directly.

### C12-SR-02 (Low/Low): `proxy.ts` middleware cookie format check accepts 3-part tokens with empty fields

- **File+line**: `apps/web/src/proxy.ts:87`
- **Issue**: Already flagged as C11-LOW-01. `token.split(':').length !== 3` passes for tokens like `::abc`. The full `verifySessionToken` validates each part with HMAC comparison using timing-safe equality. No security impact — just a slightly wasteful redirect. Confirming this remains valid and deferred.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-SR-03 (Low/Medium): CSP `style-src` includes `'unsafe-inline'` in production

- **File+line**: `apps/web/src/lib/content-security-policy.ts:81`
- **Issue**: Already flagged as D4-MED in prior cycles. The production CSP includes `style-src 'self' 'unsafe-inline'`. This is required by Tailwind CSS's runtime class generation. Confirming this remains valid and deferred — the nonce-based approach would require refactoring Tailwind's style injection.
- **Fix**: Already deferred.
- **Confidence**: Low — confirming existing deferred item.

### C12-SR-04 (Low/Low): `serveUploadFile` does not validate that `resolvedPath` points inside `UPLOAD_ROOT` when `UPLOAD_ROOT` itself is a symlink

- **File+line**: `apps/web/src/lib/serve-upload.ts:69-82`
- **Issue**: The function resolves `UPLOAD_ROOT` via `realpath()` (handling ENOENT) and then checks that the file's `realpath` starts with `resolvedRoot + path.sep`. However, if `UPLOAD_ROOT` itself is a symlink pointing outside the expected directory, the `realpath()` call on `UPLOAD_ROOT` would resolve the symlink, so the containment check actually works correctly. The code is correct but the symlink resolution of `UPLOAD_ROOT` on ENOENT (falling back to `path.resolve(UPLOAD_ROOT)`) could be a concern if an attacker can create a symlink at the UPLOAD_ROOT path. In practice, UPLOAD_ROOT is a constant determined by the app and not attacker-controlled. No functional vulnerability.
- **Fix**: No fix needed — the code is correct.
- **Confidence**: Low — analyzed the symlink resolution chain.

## Summary
- Total findings: 4
- Medium severity: 1 (C12-SR-01, overlaps with C12-CR-01 and C12-CR-02)
- Low severity: 3
