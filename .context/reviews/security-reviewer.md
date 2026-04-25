# Security Reviewer — Cycle 3 (review-plan-fix loop, 2026-04-25)

Reviewed surfaces: actions/* (all mutating server actions), lib/sanitize.ts, lib/validation.ts, lib/rate-limit.ts, lib/audit.ts, auth.ts. The codebase carries 46 cycles of accumulated hardening; most surfaces are tight. Below are residual findings.

## C3L-SEC-01: `isValidTopicAlias` permits invisible/Unicode-spoofing characters in topic aliases [LOW] [Medium confidence]

**File:** `apps/web/src/lib/validation.ts:28-30`

The alias regex blocks slashes, dots, whitespace, NUL, `<>"'&`, `?`, `#`. It does NOT exclude:

- U+200B–U+200D (ZWSP/ZWNJ/ZWJ)
- U+2060 (WORD JOINER), U+FEFF (BOM)
- U+202A–U+202E (LRE/RLE/PDF/LRO/RLO — Trojan-Source bidi overrides)
- U+2066–U+2069 (LRI/RLI/FSI/PDI)

`stripControlChars` only handles 0x00–0x1F, 0x7F–0x9F, so these high-codepoint formatting characters survive both filters. CSV export was hardened against these in C7R-RPL-11 / C8R-RPL-01, but topic aliases — which become URL path segments and are displayed in admin/SEO UI — are not.

**Failure scenario:** An admin (admin-only mutation, so impact is bounded) creates an alias containing U+202E. The alias is stored, then displayed in admin alias-management UI and rendered in URLs. Visual reading order can be reversed for downstream readers; defense-in-depth gap that the project has explicitly hardened elsewhere.

**Fix:** Extend `isValidTopicAlias` to reject the documented Unicode-formatting set. Match the exact set already enumerated in `csv-escape.ts` for consistency.

---

## C3L-SEC-02: `loadMoreImages` `tagSlugs` not pre-sanitized for parity [LOW] [Medium confidence]

**File:** `apps/web/src/app/actions/public.ts:85-88`

`isValidTagSlug` regex is `/^[\p{Letter}\p{Number}_-]+$/u` which rejects ZWSP and Trojan-Source overrides today, so this is not exploitable. Flagged for parity with the project's documented sanitize-then-validate pattern. Defer.

---

## C3L-SEC-03: Search bucket DB rate-limit error swallowed silently [INFO]

**File:** `apps/web/src/app/actions/public.ts:147-153`

Intentional; matches other surfaces. Not a finding.

## Summary

No CRITICAL or HIGH findings. One LOW item (C3L-SEC-01) recommended for fix; one LOW item recommended for defer.
