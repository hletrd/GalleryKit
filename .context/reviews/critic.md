# Critic — Cycle 6 (review-plan-fix loop, 2026-04-25)

## Critique angle
Continuation of cycle-5 critique: the Unicode-formatting hardening lineage (C7R-RPL-11 → C8R-RPL-01 → C3L-SEC-01 → C4L-SEC-01 → C5L-SEC-01) has been applied to every persistent admin string surface **except** the SEO settings.

## New findings

### C6L-CRIT-01 — Cycle 5 stopped one fix short of full parity [LOW] [High confidence]

**Surface:** `apps/web/src/app/actions/seo.ts`.

**Why a problem.** The cycle-5 RPL aggregate categorised `admin_settings`/`seo` as "intentionally permissive". That category was correct for `admin_settings` (numeric/boolean values per `GALLERY_SETTING_KEYS`) but **wrong** for `seo` (six free-form strings, four of which reach public HTML head + OG cards on every page). The "permissive" label conflated two distinct settings tables.

**Suggested fix.**
1. Apply Unicode-formatting rejection to `seo_title`, `seo_description`, `seo_nav_title`, `seo_author`.
2. Update `CLAUDE.md` Database Security bullet to enumerate the SEO fields explicitly.
3. Update the `validation.ts` lineage comment to record `C6L-SEC-01`.
4. Add ≥4 action-level test cases.

### C6L-CRIT-02 — Skip `seo_locale` and `seo_og_image_url`, but document why [INFO] [Medium confidence]

**File:** `apps/web/src/app/actions/seo.ts:96-110`

**Why a problem.** A reader of the cycle-6 fix will reasonably ask why these two fields are skipped. The answer is in `normalizeOpenGraphLocale` and `validateSeoOgImageUrl` — both stricter than the Unicode-formatting filter — but the absence is not visible at the call site.

**Suggested fix.** Add an inline comment explicitly stating the locale/OG-URL fields are skipped because their existing validators are stricter than the Unicode-formatting filter.

## Cross-agent agreement
Overlaps with security-reviewer (C6L-SEC-01 root), code-reviewer (C6L-CR-01), document-specialist (CLAUDE.md update), test-engineer (coverage).
