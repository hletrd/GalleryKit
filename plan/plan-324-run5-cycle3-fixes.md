# Plan 324 — HIGH fixes (Run-5 Cycle 3)

**Source:** `.context/reviews/run5-cycle3/_aggregate.md`
**Commit discipline:** GPG-signed (`git commit -S`), conventional commits + gitmoji, one commit per item, push after each, full gate run before cycle close.

---

## Item 1 — AGG-R5C3-01: test-artifact leak into `public/resources/` (HIGH/High · confirmed · 3 agents, reproduced)

- **Sources:** BUG-R5C3-01 + BUG-R5C3-03 (debugger), COR-R5C3-01 (code-reviewer, reproduced +2 files/run), TRC-R5C3-01/-02 (tracer).
- **Where:**
  - `apps/web/src/__tests__/process-topic-image.test.ts:88-106` — the two success-path tests call the REAL Sharp pipeline; outputs never registered for cleanup (`afterAll` at :146-149 only cleans `createdFiles[]` from the other describe block).
  - `apps/web/src/lib/process-topic-image.ts:11-17` — `RESOURCES_DIR` resolves to live `apps/web/public/resources/` under vitest cwd.
  - `apps/web/.gitignore` — has `/public/uploads/*`, nothing for `/public/resources/`.
- **Change:**
  1. In the `processTopicImage` describe block, push every returned `path.join(resourcesDir, filename)` into a cleanup list and unlink in `afterAll` (mirror the existing pattern).
  2. Add to `apps/web/.gitignore`: `/public/resources/*` + `!/public/resources/.gitkeep`; create the tracked `.gitkeep`.
  3. Delete the ~30 leaked UUID `.webp` files (verified synthetic 512×512 solid-color test blobs from today's gate runs — not user data).
- **Acceptance:** running `npx vitest run src/__tests__/process-topic-image.test.ts` twice leaves `public/resources/` containing only `.gitkeep`; `git status` clean.

## Item 2 — AGG-R5C3-02: tautology assertion in `caption-generator.test.ts` (HIGH/High · confirmed · 2 agents)

- **Sources:** BUG-R5C3-02 (debugger), TEST-R5C3-01 (test-engineer); folds BUG-R5C3-07 (redundant `vi.mock('server-only')`).
- **Where:** `apps/web/src/__tests__/caption-generator.test.ts:65-69` — `expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX)` (deslop 62532c77 residue); `:11` redundant `vi.mock('server-only', () => ({}))` (global alias exists in `vitest.config.ts`).
- **Change:** replace the self-comparison with a behavioral pin: call `generateCaption(...)` and assert `result.indexOf(ALT_TEXT_STUB_PREFIX) === 0` with the constant imported from `caption-constants`. Remove the redundant `vi.mock('server-only')` line.
- **Acceptance:** mutating the prefix literal inside `generateCaptionStub` makes the test fail; suite green at HEAD.

## Item 3 — AGG-R5C3-03: global skip link broken on admin routes (HIGH/High · confirmed · runtime-verified, WCAG 2.4.1)

- **Source:** DES-R5C3-01 (designer; runtime evidence `brokenSkipLinks: ["#main-content"]` on `/en/admin`).
- **Where:** `apps/web/src/app/[locale]/layout.tsx:124` (global `href="#main-content"`); `apps/web/src/app/[locale]/admin/layout.tsx:20,24` (admin `<main id="admin-content">`).
- **Change:** make the global skip link resolve on admin routes — put `id="main-content"` on the admin layout's `<main>` (keep `admin-content` only if something references it; grep first — if `#admin-content` is referenced by the admin sub-layout skip link, update that link to `#main-content` too and drop the duplicate skip link if redundant). Ensure exactly ONE skip link per page and no duplicate ids on public routes.
- **Acceptance:** on `/en/admin` and `/en/admin/settings`, `document.querySelector('a[href^="#"]')` targets resolve to an existing element; e2e/admin a11y smoke (if present) green; no duplicate `id` warnings.

---

## Progress

| # | Finding | Commit | Status |
|---|---|---|---|
| 1 | AGG-R5C3-01 | — | TODO |
| 2 | AGG-R5C3-02 | — | TODO |
| 3 | AGG-R5C3-03 | — | TODO |
