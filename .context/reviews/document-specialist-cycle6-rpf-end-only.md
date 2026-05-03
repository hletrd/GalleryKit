# document-specialist — Cycle 6 RPF (end-only)

## Method

Doc-vs-code pass: read inline docstrings, README, AGENTS, CLAUDE files,
plan README; verify they match current source.

## Findings

### DOC-01 — `mapStripeRefundError` docblock says "only the mapped identifier crosses the action boundary"
- **File:** `apps/web/src/app/actions/sales.ts:88-93`
- **Severity:** Low | Confidence: Medium
- **What:** The doc explicitly says only `errorCode` crosses to the
  client. The actual code at line 202 returns `err.message` in the
  `error` field. Doc-code mismatch. The fix is in the code (drop the
  `error` field) or in the doc (acknowledge the dual surface and say
  "the `error` field is for server-side trace only and clients SHOULD
  read errorCode").
- **Cross-agent:** matches CR-03, SEC-05, ARCH-03, DBG-04.
- **Fix:** drop the field from the type to align doc and code.

### DOC-02 — Cycle 5 P388 numbering vs cycle 5 P266 commit numbering
- **Files:** test source comments use P388, commits use P266.
- **Severity:** Informational | Confidence: High
- **What:** Cosmetic plan-ID drift across the cycle 5 work. No
  functional impact, but a contributor reading the test source then
  searching git log for "P388" will find nothing. A docstring update
  in the test file could help, but is not necessary — the test asserts
  on source patterns, not on plan IDs.
- **Fix:** none required this cycle.

### DOC-03 — Webhook line 46 docblock describes the cycle 5 hoist
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:35-46`
- **Severity:** Informational | Confidence: High
- **What:** Doc is correct and self-consistent.

### DOC-04 — Cycle 5 deferred plan (plan-389) is comprehensive
- **File:** `.context/plans/plan-389-cycle5-rpf-end-only-deferred.md`
- **Severity:** Informational | Confidence: High
- **What:** Includes carry-forward of cycle 1-4 deferred items. Sound.

### DOC-05 — README.md "Paid downloads" section
- **File:** `apps/web/README.md` (not re-read this cycle, carry-forward).
- **Severity:** Informational
- **What:** Describes the `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true` opt-in
  workflow. Code at webhook line 313 matches.

### DOC-06 — `requireSameOriginAdmin` docblock
- **File:** `apps/web/src/lib/action-guards.ts:6-44`
- **Severity:** Informational | Confidence: High
- **What:** Comprehensive. Code matches doc.

## Confirmed clean docs

- `apps/web/src/app/api/stripe/webhook/route.ts` — every cycle marker
  references existing source structure.
- `apps/web/src/app/actions/sales.ts` — Stripe error type mapping
  table (line 101-110) matches actual implementation.
- `apps/web/src/lib/download-tokens.ts` — STORED_HASH_SHAPE doc
  matches code.
- `apps/web/src/app/api/download/[imageId]/route.ts` — every cycle
  marker accurate.
