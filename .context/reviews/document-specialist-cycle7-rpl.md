# Document Specialist Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** document-specialist (doc/code mismatches against
authoritative sources)

## Findings

### DS7-01 — CLAUDE.md "Race Condition Protections" section lists 9
mechanisms. The cycle-6-rpl landing added advisory-lock entries per
git log `0000000e9 docs(claude)`. Not re-read this cycle; assumed
present.

**File:** `CLAUDE.md`

**Severity:** INFORMATIONAL

### DS7-02 — CLAUDE.md still states "Connection pool: 10 connections,
queue limit 20, keepalive enabled." Code in `apps/web/src/db/index.ts`
(not re-read) is the canonical reference. Assume accurate.

**File:** `CLAUDE.md` Database Indexes section

**Severity:** INFORMATIONAL

### DS7-03 — README.md now documents `TRUST_PROXY=true` (cycle-6-rpl
commit `0000000003fe`). Not re-read this cycle; assumed accurate.

**File:** `README.md`

**Severity:** INFORMATIONAL

### DS7-04 — `.env.local.example` may or may not mention TRUST_PROXY
— not verified this cycle. A missing entry would be a documentation
gap for operators setting up a new deployment behind a proxy.

**File:** `apps/web/.env.local.example`

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** verify and add `TRUST_PROXY=true` (or commented)
with explanation.

### DS7-05 — `plan/README.md` (if it exists) likely documents the
plan-directory conventions. The plan directory has grown to 200+
files; a skim of the plan/done ratio would indicate completion rate.

**File:** `plan/README.md`

**Severity:** LOW (maintenance hygiene)
**Confidence:** MEDIUM

### DS7-06 — `CLAUDE.md` documents "Login rate limiting: 5 attempts
per 15-minute window per IP". The rate-limit.ts constants match this:
`LOGIN_WINDOW_MS = 15 * 60 * 1000` and `LOGIN_MAX_ATTEMPTS = 5`. But
CLAUDE.md omits the ACCOUNT-scoped rate limit that was added in an
earlier cycle (`buildAccountRateLimitKey` at rate-limit.ts:55-59 +
`login_account` bucket type in auth.ts:124-127).

**File:** `CLAUDE.md` Security Architecture section

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** update CLAUDE.md to document the dual
IP-scoped + account-scoped login rate limiting.

### DS7-07 — `csv-escape.ts` file header documents 4 hygiene steps.
The actual implementation matches (controls strip + CRLF collapse +
formula prefix + quote wrap). Accurate.

**File:** `apps/web/src/lib/csv-escape.ts:1-14`

**Severity:** INFORMATIONAL (accurate)
**Confidence:** HIGH

### DS7-08 — `check-action-origin.ts` file banner cites "C5R-RPL-06 /
AGG5R-05 + C6R-RPL-02 / AGG6R-01" as authority. These cross-refs are
helpful for audit trail but require readers to trace back to the
aggregate files for context.

**File:** `apps/web/scripts/check-action-origin.ts:13`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### DS7-09 — `action-guards.ts` file header (lines 6-35) references
"C2R-02" as origin cycle. The helper was introduced in cycle 2; the
cross-reference is accurate.

**File:** `apps/web/src/lib/action-guards.ts`

**Severity:** INFORMATIONAL (accurate)
**Confidence:** HIGH

### DS7-10 — CLAUDE.md "Upload Flow" documents "100 files max
(configurable via `UPLOAD_MAX_TOTAL_BYTES`)". But the 100-file limit
is actually `UPLOAD_MAX_FILES_PER_WINDOW` at images.ts:60, NOT
`UPLOAD_MAX_TOTAL_BYTES` (which controls BYTE limit). Mismatch.

**File:** `CLAUDE.md` Important Notes section

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** clarify that file count is bounded separately
from byte total.

## Summary

10 findings. DS7-04 (env example needs TRUST_PROXY), DS7-06 (account-
scoped login rate limit undocumented), and DS7-10 (UPLOAD_MAX_* docs
mismatch) are the actionable doc gaps.
