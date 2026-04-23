# Security Reviewer -- Cycle 6 (Round 3, 2026-04-20)

## Scope
OWASP Top 10, secrets, unsafe patterns, auth/authz review. Mature codebase with 46+ prior cycles.

## Findings

### SR6R3-01: `deleteTopic`/`updateTopic`/`deleteTopicAlias` silently proceed with sanitized slug when input differs [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/topics.ts` lines 100, 192, 285
**Description:** When `stripControlChars(slug)` produces a different string than the raw input, the function proceeds using the sanitized version without rejecting the request. This means an attacker (or buggy client) could send `slug="\x00admin"` which strips to `"admin"`, and the function would operate on the "admin" topic. While `isValidSlug` would still validate the sanitized slug, the fact that the original input was malformed (contained control characters) is silently accepted rather than rejected. For a security-sensitive operation like topic deletion, malformed input should be rejected outright rather than silently sanitized and executed. This follows the principle of "reject unexpected, don't fix it" that applies to mutating operations.
**Fix:** Add an early return: if `slug !== cleanSlug` after stripControlChars, return an error (e.g., `t('invalidSlug')`). This applies to `updateTopic`, `deleteTopic`, and `deleteTopicAlias`.
**Note:** The practical exploitability is low because `isValidSlug` after sanitization would catch most cases, but the defense-in-depth principle says: for destructive operations, don't silently modify input.

### SR6R3-02: `addTagToImage` and `removeTagFromImage` use `cleanName` for DB lookup but the tag could be a collision target [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/tags.ts` lines 115-164, 166-202
**Description:** Both functions sanitize `tagName` into `cleanName` and then look up by exact name first, then fall back to slug. If `tagName !== cleanName` (control chars were stripped), the function proceeds with the sanitized version. Similar to SR6R3-01, for tag operations the sanitized version could map to a different tag than the caller intended if the original name (with control chars) happened to be a valid (but different) tag name.
**Fix:** Same as SR6R3-01: reject input where sanitization changes the value.

### SR6R3-03: OG image route does not sanitize `topic` parameter against control characters [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/api/og/route.tsx` lines 8-13
**Description:** The `topic` query parameter is validated for length (`topic.length > 200`) but not sanitized for control characters before being rendered in the SVG/HTML response. Since this runs on the Edge runtime and uses `ImageResponse` (not raw HTML), the actual XSS risk is minimal — the text is rendered as a bitmap image. However, control characters in the topic name could cause visual glitches or unexpected rendering in the OG image.
**Fix:** Apply `stripControlChars` or at minimum strip C0 control characters from the `topic` parameter before rendering. This is low priority since the output is a bitmap, not HTML.

## No New Critical/High Security Findings

The codebase maintains strong security posture:
- All server actions validate auth via `isAdmin()` or `getCurrentUser()`
- API routes use `withAdminAuth` wrapper
- Session tokens use HMAC-SHA256 with timing-safe comparison
- Passwords hashed with Argon2id with dummy hash for timing-safe user enumeration prevention
- Rate limiting uses pre-increment-then-check pattern (TOCTOU safe)
- Upload routes validate path traversal, symlinks, and directory containment
- SQL restore scanner blocks dangerous SQL patterns
- Privacy fields explicitly excluded from public queries with compile-time guard
