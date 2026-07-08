# Run-10 Cycle 35/100 Aggregate Review

Date: 2026-07-08 KST
HEAD: `7993fa467f8a71814f878aa59bcd80174daab1ed`
Scope: full-repository review-plan-fix cycle 35.

## Agent Coverage

Required and discovered reviewer surfaces completed:

- `code-reviewer.md` - no fresh code-quality/correctness findings.
- `perf-reviewer.md` - 4 performance/resource findings.
- `security-reviewer.md` - no fresh security findings.
- `critic.md` - no fresh code defects; reiterated manual ops risks.
- `verifier.md` - no implementation/docs correctness mismatch; 4 manual verification risks.
- `test-engineer.md` - 9 test/gate coverage risks.
- `tracer.md` - no fresh causal-flow findings.
- `architect.md` - 4 architecture/resource/manual-risk findings.
- `debugger.md` - 1 data-consistency bug.
- `document-specialist.md` - 2 documentation/provenance findings.
- `designer.md` - 4 UI/UX/accessibility findings with browser evidence.
- `product-marketer-reviewer.md` - 2 product-copy/config findings.

The requested single-batch fan-out was capacity-bounded by the active child-agent limit, so the lanes were run in staged batches while preserving every required and discovered reviewer. No agent failed after retry.

Raw finding count: 30 when counting all per-agent findings and manual-risk items. Deduped actionable count: 24.

## Deduped Findings

### C35-01 - Shared background DB/CPU capacity is not enforced across subsystems

- Severity: High
- Confidence: High
- Classification: confirmed performance/architecture risk
- Agents: `perf-reviewer` (`PERF-C35-01`), `architect` (`ARCH-C35-02`), `code-reviewer` prior-risk note.
- Regions: `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/background-db-writes.ts:8-75`.
- Problem: image processing, in-app color backfill, semantic work, maintenance, and analytics each reason about capacity locally. Aggregate background DB work can consume the foreground pool reserve.
- Fix direction: add a shared web-process resource coordinator or maintenance admission mode; prove with a small-pool combined-background regression.

### C35-02 - Color sidecar can exceed live DB/CPU admission controls

- Severity: Medium
- Confidence: High
- Classification: confirmed performance/ops risk
- Agents: `perf-reviewer` (`PERF-C35-02`), `architect` (`ARCH-C35-02`).
- Regions: `apps/web/scripts/backfill-color-pipeline.ts:416-420`, `apps/web/scripts/backfill-color-pipeline.ts:557-623`, `apps/web/src/lib/process-image.ts:36-57`.
- Problem: the sidecar runs in a separate process/pool and allows up to 8 lanes, bypassing the in-app pool clamp.
- Fix direction: default/clamp sidecar concurrency for live-traffic-safe mode and document/enforce when high concurrency requires quiescing live background workers.

### C35-03 - Service-worker cached images can still block on synchronous HEAD probes

- Severity: Medium
- Confidence: High
- Classification: likely performance issue
- Agents: `perf-reviewer` (`PERF-C35-03`).
- Region: `apps/web/public/sw.template.js:31-39`, `apps/web/public/sw.template.js:350-438`.
- Problem: warm cached image responses with ETags wait on a synchronous HEAD path up to 300 ms per tile before serving cached bytes.
- Fix direction: serve fresh-enough cached images immediately and move validation into `event.waitUntil`, with sync validation only for stale entries or a manifest/version mismatch.

### C35-04 - Photo/share viewer initial bundle includes optional panels

- Severity: Medium
- Confidence: Medium
- Classification: likely performance issue
- Agents: `perf-reviewer` (`PERF-C35-04`).
- Regions: `apps/web/src/components/photo-viewer.tsx:15-29`, `apps/web/src/components/photo-viewer.tsx:807-956`, `.next/diagnostics/route-bundle-stats.json`.
- Problem: lightbox, bottom sheet, histogram, color details, and similar photos are statically imported into the initial viewer bundle.
- Fix direction: split the primary viewer shell from on-demand panels and compare route diagnostics after the split.

### C35-05 - Semantic embedding work has multiple active owners

- Severity: Medium
- Confidence: High
- Classification: confirmed architecture/resource risk
- Agents: `architect` (`ARCH-C35-01`).
- Regions: `apps/web/src/lib/image-queue.ts:501-637`, `apps/web/scripts/backfill-clip-embeddings.ts:114-130`, `apps/web/src/app/actions/embeddings.ts:113-131`, `apps/web/src/lib/clip-model.ts:53-173`.
- Problem: live bootstrap can perform duplicate embedding work while sidecar/admin semantic backfills own the semantic backfill lock.
- Fix direction: have live bootstrap observe the semantic backfill lock or move all embedding writes to a shared durable work queue/lease.

### C35-06 - Color sidecar batching weakens per-image claim ownership

- Severity: Low
- Confidence: Medium
- Classification: likely invariant risk
- Agents: `architect` (`ARCH-C35-04`).
- Regions: `apps/web/scripts/backfill-color-pipeline.ts:471-527`, `apps/web/scripts/backfill-color-pipeline.ts:557-603`.
- Problem: one concurrent task can flush another task's row and release timing can drift from the owning claim's persistence.
- Fix direction: make the claim owner persist its own row, or make the batch coordinator track/release all row claims after persistence.

### C35-07 - Topic map visibility toggles can be lost during slug rename

- Severity: Medium
- Confidence: High
- Classification: likely data-consistency bug, confirmed by static interleaving
- Agents: `debugger` (`DBG-C35-01`).
- Regions: `apps/web/src/app/actions/topics.ts:70-103`, `apps/web/src/app/actions/topics.ts:282-372`, `apps/web/src/app/actions/topics.ts:690-720`, `apps/web/src/__tests__/topics-actions.test.ts:813-819`.
- Problem: `updateTopic` serializes slug mutation through `withTopicRouteMutationLock`, but `setTopicMapVisible` updates the same row outside that lock.
- Fix direction: run `setTopicMapVisible` under the same lock and add a regression that proves lock usage around the update/audit/revalidate path.

### C35-08 - nginx public limiter docs understate public API coverage

- Severity: Medium
- Confidence: High
- Classification: confirmed documentation/comment mismatch
- Agents: `document-specialist` (`DOC-C35-01`).
- Regions: `CLAUDE.md:248`, `apps/web/nginx/default.conf:274-295`, `apps/web/src/app/api/search/**`, `apps/web/src/app/api/og/**`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`.
- Problem: docs describe page-only throttling and say API locations are excluded, but public non-admin API routes also fall through `location /`.
- Fix direction: update docs/template comments to "public catch-all" or add explicit public API locations with intentional limiter policy.

### C35-09 - Active review/provenance index still points at Cycle 34

- Severity: Medium
- Confidence: High
- Classification: confirmed stale provenance mismatch
- Agents: `document-specialist` (`DOC-C35-02`).
- Regions: `.context/reviews/_aggregate.md:1-13` before this update, `.context/plans/README.md:34-38`, root review lane headers.
- Problem: root review artifacts are mixed generation until the Cycle 35 aggregate and plan pointers are updated.
- Fix direction: write this Cycle 35 aggregate and update plan index during Prompt 2.

### C35-10 - Search combobox points `aria-controls` at the dialog when results are absent

- Severity: Medium
- Confidence: High
- Classification: confirmed accessibility issue
- Agents: `designer` (`DES-C35-01`).
- Regions: `apps/web/src/components/search.tsx:430-452`.
- Problem: the search input is `role="combobox"` with `aria-expanded=true` while controlling the modal dialog instead of a listbox when no results are displayed.
- Fix direction: always render a listbox/status target or omit the combobox popup relationship until results exist.

### C35-11 - Mobile masonry metadata overlays permanently cover photos

- Severity: Low-Medium
- Confidence: High
- Classification: confirmed UX issue
- Agents: `designer` (`DES-C35-02`).
- Region: `apps/web/src/components/masonry-card.tsx:155-166`.
- Problem: mobile gallery cards permanently cover the top of photos with a dark title/topic overlay.
- Fix direction: move metadata to a reserved caption area or make overlay reveal intentional with an accessible persistent alternative.

### C35-12 - SEO settings mark every field invalid for one field error

- Severity: Medium
- Confidence: High
- Classification: confirmed source UI/accessibility issue
- Agents: `designer` (`DES-C35-03`).
- Regions: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:75-209`, `apps/web/src/app/actions/seo.ts:85-139`.
- Problem: one form-level server error sets `aria-invalid` on every SEO field.
- Fix direction: return structured field errors and apply invalid state/descriptions only to affected controls.

### C35-13 - Public photo/search surfaces expose visible shortcut tutorial copy

- Severity: Low
- Confidence: High
- Classification: confirmed UX/copy issue
- Agents: `designer` (`DES-C35-04`).
- Regions: `apps/web/src/components/photo-viewer.tsx:580-585`, `apps/web/src/components/search.tsx:524-530`.
- Problem: operational shortcut text is visible in the public photo/search experience rather than contextual help.
- Fix direction: move shortcut discovery to tooltips/help affordances or screen-reader-only widget instructions.

### C35-14 - Wide-gamut hint overstates sRGB delivery

- Severity: Medium
- Confidence: High
- Classification: confirmed product-copy issue
- Agents: `product-marketer-reviewer` (`PMR-C35-01`).
- Regions: `apps/web/messages/en.json:398-399`, `apps/web/messages/ko.json:398-399`, `apps/web/src/components/wide-gamut-hint.tsx:146-172`, `apps/web/src/components/photo-viewer.tsx:521-561`.
- Problem: copy says an sRGB display is seeing an "sRGB version" or converted sRGB color, but the viewer does not select a separate sRGB asset by display capability.
- Fix direction: change copy to display-capability wording that does not claim a separate sRGB rendition.

### C35-15 - Checked-in Atik site config can brand fresh self-hosted builds

- Severity: Medium
- Confidence: High
- Classification: confirmed distribution/product risk
- Agents: `product-marketer-reviewer` (`PMR-C35-02`).
- Regions: `apps/web/src/site-config.json:2-10`, `apps/web/scripts/ensure-site-config.mjs:4-42`, `README.md`, `apps/web/README.md`.
- Problem: `site-config.json` contains real Atik deployment values and passes production validation, so a fresh self-hosted build can inherit Atik branding/canonical URL.
- Fix direction: track only example config, require explicit deployment allowlist for Atik config, or make production reject checked-in deployment-specific config without an override.

### C35-16 - No coverage metric or ratchet exists for high-risk code

- Severity: Medium
- Confidence: High
- Classification: confirmed test/gate gap
- Agents: `test-engineer` (`TE-C35-01`).
- Regions: `package.json:17-30`, `apps/web/package.json:8-30`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:54-83`.
- Problem: the suite has no coverage command, threshold, or changed-file coverage signal for high-risk branches.
- Fix direction: add a non-blocking coverage job first, then ratchet thresholds by high-risk directory.

### C35-17 - Semantic scan cap is source-pinned instead of behavior-pinned

- Severity: Medium
- Confidence: High
- Classification: confirmed behavioral-test gap
- Agents: `test-engineer` (`TE-C35-02`).
- Regions: `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-76`, `apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`.
- Problem: tests prove `.limit(SEMANTIC_SCAN_LIMIT)` appears in source, not that the executed embedding scan query applies the cap.
- Fix direction: add route-level DB-chain mocks that record and assert the terminal scan limit for semantic and similar routes.

### C35-18 - Nav visual e2e captures screenshots without comparing them

- Severity: Medium
- Confidence: High
- Classification: confirmed test gap
- Agents: `test-engineer` (`TE-C35-03`).
- Region: `apps/web/e2e/nav-visual-check.spec.ts:40-86`.
- Problem: screenshots are written as artifacts but never compared to baselines.
- Fix direction: add stable `toHaveScreenshot` / snapshot assertions with masks, keeping geometry checks.

### C35-19 - Production CLIP proof is outside PR/push gates

- Severity: Medium
- Confidence: High
- Classification: confirmed gate/manual-validation gap
- Agents: `test-engineer` (`TE-C35-04`), `verifier` (`M2`), `critic` (`RISK35-03`).
- Regions: `apps/web/package.json:21-23`, `.github/workflows/quality.yml:69-83`, `.github/workflows/clip-preflight.yml:3-46`, `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`.
- Problem: real CLIP model loading/ranking is skipped in normal CI and runs only manual/weekly.
- Fix direction: trigger CLIP preflight on PR/push path filters for CLIP/model/semantic-production files, or require an explicit preflight check on such changes.

### C35-20 - Sidecar backfill scripts have mostly indirect/source coverage

- Severity: Medium
- Confidence: Medium-High
- Classification: likely test gap
- Agents: `test-engineer` (`TE-C35-05`).
- Regions: `apps/web/scripts/backfill-alt-text.ts:55-160`, `apps/web/scripts/backfill-cicp-recheck.ts:51-157`.
- Problem: operator sidecar behavior is guarded mostly by source-string tests instead of behavioral runner tests.
- Fix direction: extract injectable runners and add table tests for locks, disabled/force behavior, restore markers, row errors, tuple unwraps, and exit codes.

### C35-21 - Migration reconcile tests are not structural validation

- Severity: Medium
- Confidence: Medium
- Classification: test risk
- Agents: `test-engineer` (`TE-C35-06`).
- Region: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Problem: source tripwires can pass while emitted table/column/index/FK structure differs from Drizzle.
- Fix direction: add disposable MySQL structural-diff tests for high-risk tables.

### C35-22 - Hydration e2e uses `networkidle` as hydration oracle

- Severity: Low-Medium
- Confidence: Medium
- Classification: test reliability risk
- Agents: `test-engineer` (`TE-C35-07`).
- Region: `apps/web/e2e/hydration-photo-page.spec.ts:20-49`.
- Problem: `networkidle` can miss late hydration warnings or create unrelated flake.
- Fix direction: add an app-level client-ready marker and assert for a bounded interval after mount.

### C35-23 - Browser-flow matrix is single-project Desktop Chromium

- Severity: Medium
- Confidence: High
- Classification: manual-validation/test-matrix risk
- Agents: `test-engineer` (`TE-C35-08`).
- Regions: `apps/web/playwright.config.ts:48-77`, `.github/workflows/quality.yml:75-80`.
- Problem: mobile WebKit, mobile Chromium, Firefox/display-gamut, and touch/service-worker behavior can regress outside CI.
- Fix direction: add small smoke projects for mobile Chromium and mobile WebKit first; add Firefox display-capability smoke if the color surface changes.

### C35-24 - Public edge/proxy/upload operational proofs remain manual

- Severity: Medium
- Confidence: High for nginx/CLIP/proxy; Medium for upload RSS
- Classification: manual validation gaps
- Agents: `verifier` (`M1`, `M3`, `M4`), `critic` (`RISK35-01`, `RISK35-02`, `RISK35-04`), `architect` (`ARCH-C35-03`), `test-engineer` (`TE-C35-09`).
- Regions: `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:254-306`, `scripts/check-proxy-topology.mjs:7-16`, `CLAUDE.md:657-663`.
- Problem: live host nginx limiter application, effective client-IP buckets, and large-upload RSS envelope are not proven by repo-local gates.
- Fix direction: preserve operator runbooks and add non-mutating post-deploy probes where possible; keep live-host verification as a manual evidence item when production state cannot be safely mutated from the cycle.

## Cross-Agent Agreement

- Background capacity / DB pool pressure was flagged by `perf-reviewer`, `architect`, and the code-review prior-risk sweep.
- nginx/live edge validation was flagged by `architect`, `test-engineer`, `verifier`, `critic`, and `document-specialist`.
- CLIP production preflight was flagged by `test-engineer`, `verifier`, and `critic`.
- UI findings were browser-backed by `designer`; product-copy findings were independently source-backed by `product-marketer-reviewer`.

## Agent Failures

None. One attempted sixth concurrent spawn failed because the environment thread limit was already reached; it was retried successfully after a slot freed.

## Completion Notes

All per-agent reports are retained as provenance. This aggregate intentionally separates implementation-ready issues from operational/manual risks so Prompt 2 can schedule or defer every finding under the repo's deferred-fix rules.
