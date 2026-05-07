# Critic Review — Cycle 1 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30
Scope: whole repository — multi-perspective critique of the overall design, tradeoffs, and risks.

## Inventory reviewed

All `apps/web/src/` files, CLAUDE.md, deployment configuration, and test suite.

---

## Findings

### C1F-CT-01 (High / High). The "personal gallery" threat model creates tension between security investment and attack surface

- The codebase invests heavily in security hardening (Argon2, HMAC sessions, advisory locks, rate limiting, CSP, origin checks, Unicode bidi validation, CSV formula injection prevention). This is appropriate for a public-facing web application. However, CLAUDE.md explicitly scopes the project as a "personal gallery" with "root-admin" accounts and no role/capability model. The security investment is high but the threat model says 2FA is "permanently deferred" because single-user Argon2id is "sufficient."
- **Tension**: The extensive defense-in-depth suggests a high-value target, but the deployment model (single Docker instance, personal NAS) suggests a low-value target. The security code adds complexity and maintenance burden that may not be proportional to the actual risk.
- **Severity**: Low — this is a design philosophy question, not a bug.
- **Fix**: No fix needed — the security posture is appropriate for a public-facing web app even at personal-gallery scale, since the gallery is exposed to the internet.

### C1F-CT-02 (Medium / Medium). Documentation-code coupling is high — CLAUDE.md references specific line numbers and cycle identifiers

- CLAUDE.md contains extensive inline references like "C7R-RPL-01", "AGG4-L01", "C8R-RPL-06", etc. These are traceability IDs from prior review cycles. While they're valuable for provenance, they create coupling between documentation and implementation that's fragile — if code is refactored, the references become stale.
- **Severity**: Low — the references are in comments, not executable code.
- **Fix**: Consider moving the detailed cycle-by-cycle provenance to `.context/` files and keeping only the current behavioral contracts in CLAUDE.md.

### C1F-CT-03 (Medium / Medium). The `publicSelectFields` pattern is clever but fragile

- Location: `apps/web/src/lib/data.ts:213-252`
- The privacy guard uses TypeScript destructuring to omit sensitive fields from `adminSelectFields`, then a compile-time type assertion (`_SensitiveKeysInPublic`) to prevent future additions. This is clever but:
  1. It requires adding a new `_omit*` variable for every sensitive field.
  2. The eslint-disable comments for unused vars are noisy.
  3. A developer adding a new sensitive field must know to add both the omit variable AND update the type guard.
- **Severity**: Low — the compile-time guard catches mistakes, but the DX could be better.
- **Fix**: Consider defining `publicSelectFields` explicitly (not derived from `adminSelectFields`) with the compile-time guard as the enforcement mechanism. This removes the need for `_omit*` variables.

### C1F-CT-04 (Low / Low). Environment variable documentation in CLAUDE.md is incomplete

- The CLAUDE.md "Environment Variables" section lists 5 env vars (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_PASSWORD, SESSION_SECRET). However, the codebase reads many more: UPLOAD_ROOT, UPLOAD_ORIGINAL_ROOT, DB_SSL, TRUST_PROXY, TRUSTED_PROXY_HOPS, AUDIT_LOG_RETENTION_DAYS, QUEUE_CONCURRENCY, SHARP_CONCURRENCY, IMAGE_MAX_INPUT_PIXELS, IMAGE_MAX_INPUT_PIXELS_TOPIC, IMAGE_CLEANUP_CONCURRENCY, UPLOAD_MAX_TOTAL_BYTES, UPLOAD_MAX_FILES_PER_WINDOW, NEXT_UPLOAD_BODY_MAX_BYTES, NEXT_PUBLIC_GA_ID, IMAGE_BASE_URL, BASE_URL, HEALTH_CHECK_DB.
- **Severity**: Low — the undocumented env vars have sensible defaults.
- **Fix**: Add a comprehensive env var reference table to CLAUDE.md or a separate `.env.local.example` with all variables documented.
