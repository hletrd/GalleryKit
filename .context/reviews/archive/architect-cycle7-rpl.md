# Architect Review — Cycle 7 (RPL loop, 2026-04-23)

**Reviewer role:** architect (architectural/design risks, coupling,
layering)

## Findings

### A7-01 — `requireSameOriginAdmin` centralization is the right move,
but its return type (`string | null`) couples every caller to a
string-based branching convention

**File:** `apps/web/src/lib/action-guards.ts:37-44`

Every caller writes:
```ts
const originError = await requireSameOriginAdmin();
if (originError) return { error: originError };
```

The design-intent comment at lines 20-28 justifies this as a TS 6
type-inference workaround. Alternative: helper returns a discriminated
union `{ ok: true } | { ok: false; error: string }`, callers use
`if (!result.ok) return { error: result.error }`. Slightly more
verbose but explicitly typed. Current design is acceptable.

**Severity:** LOW (design preference)
**Confidence:** HIGH

### A7-02 — `csv-escape.ts` extraction reduces coupling between
`db-actions.ts` and the CSV hygiene logic. The separation enables
unit tests to import the pure helper without the `'use server'`
async-only constraint. Good layering.

**File:** `apps/web/src/lib/csv-escape.ts`

**Severity:** INFORMATIONAL (positive)
**Confidence:** HIGH

### A7-03 — `image-queue.ts` contains:
1. processing-queue state management
2. acquire/release advisory lock helpers
3. bootstrap logic (DB-pending scan)
4. periodic GC (hourly sessions / audit / rate-limit buckets)
5. orphan tmp-file cleanup
6. quiesce/resume for restore maintenance

These concerns are tightly coupled in one module. The queue module
is ~385 lines and growing. Consider splitting periodic GC into
`lib/gc-scheduler.ts` or similar.

**File:** `apps/web/src/lib/image-queue.ts`

**Severity:** LOW (coupling risk)
**Confidence:** MEDIUM
**Recommendation:** deferred refactor — split concerns in a follow-
up.

### A7-04 — `check-action-origin.ts` and `check-api-auth.ts` are
standalone CLI scripts. They import `typescript` directly and parse
the AST. Business logic (what counts as a mutation, what opts-out)
is scattered between:
- `AUTOMATIC_NAME_EXEMPTIONS` regex at line 96.
- `EXCLUDED_ACTION_FILENAMES` set at line 46.
- `@action-origin-exempt:` JSDoc tag at line 102.
- `requireSameOriginAdmin` identifier match at line 109.

Four exemption/match rules in one 266-line script. Each is
documented inline. A future addition (e.g., fourth opt-out mechanism)
should update this summary.

**File:** `apps/web/scripts/check-action-origin.ts`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### A7-05 — `data.ts` is 894 lines with mixed concerns:
1. view-count buffering + debounced flush + backoff (module-scoped mutable
   state).
2. select-field privacy lists (admin vs public).
3. 9 public query functions (`getImages*`, `getTopics*`, etc.).
4. compile-time privacy guard.
5. SEO settings loader.

The module-level mutable state (viewCountBuffer + flushTimer +
consecutiveFlushFailures) is a singleton that doesn't compose well
with multi-process deployments. Already flagged as D6-13.

**File:** `apps/web/src/lib/data.ts`

**Severity:** LOW (carry-forward)
**Confidence:** HIGH
**Recommendation:** re-deferred.

### A7-06 — Layering: `app/actions/*.ts` import from both `@/lib/*`
AND `@/db/*`. A stricter separation would route all DB access through
`@/lib/data.ts`-style modules, keeping `@/app/actions/*` focused on
authn/authz/validation.

Current pattern works and is idiomatic for Next.js server actions.
Changing would be a major refactor. Keep as-is.

**File:** `apps/web/src/app/actions/*`

**Severity:** INFORMATIONAL
**Confidence:** HIGH

### A7-07 — `requireSameOriginAdmin` fetches translations itself
(line 38) even when the caller already did (in `sharing.ts`,
`images.ts`, etc.). This is a small duplication:
```ts
const t = await getTranslations('serverActions');  // caller
const originError = await requireSameOriginAdmin(); // helper fetches again
```

`getTranslations` is cached per-request via Next's request memo, so
the second fetch is cheap. Acceptable.

**File:** `apps/web/src/lib/action-guards.ts:38`

**Severity:** INFORMATIONAL (positive — decouples helper from caller
state)
**Confidence:** HIGH

### A7-08 — The `plan/` directory has become a log of 200+ plan
documents. Indexing via `plan/README.md` + `plan/done/` archive is
the right structure, but a `plan/INDEX.md` that lists CURRENT-open
plans would reduce onboarding friction.

**File:** `plan/`

**Severity:** LOW (docs hygiene)
**Confidence:** MEDIUM
**Recommendation:** consider a regenerated index file.

## Summary

8 findings. Cycle-6-rpl landings respect existing boundaries. No
architectural regressions. A7-03 (`image-queue.ts` split) and A7-05
(`data.ts` split) remain as carry-forward refactors.
