# Designer (UI/UX) — Run-4 Cycle 20

Single-subagent in-context pass.

## Inventory (this angle)

Reviewed the SEO admin settings client (`seo-client.tsx`) and the public
OG/link-preview surface affected by SEC-R4C20-01, plus the touch-target
posture of the components touched indirectly.

## Adjudication (no separate UI fix)

### DES-R4C20-01 — link-preview integrity is a UX concern, severity context for SEC-R4C20-01

The `seo_og_image_url` value feeds every public page's social link-preview
card (`og:image`). A backslash-bypassed off-site URL would make the
gallery's shared links render an attacker-controlled preview image on
Slack / iMessage / Facebook / X — a brand-integrity and trust harm, not
just a security abstraction. This is severity context for SEC-R4C20-01;
the root-cause fix (validator rejects backslash) resolves the UX harm. No
separate designer fix.

The SEO admin input itself (`seo-client.tsx:168-169`) is a plain text
field; on reject, the server action returns `seoOgImageUrlInvalid` which
the client surfaces as a toast. After the fix, a backslash value will
correctly trip that same error path — no new UI state needed.

## Clean-pass

- No touch-target regressions in the cycle-20 surface (no new interactive
  elements added; the validator/route changes are non-visual).
- `nav-client.tsx`, `footer.tsx`, `tag-filter.tsx`, `load-more.tsx`
  re-confirmed at the 44 px floor (min-h-11 / min-h-[44px] / size-11) per
  the blocking touch-target audit; unchanged this cycle.
