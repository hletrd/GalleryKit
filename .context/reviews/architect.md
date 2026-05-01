# Architect — Cycle 25

## Review method

Architectural review of coupling, layering, module boundaries, and design risks.

## Architecture assessment

The codebase follows a clean layered architecture:

- **Route layer**: `app/[locale]/(public)/*` and `app/[locale]/admin/*` pages
- **Server action layer**: `app/actions/*` with consistent guard pattern
  (isAdmin -> requireSameOriginAdmin -> maintenance check -> business logic)
- **Data access layer**: `lib/data.ts` with React.cache() deduplication
- **Library layer**: `lib/*` utilities with clear single-responsibility
- **Middleware layer**: `proxy.ts` with CSP and admin auth guard

**Coupling observations**:
- Server actions depend on `isAdmin` and `requireSameOriginAdmin` in consistent
  order — good pattern that prevents accidental omission
- `data.ts` at 1283 lines is the largest module but is internally well-organized
  with clear section comments
- Advisory lock names are centralized in `advisory-locks.ts` — good
- Rate-limit rollback patterns are symmetric across all action surfaces

**Layering concerns (all previously deferred)**:
- data.ts god module (1283 lines) — A17-MED-01
- getImage parallel queries pool exhaustion — A17-MED-03
- CSP unsafe-inline — A17-MED-02

## New Findings

None. The architecture is sound and consistent with the single-writer /
personal-gallery deployment model documented in CLAUDE.md.
