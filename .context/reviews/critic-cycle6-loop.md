# Critic — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Critique angle
Continuation of the cycle-5 critique: the Unicode-formatting hardening lineage (C7R-RPL-11 → C8R-RPL-01 → C3L-SEC-01 → C4L-SEC-01 → C5L-SEC-01) has now been applied to every persistent admin string surface **except** the SEO settings. Cycle 5 closed three at once (`topic.label`, `image.title`, `image.description`). The remaining gap is `seo.ts`.

## New findings

### C6L-CRIT-01 — Cycle 5 stopped one fix short of full parity [LOW] [High confidence]

**Surface:** `apps/web/src/app/actions/seo.ts`.

**Why a problem.** The cycle-5 RPL aggregate categorised `admin_settings`/`seo` as "intentionally permissive" (carry-forward bullet AGG5R-15 reasoning). That category was correct for `admin_settings` (numeric/boolean values per `GALLERY_SETTING_KEYS`) but **wrong** for `seo` (six free-form strings, four of which reach public HTML head and OG cards on every page). The "permissive" label conflated two distinct settings tables.

**Concrete failure scenario.** No active regression. The risk is consistency-of-policy. If reviewers in cycle 7 don't catch this gap, the policy will permanently lose its "every admin-controlled persistent string column passes the Unicode-formatting check" invariant.

**Suggested fix.**
1. Apply `UNICODE_FORMAT_CHARS.test(...)` to `seo_title`, `seo_description`, `seo_nav_title`, `seo_author` in `updateSeoSettings`.
2. Update `CLAUDE.md` Database Security bullet to enumerate the SEO fields explicitly.
3. Update the `validation.ts` lineage comment to record `C6L-SEC-01`.
4. Add at least two test cases covering bidi rejection on `seo_title` and ZWSP rejection on `seo_description`.

### C6L-CRIT-02 — `seo_locale` and `seo_og_image_url` are fine to skip — but document it [INFO] [Medium confidence]

**File:** `apps/web/src/app/actions/seo.ts:96-110`

**Why a problem.** A reader of the cycle-6 fix will reasonably ask "why are `seo_locale` and `seo_og_image_url` not also gated?". The answer is in the existing `normalizeOpenGraphLocale` and `validateSeoOgImageUrl` — both already restrict the value space far below the Unicode-formatting threshold. But the absence is not visible at the call site.

**Suggested fix.** Add an inline comment in `updateSeoSettings` explicitly stating that the locale and OG-URL fields are skipped because their existing validators are stricter than the Unicode-formatting filter.

## Cross-agent agreement
Overlaps with security-reviewer (C6L-SEC-01 root), code-reviewer (C6L-CR-01), document-specialist (CLAUDE.md update), test-engineer (coverage).
