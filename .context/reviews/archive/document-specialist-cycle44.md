# Document Specialist — Cycle 44 (2026-04-20)

## Review Scope
Doc/code mismatches against authoritative sources. Verify CLAUDE.md claims against actual code behavior.

## New Findings

### DS44-01: CLAUDE.md states "Next.js 16.2" but package.json may differ [LOW] [LOW confidence]
**Description:** CLAUDE.md states "Next.js 16.2" and "TypeScript 6". These version claims should be verified against the actual `package.json` dependencies. This is a known deferred item from prior cycles (DOC-38-01/DOC-38-02).

### DS44-02: CLAUDE.md "Race Condition Protections" section is accurate [N/A] [HIGH confidence]
**Description:** Verified that the documented protections match actual code:
- "Delete-while-processing": Queue checks row exists (image-queue.ts:174-178) + conditional UPDATE (line 231)
- "Concurrent tag creation": `INSERT IGNORE` + slug collision detection (tags.ts:130, uploadImages tags block)
- "Topic slug rename": Transaction wraps references (topics.ts:141-152)
- "Batch delete": Wrapped in DB transaction (images.ts:454-458)
- "createTopic TOCTOU": Catches ER_DUP_ENTRY (topics.ts:87)
- "Session secret init": INSERT IGNORE + re-fetch (session.ts:59-73)
**VERIFIED ACCURATE.**

### DS44-03: CLAUDE.md "Security Architecture" section accurately reflects code [N/A] [HIGH confidence]
**Description:** Verified:
- Argon2id password hashing: auth.ts:106, auth.ts:301
- HMAC-SHA256 session tokens: session.ts:87
- timingSafeEqual: session.ts:117
- Cookie attributes (httpOnly, secure, sameSite: lax, path: /): auth.ts:176-182
- Session secret from env var in production: session.ts:30-36
- Login rate limiting: auth.ts:88-117
**VERIFIED ACCURATE.**

## Previously Deferred Items (No Change)

- DOC-38-01/DOC-38-02: Version number mismatches in CLAUDE.md
