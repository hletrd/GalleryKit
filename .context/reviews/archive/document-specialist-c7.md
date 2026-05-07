# Documentation Review — Cycle 7

## Summary

Inline documentation is excellent — among the best in the codebase. Security rationale, historical context, and cross-references to prior cycles are consistently present. A few API surfaces lack external documentation.

---

## C7-DOC-01: `admin-tokens.ts` PAT scope semantics are undocumented — Medium

**File:** `apps/web/src/lib/admin-tokens.ts`

**Finding:** The PAT scopes (`lr:upload`, `lr:read`, `lr:delete`) are referenced in code but there is no documentation explaining what each scope permits. The `lr:` prefix suggests "Lightroom" but this is never explained. Future developers or plugin authors won't know which scope to request.

**Fix:** Add a doc comment block above the scope constants:
```typescript
/**
 * PAT scopes for non-browser integrations (e.g., Lightroom Classic plugin).
 * - lr:upload  — upload new images via uploadImages server action
 * - lr:read    — list topics, images, and metadata
 * - lr:delete  — delete images and their variants
 */
```

**Confidence:** Medium

---

## C7-DOC-02: `check-public-route-rate-limit.ts` header comment is misleading about GET coverage — Low

**File:** `apps/web/src/scripts/check-public-route-rate-limit.ts`
**Lines:** 1-16

**Finding:** The header says "every PUBLIC API route file which exports a mutating HTTP handler" but the actual scan only covers POST/PUT/PATCH/DELETE. The comment is accurate but could be clearer that GET routes are intentionally out of scope. This confusion led to C7-SEC-03 (OG route missing rate limit).

**Fix:** Add a sentence: "GET handlers are NOT scanned by this gate; expensive GET routes must opt out manually with `@public-no-rate-limit-required` or use a separate audit."

**Confidence:** Low

---

## C7-DOC-03: `smartCollections` schema comment references `apps/web/src/lib/smart-collections.ts` but the module is not linked — Low

**File:** `apps/web/src/db/schema.ts`
**Lines:** 252-266

**Finding:** The smart_collections table has a detailed comment about AST compilation safety, but there is no README or design doc explaining the AST shape, the query language, or how admins construct queries. The only documentation is inline code comments.

**Fix:** Add a brief AST specification comment in `smart-collections.ts` or a markdown file in `.context/docs/` describing the predicate grammar.

**Confidence:** Low

---

## C7-DOC-04: `imageEmbeddings` table comment is comprehensive — Commendation

**File:** `apps/web/src/db/schema.ts`
**Lines:** 213-229

**Finding:** The comment explains MEDIUMBLOB vs Drizzle text typing, Buffer/Float32Array conversion, model versioning, and privacy considerations. This is exemplary documentation.

**Confidence:** N/A (commendation)
