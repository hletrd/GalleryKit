# Cycle 1 rpl — review fixes plan

Source aggregate: `.context/reviews/_aggregate-cycle1-rpl.md` (also mirrored into `.context/reviews/_aggregate.md`).
Raw reviews consulted: `.context/reviews/{code-reviewer-cycle1-fresh,security-reviewer-cycle1-new,perf-reviewer-cycle1-new,critic-cycle1-new,verifier-cycle1-new,test-engineer-cycle1-new,tracer-cycle1-new,architect-cycle1-new,debugger-cycle1-new,document-specialist-cycle1-new,designer-cycle1-new}.md`.

## Repo-policy inputs consulted
- `CLAUDE.md` (project instructions + security architecture section)
- `AGENTS.md`
- `.context/` existing plan artifacts (including `plan/cycle6-review-fixes.md`, `plan/cycle6-review-triage.md`)
- `.cursorrules` *(missing)*
- `CONTRIBUTING.md` *(missing)*
- `docs/` policy/style files *(not present)*

## Context
The cycle-6 plan (`plan/cycle6-review-fixes.md`) was committed but never implemented — every cited finding was re-verified on current HEAD `a308d8c`. This cycle 1 rpl plan subsumes the still-open Cycle 6 items under new ids and adds the small test-coverage item the aggregate calls out. Broader deferrals (cursor pagination, sitemap partitioning, CSV streaming, photo-route contract redesign, CSP nonce rollout) remain recorded in the deferred file.

## Planned implementation tasks

### C1R-01 — Fail-closed same-origin default + lock in unit tests
- **Source findings:** `AGG1R-01`, `AGG1R-07`
- **Files:**
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/__tests__/request-origin.test.ts`
- **Severity / confidence:** MEDIUM / HIGH overall
- **Goal:** Require explicit same-origin provenance on auth-sensitive server actions by default; retain the explicit loose option.
- **Plan:**
  1. Flip the `allowMissingSource` default in `hasTrustedSameOriginWithOptions` from `true` to `false`.
  2. Flip the `hasTrustedSameOrigin` default helper to the stricter default.
  3. Update `request-origin.test.ts` — the current "compatibility fallback" case must now expect `false`, and a sibling test must lock the explicit loose opt-in via `hasTrustedSameOriginWithOptions({ allowMissingSource: true })`.
  4. Run `npm test --workspace=apps/web` locally and verify passes.
- **Progress:** [x] implemented, commit 3d19be5 → mined to 000000033dee98f8bc40cd3772d304e668eea49d.

### C1R-02 — Move password-change rate-limit clear after transaction commits
- **Source findings:** `AGG1R-02`
- **Files:**
  - `apps/web/src/app/actions/auth.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** Preserve rate-limit pressure accumulated by earlier failed attempts when the post-verify transaction fails.
- **Plan:**
  1. Remove the `clearSuccessfulPasswordAttempts(ip)` call that currently runs immediately after `argon2.verify` succeeds.
  2. Run the password-update + session-invalidation transaction first.
  3. On commit success, call `clearSuccessfulPasswordAttempts(ip)`.
  4. Leave the catch-branch rollback (`rollbackPasswordChangeRateLimit`) unchanged.
- **Progress:** [x] implemented, commit e5611db → mined to 00000008844cc5786e3df45e9fa139de8e4e4152.

### C1R-03 — Strip authenticated chrome from the unauthenticated `/admin` login shell
- **Source findings:** `AGG1R-03`
- **Files:**
  - `apps/web/src/app/[locale]/admin/layout.tsx`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** Do not render the full `AdminHeader` (+ nav + logout) on the unauthenticated login page.
- **Plan:**
  1. Have the top-level admin layout call `getCurrentUser()` (which is React `cache()`-wrapped).
  2. When no user is present, render a minimal container (skip link + children + unobtrusive branding).
  3. When a user is present, render `AdminHeader` as today.
  4. Keep the `(protected)/layout.tsx` behavior unchanged.
- **Progress:** [x] implemented, commit 296497a → mined to 000000043e27853fd6e3381cec2f487d27673b8d.

### C1R-04 — Return normalized persisted values from three admin actions + reflect in clients
- **Source findings:** `AGG1R-04`
- **Files:**
  - `apps/web/src/app/actions/images.ts` (`updateImageMetadata`)
  - `apps/web/src/components/image-manager.tsx`
  - `apps/web/src/app/actions/seo.ts` (`updateSeoSettings`)
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
  - `apps/web/src/app/actions/settings.ts` (`updateGallerySettings`)
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
  - optional: `apps/web/src/__tests__/*.test.ts` (small normalization tests)
- **Severity / confidence:** MEDIUM / HIGH (images), LOW / HIGH (seo, settings)
- **Goal:** Keep admin UI state aligned with the sanitized values actually stored server-side.
- **Plan:**
  1. `updateImageMetadata` → return `{ success: true, title, description }` with sanitized values; client updates `images` state from returned fields.
  2. `updateSeoSettings` → return `{ success: true, settings }` with sanitized map; seo-client rehydrates from returned values.
  3. `updateGallerySettings` → return `{ success: true, settings }` with normalized values (including normalized `image_sizes`); settings-client rehydrates from returned values.
  4. Add at least one vitest per action to lock the normalization contract.
- **Progress:** [x] implemented, commit e3e1458 → mined to 00000008add24167472b71b84b4ca946b883e13d. Unit coverage deferred to the gate verification pass; existing contract tests pass.

### C1R-05 — Make `seed-e2e.ts` honor configured image sizes
- **Source findings:** `AGG1R-05`
- **Files:** `apps/web/scripts/seed-e2e.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** E2E fixture derivatives match the active image-size contract.
- **Plan:**
  1. Import the default/configured `image_sizes` list (via `@/lib/gallery-config-shared` or the shared defaults).
  2. Replace the hard-coded `[640, 1536, 2048, 4096]` array in generation and cleanup loops with that list.
  3. Keep existing topic, alias, image metadata, and 2048-to-canonical behavior unchanged.
- **Progress:** [x] implemented, commit 45f773e → mined to 000000008e8edbd94c812615e82ef9958535ce40.

### C1R-06 — Normalize legacy `src/db/seed.ts` topic slugs to current runtime rules
- **Source findings:** `AGG1R-06`
- **Files:** `apps/web/src/db/seed.ts`
- **Severity / confidence:** LOW / HIGH
- **Goal:** Seed rows must satisfy the current slug invariant.
- **Plan:**
  1. Change slugs `IDOL` and `PLANE` to `idol` and `plane`.
  2. Preserve labels and `order`.
- **Progress:** [x] implemented, commit 00314d9 → mined to 00000004b644be80ce8762b4eb7b0d3da5f16100.

### C1R-07 — Auto-enable admin E2E lane locally + add GPS-toggle assertion
- **Source findings:** `AGG1R-08`
- **Files:**
  - `apps/web/e2e/helpers.ts`
  - `apps/web/e2e/admin.spec.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** Default local `npm run test:e2e` exercises non-destructive admin flows; designer's GPS-toggle UI claim is explicitly validated.
- **Plan:**
  1. In `helpers.ts`, detect safe local-test environment (e.g. `NODE_ENV !== 'production'` and `E2E_ADMIN_USERNAME` present) and set `adminE2EEnabled = true` by default; keep explicit opt-out.
  2. Extend `admin.spec.ts` with a non-destructive settings assertion that flipping the GPS toggle changes the hydrated UI state.
- **Progress:** [x] implemented, commit ec47983 → mined to 000000011ff14bfa251c21b1f226bb26aa0d2939.

## Status after implementation
This plan will be moved to `plan/done/` once all tasks are complete and the orchestrator gates are green.
