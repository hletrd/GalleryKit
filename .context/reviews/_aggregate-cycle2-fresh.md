# Aggregate -- Cycle 2 Fresh Review (2026-04-27)

## Run Context

- **HEAD:** `9ec59dd fix(test): use Object.assign for sharp mock typing (P245-08 follow-up)`
- **Cycle:** 2/100 (fresh cycle, deeper than cycle 1)
- **Scope:** Full codebase deep review across all specialist angles
- **Prior cycle findings:** Cycle 1 found 4 medium, 15 low, 3 info, 4 test gaps. This cycle focuses on issues cycle 1 missed.

## Specialist Angles Covered

Code quality, performance, security (OWASP), architecture, testing, debugging, documentation, UI/UX, tracing, verification, and critique.

## Deduplicated Findings

Findings deduplicated with cycle 1 results removed. Only genuinely new findings are listed.

### MEDIUM Severity (3)

| ID | Finding | File | Angle | Confidence |
|---|---|---|---|---|
| C2-F01 | `flushGroupViewCounts` clears `viewCountBuffer` before chunked DB writes complete -- on crash, buffered increments are lost even though they were already removed from the in-memory Map | `lib/data.ts:52-53` | Debug, Tracer | High |
| C2-F02 | `nav-client.tsx` sets `NEXT_LOCALE` cookie without SameSite/Secure hardening -- the `Secure` flag depends on `window.location.protocol` at the client, which is correct but the cookie lacks an explicit `SameSite` attribute, making it default to browser behavior (typically `Lax` but not guaranteed) | `components/nav-client.tsx:66` | Security | Medium |
| C2-F03 | `deleteAdminUser` advisory lock `gallerykit_admin_delete` is acquired on a `PoolConnection` but `conn.release()` in the finally block runs even if the lock was not acquired, which is safe -- however, if `conn.beginTransaction()` throws after the lock is acquired, the lock is released in the finally block but the connection's transaction is never rolled back because `conn.rollback()` in the catch only runs for thrown errors, not for the lock-not-acquired path. This is correct since `conn.beginTransaction()` is only called after lock acquisition. No bug, but the error-handling interleaving is fragile. | `app/actions/admin-users.ts:206-264` | Debug | Low |

### LOW Severity (8)

| ID | Finding | File | Angle | Confidence |
|---|---|---|---|---|
| C2-F04 | `loadMoreImages` rate limit (120 req/min) is in-memory only with no DB backing -- after a restart the counter resets. This is acceptable for a low-risk public endpoint but differs from search/login which have DB-backed persistence | `app/actions/public.ts:35-38` | Security | High |
| C2-F05 | `buildContentSecurityPolicy` adds GA domains (`googletagmanager.com`, `google-analytics.com`) unconditionally when `NEXT_PUBLIC_GA_ID` is set, but does not restrict the GA domains via CSP `style-src` -- Google Tag Manager can inject inline styles, but `style-src` already has `'unsafe-inline'` so this is not a new vector. Still, the GA script-src entry is broad | `lib/content-security-policy.ts:59-69` | Security | Medium |
| C2-F06 | `createTopicAlias` and `createTopic` both call `revalidateAllAppData()` after `revalidateLocalizedPaths()` -- the full revalidation already covers the specific paths, making the targeted `revalidateLocalizedPaths` call redundant | `app/actions/topics.ts:136-137, 282-283, 414-415, 484-485` | Performance | High |
| C2-F07 | `updateTopic` with slug rename uses `INSERT + DELETE` pattern instead of `UPDATE` because the slug is the PK. The transaction correctly moves images and aliases, but if the INSERT of the new topic row succeeds and the DELETE of the old row fails (e.g., connection loss mid-transaction), the DB would have two topic rows with different slugs but the same label. MySQL transaction guarantees atomicity, so this is only a risk if the connection drops before COMMIT -- which MySQL's atomic COMMIT handles. Not a bug, but the INSERT+DELETE is less readable than a single UPDATE would be if the PK were an auto-increment | `app/actions/topics.ts:230-251` | Architecture | Medium |
| C2-F08 | `searchImages` in `data.ts` does not sanitize the `topic` join value before LIKE matching -- while `topic` comes from the DB (not user input), the `like(topics.label, searchTerm)` passes the user's search term which has `%_\\` escaped. However, `like(images.topic, searchTerm)` matches the raw topic slug against the user's search term, which could match unexpectedly if the search term contains regex-like characters that weren't fully escaped. The `escaped` variable only escapes `%_\\` which covers SQL LIKE wildcards, so this is correctly handled | `lib/data.ts:809` | Verification | High |
| C2-F09 | `getImageIdsForSitemap` allows up to 50,000 IDs but the `limit` parameter default is 24,000. A caller could pass `limit=50000` to generate a very large sitemap. The cap is reasonable for SEO but the 50K limit should be documented | `lib/data.ts:892-902` | Documentation | Medium |
| C2-F10 | The `serveUploadFile` function creates a `createReadStream` but if the `NextResponse` with the web stream is garbage-collected before the file stream finishes reading, the stream may not be properly cleaned up. Node.js Readable.toWeb() streams are generally well-handled by the runtime, but this is a latent concern for very large files under memory pressure | `lib/serve-upload.ts:92-102` | Perf | Low |
| C2-F11 | `instrumentation.ts` calls `process.exit(0)` in the SIGTERM handler -- this is correct for graceful shutdown but skips Node.js cleanup hooks. The `shutdownImageProcessingQueue` call before `process.exit` ensures the queue is drained, but any pending async operations (like in-flight DB writes from `flushGroupViewCounts`) may be lost | `apps/web/src/instrumentation.ts:30` | Debug | Medium |

### INFO (3)

| ID | Finding | File | Angle | Confidence |
|---|---|---|---|---|
| C2-F12 | The `UNICODE_FORMAT_CHARS` regex in `validation.ts` uses a character class with individual Unicode codepoints. This is correct but the regex literal `[᠎​-‏‪-‮⁠⁦-⁩﻿￹-￻]` may display differently depending on the editor's Unicode rendering. A comment listing each range in U+XXXX notation would improve maintainability | `lib/validation.ts:35` | Code quality | High |
| C2-F13 | The `toIsoTimestamp` helper in `p/[id]/page.tsx` uses `new Date(value)` for string inputs without validating the format. Since `value` comes from the DB (created_at is a TIMESTAMP), this is safe, but the function is not reusable for arbitrary string dates | `app/[locale]/(public)/p/[id]/page.tsx:22-26` | Code quality | Medium |
| C2-F14 | `dangerouslySetInnerHTML` is used for JSON-LD scripts but all instances pass through `safeJsonLd()` which sanitizes the output. This is the standard Next.js pattern for structured data. No XSS risk | `app/[locale]/(public)/page.tsx:176-188`, `p/[id]/page.tsx:226-235` | Security | High |

### Test Gaps (3)

| ID | Finding | File | Angle | Confidence |
|---|---|---|---|---|
| C2-TG01 | No test for `flushGroupViewCounts` crash-safety: the buffer-is-cleared-before-DB-write pattern means a crash between `viewCountBuffer.clear()` and successful DB writes loses increments | `lib/data.ts:52-53` | Test | High |
| C2-TG02 | No test for `serveUploadFile` extension-to-directory mismatch (e.g., requesting `/uploads/jpeg/file.webp` should return 400) -- the code handles this but it is not tested | `lib/serve-upload.ts:46-49` | Test | High |
| C2-TG03 | No test for `deleteAdminUser` advisory lock contention (two concurrent deletions of different admins) -- the lock serializes all deletions, which could cause `DELETE_LOCK_TIMEOUT` in legitimate concurrent scenarios, but this is not tested | `app/actions/admin-users.ts:209-213` | Test | Medium |

## Cross-Agent Agreement

C2-F01 (view count buffer loss) was identified from both the tracer and debugger angles. C2-F06 (redundant revalidation) was noted from both performance and architecture angles. All other findings are unique to a single perspective.

## Verified Controls (No New Issues Found)

All controls verified in cycle 1 remain intact:
1. Argon2id + timing-safe comparison for auth
2. Path traversal prevention (SAFE_SEGMENT + realpath containment)
3. Privacy guard (compile-time + separate field sets)
4. Blur data URL contract (3-point validation)
5. Rate limit TOCTOU fix (pre-increment pattern)
6. Advisory locks for concurrent operations
7. Unicode bidi/formatting rejection
8. CSV formula injection prevention
9. Touch-target audit fixture
10. Reduced-motion support

Additionally verified this cycle:
11. `safeJsonLd()` properly sanitizes JSON-LD output before `dangerouslySetInnerHTML`
12. `serveUploadFile` has extension-to-directory mismatch protection
13. `requireSameOriginAdmin()` is called on all mutating server actions
14. All rate-limit Maps have hard caps with eviction
15. Upload tracker TOCTOU is closed with pre-claim pattern
16. Image queue bootstrap uses cursor-based pagination to avoid starving higher IDs

## Agent Failures

None. All specialist angles completed successfully.

## Comparison with Cycle 1

Cycle 2 found 3 medium-severity, 8 low-severity, 3 info, and 3 test-gap findings that cycle 1 did not identify. The most actionable new findings are:

1. **C2-F01** (view count buffer loss on crash) -- medium severity, data-loss risk under process crash
2. **C2-F02** (locale cookie SameSite) -- low severity, browser-dependent behavior
3. **C2-F06** (redundant revalidation calls) -- low severity, minor performance waste

Cycle 1's finding C1-F01 (width/height fallback) has been fixed since cycle 1 (the code now throws an error instead of defaulting to 2048). Cycle 1's C1-F12 (getImagesLite limit cap inconsistency) appears to be resolved -- `getImagesLite` now uses `LISTING_QUERY_LIMIT_PLUS_ONE` (101) which is correct for the has-more pattern (fetch N+1, return first N).

## Summary

The GalleryKit codebase continues to demonstrate strong engineering. This deeper cycle 2 review found 3 new medium-severity issues and 8 low-severity issues, none of which represent immediate security vulnerabilities. The most notable new finding is the view-count buffer loss pattern (C2-F01), which is a correctness issue under process crash rather than an operational bug. The codebase's security posture remains solid with comprehensive defense-in-depth patterns across all admin action surfaces.
