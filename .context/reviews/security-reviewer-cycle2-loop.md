# Security Reviewer — Cycle 2 review-plan-fix loop (2026-04-25)

## Lens

Verify plan-301 changes didn't open new vulnerabilities, and audit any cycle-2 surface for known classes (XSS, path traversal, SSRF, prototype pollution, regex DoS, info disclosure).

## Findings

### S2L-INFO-01 — `humanizeTagLabel` regex is safe

- **File:** `apps/web/src/lib/photo-title.ts:28-30`
- **Severity / Confidence:** INFO / High
- Uses a simple `name.replace(/_/g, ' ')`. Linear time, no backtracking, no group capture. ReDoS-safe even on attacker-controlled tag names.
- **Action:** None.

### S2L-INFO-02 — `buildHreflangAlternates` does not introduce SSRF / open-redirect surface

- **File:** `apps/web/src/lib/locale-path.ts:88-95`
- **Severity / Confidence:** INFO / High
- The helper iterates a static `LOCALES` constant and concatenates `seo.url` (admin-controlled, not user-controlled). The output is consumed by Next.js's `Metadata.alternates.languages`, which renders `<link rel="alternate" hreflang="..." href="...">`. No user input flows into the path. Path passed in is internal (`/`, `/p/<id>`, `/<topic>`) — a malformed `seo.url` could theoretically produce invalid alternate URLs, but the rendering is server-side metadata only and does not initiate any fetch.
- **Action:** None.

### S2L-INFO-03 — Login form (F-12 / F-13) password-toggle changes — no new exposure

- **File:** `apps/web/src/app/[locale]/admin/login-form.tsx`
- **Severity / Confidence:** INFO / High
- The toggle flips `<Input type>` between `password` and `text` purely client-side. Form submission still uses `FormData`; the value travels through the same authenticated server action with rate limiting (per-IP + per-account) and Argon2 verification.
- **Action:** None. Plan-302 deferred AGG1L-LOW-14 (browser save-password prompt) is appropriate to keep deferred — it's a UX / browser-quirk concern, not a security finding.

## No new vulnerabilities surfaced this cycle.

Plan-301 is mechanical refactor + metadata emitter; the security envelope is unchanged.
