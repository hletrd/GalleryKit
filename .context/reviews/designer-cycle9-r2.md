# Designer Review — Cycle 9 (R2)

## UX-9R2-01: Settings page has no "back" navigation — inconsistent with other admin pages [LOW] [HIGH confidence]

- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` line 54
- **Description:** The SEO page (`seo-client.tsx`) has no back button, but the settings page (`settings-client.tsx`) does have a back button (line 54-57, ChevronLeft link). Meanwhile, the admin layout has a nav bar at the top. This inconsistency is minor but the SEO page is missing its back button while settings has one. This is actually fine — but the SEO page should also have one for consistency.
- **Fix:** Add a back button to `seo-client.tsx` matching the settings page pattern.

## UX-9R2-02: Storage backend warning is not shown until after selection [LOW] [MEDIUM confidence]

- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` lines 291-296
- **Description:** The amber warning about configuring env vars for MinIO/S3 only appears after selecting one of those backends. A user might select "MinIO", save, and only then see the warning. The warning should be visible at all times when MinIO or S3 is selected, which it currently is — this is fine.
- **Fix:** No action needed — the current behavior is acceptable.

## UX-9R2-03: Image sizes input has no format validation hint in the UI [LOW] [LOW confidence]

- **File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx` lines 119-128
- **Description:** The `image_sizes` input accepts freeform text. The hint says "Comma-separated pixel widths" but there's no client-side validation. An admin could enter "640;1536;2048" (semicolons) and only discover the error after clicking Save. A simple regex pattern attribute or input type would help.
- **Fix:** Add `pattern="[0-9, ]+"` to the input element for basic client-side format validation.
