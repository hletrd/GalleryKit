# perf-reviewer — cycle 1 (new)

Scope: CPU/memory/UI responsiveness, concurrency, query hotspots.

## Findings

### PERF1-01 — `seed-e2e.ts` double-generates each base image and every variant
- **Citation:** `apps/web/scripts/seed-e2e.ts:65-100`
- **Severity / confidence:** LOW / HIGH
- **Problem:** `createVariants` creates a full `sharp({ create })` pipeline, writes it as the "original", then for each of four sizes constructs a *new* `sharp({ create })` pipeline and `resize()` — so the base synthetic image is decoded four extra times for every image. Not a correctness issue; adds ~200ms per size on CI. Acceptable since this is an offline seed script; noting for completeness. Size-list fix from CR1-06 would further amortize.

### PERF1-02 — `AdminNav` renders 8 `<Link>` components unconditionally on every admin path
- **Citation:** `apps/web/src/components/admin-nav.tsx:15-45`
- **Severity / confidence:** LOW / LOW
- **Problem:** `localizePath` is invoked eight times per render. Trivial cost; no optimization suggested.

### PERF1-03 — `updateImageMetadata` revalidates per-image paths even on title-only edits
- **Citation:** `apps/web/src/app/actions/images.ts:597-599`
- **Severity / confidence:** LOW / MEDIUM
- **Problem:** Every metadata update revalidates `/p/${id}`, `/admin/dashboard`, `/`, and the topic page. That's fine for a small gallery, but on a large-topic page it invalidates every photo's listing cache unnecessarily. Observational; no change suggested this cycle.

### PERF1-04 — Admin layout re-queries auth for every admin route render
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx` (currently does not) and the protected sub-layout's `isAdmin()` call (observation)
- **Severity / confidence:** LOW / HIGH
- **Note:** Once CR1-03 lands, the top-level layout will call `isAdmin()`/`getCurrentUser()`. `getCurrentUser` is already wrapped in React `cache()` so per-request duplication is elided. No perf regression.

### PERF1-05 — No new perf regressions detected
- **Disposition:** None of the outstanding deferred items in `plan/cycle6-review-triage.md` are first-introduced this cycle.
