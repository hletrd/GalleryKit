# Aggregate Review — Cycle 25

**Date:** 2026-04-19
**Cycle:** 25/100

---

## Actionable Findings

### C25-09: `db-actions.ts` dumpDatabase/restoreDatabase use `-u` flag exposing MySQL username in process list

- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Category:** Security
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 112-119 and 306-315
- **Detail:** `mysqldump` and `mysql` spawns pass `-u${DB_USER}` as a CLI arg, visible in `/proc/<pid>/cmdline`. `MYSQL_PWD` is correctly used for the password, but the username is exposed. MySQL supports `MYSQL_USER` env var to avoid this.
- **Fix:** Move `-h`, `-P`, `-u` flags to environment variables (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`) in the spawn `env` option.

### C25-10: `photo-viewer.tsx` `toLocaleTimeString()` missing locale parameter

- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Category:** i18n / UX
- **File:** `apps/web/src/components/photo-viewer.tsx`, line 517
- **Detail:** Capture time rendered with `toLocaleTimeString()` without passing the `locale` variable. The capture date at line 511 correctly uses `toLocaleDateString(locale, ...)`. Without locale, time format uses browser default, inconsistent with selected app locale.
- **Fix:** Change `toLocaleTimeString()` to `toLocaleTimeString(locale)`.

### C25-11: `info-bottom-sheet.tsx` has same locale bug in capture time rendering

- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Category:** i18n / UX
- **File:** `apps/web/src/components/info-bottom-sheet.tsx`, line 357
- **Detail:** Same bug as C25-10. `toLocaleTimeString()` called without locale parameter.
- **Fix:** Change `toLocaleTimeString()` to `toLocaleTimeString(locale)`.

---

## Previously Resolved (Verified This Cycle)

- C25-01: `deleteGroupShareLink` revalidation — RESOLVED
- C25-02: `revokePhotoShareLink` revalidation — RESOLVED
- C25-03: `searchImages` deterministic sort — RESOLVED
- C25-04: `flushGroupViewCounts` concurrent flush guard — RESOLVED
- C25-05: Admin user create form autoComplete — RESOLVED

## Deferred / Not Actionable

- C25-06: uploadTracker "unknown" IP fallback — intentional
- C25-07: Double query trimming — defensive, not a bug
- C25-08: Auto-bootstrap on import — intentional
- C25-12: In-memory uploadTracker not shared across processes — acceptable for single-admin
- C25-13: No CSP header on upload serve — would break legitimate embedding
- C25-14: Prev/next query performance at scale — not actionable at current scale

## Totals

- **0 CRITICAL**
- **0 HIGH**
- **3 MEDIUM** (C25-09, C25-10, C25-11)
- **0 LOW** (actionable)
- **6 NOT-A-BUG** observations
