# Cycle 2 review fixes plan

Source aggregate: `.context/reviews/_aggregate.md`
Reviewed raw reviewer outputs: `.context/reviews/{code-reviewer,security-reviewer,critic,verifier,test-engineer,architect,debugger,designer,perf-reviewer,tracer,document-specialist}.md`

## Status
- [x] C2R2-01 Overlap metadata tag lookups with the other public-page metadata reads.
- [ ] C2R2-02 Remove unnecessary Edge runtime from static icon routes and verify `next build` no longer emits the icon static-generation warning.
- [ ] Re-run full repo gates after the fixes.

## Implementation tasks

### C2R2-01 — Metadata tag lookup overlap
- **Source finding:** `.context/reviews/_aggregate.md` → `C2R2-01`
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:18-29`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-36`
- **Severity / confidence:** LOW / HIGH
- **Goal:** Start tag validation fetches without the extra post-`Promise.all` wait on tag-filtered metadata requests.
- **Planned changes:**
  1. Home metadata: start `getTagsCached()` up front when `tagsParam` is present and await it alongside the existing metadata reads.
  2. Topic metadata: compose the tag-fetch promise off the topic lookup so tag hydration starts as soon as the canonical topic row resolves.
  3. Keep behavior identical for no-tag requests and missing-topic requests.
- **Verification:** unit tests, TypeScript, lint, and production build.

### C2R2-02 — Static icon generation
- **Source finding:** `.context/reviews/_aggregate.md` → `C2R2-02`
- **Files:** `apps/web/src/app/apple-icon.tsx:2-5`, `apps/web/src/app/icon.tsx:2-6`
- **Severity / confidence:** LOW / HIGH
- **Goal:** Let Next statically generate the favicon/apple-icon routes instead of forcing Edge runtime.
- **Planned changes:**
  1. Remove explicit `runtime = 'edge'` from the two static icon routes.
  2. Keep the current icon visuals and response sizes unchanged.
  3. Verify `npm run build --workspaces` stops emitting the `Using edge runtime on a page currently disables static generation for that page` warning for these icon routes.
- **Verification:** production build output + full repo gates.
