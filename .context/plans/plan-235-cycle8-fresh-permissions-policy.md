# Plan 235 — Cycle 8 fresh: append modern privacy directives to Permissions-Policy

**Source finding:** AGG8F-05 (4 agents: code-reviewer, security, verifier, document-specialist)
**Severity:** LOW
**Confidence:** Medium

## Problem

`Permissions-Policy: camera=(), microphone=(), geolocation=()` is missing modern directives that a privacy-leaning personal gallery should opt out of:

- `interest-cohort=()` (Topics API opt-out, FLoC successor)
- `browsing-topics=()` (formal Topics API)
- `attribution-reporting=()`
- `private-state-token-redemption=()`
- `private-state-token-issuance=()`
- `idle-detection=()` (no UI need)

The header lives in two places that must stay in lockstep:
- `apps/web/next.config.ts:45`
- `apps/web/nginx/default.conf:39, 110`

## Fix shape

Append the new directives to both files. Update CLAUDE.md or a comment to capture the rationale.

## Implementation steps

1. Edit `apps/web/next.config.ts:45` to:
   ```
   { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=(), attribution-reporting=(), private-state-token-redemption=(), private-state-token-issuance=(), idle-detection=()' },
   ```
2. Edit `apps/web/nginx/default.conf:39` and `:110` to match.
3. (Optional) Add a unit test that imports `next.config.ts` (via the headers function) and asserts the policy contains each opt-out directive. Keeps the next/nginx pair in sync via a build-time check.

## Done criteria

- All gates pass.
- Manual probe (post-deploy): `curl -I https://gallery.atik.kr/` returns the new header value.
- Both Next config and nginx config carry the same directive list.

## Risk assessment

- No functional change for legitimate users. Browsers treat unknown directives as no-ops.
- Defense in depth — strictly opt-out hardening.

## Out of scope

- Removing the duplicate Nginx declaration (AGG8F-14). Defer.
