# Security Reviewer — Cycle 1 (review-plan-fix loop, 2026-04-25)

## Lens

AuthN/AuthZ, injection, validation, secret handling, session/cookie attributes, supply chain, privacy.

**HEAD:** `8d351f5`
**Cycle:** 1/100
**Diff scope:** 11 UI/UX fix commits, 17 files.

## Surface analysis

The 11 fix commits are UI/UX only:

- DOM/CSS changes (touch targets, contrast, focus outline, layout)
- Two new i18n keys (`showPassword`, `hidePassword`)
- Local React state for password visibility toggle
- New `<main tabIndex={-1}>` for skip-link target
- `getOpenGraphLocale` precedence change (route locale wins on supported locales)
- hreflang alternate-language metadata emission
- Underscore display normalization

No DB, auth, session, upload, rate-limit, or query surface was touched.

## Findings

### S1-LOW-01 — Password-visibility toggle is client-only state, no server log entry (LOW, High confidence)

**File/region:** `apps/web/src/app/[locale]/admin/login-form.tsx:26,73-94`.

**Why a problem (defense-in-depth):** Showing a password on screen during login is a personal-risk affordance that users sometimes invoke in shoulder-surfable contexts (cafés, shared screens). Industry guidance (NIST 800-63B §5.1.1.2) supports allowing it, *but* recommends UX cues that the field is unmasked.

The current implementation has correct ARIA (`aria-pressed={showPassword}`) but no visible warning that the password is now readable. A user might leave the field unmasked across navigations because state lives only in the component (good) and submitting is single-shot (also good).

**Failure scenario:** No direct security failure — local-only state, no transmission of the unmasked value, value still posted via `POST` to the server action. The `pr-11` padding accommodates the toggle button. The risk is purely UX.

**Suggested fix (optional):** Auto-mask on submit / on blur (some banks do this). Not required.

**Confidence:** High that this is non-exploitable; LOW priority.

### S1-LOW-02 — `aria-label` for password toggle is the only AT cue for state (LOW, Medium confidence)

**File/region:** `apps/web/src/app/[locale]/admin/login-form.tsx:85-86`.

**Why a problem:** `aria-label` flips between `t('showPassword')` and `t('hidePassword')`, plus `aria-pressed={showPassword}` for the button state. This is correct ARIA. No security defect; flagged for completeness during the security pass over the login surface.

**Confidence:** Medium (UX concern, not security).

### S1-INFO-01 — hreflang URL emission uses `seo.url` from settings (informational)

**File/region:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:96-98`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:92-94`.

**Why informational:** `seo.url` is admin-configurable. `localizeUrl(seo.url, 'en'|'ko', path)` will emit whatever URL the admin set. URL validation occurs at write time in the SEO settings action; no new injection surface.

`URL` constructor in `absoluteUrl(baseUrl, path)` rejects malformed inputs and throws — caller is in a server function that returns `Metadata`, an unhandled throw would 500 the page. Existing settings validation already prevents this.

**Confidence:** High that no new injection surface exists.

### S1-INFO-02 — `not-found.tsx` no longer hides `<Nav />` and `<Footer />` (informational)

**File/region:** `apps/web/src/app/[locale]/not-found.tsx:24,51`.

**Why informational:** `<Nav />` is a Server Component fetching `getTopicsCached()`, `getSeoSettings()`, `getGalleryConfig()`. On a 404 these queries still run, which is fine because they're cached. No additional DB load on 404 storms because `cache()` deduplicates per request and `revalidate` is honored. Verified no auth state leaks because Footer's `admin` link is just a static route — no admin gating logic.

**Confidence:** High.

### S1-INFO-03 — Underscore→space replacement is purely presentational, not a sanitization step (informational)

**File/region:** `apps/web/src/lib/photo-title.ts:78`, `apps/web/src/components/tag-filter.tsx:61`, `apps/web/src/components/home-client.tsx:122,160`.

**Why informational:** `_` is not a CSV/SQL/HTML special character; replacing it with space cannot break any escaping or sanitization layer. JSON-LD `safeJsonLd` continues to escape `</script>` and U+2028/U+2029 regardless of underscore content.

**Confidence:** High.

## Regression scan

- **Login form same-origin/CSRF:** `login` server action unchanged; `requireSameOriginAdmin` not affected. Verified by lint:action-origin (passing).
- **CSP nonce:** All `<script>` blocks (JSON-LD on home + topic + p/[id]) still pass `nonce={nonce}` from `getCspNonce()`. Unchanged.
- **Open redirect:** No new redirect surface. `localizeUrl` callees use admin-validated `seo.url`.
- **DOMPurify / dangerouslySetInnerHTML:** Only `safeJsonLd` callsites; unchanged.
- **Cookies:** `NEXT_LOCALE` cookie path unchanged in `nav-client.tsx:66` (preserved from prior commits).
- **Touch-target sizing** does not introduce any clickjacking surface — all targets are within `<main>` and inside the same origin.

## Confidence

High. Zero new MEDIUM or HIGH security findings.

## Recommendation

No security fix this cycle. The defense-in-depth note (S1-LOW-01) about auto-masking on blur can be considered later as a UX/security polish, not a critical fix.
