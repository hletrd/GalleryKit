# Test-engineer — Run-4 Cycle 20

Single-subagent in-context pass.

## Inventory (this angle)

`apps/web/src/__tests__/seo-actions.test.ts` (the `validateSeoOgImageUrl`
describe block), plus a sweep of the URL/validation test coverage.

## Findings

### TEST-R4C20-02 — no backslash/normalization case in the OG URL validator suite (MED / High)

- **Citation:** `apps/web/src/__tests__/seo-actions.test.ts:5-19`.
- **Problem:** the `validateSeoOgImageUrl` describe block asserts:
  - accepts `/uploads/og.jpg` (relative)
  - rejects `//evil.example/og.jpg` (scheme-relative)
  - rejects cross-origin absolute
  - accepts same-origin absolute

  It does NOT cover the backslash variant `/\evil.com`, which is exactly
  the SEC-R4C20-01 bypass. The suite is green against the broken validator
  — the same "the test encodes the same blind spot as the code" pattern
  that hid COR-R4C19-01 for six weeks. A reviewer reading the suite would
  reasonably conclude scheme-relative bypasses are covered; only the `//`
  spelling is.
- **Fix:** add cases asserting `/\evil.com`, `/\/evil.com`, `/\\evil.com`
  are rejected and that a legitimate `/uploads/og.jpg` still passes.
  Schedule together with SEC-R4C20-01 (same file pairing as the fix), and
  prove the new reject-cases fail pre-fix.
- **Confidence:** High.

## Clean-pass

- The cycle-19 additions (`topics-actions.test.ts` tuple mocks,
  `check-public-route-rate-limit.test.ts` star-re-export cases,
  `admin.spec.ts` topic create/delete) are runtime-accurate and were
  proven failing pre-fix per their commit bodies. No flake surface added
  (the e2e topic spec is self-cleaning in a `finally`).
- No new TDD opportunity beyond TEST-R4C20-02 surfaced in the rotation
  cluster; the leaf utilities (download-filename, base56, exif-datetime,
  bounded-map) already carry dedicated fixtures.
