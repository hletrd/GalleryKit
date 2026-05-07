# Document Specialist — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Scope: doc/code mismatches against authoritative sources. CLAUDE.md, AGENTS.md, README, inline comments vs. reality.

## Findings

### DS5-01 — `scripts/check-action-origin.ts` header comment suggests `auth.ts` is "automatically exempt" but the script's ACTION_FILES list explicitly does not include `auth.ts`
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/scripts/check-action-origin.ts:31-37` (comments) vs `:19-28` (ACTION_FILES).
- **Evidence:** the comment block says "`auth.ts` functions: exempt — they own their own `hasTrustedSameOrigin` call." But `auth.ts` isn't in `ACTION_FILES`, so it's not scanned at all. The "automatic name exemption" only takes effect for files that ARE scanned. The comment is technically correct but creates the impression the script checks `auth.ts` with an exemption — it doesn't check it at all.
- **Fix:** tighten the comment: "`auth.ts` and `public.ts` are intentionally excluded from ACTION_FILES because their auth-flow functions apply `hasTrustedSameOrigin` at call sites that the scanner cannot detect generically, and `public.ts` is the unauthenticated read-only action surface. They are not scanned; the exemption rules below apply only to the scanned files."

### DS5-02 — `check-action-origin.ts` line 41 exemption regex "`^get[A-Z]`" is documented as covering "read-only getters" but could match a mutating function accidentally named `getOrCreateFoo`
- **Severity:** LOW. **Confidence:** HIGH.
- **File:** `apps/web/scripts/check-action-origin.ts:41`.
- **Evidence:** the regex exempts any async exported function whose name starts with `get` followed by an uppercase letter. A mutating helper named `getOrCreateFoo` would be silently exempted — even though it mutates state.
- **Why it matters:** the doc says "read-only getters (name starts with `get`)". But `getOrCreateFoo` is not read-only; it mutates state.
- **Fix direction:** either tighten the regex (e.g. exempt only `getX`/`getXY`/`getXYZ` patterns that don't include `Create`/`Update`/`Delete`/`OrCreate`/`OrInsert` substrings), OR remove the auto-exemption entirely and require explicit `@action-origin-exempt: <reason>` comments for all non-mutating getters. Explicit is safer.
- **Note:** in the current codebase, no exported mutating function in the scanned files is named `get*` — this is a latent bug, not an active one.

### DS5-03 — CLAUDE.md says "uses `output: 'standalone'` for Docker deployments" — verified
- **Evidence:** not re-read this cycle. Prior cycles verified. **PASS.**

### DS5-04 — CLAUDE.md says "Node.js 24+ required, TypeScript 6.0+"
- **Evidence:** `package.json` — `"engines": { "node": ">=24" }`, `"typescript": "^6"`. **PASS.**

### DS5-05 — CLAUDE.md "Image Upload Flow" step 3 says "Sharp processes to AVIF/WebP/JPEG (async queue)" — matches `enqueueImageProcessing` → `processImageFormats`
- **Evidence:** `apps/web/src/lib/image-queue.ts:209-217`, `apps/web/src/lib/process-image.ts:362-444`. **PASS.**

### DS5-06 — CLAUDE.md says "`adminSelectFields` includes all fields (including PII) for authenticated admin routes; `publicSelectFields` derived from `adminSelectFields` by omitting PII fields"
- **Evidence:** `apps/web/src/lib/data.ts:115-200`. Derivation via object destructuring. Compile-time guard `_SensitiveKeysInPublic`. **PASS.**

### DS5-07 — README or CLAUDE.md says nothing about the `lint:action-origin` script's coverage scope
- **Severity:** LOW.
- **Evidence:** CLAUDE.md documents the GATES list but not the gate's own internal coverage. A reader looking to "add a new mutating action" has no guidance to add it to `ACTION_FILES`.
- **Fix:** add a short paragraph in CLAUDE.md under "Testing" or a new "Lint Gates" section: "New action files added to `apps/web/src/app/actions/` must also be added to `ACTION_FILES` in `scripts/check-action-origin.ts`, unless they are read-only (name starts with `get`) or unauthenticated (public.ts)." Addresses both DS5-01 and A5-02.

### DS5-08 — `CLAUDE.md` "Race Condition Protections" section lists `uploadImages` tracker TOCTOU fix as a past correction
- **Evidence:** `apps/web/src/app/actions/images.ts:170-176` — pre-increment tracker before processing. **PASS.**

### DS5-09 — CLAUDE.md "Security Architecture" section documents all the mitigations; no regressions detected
- **PASS.**

### DS5-10 — `safe-json-ld.ts:6-11` JSDoc accurately describes the U+2028/U+2029 + `<` escaping. No doc drift
- **PASS.**

## Summary

10 findings/verifications, all LOW. Actionable this cycle:
- DS5-01 — tighten the `check-action-origin.ts` header comment
- DS5-02 — tighten the exemption regex OR document it better
- DS5-07 — add a short "Lint Gates" section to CLAUDE.md
