# Cycle 69 Code Quality / Architecture Review

Start HEAD: `87e2b98db76e90985299e37ad90cf2faad12c5c4`.

## Inventory

- Required rules: `AGENTS.md`, `CLAUDE.md`, current `.context/reviews/_aggregate.md`, Cycle 68 plan/deferred files, and `.context/plans/README.md`.
- Source surfaces: gallery settings validation/diffing, Settings client backfill state, in-app backfill runner status, image queue embedding side effects, service worker image cache, deploy/package metadata, and current regression tests.
- Prior deferred items were checked for changed evidence and not re-raised unless current source made the issue scheduled now.

## Findings

### CQ69-01 - `image_sizes` accepts derivatives below the documented 128 px floor

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/lib/gallery-config-shared.ts:245`, `apps/web/src/lib/gallery-config-shared.ts:254`, `apps/web/messages/en.json:730`.
- Evidence: `normalizeConfiguredImageSizes()` rejects non-positive and `>10000` values, but not values below 128. The UI copy says valid widths are between 128 and 10000 pixels, and server action validation relies on this helper.
- Failure scenario: a fresh gallery can save `image_sizes=1,2`; future uploads then generate unusably tiny derivatives and public image hints can advertise them.
- Fix direction: add a shared minimum constant and reject values below 128. Add tests for 127 rejection and 128 acceptance.

### CQ69-02 - Zero-candidate in-app backfill is still recorded as a clean completed run

- Severity/confidence: Low / High.
- File/line: `apps/web/src/lib/admin-backfill-runner.ts:856`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:370`, `apps/web/messages/en.json:803`.
- Evidence: Cycle 68 added a distinct toast when settings-only changes have no pipeline-version candidates, but `triggerAdminBackfill()` still increments `completedRuns` and the Settings page can render "Completed cleanly - 0 photo(s) re-encoded."
- Failure scenario: after saving a byte-impacting settings-only change, an operator clicks the in-app button, sees the sidecar-required toast, then the last-run panel says a clean zero-photo run completed. That weakens the operator cue that existing derivatives still need sidecar `--force-reencode`.
- Fix direction: carry a no-candidate status in runner state and render a distinct last-run message.

## No Additional Code-Quality Findings

Cycle 68 settings normalization and CLIP notice fixes are present. Security scanners, migration runbook rules, and deploy target configuration were not changed in this cycle start tree.
