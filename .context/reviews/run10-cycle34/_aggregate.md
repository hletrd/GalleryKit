# Run-10 Cycle 34/100 Aggregate Review

Date: 2026-07-08 KST
Start HEAD: `5124d17ec6bf801f302c180cabf6a58539d892c5`
Review artifact commits already pushed by subagents: `53476e5d`, `bb61b083`, `68abb0ac`, `e94455d3`

## Agent Coverage

Required lanes completed: `code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, and `designer`.

Additional registered reviewer-style lane completed: `product-marketer-reviewer`.

The environment exposed only generic native subagent roles plus local reviewer prompt files, so each specialist lane ran through a bounded default-agent prompt. The runtime allowed five concurrent agents, not the six allowed by AGENTS.md, so the fan-out ran in waves. Initial `test-engineer` spawn hit the thread limit and was retried successfully. No reviewer failed after retry.

## Deduped Findings

### C34-01 - Lightroom/PAT upload can write after restore because it does not hold the admin mutation barrier

- Severity: High
- Confidence: High
- Status: confirmed correctness/data-consistency defect
- Cross-agent agreement: tracer primary; related restore/upload timing concerns from critic, perf, and debugger.
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:84-440`; `apps/web/src/lib/admin-mutation-barrier.ts:1-141`; `.context/reviews/tracer.md`.
- Problem: browser mutating admin actions hold `acquireAdminMutationSlot()` for the full mutation body, but the PAT Lightroom route only checks restore maintenance and the upload-processing contract lock. A route admitted before restore maintenance begins can parse/save/insert after restore drains foreground action slots.
- Scenario: a PAT upload starts, passes the first restore check, then a DB restore marks maintenance and drains admin mutation slots. Because the PAT route never acquired a slot, restore can import a dump and release locks while the upload continues and inserts into the freshly restored DB.
- Fix: acquire an admin mutation slot for the full PAT upload mutation window, returning 503 when the exclusive restore side is active. Add route/source tests proving the PAT upload imports and uses the barrier.

### C34-02 - In-app color backfill is not part of graceful shutdown drain

- Severity: Medium
- Confidence: High
- Status: confirmed reliability defect
- Cross-agent agreement: debugger primary; related background-work/resource concerns from code-reviewer, perf, and architect.
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:45-51`, `apps/web/src/lib/admin-backfill-runner.ts:678-863`, `apps/web/src/instrumentation.ts:33-87`; `.context/reviews/debugger.md`.
- Problem: the in-app admin color backfill is fire-and-forget and tracks `state.running`, but shutdown drains only the image queue, maintenance scheduler, shared view-count buffer, background DB writes, and single-writer guard. A SIGTERM during in-app backfill can cut off re-encode work even though shutdown reports only queue drain state.
- Scenario: an operator triggers re-encode from Settings, then deploy restarts the container. The process can exit after image queue/background DB drain while backfill work remains active, leaving a partially processed run and misleading shutdown evidence.
- Fix: expose a bounded `shutdownAdminBackfillRunner()`/drain helper and include it in `instrumentation.ts` graceful shutdown. Pin with a source/unit test.

### C34-03 - Browser upload rethrows topic lookup failure after quota preclaim

- Severity: Medium
- Confidence: High
- Status: confirmed reliability/UX defect
- Cross-agent agreement: critic primary; related multipart/upload concerns from perf and debugger.
- Citations: `apps/web/src/app/actions/images.ts:252-274`; `.context/reviews/critic.md`.
- Problem: after the upload tracker preclaim, a topic lookup DB error settles the quota claim but rethrows the error. That surfaces as an unstructured Server Action failure instead of the app's normal localized upload error.
- Scenario: a transient DB connection reset during topic validation produces a framework-level failure for the admin upload UI rather than a controlled error response, even though other adjacent upload failures return structured messages.
- Fix: log the topic lookup error, settle the claim, and return a localized structured failure such as `failedToVerifyTopic`.

### C34-04 - E2E seeding deletes DB-sourced filenames without containment validation

- Severity: Low
- Confidence: High
- Status: confirmed local destructive operational risk
- Cross-agent agreement: security-reviewer primary.
- Citations: `apps/web/scripts/seed-e2e.ts:213-233`; `.context/reviews/security-reviewer.md`.
- Problem: `seed-e2e.ts` restricts production/destructive DB use, but when deleting existing seed-topic rows it joins DB-stored filenames directly into upload directories. If a disposable DB contains poisoned filenames, the script can unlink outside the intended seed file set.
- Scenario: a compromised or manually edited local e2e DB row under the seed topic has `filename_original = '../../something'`; running the destructive seed helper can remove an unintended path in the developer/e2e environment.
- Fix: validate filenames before deletion with the same filename contract used by app paths, or restrict cleanup to the known seed basename allowlist.

### C34-05 - Cycle 33 release ledger still marks shipped work as active/pending

- Severity: Medium
- Confidence: High
- Status: confirmed documentation/provenance mismatch
- Cross-agent agreement: document-specialist plus local aggregate evidence.
- Citations: `.context/plans/run10-cycle33/plan.md:3`, `.context/plans/run10-cycle33/plan.md:127-128`, `.context/plans/README.md`; `.context/reviews/document-specialist.md`.
- Problem: Cycle 33 is committed and pushed at `5124d17e`, but its plan still says signed push and deploy/live smoke are pending, and the plans index still lists Cycle 33 as active.
- Scenario: future cycles treat already-shipped work as pending or miss the production evidence gap that Cycle 34 is supposed to supersede.
- Fix: mark Cycle 33 complete/pushed, move it to recently completed in the index, and make Cycle 34 the active ledger.

### C34-06 - Root review handoff mixes current Cycle 34 artifacts with stale top-level review files

- Severity: Medium
- Confidence: High
- Status: confirmed documentation/provenance mismatch
- Cross-agent agreement: document-specialist primary; current cycle observation confirms.
- Citations: `.context/reviews/_aggregate.md`; root `.context/reviews/*.md`; `.context/reviews/document-specialist.md`.
- Problem: current Cycle 34 lanes overwrite some root review files while other root files remain stale from older cycles, making root review state ambiguous.
- Scenario: a planner reads root review files and accidentally combines current Cycle 34 findings with stale Cycle 24/Cycle 33 artifacts.
- Fix: write a cycle-scoped `.context/reviews/run10-cycle34/_aggregate.md` and make root `_aggregate.md` explicitly point to the current cycle. Keep per-agent root artifacts as the current rolling handoff only when rewritten this cycle.

### C34-07 - Background DB connection budgets are fragmented across image queue and backfills

- Severity: Medium
- Confidence: High
- Status: confirmed architectural/resource risk
- Cross-agent agreement: code-reviewer, perf-reviewer, and architect.
- Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:106-143`; `apps/web/src/lib/background-db-writes.ts`; `CLAUDE.md` DB pool budget note; `.context/reviews/code-reviewer.md`; `.context/reviews/perf-reviewer.md`; `.context/reviews/architect.md`.
- Problem: each background subsystem reserves DB headroom independently. Running upload processing and admin color backfill together can leave far less live-request headroom than either subsystem's formula claims.
- Scenario: image processing and admin re-encode overlap on the default 10-connection pool, then a live photo/search/admin request fan-out queues behind long-held encode/update work.
- Disposition: deferred with preserved severity. This is a broader scheduler/resource-governor design, already documented in `CLAUDE.md`, and is not a contained same-cycle bug fix.

### C34-08 - Sidecar color backfill does not claim the per-image processing lock

- Severity: High
- Confidence: Medium-High
- Status: likely/confirmed-by-architecture risk for the sidecar path
- Cross-agent agreement: architect primary; sidecar code inspection confirms no `getImageProcessingLockName()` use in `scripts/backfill-color-pipeline.ts`.
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:524-560`; `apps/web/src/lib/admin-backfill-runner.ts:355-389`, `apps/web/src/lib/admin-backfill-runner.ts:521-671`; `.context/reviews/architect.md`.
- Problem: the in-app backfill claims the per-image processing lock, but the sidecar color backfill processes rows under only the global color-backfill lock.
- Scenario: a failed image retry or live image-processing worker can claim the same image while the sidecar re-encodes it, creating duplicate derivative writes or stale metadata persistence.
- Disposition: scheduled in Cycle 34. The contained fix is to hold the same per-image processing advisory lock as the in-app runner through sidecar reprocess and persistence, with source-contract coverage.

### C34-09 - Semantic embedding bootstrap and sidecars do not coordinate on one work owner

- Severity: Medium
- Confidence: High
- Status: confirmed design risk
- Cross-agent agreement: architect primary; related CLIP readiness risks from verifier/test-engineer/document-specialist.
- Citations: `apps/web/src/lib/image-queue.ts`; `apps/web/scripts/backfill-clip-embeddings.ts`; `apps/web/src/app/actions/embeddings.ts`; `.context/reviews/architect.md`.
- Problem: upload/bootstrap embedding work, semantic backfill action, and sidecar embedding backfill coordinate partially through mode/model filters and advisory locks, but the ownership contract is spread across paths.
- Scenario: activation/backfill/retry operations overlap and produce stale or skipped embeddings unless the operator follows the runbook exactly.
- Disposition: deferred with preserved severity as an architecture/test-infra item.

### C34-10 - Large Server Action upload and restore bodies are admitted after framework parsing

- Severity: High
- Confidence: High
- Status: confirmed performance/resource risk; long-standing architecture item
- Cross-agent agreement: perf-reviewer, debugger, verifier, test-engineer.
- Citations: `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:87-106`; `apps/web/src/app/[locale]/admin/db-actions.ts:789-810`; `.context/reviews/perf-reviewer.md`; `.context/reviews/debugger.md`.
- Problem: browser upload/restore Server Actions receive already-materialized `FormData` before app-level locks, quotas, and disk checks.
- Scenario: near-limit browser uploads or restore files can consume hundreds of MiB of heap/RSS before GalleryKit's resource gates run.
- Disposition: deferred with preserved severity. Fix requires route-handler/streaming architecture and browser-flow coverage.

### C34-11 - Search/timeline/map performance paths still rely on scan-heavy query shapes

- Severity: Medium
- Confidence: High
- Status: confirmed performance long-tail
- Cross-agent agreement: perf-reviewer/test-engineer; prior carry-forward lineage.
- Citations: `apps/web/src/lib/data.ts` search/map paths; `apps/web/src/lib/data-timeline.ts`; `.context/reviews/perf-reviewer.md`.
- Problem: public keyword search uses leading-wildcard LIKE and tag EXISTS scans; timeline archive queries use date functions; public map can emit up to 10,000 markers.
- Scenario: larger galleries see accepted public requests consume DB/client CPU despite rate limits.
- Disposition: deferred with preserved severity; needs schema/index/product pagination work.

### C34-12 - Test strategy gaps remain despite high raw test count

- Severity: Medium
- Confidence: High
- Status: confirmed/likely test gaps
- Cross-agent agreement: test-engineer; verifier for manual proof gaps.
- Citations: `.context/reviews/test-engineer.md`.
- Problem: no coverage signal exists; semantic caps and sidecar behaviors are often source-pinned; nav visual specs do not compare pixels; production CLIP proof is outside normal push gates; browser matrix is Desktop Chromium only.
- Scenario: behavior changes can satisfy source-contract tests while still regressing runtime behavior, visual output, or non-Chromium/mobile flows.
- Disposition: deferred with preserved severity as test-infra work.

### C34-13 - Public/admin UX field association and responsive issues

- Severity: Medium
- Confidence: High for SEO field-error issue; mixed for other UI risks
- Status: confirmed/likely UX defects
- Cross-agent agreement: designer primary.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:75-208`; `apps/web/src/app/actions/seo.ts:85-139`; public grid card components cited in `.context/reviews/designer.md`.
- Problem: the SEO form marks all fields invalid for one server-side error; mobile photo grids keep permanent metadata overlays over photos; admin tables/dialogs have responsive and field-error limitations.
- Scenario: admins using screen readers or narrow screens are sent to a summary/all-fields-invalid state rather than the actual invalid field; mobile visitors see photo intent obscured by permanent overlays.
- Disposition: deferred with preserved severity. Needs structured field-error design and browser-flow validation.

### C34-14 - Checked-in Atik site-config can become a fresh deploy's public identity

- Severity: Medium
- Confidence: High
- Status: confirmed product/distribution risk
- Cross-agent agreement: product-marketer-reviewer primary; document-specialist related provenance concerns.
- Citations: `apps/web/src/site-config.json`; `apps/web/scripts/ensure-site-config.mjs`; `README.md`; `apps/web/README.md`; `.context/reviews/product-marketer-reviewer.md`.
- Problem: although `apps/web/.gitignore` ignores `src/site-config.json`, the current repository still tracks a real Atik deployment config. A fresh clone can build with Atik fallback metadata if `BASE_URL`/DB SEO settings are absent.
- Scenario: a self-hosting operator publishes the wrong canonical URL, footer, and fallback SEO metadata.
- Disposition: deferred with preserved severity. The primary deployment uses this repository, so replacing tracked config needs an explicit distribution/deploy decision.

### C34-15 - Operational/manual validation risks remain outside repository proof

- Severity: Medium mixed
- Confidence: High that manual validation is required
- Status: manual-validation risks
- Cross-agent agreement: code-reviewer, security-reviewer, critic, verifier, test-engineer, architect, document-specialist.
- Citations: proxy/nginx docs and scripts; CLIP runbook/tests; backup/privacy docs; `.context/reviews/*`.
- Problem: host nginx limiter/real-IP state, production CLIP seeded weights/env/DB state, upload RSS envelope, runtime secret rotation, plaintext backup boundary, and service-worker offline freshness cannot be proven from source alone.
- Scenario: production behaves differently than source assumptions because host config, model files, or operational state drift.
- Disposition: deferred/manual validation with preserved severity and exit criteria.

## AGENT FAILURES

None after retry. The initial `test-engineer` spawn failed due to the runtime thread limit and was retried successfully.

## Final Sweep

The aggregate preserves every review finding either as scheduled work or deferred/manual-validation work for Prompt 2. Confirmed correctness/security/data-loss issues scheduled for this cycle: C34-01 through C34-06 and C34-08. Broader architecture, performance, UX, test-infra, product-distribution, and operator-validation findings are recorded with original severity/confidence and explicit exit criteria in the Cycle 34 deferred register.
