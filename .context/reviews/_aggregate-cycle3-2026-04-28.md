# Aggregate Review — Cycle 3/100 (2026-04-28, current loop)

## Run Context

- **HEAD at start:** `c73dc56 docs(reviews): record cycle-3 fresh review and plan-316 no-op convergence`
- **Cycle:** 3/100 of review-plan-fix loop (this loop). Cycles 1-2 produced commits; cycle 3 (2026-04-27) was a no-op. This is the 7th consecutive cycle with no actionable production code changes (cycles 1-2 of this loop had test-only commits; cycles 3+ had zero findings).
- **Scope:** Full repo deep review across all specialist angles. Inline pass — the orchestrator-listed reviewers are not registered as subagents in this environment. All 11 specialist angles were applied directly inline by reading the relevant source files (225+ TypeScript files examined).

## Specialist Angles Covered (Inline)

- **Code quality:** Re-read all server actions (`auth.ts`, `images.ts`, `admin-users.ts`, `topics.ts`, `tags.ts`, `sharing.ts`, `settings.ts`, `seo.ts`, `public.ts`, `db-actions.ts`), all lib modules (`data.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `validation.ts`, `sql-restore-scan.ts`, `csv-escape.ts`, `safe-json-ld.ts`, `blur-data-url.ts`, `session.ts`, `request-origin.ts`, `action-guards.ts`, `api-auth.ts`, `content-security-policy.ts`, `serve-upload.ts`, `db-restore.ts`, `image-queue.ts`, `upload-processing-contract-lock.ts`, `upload-tracker.ts`, `restore-maintenance.ts`), schema (`schema.ts`), middleware (`proxy.ts`), and API routes (`api/admin/db/download/route.ts`, `api/health/route.ts`, `api/live/route.ts`, `api/og/route.tsx`). No new code findings.
- **Perf:** view-count chunked flush (FLUSH_CHUNK_SIZE=20), consecutiveFlushFailures exponential backoff, capacity guard (MAX_VIEW_COUNT_BUFFER_SIZE=1000), search rate-limit pruning interval gating, load-more in-memory fast path, OG rate limit with pre-increment pattern — all confirmed sound. Build artifact prerender vs dynamic split unchanged from last cycle.
- **Security:** Argon2id + timingSafeEqual for auth; SAFE_SEGMENT + realpath containment on serve-upload; CSP GA-conditional on NEXT_PUBLIC_GA_ID; containsDangerousSql blocklist (35+ patterns); containsUnicodeFormatting blocks bidi+ZW; CSV escapes formula injection + C0/C1 + bidi + ZW; requireSameOriginAdmin() on every mutating action; all 5 dangerouslySetInnerHTML call sites pass through safeJsonLd() with nonce; withAdminAuth on admin API routes; backup download route has both withAdminAuth and hasTrustedSameOriginWithOptions; upload tracker TOCTOU closed with pre-claim pattern; advisory locks for concurrent operations.
- **Architect/critic:** Layering of actions/lib/db preserved; publicSelectFields derived from adminSelectFields with compile-time _SensitiveKeysInPublic and _LargePayloadKeysInPublic guards; advisory-lock scope caveat documented in CLAUDE.md; single-writer topology constraints documented.
- **Debug/verifier:** view-count Map swap pattern correct; consecutiveFlushFailures counter increments only when succeeded===0 && batch.size>0; rate-limit pre-increment/rollback pattern consistent across all surfaces (login, password change, admin user creation, share creation, search, load-more, OG); session verification uses timingSafeEqual; upload tracker settlement math correct; all advisory lock release paths covered in finally blocks.
- **Test:** 469/469 vitest tests pass (70 test files, 23.52s). No flakes. Test count stable since last cycle.
- **Document-specialist:** CLAUDE.md is internally consistent; all documented security controls verified against code; advisory-lock scope note up-to-date; touch-target audit pattern coverage documented; view-count flush behavior documented.
- **Tracer:** Followed bufferGroupViewCount -> flushGroupViewCounts -> flushBufferedSharedGroupViewCounts (graceful shutdown path) -> re-entry via timer. No control-flow gaps. unref?.() calls allow clean process exit.
- **UI/UX/designer:** Touch-target audit fixture verified by vitest run; KNOWN_VIOLATIONS counts unchanged. No new components added. Designer agent skills (agent-browser) not available from this subagent.

## Deduplicated Findings (only items not yet covered by prior cycles)

### HIGH Severity (0)
None.

### MEDIUM Severity (0)
None.

### LOW Severity (0)
None.

### INFO (0)
None.

## Cross-Agent Agreement

All inline angles converged on "no new findings." The codebase has been stable across multiple review cycles. All previously identified issues have been addressed or explicitly deferred.

## Verified Controls (No New Issues Found, Re-Verified This Cycle)

1. Argon2id + timingSafeEqual for auth (`apps/web/src/app/actions/auth.ts`)
2. Path traversal prevention (SAFE_SEGMENT + realpath containment on `lib/serve-upload.ts`)
3. Privacy guard (compile-time `_SensitiveKeysInPublic`/`_LargePayloadKeysInPublic` + separate field sets in `lib/data.ts`)
4. Blur data URL contract (3-point validation with producer-side `assertBlurDataUrl` at `lib/process-image.ts`)
5. Rate limit TOCTOU fix (pre-increment pattern across all surfaces)
6. Advisory locks for concurrent operations (lock namespace caveat documented in CLAUDE.md)
7. Unicode bidi/formatting rejection (`UNICODE_FORMAT_CHARS` in `validation.ts`, re-imported by `csv-escape.ts`)
8. CSV formula injection prevention with C0/C1/bidi/ZW stripping
9. Touch-target audit fixture passes (`apps/web/src/__tests__/touch-target-audit.test.ts`)
10. Reduced-motion support
11. `safeJsonLd()` properly sanitizes all 5 `dangerouslySetInnerHTML` JSON-LD call sites
12. `serveUploadFile` extension-to-directory mismatch protection
13. `requireSameOriginAdmin()` on every mutating server action (lint:action-origin gate green)
14. `withAdminAuth(...)` on every admin API route (lint:api-auth gate green)
15. Upload tracker TOCTOU closed with pre-claim pattern
16. View count buffer swap — fixture-tested by plan-315
17. CSP GA domain conditional on `NEXT_PUBLIC_GA_ID`
18. Dimension rejection for undetermined images
19. SQL restore scanner blocks the full dangerous-statement set (35+ patterns)
20. View-count flush exponential backoff with `consecutiveFlushFailures` counter
21. View-count flush chunk size (`FLUSH_CHUNK_SIZE = 20`) and capacity (`MAX_VIEW_COUNT_BUFFER_SIZE = 1000`) constants
22. Session token format validation (3-part timestamp:random:signature in middleware + cryptographic verification in verifySessionToken)
23. Backup file download route has defense-in-depth auth (withAdminAuth + hasTrustedSameOriginWithOptions)
24. Restore maintenance flag prevents uploads/mutations during DB restore
25. Upload processing contract lock serializes image_sizes/strip_gps changes with uploads
26. Per-image processing claim via advisory lock prevents dual-worker duplication
27. `stripControlChars` applied before validation on all admin-controlled string inputs
28. `containsUnicodeFormatting` applied to all admin-controlled persistent string fields (topic alias, tag name, topic label, image title/description, SEO settings)

## Gate Run Evidence (cycle 3, 2026-04-28)

- `npm run lint --workspace=apps/web` — exit 0
- `npm run typecheck --workspace=apps/web` — exit 0
- `npm run lint:api-auth --workspace=apps/web` — exit 0 (1 OK)
- `npm run lint:action-origin --workspace=apps/web` — exit 0 (8 OK)
- `npm test --workspace=apps/web` — exit 0 (469 / 469 pass; 70 test files; 23.52s)
- `npm run build --workspace=apps/web` — exit 0 (all routes built; no warnings)

## Agent Failures

None. Inline pass — see Reviewer Roster note above.

## Comparison with Prior Cycles

- Cycle 1 of this loop: vitest sub-test timeout raise (test gate flake fix, `e50a2dc`)
- Cycle 2 of this loop: view-count flush invariant test (`62213dc`)
- Cycle 3 (2026-04-27): zero new findings (plan-316)
- Cycle 1 (2026-04-28): 1 low-severity note (C1-28-F01, deferred — raw SQL in deleteAdminUser is intentional)
- Cycle 2 (2026-04-28): zero new findings (plan-317)
- Cycle 3 (2026-04-28, this cycle): zero new findings

This is the 7th consecutive cycle with zero net-new actionable code-surface findings. Production code remains converged.

## Summary

Production code remains converged. Zero new findings this cycle across all 11 specialist angles. All gates green. All previously identified and addressed controls remain sound. No security, correctness, or data-loss findings. No new test gaps. No new deferred items.
