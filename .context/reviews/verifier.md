# Cycle 8 Verifier Review (manual fallback after agent retry failure)

## Inventory
- Re-verified public topic routing, share-link creation, admin backup flows, search UI state handling, and tag mutation UX against the current working tree.
- Cross-checked current specialist reports from `code-reviewer`, `security-reviewer`, and `test-engineer` plus a direct source pass.

## Confirmed Issues

### V8-01 — Topic alias canonicalization drops the current tag filter
**Confidence:** High

**Files / regions:**
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:87-95`

**Why this is a problem:**
The route resolves aliases to the canonical topic slug, but the redirect target discards the current `searchParams`, so the canonical page no longer represents the request the user made.

**Concrete failure scenario:**
A shared/bookmarked alias URL with `?tags=portrait,travel` lands on the canonical topic without those filters, silently changing the visible gallery.

**Suggested fix:**
Preserve the current query string when redirecting to the canonical slug.

---

### V8-02 — Batch tag success can leave the admin UI out of sync with the persisted tag set
**Confidence:** High

**Files / regions:**
- `apps/web/src/components/image-manager.tsx:183-200`
- `apps/web/src/components/image-manager.tsx:371-399`
- `apps/web/src/app/actions/tags.ts:347-400`

**Why this is a problem:**
The server action can canonicalize, warn, or partially apply tag changes, but the current table keeps rendering stale local state until the operator manually reloads.

**Concrete failure scenario:**
A tag add/remove returns success with warnings, but the visible tag chips remain wrong because the client never refreshes from the server truth.

**Suggested fix:**
Refresh the route after successful tag mutations or return canonical persisted tags from the server and reconcile local state with them.

---

### V8-03 — The default E2E runner still depends on externally seeded state
**Confidence:** High

**Files / regions:**
- `apps/web/playwright.config.ts:27-58`
- `apps/web/e2e/public.spec.ts:60-77`
- `apps/web/e2e/admin.spec.ts:46-54`
- `apps/web/scripts/seed-e2e.ts:22-28,183-186`

**Why this is a problem:**
`npm run test:e2e` assumes the seeded topic/group already exist, but the default local runner does not create them first.

**Concrete failure scenario:**
A fresh checkout runs Playwright against a valid app instance but fails because `/g/Abc234Def5` and `e2e-smoke` were never seeded.

**Suggested fix:**
Make the default local Playwright runner seed the E2E fixture data before starting the server.

## Agent-failure note
- The first spawned verifier lane failed with a context-window exhaustion error.
- A retry lane was launched, then shut down after stalling, so this manual fallback note records the current verifier pass for provenance.
