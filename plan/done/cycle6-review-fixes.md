# Cycle 6 review fixes plan

Source aggregate: `.context/reviews/_aggregate.md`
Raw reviews consulted: `.context/reviews/{code-reviewer,security-reviewer,critic,verifier,test-engineer,architect,debugger,designer}.md`

## Repo-policy inputs consulted
- `CLAUDE.md`
- `AGENTS.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/available-agents-cycle6.txt`
- `.context/plans/README.md`
- `.cursorrules` *(missing)*
- `CONTRIBUTING.md` *(missing)*
- `docs/` policy/style files *(none present)*

## Summary
This cycle will implement the narrow, current-head-fixable review findings and revalidation work that fit the repo rule to keep diffs small, reviewable, and reversible. Broader contract changes (cursor pagination, sitemap partitioning, streaming CSV, scoped photo navigation, public-photo ISR boundary redesign, broader architectural splits) are tracked separately in the triage file.

## Planned implementation tasks

### C6R-01 — Fail closed for auth provenance checks and preserve password-change rollback correctness
- **Source findings:** `AGG6-02`; debugger `DBG6-03`
- **Files:**
  - `apps/web/src/lib/request-origin.ts`
  - `apps/web/src/__tests__/request-origin.test.ts`
  - `apps/web/src/app/actions/auth.ts`
- **Severity / confidence:** MEDIUM / HIGH overall
- **Goal:** Make auth-sensitive calls require explicit same-origin provenance by default, and avoid losing the password-change bucket when post-verify transactional work fails.
- **Plan:**
  1. Change `hasTrustedSameOrigin()` to fail closed by default when both `Origin` and `Referer` are missing.
  2. Update request-origin tests to lock the stricter default while preserving the explicit compatibility opt-in path.
  3. Move password-change rate-limit clearing until after the password/session transaction commits successfully.
  4. Verify login/password-change flows still pass existing tests and types.
- **Progress:** [ ] pending

### C6R-02 — Reflect persisted normalized values back into admin clients
- **Source findings:** `AGG6-03`; `AGG6-13`
- **Files:**
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/components/image-manager.tsx`
  - `apps/web/src/app/actions/seo.ts`
  - `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
  - `apps/web/src/app/actions/settings.ts`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- **Severity / confidence:** MEDIUM/LOW with HIGH confidence
- **Goal:** Keep admin UI state aligned with the sanitized values actually stored by the server.
- **Plan:**
  1. Return normalized persisted values from `updateImageMetadata`, `updateSeoSettings`, and `updateGallerySettings`.
  2. Rehydrate local client state from those normalized return values instead of raw pre-save inputs.
  3. Add/adjust tests where practical to lock the normalization contract.
- **Progress:** [ ] pending

### C6R-03 — Strip protected admin chrome from the unauthenticated login shell
- **Source findings:** `AGG6-04`
- **Files:**
  - `apps/web/src/app/[locale]/admin/layout.tsx`
  - `apps/web/src/components/admin-header.tsx`
  - `apps/web/src/components/admin-nav.tsx`
  - optional E2E assertions under `apps/web/e2e/admin.spec.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** Keep `/admin` focused on sign-in until auth is established.
- **Plan:**
  1. Have the shared admin layout determine whether an authenticated admin user is present.
  2. Hide the protected nav and logout affordances when rendering the unauthenticated login route.
  3. Preserve the protected shell for authenticated admin routes.
- **Progress:** [ ] pending

### C6R-04 — Make the local Playwright lane exercise the admin surface and revalidate the disputed UI findings
- **Source findings:** `AGG6-06`; designer finding 3; `AGG6-14`
- **Files:**
  - `apps/web/e2e/helpers.ts`
  - `apps/web/e2e/admin.spec.ts`
  - optional `apps/web/playwright.config.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** Ensure the default local E2E run covers non-destructive admin flows and explicitly validates the settings toggle behavior that the designer review flagged.
- **Plan:**
  1. Enable admin E2E automatically for the safe local test environment when plaintext local credentials are available.
  2. Keep remote admin E2E opt-in only.
  3. Add a non-destructive admin settings assertion that the GPS toggle changes state in the hydrated UI.
  4. Use the resulting green E2E evidence to close the disputed “public controls are inert” review claim if it remains unreproduced.
- **Progress:** [ ] pending

### C6R-05 — Make E2E fixture generation honor configured image sizes
- **Source findings:** `AGG6-09`
- **Files:** `apps/web/scripts/seed-e2e.ts`
- **Severity / confidence:** MEDIUM / HIGH
- **Goal:** Generate seeded derivatives that match the active gallery image-size contract.
- **Plan:**
  1. Read the configured/default image sizes inside the seed script.
  2. Generate base + variant files from that active size list instead of the hard-coded `[640,1536,2048,4096]` array.
  3. Keep the existing seeded topic, aliases, and image metadata behavior unchanged.
- **Progress:** [ ] pending

### C6R-06 — Normalize legacy topic seed slugs to current runtime rules
- **Source findings:** `AGG6-12`
- **Files:** `apps/web/src/db/seed.ts`
- **Severity / confidence:** LOW / HIGH
- **Goal:** Stop the legacy seed path from inserting slugs that current validation rejects.
- **Plan:**
  1. Change legacy seed slugs to lowercase.
  2. Preserve labels/order so the seed remains functionally equivalent.
- **Progress:** [ ] pending
