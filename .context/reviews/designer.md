# Cycle 6 Designer Notes

## Findings

### C6-02 — Fatal error branding can disagree with the live gallery title after SEO updates
- **Severity:** MEDIUM
- **Confidence:** High
- **Citations:** `apps/web/src/app/global-error.tsx:45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48`
- **User impact:** the app can show one gallery title in navigation/metadata and a different one on the fatal fallback screen, which makes the experience feel broken or unbranded during an already-bad moment.
- **Suggested fix:** hand the live nav/title values to the document shell and let the client error screen prefer those values before falling back to static config.
