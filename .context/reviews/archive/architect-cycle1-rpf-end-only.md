# Architect — Cycle 1 (RPF, end-only deploy mode)

## Scope
Architecture, coupling, layering review of gallery codebase as of HEAD
(`e090314`).

## Verified Architecture
- **Layered separation**: server actions (`app/actions/*.ts`) own business
  logic; route handlers (`app/api/**/route.ts`) are thin wrappers; data
  access lives in `lib/data.ts`. No leakage of `db` queries into components.
- **Auth/CSRF surface**: a single `requireSameOriginAdmin` is reused across
  all admin actions; a single `withAdminAuth` is reused across all admin
  API routes. Lint gates enforce both.
- **Rate-limit family**: a single `lib/rate-limit.ts` with three documented
  rollback patterns; consumers reuse the helpers (`preIncrementXxx`,
  `rollbackXxx`) — uniform and predictable.
- **Image pipeline**: queue → worker → DB metadata → revalidation, with
  contract lock (`upload-processing-contract-lock`) to prevent admin
  settings drift mid-upload.
- **Internationalization**: routes are `[locale]/...` consistently; helpers
  in `lib/locale-path.ts` and `lib/seo-og-url.ts` centralize URL formation.

## Observations

### A-CYCLE1-01: Plan/review file proliferation [Informational]
**Locations:** `.context/plans/` (60+ files) and `.context/reviews/`
(180+ files).
**Description:** The historical RPF cycles have accreted a large number of
review and plan documents in the unscoped root of `.context/reviews/` and
`.context/plans/`. Most are marked done or carryforward. Long-term, an
archive convention (e.g. `.context/plans/done/` already exists) could
absorb stale plans to keep the active surface scannable.
**Action:** No code change needed; this is informational and would be a
housekeeping pass at user discretion.

### A-CYCLE1-02: AGENTS.md is minimal compared to CLAUDE.md [Informational]
**Files:** `AGENTS.md` (4 lines), `CLAUDE.md` (rich).
**Description:** AGENTS.md only states two rules. The repo's substantive
guidance lives in `CLAUDE.md`. Some agentic toolchains read AGENTS.md
preferentially. A pointer in AGENTS.md to `CLAUDE.md` would prevent agents
that only read AGENTS.md from missing project rules. This is a docs hygiene
concern, not a defect.
**Confidence:** Low.

## Conclusion
No architectural defects. The layering, auth, and pipeline architecture is
sound and consistent. The only callouts are housekeeping observations.
