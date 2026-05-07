# Code Review — Cycle 23

## Review method

Comprehensive deep review of all 242 TypeScript source files across the GalleryKit
codebase. Examined: validation.ts, data.ts, sanitize.ts, image-queue.ts, session.ts,
auth-rate-limit.ts, proxy.ts, images.ts (actions), sharing.ts, auth.ts, admin-users.ts,
topics.ts, tags.ts, settings.ts, seo.ts, db-actions.ts, db-restore.ts, csv-escape.ts,
serve-upload.ts, upload-tracker-state.ts, content-security-policy.ts, public.ts,
og/route.tsx, schema.ts, plus all other lib/ and component files.

This is the 23rd review cycle after ~84 cumulative commits. Finding counts have been
in steep decline across cycles 1-22.

---

## Findings

### No new actionable findings

After thorough examination of all source files, I found **zero new actionable findings**
that were not already identified and addressed in prior cycles (1-22) or already
present in the deferred backlog.

### Re-verified areas (confirmed correct this cycle)

1. **Validation layer**: `countCodePoints` used consistently for all max-length checks
   on fields that allow CJK/emoji (topicAlias, tagName, tagSlug, password, title,
   description, label, SEO fields, search query). ASCII-only fields (slug, username)
   correctly use `.length`. `safeInsertId` used at all three insertId sites.
   `UNICODE_FORMAT_CHARS` consistently applied at all admin string surfaces.

2. **Sanitization layer**: `sanitizeAdminString` checks Unicode formatting BEFORE stripping
   (avoids the `/g` flag `.test()` stateful bug). `requireCleanInput` returns null on
   rejection. `normalizeStringRecord` validates shape and checks Unicode formatting before
   trim. `stripControlChars` removes C0/C1 + Unicode formatting chars. All patterns
   consistent.

3. **Auth flow**: Dual IP+account rate limiting, Argon2 timing-safe verification with
   dummy hash, session fixation prevention via transaction, `unstable_rethrow` only in
   auth.ts. Login/validation ordering correct (validate before rate-limit increment).
   No rollback on infrastructure errors (correct — preserves budget).

4. **Upload flow**: TOCTOU prevention with pre-increment tracker, upload-processing
   contract lock, disk space pre-check, topic existence check. Tracker settlement
   reconciles pre-claimed quota with actual results.

5. **Image queue**: Advisory lock per job, claim check with conditional UPDATE, orphaned
   file cleanup on delete-during-processing. Permanently-failed ID tracking with FIFO
   eviction. Bootstrap continuation scheduling.

6. **Privacy guards**: `publicSelectFields` derived from `adminSelectFields` with
   compile-time `_SensitiveKeysInPublic` guard. `_LargePayloadKeysInPublic` guard
   prevents `blur_data_url` in listing queries. GPS coordinates excluded from public
   API responses.

7. **Rate-limit patterns**: Three documented rollback patterns consistently applied
   across all surfaces (login, password change, search, load-more, share, OG, user
   create). DB-backed counters for cross-restart accuracy. Pre-increment before check
   for TOCTOU prevention.

8. **Action guards**: Every mutating server action calls `requireSameOriginAdmin()` and
   returns early on error. Read-only exports carry `@action-origin-exempt` comments.

9. **API auth**: `withAdminAuth` wrapper enforces origin + admin check on all API admin
   routes. CSP nonce applied to all production responses.

10. **File serving**: Symlink rejection, path traversal prevention, directory whitelist,
    realpath containment, extension-to-directory mapping.

11. **DB restore**: Advisory lock, upload-processing contract lock, restore maintenance
    flag, SQL scan, header validation. `MYSQL_PWD` env var (not CLI flag). Proper
    connection release in all finally blocks.

12. **CSV export**: CHAR(1) separator, `escapeCsvField` with formula-injection guard,
    Unicode formatting char strip. `results.length = 0` for GC (fixed in C22-01).

13. **OG route**: `clampDisplayText` uses `countCodePoints` + `Array.from` for surrogate-safe
    truncation. Per-IP rate limit with rollback on 404. ETag support for cache efficiency.

14. **Session security**: HMAC-SHA256 signed tokens, `timingSafeEqual` verification,
    production requires `SESSION_SECRET` env var. Transaction-based session rotation on
    login and password change.

15. **CSP**: Production nonce-based script-src. `style-src 'unsafe-inline'` remains
    (previously deferred as A17-MED-02 / C14-LOW-04). Google Analytics integration
    conditionally adds GTM domain.

16. **Cursor pagination**: `normalizeImageListCursor` validates shape, type, and format
    of cursor inputs. Legacy offset capped at 10,000. `buildCursorCondition` handles
    NULL capture_date correctly with explicit `isNotNull` guards.

17. **Schema**: All indexes present and aligned with documented query patterns.
    `onUpdateNow()` on `updated_at` columns. FK cascades where appropriate.
    `original_file_size` as `bigint('mode: 'number')` — documented precision limit.

---

## Carry-forward (unchanged — existing deferred backlog)

All previously deferred items remain deferred with no change in status:

- A17-MED-02 / C14-LOW-04: CSP style-src 'unsafe-inline' in production
- A17-MED-01 / C14-LOW-05: data.ts god module
- A17-MED-03 / C14-LOW-06: getImage parallel DB queries — pool exhaustion risk
- A17-LOW-04 / C14-LOW-07: permanentlyFailedIds process-local — lost on restart
- C14-LOW-01: original_file_size BigInt precision risk
- C14-LOW-02: lightbox.tsx showControls callback identity instability
- C14-LOW-03: searchImages alias branch over-fetch
- C15-LOW-04: flushGroupViewCounts re-buffers into new buffer
- C15-LOW-05 / C13-03 / C22-02: CSV headers hardcoded in English
- C15-LOW-07: adminListSelectFields verbose suppression pattern
- C14-MED-03: createGroupShareLink BigInt coercion risk on insertId
- C9-TE-03-DEFER: buildCursorCondition cursor boundary test coverage
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D4-MED: CSP unsafe-inline
- All other items from prior deferred lists

---

## Convergence assessment

The codebase is in a highly hardened state after 22+ review cycles with ~84 commits.
This cycle produced **zero** new findings. All HIGH and MED severity categories have
been exhausted. The codebase has achieved full convergence for actionable findings
at the current threat model and scale. The remaining deferred items are either
architectural improvements, informational notes, or low-priority polish items that
have been explicitly deferred with documented exit criteria.
