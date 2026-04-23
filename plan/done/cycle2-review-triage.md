# Cycle 2 review triage / deferred items

Source aggregate: `.context/reviews/_aggregate.md`
Purpose: capture every raw review finding that is **not** being implemented this cycle so nothing is silently dropped.

## Deferred / invalidated findings

### I2R2-01 — Load-more “missing hasMore” claim is already fixed on current HEAD
- **Original review sources:** code-reviewer, critic, verifier, test-engineer, architect, debugger, designer, perf-reviewer, tracer
- **Original citation:** `apps/web/src/app/actions/public.ts:11-25`, `apps/web/src/components/load-more.tsx:29-43`, `apps/web/src/__tests__/public-actions.test.ts:89-99`
- **Original severity / confidence:** LOW / HIGH (designer marked MEDIUM confidence)
- **Disposition:** Deferred as invalidated/stale review output; no implementation needed this cycle.
- **Reason for deferral:** The server action already returns `{ images, hasMore }` and overfetches one row, and the exact-multiple terminal-page behavior is already covered by `public-actions.test.ts`.
- **Exit criterion to reopen:** Re-open only if a reproduced UI trace shows a redundant terminal fetch on current HEAD or the `hasMore` contract regresses.

### I2R2-02 — Broad “public pages still serialize all independent reads” claim is overstated
- **Original review sources:** code-reviewer, critic, verifier, architect, debugger, perf-reviewer, tracer
- **Original citation:** `apps/web/src/app/[locale]/(public)/page.tsx:95-110`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`, `apps/web/src/app/[locale]/layout.tsx:55-64`
- **Original severity / confidence:** MEDIUM / HIGH
- **Disposition:** Deferred as partially invalidated; narrowed actionable work is completed in `plan/done/cycle2-review-fixes.md` as `C2R2-01`.
- **Reason for deferral:** The cited route bodies already use `Promise.all(...)` for their main public-page read groups. The remaining real issue is the narrower metadata tag-lookup overlap, not the broader claim as written.
- **Exit criterion to reopen:** Re-open only if profiling or new code evidence identifies another specific serialized read chain beyond `C2R2-01`.
