# Cycle 64/100 Aggregate Review

Start HEAD: `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f` (current deployed `master` HEAD at cycle start).

## Review Inputs

- `code-debug-trace.md`
- `security.md`
- `perf-arch-docs.md`
- `test-verifier.md`
- `ui-ux-accessibility.md`
- `photographer-product-critic.md`

## Deduplicated Findings

### C64-01 - Search mode reset leaves stale active result selection

- Severity/confidence: Low / High.
- Cross-agent agreement: code/debug/tracer lane.
- File/line: `apps/web/src/components/search.tsx:152`, `apps/web/src/components/search.tsx:162`, `apps/web/src/components/search.tsx:282`, `apps/web/src/components/search.tsx:440`, `apps/web/src/components/search.tsx:456`, `apps/web/src/components/search.tsx:495`, `apps/web/src/components/search.tsx:532`.
- Evidence: the shared search reset path clears request ownership/results/status but not `activeIndex` or `resultRefs`. The semantic-search toggle uses that reset path, so a selection index from keyword results can survive into the next semantic result set.
- Failure scenario: a visitor arrows to a result, toggles semantic mode, waits for new results, and can see/activate a stale positional selection in the new list.
- Fix direction: reset `activeIndex` and refs in `clearSearchState()` and pin the semantic-toggle reset contract.

### C64-02 - Admin GPS map links do not meet the 44 px touch-target floor

- Severity/confidence: Low / High.
- Cross-agent agreement: UI/UX/accessibility lane.
- File/line: `apps/web/src/components/photo-viewer.tsx:886`, `apps/web/src/components/info-bottom-sheet.tsx:457`.
- Evidence: the admin-only Google Maps coordinate links are compact text/icon links without `min-h-11`, `min-w-11`, padding, or equivalent hit-area expansion. They are reachable through admin viewer data that includes GPS coordinates.
- Failure scenario: an admin on touch hardware has to tap the compact coordinate text rather than a 44 px target to open a GPS-bearing photo in Maps.
- Fix direction: apply a shared 44 px anchor shape to both GPS links and add source-contract coverage.

### C64-03 - Radix Select options are compact despite compliant Select triggers

- Severity/confidence: Low / Medium.
- Cross-agent agreement: UI/UX/accessibility lane.
- File/line: `apps/web/src/components/ui/select.tsx:103`, `apps/web/src/components/ui/select.tsx:112`.
- Evidence: the trigger primitive floors to `min-h-11`, but each Radix `SelectItem` option row uses compact `py-1.5` sizing and no `min-h-11`. Existing touch-target audit covers native `<select>` but not this custom option primitive.
- Failure scenario: admins can open a compliant select trigger, then have to tap compact option rows in Settings or Bulk Edit on touch hardware.
- Fix direction: add `min-h-11` to `SelectItem` and pin the primitive contract.

### C64-04 - Saved color/quality setting changes can lose their backfill warning before existing derivatives are actually updated

- Severity/confidence: Medium / High.
- Cross-agent agreement: photographer-product/critic lane.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:328`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:270`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:275`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:279`, `apps/web/src/lib/admin-backfill-runner.ts:49`, `apps/web/src/lib/admin-backfill-runner.ts:387`, `apps/web/messages/en.json:788`, `CLAUDE.md:339`.
- Evidence: the warning appears only while byte-impacting fields differ from the current baseline. A successful save updates that baseline immediately, hiding the warning even though current-version derivatives still need the documented sidecar `--force-reencode` path for settings-only byte changes.
- Failure scenario: a photographer/admin saves JPEG quality, AVIF effort, chroma, or force-sRGB changes and sees a clean Settings page while existing public derivatives still serve old bytes.
- Fix direction: keep a post-save re-encode obligation visible after byte-impacting settings are saved.

## Scheduled This Cycle

- `C64-01` search reset selection cleanup and source-contract coverage.
- `C64-02` admin GPS link touch-target floor and source-contract coverage.
- `C64-03` Radix SelectItem touch-target floor and source-contract coverage.
- `C64-04` post-save backfill warning persistence for byte-impacting settings and source-contract coverage.

## Deferred / Not Scheduled

No new Cycle 64 findings are deferred.

## Deferred Items Not Re-Raised

No new evidence changed severity or scheduling for `C61-06`, `C61-07`, `PA-42-02`, `TV-40-03`, `PERF-C39-03`, `PERF-C39-04`, `AGG-C38-07`, or `AGG-C38-08`.

## Agent Failures / Deviations

- Native specialized reviewer roles such as `code-reviewer`, `perf-reviewer`, `tracer`, and `document-specialist` were not exposed as callable agent types in this environment; the cycle used available native subagents grouped by review perspective.
- The first photographer-product lane spawn hit the active thread limit and was retried after other lanes completed.
- Two local reviewer prompt files exist under `/Users/hletrd/.codex/agents`, but their bodies are BurstPick-specific and not applicable as authoritative GalleryKit instructions. Their relevant reviewer perspectives were covered by the UI/UX and photographer-product lanes.
