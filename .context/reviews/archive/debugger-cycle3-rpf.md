# Debugger RPF Review — Cycle 3 / Prompt 1

Scope: full-repo review of the Gallery app (routes, server actions, lib, components, scripts, and tests). No implementation files were edited.

## Summary
I found 3 high-confidence latent issues during the final sweep:
1. Photo navigation skips older undated images when the current image has a capture date.
2. Sitemap ordering is nondeterministic for equal timestamps, which can cause the capped sitemap subset to churn across regenerations.
3. Tag-input normalization uses locale-sensitive lowercasing, which can break tag matching in some locales.

## Findings

### 1) Next-photo lookup omits undated images after dated ones
- **Location:** `apps/web/src/lib/data.ts:686-718`
- **Severity:** Medium
- **Confidence:** High
- **Failure scenario:**
  - The photo viewer computes `nextId` from `getImage(id)`.
  - For a dated image, the "next" query only searches older dated rows with the same sort key tuple.
  - If the gallery contains undated images (`capture_date IS NULL`) after the last dated photo, `nextId` becomes `null` instead of pointing to the first undated image.
  - This breaks keyboard navigation, the hidden prefetch link, and any UI expecting the full ordered sequence.
- **Concrete fix:**
  - Add an explicit `isNull(images.capture_date)` branch to the "next" query when the current image has a non-null capture date, mirroring the ordering semantics used elsewhere (`NULL`s sort last in DESC order).
  - Keep the existing tiebreakers on `created_at` and `id`.

### 2) Sitemap row selection is unstable when multiple images share the same timestamp
- **Location:** `apps/web/src/lib/data.ts:1018-1028`
- **Severity:** Low to Medium
- **Confidence:** High
- **Failure scenario:**
  - `getImageIdsForSitemap()` orders only by `created_at DESC` and then truncates to the sitemap budget.
  - When several images have the same `created_at` value, the database is free to return them in different orders between requests.
  - Because the sitemap is capped, rows near the cutoff can appear/disappear across ISR regenerations, causing inconsistent crawl coverage and noisy diff churn.
- **Concrete fix:**
  - Add a deterministic secondary sort, e.g. `orderBy(desc(images.created_at), desc(images.id))`.
  - This keeps the capped subset stable across runs.

### 3) Tag matching uses locale-sensitive lowercasing
- **Location:** `apps/web/src/components/tag-input.tsx:25-37`
- **Severity:** Low
- **Confidence:** Medium
- **Failure scenario:**
  - `normalizeTagInputValue()` uses `toLocaleLowerCase()` with no locale argument.
  - In browser locales with special casing rules (notably Turkish), `I`/`İ` lowercasing can differ from the app's canonical tag-slug behavior.
  - Exact-match detection and duplicate suppression can then misfire, letting the UI show the wrong suggestion state or allow duplicate-looking tags.
- **Concrete fix:**
  - Replace locale-sensitive lowercasing with locale-neutral normalization, e.g. `toLowerCase()`, or compare against the canonical tag slug instead of the display name.
  - Keep the normalization path consistent with the server-side tag-slug generator.

## Missed-issues sweep
I rechecked the main cross-file flows after the initial pass, including:
- public gallery listing + load-more cursor flow,
- photo/share/group page metadata flows,
- upload/delete/tag/topic/admin mutation flows,
- auth/session/rate-limit handling,
- upload serving and path validation,
- sitemap and OG generation.

No additional high-confidence issues surfaced beyond the three findings above.
