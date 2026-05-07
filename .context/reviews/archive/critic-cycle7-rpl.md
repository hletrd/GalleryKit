# Critic Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** critic (multi-perspective critique of the change
surface)

## Perspective 1 — "Future maintainer opens this file in 18 months"

### C7-01 — `escapeCsvField` file is 22 lines with a ~12-line header
comment. The implementation is 7 lines. Comment-to-code ratio is high.

**File:** `apps/web/src/lib/csv-escape.ts`

The header is detailed and useful (explains the 4-step hygiene).
A future reader can re-derive intent. Not a defect — just
observation that the header is the "API documentation" here.

**Severity:** LOW (positive observation)

### C7-02 — `requireSameOriginAdmin()` is a 6-line async helper with a
29-line doc header

**File:** `apps/web/src/lib/action-guards.ts:1-44`

The header explains WHY the return type is `string | null` rather than
`{error: string} | null` — that rationale is valuable because the
author hit TS 6 type-inference edge cases. Well-documented.

**Severity:** LOW (positive observation)

### C7-03 — Plan directory has 200+ files (plan-*.md + done/ + cycle-*
directories). A future maintainer looking for "where's the live roadmap?"
will be overwhelmed.

**File:** `plan/`

The cycle-based naming scheme plus `done/` archive is correct for the
review-plan-fix loop, but onboarding docs could point at a single
canonical "what's active" index.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** plan-README.md rollup (already exists at
`plan/README.md`) should be refreshed periodically.

## Perspective 2 — "Hostile user / attacker / prankster"

### C7-04 — `uploadImages` upload tracker is per-IP, but an attacker
behind CGNAT shares an IP with many legitimate admins (in theory
multi-admin deployments)

**File:** `apps/web/src/app/actions/images.ts:121-176`

Single-admin deployments are safe. For multi-admin orgs behind
shared egress (rare), one admin's upload burst could deny uploads to
co-admins. Acceptable tradeoff for the target personal-gallery use
case.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** document single-admin-per-IP assumption.

### C7-05 — `exportImagesCsv` has no rate limit per admin. An admin
with their session cookie leaked could be weaponized to run repeated
50 000-row exports.

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:32-99`

Matches the cycle-6-rpl finding AGG6R-17 (S6-03). Already deferred.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** re-deferred.

### C7-06 — `restoreDatabase` advisory lock is 0-timeout (`GET_LOCK(name, 0)`)
— concurrent restore attempts fail immediately with "restore in
progress", which is the intended behavior.

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:261-265`

Good; avoids a deadlock between two admins trying to restore at once.

**Severity:** INFORMATIONAL

### C7-07 — `check-action-origin.ts` `AUTOMATIC_NAME_EXEMPTIONS` pattern
`/^get[A-Z]/` skips functions beginning with `get` + uppercase. A
future mutation action misnamed `getAndDeleteTopic` would be silently
exempted.

**File:** `apps/web/scripts/check-action-origin.ts:96-100`

The naming convention is enforced by code review. A regex-based
exemption is inherently a trust boundary. `getAndDeleteTopic` would
smell wrong in code review and should be rejected there. Defense-in-
depth: the action would still fail CSRF via Next.js framework-level
protection.

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** document the naming contract in code comment
or contributor guide.

## Perspective 3 — "Reviewer who only cares about test surface"

### C7-08 — Tests exist for: `check-action-origin.test.ts`,
`csv-escape.test.ts`, `privacy-fields.test.ts`, `public-actions.test.ts`,
`rate-limit.test.ts`. No test for `requireSameOriginAdmin` as an
isolated helper.

**File:** `apps/web/src/__tests__/` (directory)

`requireSameOriginAdmin` is tested transitively via e2e
`origin-guard.spec.ts`. A unit test that stubs `getTranslations` and
`headers` would give tighter failure localization.

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add a unit test for `requireSameOriginAdmin`
covering the success and hosted-origin-mismatch cases.

### C7-09 — `rollbackShareRateLimitFull` is exercised only via
integration with `createPhotoShareLink`. A unit test that directly
asserts both the in-memory Map and the DB counter are decremented would
be more targeted.

**File:** `apps/web/src/app/actions/sharing.ts:85-90`

**Severity:** LOW
**Confidence:** HIGH
**Recommendation:** add unit test.

## Perspective 4 — "Performance engineer"

Already covered by perf-reviewer. No new angle.

## Perspective 5 — "DevOps / deployer"

### C7-10 — `TRUST_PROXY` docs were added to README this cycle, good.
But the deploy helper `.env.deploy.example` doesn't mention
`TRUST_PROXY=true`, so operators may miss it.

**File:** `.env.deploy.example` (root)

**Severity:** LOW
**Confidence:** MEDIUM
**Recommendation:** add a commented `# TRUST_PROXY=true` line to
`.env.local.example` (not `.env.deploy`, which is for SSH deploy
config only). Verify which file is the right home.

## Summary

10 findings, all LOW. Positive observations: code-to-comment ratio on
new helpers is high in a productive way (audit-trail). Concerns: test
surface for `requireSameOriginAdmin` and `rollbackShareRateLimitFull`
could be unit-tested directly.
