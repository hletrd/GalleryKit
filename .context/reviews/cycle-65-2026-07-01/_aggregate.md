# Cycle 65/100 Aggregate Review

Start HEAD: `ad1bc983b61d4251b7b29f8d3315b16c1c0f22f` (current deployed `master` HEAD at cycle start).

## Review Inputs

- `code-quality.md`
- `security.md`
- `perf-concurrency.md`
- `test-verifier.md`
- `docs-deploy.md`
- Main-agent UI/accessibility inspection

## Deduplicated Findings

### C65-01 - Saved backfill warning stays visible after reverting byte-impacting settings to the baseline

- Severity/confidence: Medium / High.
- Cross-agent agreement: test/verification lane.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:209`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:272`, `apps/web/src/__tests__/settings-backfill-warning-source.test.ts:12`.
- Evidence: `hasSavedBackfillPending` is set after any saved backfill-relevant change, but there is no clear path when the saved values return to the pre-change baseline.
- Failure scenario: an admin saves a JPEG/AVIF/color setting change, then saves it back to the previous value. The current settings again match the derivative baseline, but the re-encode warning remains visible.
- Fix direction: clear the pending flag when a successful save leaves no backfill-relevant value changed from the prior baseline; pin the contract.

### C65-02 - Settings-only re-encode obligation disappears after page reload

- Severity/confidence: Medium / High.
- Cross-agent agreement: code-quality lane.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:89`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:209`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:284`, `apps/web/src/app/actions/settings.ts:157`.
- Evidence: the post-save re-encode obligation lives only in local component state. The server action persists changed settings but no durable pending hash/marker.
- Failure scenario: an admin saves byte-impacting settings with existing photos, reloads Settings before running a force re-encode, and sees no warning although public derivatives still reflect old bytes.
- Fix direction: design a durable settings-hash obligation and clear it from the force re-encode completion path.

### C65-03 - Radix Select scroll controls remain below the 44 px touch-target floor

- Severity/confidence: Low / Medium.
- Cross-agent agreement: code-quality + main UI/accessibility inspection.
- File/line: `apps/web/src/components/ui/select.tsx:143`, `apps/web/src/components/ui/select.tsx:151`, `apps/web/src/components/ui/select.tsx:161`, `apps/web/src/components/ui/select.tsx:169`, `apps/web/src/__tests__/select-item-touch-target.test.ts:8`.
- Evidence: `SelectItem` now has `min-h-11`, but `SelectScrollUpButton` and `SelectScrollDownButton` remain compact `py-1` icon controls.
- Failure scenario: overflowing Select menus render compact scroll controls despite compliant trigger and option rows.
- Fix direction: add `min-h-11` to both scroll controls and pin the primitive contract.

### C65-04 - Abbreviated sidecar commands can write CLIP/backfill data to the wrong paths

- Severity/confidence: Low / High.
- Cross-agent agreement: docs/deploy lane.
- File/line: `apps/web/README.md:40`, `CLAUDE.md:345`, `CLAUDE.md:513`, `CLAUDE.md:528`, `apps/web/src/lib/clip-paths.ts:48`, `apps/web/src/lib/upload-paths.ts:12`.
- Evidence: `apps/web/README.md` labels bare `npx tsx ...` commands as sidecar commands without the production sidecar mounts/env required by `CLAUDE.md`.
- Failure scenario: an operator copies the abbreviated commands into a sidecar and writes model weights or backfill I/O to ephemeral paths.
- Fix direction: mark the table commands local/dev and point production sidecar users to the full `CLAUDE.md` commands.

### C65-05 - Similar-photo fetch keeps running after the panel is closed

- Severity/confidence: Low / High.
- Cross-agent agreement: performance/concurrency lane.
- File/line: `apps/web/src/components/similar-photos.tsx:70`, `apps/web/src/components/similar-photos.tsx:77`, `apps/web/src/app/api/search/similar/[id]/route.ts:132`, `apps/web/src/app/api/search/similar/[id]/route.ts:164`.
- Evidence: `SimilarPhotos` aborts only on unmount, not when the disclosure is toggled closed.
- Failure scenario: a visitor opens Similar Photos and closes it before the API returns; the request can continue consuming server work and rate budget.
- Fix direction: abort on close, clear loading, keep retry eligibility, and guard late responses.

## Scheduled This Cycle

- `C65-01`: clear session-pending backfill warning when saved values return to the baseline, with source-contract coverage.
- `C65-03`: raise Radix Select scroll controls to `min-h-11`, with source-contract coverage.
- `C65-04`: clarify `apps/web/README.md` sidecar command scope.
- `C65-05`: abort Similar Photos fetches when the panel closes, with source-contract coverage.

## Deferred / Not Scheduled

- `C65-02`: durable settings-only re-encode marker. Deferral reason: this needs a persistent settings-hash/clear contract spanning Settings saves, color backfill sidecar/in-app completion, and operator docs; doing it as an incidental client-state fix would leave ambiguous clearing semantics. Exit criterion: plan a durable `admin_settings` marker or equivalent last-applied derivative settings hash, update both force re-encode completion paths to clear/advance it, and add tests proving reload persistence and clear-on-completion.

## Deferred Items Not Re-Raised

No new evidence changed severity for `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`.

## Agent Failures / Deviations

- Specialized native reviewer roles were not exposed as callable agent types in this environment; the cycle used available default native subagents with explicit reviewer briefs.
- The UI/UX subagent spawn hit the active thread limit. UI/accessibility review was covered by the main agent and by the code-quality reviewer for the Select primitive.
