# Document Specialist — Cycle 3

## Doc/Code Mismatches

### D1: SW comment says "401/403 responses: never cached" but `isSensitiveResponse` also checks `no-store`
- **File**: `apps/web/public/sw.js`, lines 8-9 and 45-50
- **Mismatch**: The header comment mentions only 401/403, but the code also treats `Cache-Control: no-store` as sensitive. The comment is incomplete.
- **Fix**: Update the header comment to include `no-store`.

### D2: `check-public-route-rate-limit.ts` docstring says "Pattern 2 rollback helpers" but does not mention `checkAndIncrement`
- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 34-39
- **Mismatch**: The docstring mentions `preIncrement` and `checkAndIncrement` but the regex comment says "future routes are expected to use the `preIncrement` shape". It doesn't document that `checkAndIncrement` is also accepted.
- **Fix**: Update the comment to explicitly list both accepted prefixes.

### D3: `sw.js` version stamp comment references commit hash
- **File**: `apps/web/public/sw.js`, line 16
- **Note**: `const SW_VERSION = '181b1c1';` matches a real commit. The comment says it is replaced at build time by `scripts/build-sw.ts`. Verified that `build-sw.ts` exists and performs the replacement. No mismatch.
