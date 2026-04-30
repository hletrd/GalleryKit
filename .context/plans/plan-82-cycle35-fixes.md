# Plan 82 — Cycle 35 Fixes (C35-01, C35-02, C35-04)

**Created:** 2026-04-19 (Cycle 35)
**Status:** DONE
**Severity:** 1 MEDIUM, 2 LOW

---

## C35-01: Missing `return` before `notFound()` in 3 locations [LOW, High Confidence]

**Files:**
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:65`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:80`
- `apps/web/src/app/[locale]/layout.tsx:66`

**Problem:** `notFound()` is called without `return` on these lines, inconsistent with every other `notFound()` call in the codebase (which all use `return notFound()`). This is the same class of issue as C34-02 but was missed in that cycle.

**Plan:**
1. Change `notFound();` to `return notFound();` in `g/[key]/page.tsx` line 65
2. Change `notFound();` to `return notFound();` in `[topic]/page.tsx` line 80
3. Change `notFound();` to `return notFound();` in `layout.tsx` line 66

**Exit criterion:** All `notFound()` calls in the codebase use `return notFound()`. Verified by `grep -n 'notFound()' apps/web/src/` showing only `return notFound()` patterns.

---

## C35-02: DB pool connectionLimit mismatch with CLAUDE.md [LOW, Medium Confidence]

**File:** `apps/web/src/db/index.ts:18` + `CLAUDE.md`

**Problem:** CLAUDE.md documents "Connection pool: 8 connections" but the actual code uses `connectionLimit: 10`. CLAUDE.md is used as authoritative guidance for AI agents.

**Plan:**
1. Update CLAUDE.md's "Connection pool" line from "8 connections" to "10 connections" to match the actual code.

**Exit criterion:** CLAUDE.md documents `connectionLimit: 10` matching `db/index.ts`.

**Resolution:** Already correct in CLAUDE.md — verified it shows "10 connections" matching the code. No change needed.

---

## C35-04: `generateMetadata` in photo page does not validate `id` before `parseInt` [MEDIUM, High Confidence]

**File:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:25`

**Problem:** `generateMetadata()` calls `parseInt(id, 10)` without validating that `id` is numeric. The default export function properly validates with `/^\d+$/.test(id)` before calling `parseInt`. The inconsistency means non-numeric IDs trigger a wasted DB query with NaN.

**Plan:**
1. In `generateMetadata()`, add `/^\d+$/.test(id)` validation before `parseInt`. If validation fails, return the not-found metadata early (same as when `image` is null).
2. Keep `parseInt` as a secondary safety check after regex validation passes.

**Exit criterion:** `generateMetadata` validates `id` is purely numeric before calling `parseInt`, matching the default export's pattern.

---

## Implementation Order

1. C35-01 (LOW) — add `return` before `notFound()` in 3 files (3 separate commits)
2. C35-02 (LOW) — update CLAUDE.md connectionLimit
3. C35-04 (MEDIUM) — add `id` validation in `generateMetadata`

Each fix gets its own commit.
