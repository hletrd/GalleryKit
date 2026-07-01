# Cycle 67 UI / UX / Accessibility Review

Current HEAD: `3e8ab924b5ed714f8a0f1dbfe1f9739d6fe25886`.

## Inventory

- Reviewed public gallery/photo/share/search/color surfaces, admin upload/image/settings UX, keyboard/focus contracts, touch-target/focus tests, i18n copy around HDR/backfill/search, and historical review/deferred notes.
- No files edited in this review lane. No browser was started; static review plus existing focused tests were sufficient for this cycle's findings.

## Findings

### C67-03 - Lightbox shortcut handler accepts repeated keydown events

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/components/lightbox.tsx:310`, `apps/web/src/components/photo-viewer.tsx:374`.
- Evidence: the main photo viewer blocks repeated keydown events with `if (e.repeat) return`, but the lightbox handler does not.
- Failure scenario: a keyboard user holds Space slightly too long and toggles slideshow on/off repeatedly, or holds ArrowLeft/ArrowRight and skips past photos faster than intended.
- Fix direction: add the same early repeat guard to the lightbox handler and lock it with a source-contract test.

### C67-01 - HDR ingest toggle shows a misleading re-encode obligation

- Severity/confidence: Low / High from the UI lane; promoted to Medium / High in aggregate due cross-lane agreement.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:52`.
- Evidence: same as code-quality finding `C67-01`.
- Failure scenario: an admin enables HDR ingest to upload future HDR sources and receives conflicting backfill guidance for existing photos.
- Fix direction: remove upload-admission settings from the backfill warning key set.

## Final Sweep

No edit/culling/scoring feature regression found. No public HDR honesty breach found. No critical/high UI, accessibility, i18n, or photographer-facing product blocker was found.
