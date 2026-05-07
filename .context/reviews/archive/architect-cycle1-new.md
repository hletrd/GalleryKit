# architect — cycle 1 (new)

Scope: architectural/design risks, coupling, layering.

## Findings

### ARCH1-01 — Top-level admin layout conflates authenticated and unauthenticated shells
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx`
- **Severity / confidence:** MEDIUM / HIGH
- **Problem:** The Next.js App Router already gives us `(protected)/` for the auth-required portion. The top-level layout should be a thin shell that branches on `getCurrentUser()` and delegates protected chrome to the `(protected)/layout.tsx`. Today the top-level layout unconditionally renders authenticated chrome, so the `(protected)` subgroup becomes redundant for layout purposes.
- **Fix:** Let the `(protected)/layout.tsx` own the header/nav and logout form, and leave the top-level layout as a minimal container + skip link. This matches Next convention and removes a whole class of "login page looks logged-in" bugs.

### ARCH1-02 — `hasTrustedSameOrigin` is a single function with two contracts
- **Citation:** `apps/web/src/lib/request-origin.ts:62-87`
- **Severity / confidence:** LOW / HIGH
- **Problem:** One function, two callsites, two effective contracts (strict vs loose) selected by a boolean default. The backup download already opts in via `hasTrustedSameOriginWithOptions`. It would be more defensible if the default became strict and the loose path were explicit.
- **Fix:** Flip default to strict; keep the loose option via `hasTrustedSameOriginWithOptions({ allowMissingSource: true })` where documented legacy compatibility is required.

### ARCH1-03 — Admin action return-shape inconsistency
- **Citation:** `apps/web/src/app/actions/{images,seo,settings,topics,tags,sharing,admin-users,auth}.ts`
- **Severity / confidence:** LOW / MEDIUM
- **Problem:** Some actions return `{ success: true, ... }` with normalized payload; most return `{ success: true }` only. As callers continue to rely on client-side rehydration, normalization drift is easy to introduce. A small "always return normalized fields" convention reduces the surface.
- **Fix (cycle 1 slice):** Apply convention to the three narrow actions listed in CR1F-04; leave the broader audit as a cross-cycle follow-up.

### ARCH1-04 — Legacy `db/seed.ts` is a second, inconsistent seed path
- **Citation:** `apps/web/src/db/seed.ts`
- **Severity / confidence:** LOW / HIGH
- **Problem:** Two seed paths (legacy + E2E) with diverging invariants. Either consolidate to `seed-e2e.ts` (or a new "canonical" seed) or keep the legacy path strictly valid. For this cycle, normalize the legacy slugs to meet current invariants; broader consolidation is deferrable.

### ARCH1-05 — No change to single-process runtime assumptions this cycle
- **Disposition:** `D6-13` remains deferred; no new architectural claim.
