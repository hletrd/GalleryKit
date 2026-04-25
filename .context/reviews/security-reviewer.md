# Security Reviewer — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

AuthN/AuthZ, injection, validation, secret handling, supply chain. Skipping new Unicode lineage per directive (already consolidated via `containsUnicodeFormatting`).

## Inventory

Mutating actions audited for: `requireSameOriginAdmin()`, `isAdmin()`, restore-maintenance gate, input sanitization, rate-limit, audit log.

Files audited: `auth.ts`, `seo.ts`, `topics.ts`, `images.ts`, `sharing.ts`, `admin-users.ts`, `tags.ts` (via grep), `settings.ts` (via grep), `public.ts`. Lint gates `lint:api-auth` and `lint:action-origin` already enforce the wrappers and same-origin checks.

## Findings

### C7L-SEC-01 — `loadMoreImages` is exempt from `requireSameOriginAdmin` (intentional, confirmed safe)
- File: `apps/web/src/app/actions/public.ts:76`
- Severity: INFO
- Confidence: High
- Status: NOT A FINDING — `public.ts` is intentionally exempt (read-only public surface, documented in CLAUDE.md and lint scanner exemption). Validation enforced (slug format, offset cap, tag count cap, length caps) and per-IP load-more rate limiting in place. Documented for completeness.

### C7L-SEC-02 — `tagsString` 1000-char cap is generous
- File: `apps/web/src/app/actions/images.ts:137-139`
- Severity: LOW
- Confidence: Medium
- Issue: 1000 chars allows a worst-case ~500 tags (1-char) and could amplify Unicode normalization cost in `getTagSlug` and the LIKE escape paths. Each tag is independently re-validated, so no injection — but the upper bound is wide.
- Failure scenario: Admin pasting a giant tag list inadvertently triggers slow-path tag resolution per upload.
- Fix: Defer; tighten to ~500 if a real budget review surfaces.

### C7L-SEC-03 — Audit-log catch sites use `console.debug`, not `console.error`
- File: Many (`topics.ts:133`, `sharing.ts:151,346,389`, `admin-users.ts:153,243`, `seo.ts:163`, `images.ts:482,594,707`)
- Severity: LOW
- Confidence: High
- Issue: When `logAuditEvent` fails, the failure is swallowed at debug level. In production, NODE_ENV=production typically filters out debug. A persistent audit-log infrastructure failure (e.g. table corrupted) would be invisible until manually inspected.
- Failure scenario: Audit log writes start failing silently; admins assume audit trail is intact when it's not.
- Fix: Promote audit-log failure logging to `console.warn` so it surfaces in default production logs without becoming noisy. Add to a follow-up plan if doc churn is acceptable.

### C7L-SEC-04 — `isValidTagName` already includes Unicode formatting check (no gap at per-tag boundary)
- File: `apps/web/src/app/actions/images.ts:142` ↔ `validation.ts:72-76`
- Severity: NONE
- Confidence: High
- Status: `isValidTagName` already includes `UNICODE_FORMAT_CHARS.test(trimmed)` (validation.ts:74). No issue.

### C7L-SEC-05 — `loadMoreImages` `safeOffset > 10000 → invalid` is silent
- File: `apps/web/src/app/actions/public.ts:83`
- Severity: INFO
- Confidence: Medium
- Issue: Deep-pagination DoS attempts are silently dropped. No alert/metric. Fine for a personal gallery but masks scraper activity.
- Fix: Defer; out of scope for security baseline.

## Cross-cutting

- AGG7R-21 (deferred plan claiming "double-call" of `settleUploadTrackerClaim`) re-audited: the two call sites at `images.ts:392` and `images.ts:397` are mutually exclusive (the first branch returns at line 393). **No bug; recommend closing the deferred entry.**
