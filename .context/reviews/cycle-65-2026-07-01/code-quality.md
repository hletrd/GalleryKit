# Cycle 65 Code Quality Review

## Inventory

- Recent Cycle 64 change surfaces: Settings backfill warning state, search reset, GPS links, and Radix Select primitive.
- Public/search API shape, Lightroom upload route, data privacy selectors, and map GPS exposure guard.
- Historical deferred register from Cycle 64.

## Findings

### C65-02 - Settings-only re-encode obligation disappears after page reload

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:209`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:284`, `apps/web/src/app/actions/settings.ts:157`.
- Evidence: the post-save obligation is stored only in local React state. `updateGallerySettings()` persists setting rows but does not persist a derivative-settings pending marker or last-applied derivative settings hash.
- Failure scenario: an admin changes JPEG quality, AVIF effort, chroma, or force-sRGB settings with existing photos. The warning appears after save, but after reload it resets to false while public derivatives still serve old bytes until the documented force re-encode path runs.
- Suggested fix: design and persist a derivative-settings obligation marker, then clear it only when the appropriate re-encode path completes for that settings hash.

### C65-03 - Radix Select scroll controls remain below the 44 px touch-target floor

- Severity/confidence: Low / Medium.
- File/line: `apps/web/src/components/ui/select.tsx:143`, `apps/web/src/components/ui/select.tsx:151`, `apps/web/src/components/ui/select.tsx:161`, `apps/web/src/components/ui/select.tsx:169`, `apps/web/src/__tests__/select-item-touch-target.test.ts:8`.
- Evidence: Cycle 64 raised `SelectItem` rows to `min-h-11`, but `SelectScrollUpButton` and `SelectScrollDownButton` still use only `py-1` around a 16 px icon.
- Failure scenario: a Select with enough options to overflow renders compact scroll controls. The trigger and item rows are compliant, but the scroll controls are not comfortable touch targets.
- Suggested fix: add `min-h-11` to both scroll controls and extend the source contract to cover them.

## Validation

- `npm test --workspace=apps/web -- settings-backfill-warning-source.test.ts select-item-touch-target.test.ts` passed in the reviewer lane.
