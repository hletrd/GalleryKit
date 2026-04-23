# Security Review — Cycle 2 (2026-04-19, New Loop)

**Reviewer:** security-reviewer
**Scope:** OWASP Top 10, auth/authz, secrets, unsafe patterns across the full codebase.

## Findings

### C2-SEC-01: `updateTopic` catch block fragile error matching (duplicate of C2-01) [LOW, Medium Confidence]

**File:** `apps/web/src/app/actions/topics.ts:180`

**Problem:** Same as code-quality C2-01. The `e.message?.includes('Duplicate entry')` check is fragile and inconsistent with the `e.cause?.code` pattern used elsewhere. No direct security impact since the message is not exposed to the client, but the inconsistency could lead to a future developer trusting `e.message` in a client-facing error path.

**Fix:** Same as C2-01.

---

### C2-SEC-02: `createTopicAlias` TOCTOU is correctly handled but missing US-007 comment [LOW, Low Confidence]

**File:** `apps/web/src/app/actions/topics.ts:245-249`

**Problem:** `createTopicAlias` first calls `topicRouteSegmentExists(alias)` then inserts. Two concurrent requests with the same alias could both pass the check. The `ER_DUP_ENTRY` catch at line 257 correctly handles this (matching the `createTopic` pattern from US-007), so this is NOT exploitable. However, the US-007 comment that explains this is present in `createTopic` (line 72) but missing in `createTopicAlias`.

**Fix:** Add `// US-007: Insert directly and catch ER_DUP_ENTRY to avoid TOCTOU race` comment for consistency.

---

## Verified: Prior Cycle Security Fixes Confirmed Working

| Finding | Status |
|---------|--------|
| Search rate limit rollback (C1N-07) | FIXED — public.ts:64-75 correctly rolls back in-memory counter |
| Null byte validation (C1N-08, C1N-09) | FIXED — validation.ts:25,30 correctly rejects `\x00` |
| `admin-users.ts:54` fragile message check (C1N-04) | Still deferred — same class as C2-01 |

## Summary

| ID | Severity | Confidence | Description | Status |
|----|----------|------------|-------------|--------|
| C2-SEC-01 | LOW | Medium | updateTopic fragile ER_DUP_ENTRY message check | Duplicate of C2-01 |
| C2-SEC-02 | LOW | Low | createTopicAlias missing US-007 comment | Actionable |

**New actionable findings:** 1 (LOW)
