# Cycle 81/100 Aggregate Review

Start HEAD: `4733d475be8f19fbddf4b82b589e28d6ca083992`.
Date: 2026-07-01.

## Review Lanes

- `code-reviewer.md`: no new actionable code defects.
- `security-reviewer.md`: no new actionable security findings.
- `perf-reviewer.md`: no new non-deferred performance findings.
- `test-engineer.md`: one confirmed release-ledger finding.
- `architect-critic.md`: no new actionable architecture defects.
- `deploy-docs.md`: one confirmed deploy/docs ledger finding, duplicate of the test lane.
- `designer-accessibility.md`: one confirmed map display-title fallback finding.

## Deduplicated Findings

### C81-01 - Map `displayTitle` bypasses the gallery's meaningful-title fallback rules

- Severity: Medium.
- Confidence: High.
- Sources: `designer-accessibility.md`, main-agent verification.
- Citations: `apps/web/src/app/[locale]/(public)/map/page.tsx:54`, `apps/web/src/app/[locale]/(public)/map/page.tsx:59`, `apps/web/src/lib/photo-title.ts:42`, `apps/web/src/lib/photo-title.ts:55`, `apps/web/src/lib/sanitize.ts:163`, `apps/web/src/__tests__/sanitize-admin-string.test.ts:75`, `apps/web/src/__tests__/map-thumb-wiring.test.ts:69`.
- Problem: map markers use `img.title ?? tPhoto('titleWithId', { id: img.id })`, so whitespace-only and filename-like titles bypass the shared `getPhotoDisplayTitle()` contract that other public photo surfaces use.
- Failure scenario: a geotagged, map-visible photo with an empty title or `IMG_0001.JPG` title exposes a blank or filename-like popup image alt text, open-photo button label, and map list label.
- Suggested fix: derive marker `displayTitle` with `getPhotoDisplayTitle()` and update the map source contract test to reject the raw-nullish title fallback.

### C81-02 - Cycle 80 release ledger still reads active and deploy-unchecked after its pushed HEAD

- Severity: Medium.
- Confidence: High.
- Sources: `test-engineer.md`, `deploy-docs.md`.
- Citations: `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/plans/cycle-80-2026-07-01-plan.md:53`, `.context/plans/cycle-80-2026-07-01-plan.md:54`, `.context/plans/cycle-80-2026-07-01-plan.md:58`, `.context/plans/cycle-80-2026-07-01-plan.md:67`.
- Problem: Cycle 80 is signed and pushed as `4733d475`, but committed plan ledgers still list it as active with commit/push and deploy unchecked.
- Failure scenario: future review or operations work cannot distinguish "deployed but not recorded" from "pushed but not deployed" without re-running git and deploy checks.
- Suggested fix: record terminal Cycle 80 commit/push evidence, record the explicit Cycle 80 deploy-evidence gap, move Cycle 80 out of active state, and let the required Cycle 81 deploy supersede production state after this pushed fix.

## Scheduled For Cycle 81

Schedule `C81-01` and `C81-02`.

## Deferred Not Re-Raised

- `C80-06`: `site-config.json` runtime/build-time contract remains deferred because it requires a dedicated operator-contract decision.
- `C77-ARCH-01`: restore maintenance foreground-mutation barrier remains deferred.
- `C76-04`: bottom-sheet dropdown portal coverage remains deferred.
- `C76-05`: `getImageProcessingState` processed-predicate behavior coverage remains deferred.
- `C75-08`: bulk-edit validation alert association remains deferred.
- Historical performance, semantic-search, settings re-encode, shared-view, and browser-matrix deferred items remain covered by prior deferred artifacts unless their recorded exit criteria are hit.
