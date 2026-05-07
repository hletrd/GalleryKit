# Security Reviewer — Cycle 11 (Run 2)

**Date**: 2026-05-05
**Angle**: OWASP Top 10, secrets exposure, unsafe patterns, auth/authz, injection risks
**Scope**: Entire repository

## Agent Failure Note
The `Agent` tool is not exposed in this environment; `.claude/agents/` does not exist. This review was performed manually by a single comprehensive pass.

## Findings

### C11-SEC-01: Semantic search rate limit bypass via invalid requests
**File**: `apps/web/src/app/api/search/semantic/route.ts` (lines 76-122)
**Severity**: Medium | **Confidence**: High

The semantic search endpoint consumes its per-IP rate-limit budget (30 req/min) BEFORE performing any validation. A client can exhaust the budget by sending requests when semantic search is disabled, sending malformed JSON, or submitting queries shorter than 3 characters. Once the budget is exhausted, the client can continue sending valid requests that pass all validation but are rejected with 429, effectively creating a denial-of-service condition for legitimate same-origin users.

**CVSS-like impact**: Availability impact on a public endpoint. No confidentiality or integrity breach.

**Suggested fix**: Implement the Pattern 2 rollback convention (see `rate-limit.ts` docstring). Add a `rollbackSemanticAttempt(ip)` helper and invoke it on every early-return path before the expensive embedding work begins.

### C11-SEC-02: Semantic search request body size unbounded
**File**: `apps/web/src/app/api/search/semantic/route.ts` (line 104)
**Severity**: Low | **Confidence**: Medium

`await request.json()` is called without an explicit `Content-Length` guard. While Next.js imposes default limits, a determined attacker could exploit parser behavior or memory pressure. The endpoint performs no early rejection.

**Suggested fix**: Reject requests with `Content-Length` exceeding a small threshold (e.g., 8 KB) before parsing.

### C11-SEC-03: `data.ts` search LIKE escaping assumes backslash escape semantics
**File**: `apps/web/src/lib/data.ts` (line 1141)
**Severity**: Low | **Confidence**: Medium

```js
const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
```

This escapes `%`, `_`, and `\` by prefixing a backslash. MySQL's LIKE escaping uses backslash by default, but if the server runs with `NO_BACKSLASH_ESCAPES` SQL mode enabled, the backslash is treated as a literal character and the escaping is ineffective. An attacker could then use `%` and `_` wildcards in search queries to perform broader searches than intended.

**Note**: This is a configuration-dependent risk. The current codebase does not set or check SQL modes.

**Suggested fix**: Document the SQL mode requirement in deployment docs, or switch to parameterized `ESCAPE` clause: `like(images.title, searchTerm + " ESCAPE '¥'")` with a non-backslash escape character.

### C11-SEC-04: No findings on auth/authz, session management, or secret handling
All existing security patterns remain intact:
- Session tokens use HMAC-SHA256 with `timingSafeEqual`
- Argon2id password hashing with dummy-hash timing equalization
- Same-origin checks on all mutating server actions
- Path traversal prevention via `SAFE_SEGMENT` regex and whitelist
- Filename sanitization via UUID generation
- CSP nonce generation per request
- No secrets in logs (sanitized stderr)

## Final Sweep
No additional security findings after reviewing all API routes, server actions, and middleware.
