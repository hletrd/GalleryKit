# Cycle 98 Tests/Contracts Review

Starting deployed HEAD: `6f40f66d9a6949ea866966230e5fe0ba61024637`.

## Findings

### C98-01: Public select privacy guard does not pin the exact public allowlist

- Severity: High
- Confidence: High
- Evidence: `apps/web/src/lib/data.ts` derives `publicSelectFields` with a rest-spread after omissions, while `apps/web/src/__tests__/privacy-fields.test.ts` only asserts the admin-only difference equals `SENSITIVE_KEYS`.
- Failure scenario: a future admin-only column is added to `adminSelectFields` and forgotten in the omit block and `SENSITIVE_KEYS`; public queries expose it and the symmetric difference test still passes because the field is treated as public.
- Suggested fix: add an explicit `PUBLIC_SAFE_KEYS` allowlist assertion so any public shape change requires an intentional fixture update.

### C98-02: i18n duplicate-key test cannot detect duplicate JSON keys

- Severity: Low
- Confidence: High
- Evidence: `apps/web/src/__tests__/i18n-key-parity.test.ts` imports already-parsed JSON, so duplicate object keys are collapsed before the duplicate assertion runs.
- Failure scenario: one locale file contains a duplicate key; the later value silently wins and the test remains green.
- Suggested fix: scan raw JSON source for duplicate object keys before parsed import parity checks.
