# Security Review -- Cycle 1 (Run 2)

**Date**: 2026-05-05
**Focus**: OWASP, auth/authz, data privacy, input validation

---

## Findings

### SR-R2-01: No new critical security findings

The codebase has strong security fundamentals:
- All mutating server actions verify `isAdmin()` + `requireSameOriginAdmin()`
- Input sanitization with Unicode formatting rejection
- Parameterized queries via Drizzle ORM
- Rate limiting on auth and sharing
- GPS privacy enforcement with compile-time guards
- File upload path traversal prevention
- Advisory locks for concurrent operation safety

### SR-R2-02: Semantic search API has no input length validation on client side (Low, Medium confidence)

**File**: `apps/web/src/components/search.tsx:74-78`

The semantic search POST sends `{ query: searchQuery, topK: 20 }` without client-side length validation. The server-side route should enforce limits, but the client sends arbitrary-length queries. This is a minor concern since the server should be the enforcer.

**Verdict**: Defense-in-depth concern only. Server-side validation is the primary gate.

### SR-R2-03: `reactions` API allows anonymous visitor state tracking (Low, Medium confidence)

**File**: `apps/web/src/db/schema.ts:173-181`

The `image_reactions` table stores `visitorIdHash = SHA-256(visitor_uuid + YYYY-MM-DD)`. This is privacy-conscious (daily rotation, no PII stored). The design is acceptable for anonymous reactions.

**Verdict**: Not a finding. Properly designed.