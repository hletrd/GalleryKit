# Code Review Summary — Cycle 6

Scope reviewed: 279 review-relevant files across source, tests, scripts, configs, and docs. Diagnostics observed by the agent: lint, typecheck, and unit tests passed. Final sweep found no additional actionable code-quality issues.

## Findings

### CR6-01 — Fresh deployments can reject the first upload as “insufficient disk space”
- **Location:** `apps/web/src/app/actions/images.ts:148-157`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed, environment-dependent.
- **Problem:** `uploadImages()` runs `statfs(UPLOAD_DIR_ORIGINAL)` before ensuring that the upload directories exist. A clean volume can throw `ENOENT`, which the action maps to `insufficientDiskSpace`.
- **Failure scenario:** A new install with no `data/uploads/original` directory rejects the first upload despite adequate disk space.
- **Suggested fix:** Ensure upload directories before the disk-space check, or stat an always-existing parent path.

### CR6-02 — `TRUSTED_PROXY_HOPS` misconfiguration fails open to a spoofable client IP
- **Location:** `apps/web/src/lib/rate-limit.ts:72-88`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed.
- **Problem:** With `TRUST_PROXY=true`, if the forwarded chain is shorter than `TRUSTED_PROXY_HOPS`, `getClientIp()` falls back to `validParts[0]`, the least trustworthy address.
- **Failure scenario:** An operator configures two trusted hops but only one proxy is present; a client can influence the selected IP via `X-Forwarded-For`, weakening rate limits and audit attribution.
- **Suggested fix:** Fail closed when the chain is shorter than the configured trusted hop count; use a separately trusted source or `unknown`.

### CR6-03 — Deleting a non-existent topic alias reports success
- **Location:** `apps/web/src/app/actions/topics.ts:454-474`
- **Severity/confidence:** Low / High
- **Status:** Confirmed.
- **Problem:** `deleteTopicAlias()` ignores `affectedRows === 0` and always returns success after the delete.
- **Failure scenario:** A stale UI or concurrent delete reports success even though no alias was removed.
- **Suggested fix:** Check `affectedRows` and return a not-found/idempotent no-op result explicitly.
