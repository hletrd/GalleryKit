# Document Specialist Review — Cycle 19

## Method

Compared code against inline comments, CLAUDE.md references, and cross-file documentation. Focused on comments that no longer match implementation, stale references to removed features, and misleading documentation.

---

## Findings

### C19-DOC-01 (LOW): Misplaced side-effect comment in data.ts

- **Source**: `apps/web/src/lib/data.ts:1324-1328`
- **Issue**: The comment block reads:
  ```typescript
  // cache() deduplicates calls by arguments within a single request. Shared-group
  // lookups may buffer a view-count side effect unless called with
  // incrementViewCount:false or a valid selectedPhotoId. Do not call the cached
  // wrapper twice with different count semantics in the same render path.
  export const getImageByShareKeyCached = cache(getImageByShareKey);
  ```
  `getImageByShareKey` does NOT accept `incrementViewCount` or `selectedPhotoId` options, and it does NOT buffer view counts. The `bufferGroupViewCount` side effect was removed from this function in a prior refactor. The comment accurately describes `getSharedGroup` (which IS cached on the next line), not `getImageByShareKey`.
- **Impact**: Future contributors may be confused about which function has side effects. They might incorrectly avoid calling `getImageByShareKeyCached` twice, or might incorrectly assume `getSharedGroupCached` is pure.
- **Fix**: Move the comment to line 1329 (above `getSharedGroupCached`). Add a simple "Pure function — safe to cache" comment above `getImageByShareKeyCached`.
- **Confidence**: High

### C19-DOC-02 (LOW): Outdated comment in sw.js about build replacement

- **Source**: `apps/web/public/sw.js:11`
- **Issue**: The comment says `e04a331 is replaced at build time by scripts/build-sw.ts`. However, looking at the file, `SW_VERSION` is hardcoded to `'e04a331'` and there is no evidence in the repo of `scripts/build-sw.ts`. The checked-in `sw.js` appears to be the production file, not a template.
- **Impact**: Developers may look for `scripts/build-sw.ts` and waste time searching for a non-existent file.
- **Fix**: Update the comment to reflect the actual build process, or add the build script if it is missing.
- **Confidence**: Medium

### C19-DOC-03 (LOW): `check-public-route-rate-limit.ts` comment references non-existent gate name

- **Source**: `apps/web/scripts/check-public-route-rate-limit.ts:13-17`
- **Issue**: The header comment references "Cycle 3 / D-101-15" and "C2RPF-CROSS-LOW-03". These appear to be internal ticket IDs that are not resolvable by someone reading the code without external context. While this is common in project comments, the comment also says the gate "closes the cycle 2 RPF C2RPF-CROSS-LOW-03 gap". Without access to the original ticket, a future maintainer cannot understand what gap was closed.
- **Impact**: Low — the code itself is self-explanatory, but the historical context is opaque.
- **Fix**: Add a one-sentence summary of what the gap was (e.g., "Ensures every public mutating API route has rate limiting or an explicit exemption").
- **Confidence**: Low (informational)

---

## Documentation confirmed accurate

- Rate-limit pattern docstring in `rate-limit.ts` (lines 1-31): Accurate and matches all three rollback patterns used in the codebase.
- CLAUDE.md "Security Architecture" section: Matches implementation (Argon2, HMAC-SHA256, cookie flags, rate limiting).
- `process-image.ts` ICC profile resolution matrix: Matches the implementation in `resolveAvifIccProfile`.
- Privacy field comments in `data.ts`: `adminSelectFields` / `publicSelectFields` derivation is correct; compile-time guards `_privacyGuard` and `_mapPrivacyGuard` are present.
