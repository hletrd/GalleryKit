# Security Reviewer — Cycle 11

## Method
Deep security review of authentication, authorization, session management, input validation, file upload handling, rate limiting, CSP, and data exposure. Examined: auth.ts, session.ts, rate-limit.ts, proxy.ts, content-security-policy.ts, validation.ts, sanitize.ts, action-guards.ts, request-origin.ts, images.ts, sharing.ts, public.ts, admin-users.ts, db-actions.ts, upload-tracker.ts, upload-tracker-state.ts, image-queue.ts, db-restore.ts, sql-restore-scan.ts, serve-upload.ts, upload-paths.ts, process-image.ts, csv-escape.ts, blur-data-url.ts, api routes.

## Findings

### C11-SR-01 (Medium / Medium): `proxy.ts` middleware cookie format check accepts 3-part tokens with empty fields

- **File+line**: `apps/web/src/proxy.ts:87`
- **Issue**: The middleware checks `token.split(':').length !== 3` to validate cookie format. A token like `::abc` would pass this check (3 parts, all potentially empty). The full `verifySessionToken` validates each part, so the middleware check is only a fast-path filter. A token of three empty strings would pass the middleware but fail verification — correct but wasteful.
- **Fix**: Add a minimum-length check for each part. Low priority since the middleware is a fast-path, not a security boundary.
- **Confidence**: Low

### C11-SR-02 (Low / Medium): `getImageByShareKey` performs a sequential DB query for tags after the image query, creating a minor timing side-channel

- **File+line**: `apps/web/src/lib/data.ts:868-909`
- **Issue**: `getImageByShareKey` first queries the image by share_key, then queries tags in a separate sequential query. An attacker probing random share keys could potentially distinguish "valid key, no tags" from "invalid key" by response timing. The share key is 10-char base56 (57 bits of entropy), making brute-force impractical. The timing difference is very small.
- **Fix**: Consider running the image query and tag query in parallel (like `getImage` does with `Promise.all`). Low priority given the key entropy.
- **Confidence**: Low-Medium
