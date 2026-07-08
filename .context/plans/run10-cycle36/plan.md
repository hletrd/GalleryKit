# Run-10 Cycle 36/100 Implementation Plan

Status: IMPLEMENTED - local gates green; signed push and per-cycle deploy pending
Aggregate: `.context/reviews/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `bc73c02293f2568d23602ab498f12346a37fadf1`

## Scope

This cycle schedules contained, implementation-ready findings from the Cycle 36 aggregate and records every broader item in `deferred.md`.

Repo rules read before scheduling: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/run10-cycle35/{plan,deferred}.md`, current `.context/**` plan/review artifacts, README files, and docs under `docs/superpowers/`. No new dependency, schema migration, destructive production operation, host-nginx mutation, payment/editing/product-feature reintroduction, or production secret/config hardcoding is required.

## Scheduled Work Packages

### WP1 - Remove root Playwright runtime state from tracked source

Finding: `AGG-C36-04`.

Files:

- `.gitignore`
- `test-results/.last-run.json`

Plan:

1. Stop tracking the mutable root Playwright `.last-run.json` runtime file.
2. Ignore root-level `test-results/` and `playwright-report/` alongside the existing `apps/web/` Playwright output ignores.
3. Preserve any intentional review screenshots under `.context/` rather than Playwright's mutable output directory.

Acceptance:

- `test-results/.last-run.json` is removed from git tracking.
- Future root-level Playwright runs do not dirty the worktree with default runtime output.

### WP2 - Fix footer 320px reflow and promote core browse routes

Findings: `AGG-C36-16`, partial `AGG-C36-18` where it overlaps visible search/nav affordance.

Files:

- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/__tests__/touch-target-audit.test.ts` only if the existing audit needs an updated fixture
- Existing nav/footer/source tests if present

Plan:

1. Allow footer link rows to wrap and center at narrow widths while preserving 44px touch targets.
2. Add Timeline and Map to primary desktop navigation as core browse modes, and include them in the mobile expanded menu after topics.
3. Keep About/GalleryKit, Privacy, GitHub, and Admin as footer-secondary links.
4. Add visible Search text at desktop/tablet widths if it fits the existing nav density; keep icon-only on narrow mobile.
5. Verify no touch target regression and no text overflow in EN/KO at narrow widths.

Acceptance:

- Footer no longer causes horizontal overflow at 320px.
- Timeline and Map are discoverable without reaching the footer.
- Search remains accessible and gains a visible label where space permits.

### WP3 - Return and render field-specific SEO validation errors

Finding: `AGG-C36-17`.

Files:

- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- Focused unit/source test under `apps/web/src/__tests__/` if an existing SEO settings test can be extended

Plan:

1. Extend the SEO action response shape to optionally include a field key for validation failures.
2. Map server-side validation failures to the relevant field (`seo_title`, `seo_nav_title`, `seo_description`, `seo_author`, `seo_locale`, `seo_og_image_url`, or `seo_site_url`) without changing authorization/origin/mutation-barrier behavior.
3. In the client, render inline field errors, set `aria-invalid` only on affected fields, connect field-specific `aria-describedby`, and focus the first invalid field when possible.
4. Keep the form summary for non-field/general failures.

Acceptance:

- A single invalid SEO field no longer marks every field invalid.
- Screen-reader users get field-specific error association.
- Existing auth/origin scanner and typecheck gates remain green.

### WP4 - Repair Cycle 35 provenance status and plan index

Finding: `AGG-C36-19`.

Files:

- `.context/plans/run10-cycle35/plan.md`
- `.context/plans/README.md`
- `.context/plans/run10-cycle36/plan.md`
- `.context/plans/run10-cycle36/deferred.md`

Plan:

1. Update Cycle 35 status/checklist from "signed push pending" to "signed push complete; deploy evidence absent/superseded by the next per-cycle deploy".
2. Update the plans index so Cycle 36 is active and Cycle 35 moves to recently completed/pushed history with the precise deploy-evidence caveat.
3. Keep Cycle 35's recorded gate evidence intact.

Acceptance:

- Future planners do not treat Cycle 35 as unpushed.
- Deploy evidence remains honest: if no Cycle 35 deploy transcript is present, the plan says so.

## Deferred Finding Map

Deferred items are recorded in `deferred.md` with original severity/confidence, citations, concrete reason, and exit criterion:

- `AGG-C36-01`
- `AGG-C36-02`
- `AGG-C36-03`
- `AGG-C36-05`
- `AGG-C36-06`
- `AGG-C36-07`
- `AGG-C36-08`
- `AGG-C36-09`
- `AGG-C36-10`
- `AGG-C36-11`
- `AGG-C36-12`
- `AGG-C36-13`
- `AGG-C36-14`
- `AGG-C36-15`
- The RTL/product-copy remainder of `AGG-C36-18`

No confirmed security, data-loss, or authz finding is deferred in this plan. The high-severity item (`AGG-C36-01`) is a broad operational performance/capacity finding, not a confirmed data-corruption/security defect; it is deferred with preserved severity and an explicit resource-governor exit criterion.

## Progress

- [x] Prompt 1 review artifacts returned and aggregate written.
- [x] Prompt 2 plan/deferred pair written.
- [x] WP1 root Playwright runtime hygiene implemented.
- [x] WP2 footer/nav browse discoverability implemented.
- [x] WP3 SEO field-specific errors implemented.
- [x] WP4 Cycle 35 provenance/index repaired.
- [x] Full configured gates run green.
- [ ] Signed commit pushed.
- [ ] Per-cycle deploy run and production smoke evidence recorded.

## Verification Plan

Required gates from the cycle context:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run audit:prod`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

Additional focused checks:

- Targeted SEO/nav/footer tests where available.
- `git diff --check`.
- Browser-flow e2e is required because WP2 changes public navigation/footer behavior.

## Verification Evidence

- `npm test --workspace=apps/web -- --run src/__tests__/seo-actions.test.ts src/__tests__/cycle-11-source-contracts.test.ts src/__tests__/touch-target-audit.test.ts` — passed, 3 files / 39 tests.
- `npm run typecheck --workspace=apps/web` — passed.
- `npm run lint --workspace=apps/web` — passed.
- `npm run lint:api-auth --workspace=apps/web` — passed.
- `npm run lint:action-origin --workspace=apps/web` — passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — passed.
- `npm run audit:prod` — passed, 0 vulnerabilities.
- `npm run typecheck --workspace=apps/web` — passed after final test-contract updates.
- `npm run build --workspace=apps/web` — passed.
- `npm test --workspace=apps/web` — passed, 361 files passed, 2 skipped; 3400 tests passed, 4 skipped.
- `npm run test:e2e --workspace=apps/web` — passed, 45 passed, 2 skipped.
- `git diff --check` — passed.

Deployment and production smoke after green gates and pushed commits:

- `npm run deploy`
- `https://gallery.atik.kr/api/live`
- Direct missing-upload 404 smoke against `https://gallery.atik.kr/uploads/__cycle36_missing__.jpg`
