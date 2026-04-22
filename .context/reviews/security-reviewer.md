# Cycle 11 Security Reviewer Notes

Finding count: 5

## Findings

### S11-01 — Historical session secret was committed in git history
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citation:** historical `apps/web/.env.local.example` in commit `d068a7fbd62642d574d605055afe8df9c223f635`
- Operational rotation/invalidation follow-up, not a bounded code-only fix.

### S11-02 — Share links have no default expiry
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citations:** `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`
- Bearer links remain valid until manual revocation.

### S11-03 — Login lacked same-origin request validation
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Citation:** `apps/web/src/app/actions/auth.ts`
- Login could be triggered without an explicit origin/referer consistency check.

### S11-04 — Local workspace secrets remain plaintext in `.env.local`
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Citation:** `apps/web/.env.local`
- Local operational risk only; file is untracked.

### S11-05 — Dev-only audit findings remain in the toolchain
- **Severity:** LOW
- **Confidence:** HIGH
- **Citation:** `npm audit --workspaces --json`
- Development-time `esbuild` advisory via `drizzle-kit` chain; prod audit was clean.
