# Plan 103 — Cycle 1 UI/UX and Playwright gate recovery

## Scope
Address the highest-signal UI/UX issues found in cycle 1 while keeping the default quality gates runnable in this workspace.

## Active items

### 1. Fix production CSP so the live gallery can hydrate
**Finding:** Aggregate C1 / `designer.md`
**Files:** `apps/web/next.config.ts`
- Remove the production `script-src` configuration that blocks Next runtime chunks.
- Keep GA allowed without requiring a nonce/hash pipeline the app does not implement.
- Re-verify against the live `gallery.atik.kr` target after deploy.

### 2. Fix search dialog accessibility and keyboard focus behavior
**Finding:** Aggregate C2 / `designer.md`
**Files:** `apps/web/src/components/search.tsx`
- Give the combobox a real accessible label.
- Focus the input reliably on open.
- Restore focus to the trigger on close.
- Keep keyboard navigation inside the modal surface.

### 3. Remove nested interactive controls
**Finding:** Aggregate C3
**Files:**
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- Convert `Link` + `Button` nesting into `Button asChild` composition.

### 4. Repair the admin batch-tag dialog state machine
**Finding:** Aggregate C4 / `code-reviewer.md`
**Files:** `apps/web/src/components/image-manager.tsx`
- Split dialog-open state from request-pending state.
- Keep Enter-submit behavior working only while pending is false.

### 5. Use native buttons for tag-filter chips and align theme bootstrapping with system preference
**Findings:** Aggregate C5 + C6
**Files:**
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/app/[locale]/layout.tsx`
- Render tag chips as real buttons via existing primitives.
- Change the default theme bootstrap to follow system preference.

### 6. Make the default Playwright gate runnable without a local MySQL instance
**Finding:** Aggregate C7 / `test-engineer.md`
**Files:**
- `apps/web/playwright.config.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`
- Keep the default suite focused on public smoke checks against the configured target.
- Use a standalone-compatible local server command only when the base URL is local.
- Make DB-dependent admin E2E explicitly opt-in so the default gate does not hard-fail in an unseeded workspace.
- Remove brittle host/selector assumptions that currently fail outside one local seed state.

## Existing tracked findings from this review batch (no new cycle-1 plan required)
These were already covered by prior plan/deferred artifacts and should stay on those tracks rather than expanding this UI-focused cycle:
- SQL restore scanner hardening: `.context/plans/28-data-safety-and-sharing-r8.md`
- Upload tracker / upload pipeline follow-ups: `.context/plans/30-security-rate-limit-and-upload.md`, `.context/plans/33-rate-limit-and-upload-tracker.md`, `.context/plans/plan-101-cycle13-fixes.md`
- Public/private data-layer privacy boundaries: `.context/plans/31-data-layer-and-queue-hardening.md`, `.context/plans/plan-92-cycle6-fixes.md`
- Topic/alias route-validation work: `.context/plans/45-i18n-topics-and-share-safety.md`
- Prior image-manager/admin UI follow-ups: `.context/plans/42-auth-session-transaction-and-queue-docs.md`, `.context/plans/46-ui-checkbox-password-csv.md`, `.context/plans/plan-66-cycle20-fixes.md`

## Verification target
- `npm run lint --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
