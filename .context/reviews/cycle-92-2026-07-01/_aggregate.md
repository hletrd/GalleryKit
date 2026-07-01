# Cycle 92 Aggregate Review — 2026-07-01

Reviewed repo: `/tmp/gallery-recovery-check`

Starting expected deployed HEAD: `508d35572563705008693da2dbff3e5d85442cdd`.

Observed cycle state after fan-out: a review lane accidentally committed `a2a9e400657e128a3b6752933483842533dd8925` for `test-engineer.md` before planning/implementation. This aggregate preserves that provenance and continues without reverting others' work.

## Agent Coverage

- Completed artifacts: `architect`, `code-reviewer`, `critic`, `debugger`, `designer`, `document-specialist`, `performance-reviewer`, `product-marketer-reviewer`, `security-reviewer`, `test-engineer`, `tracer`, `ui-ux-designer-reviewer`, `verifier`.
- `performance-reviewer`, `document-specialist`, and `tracer` were not listed as registered native review agents in this environment, but bounded role prompts produced artifacts for all three. The first tracer attempt missed its artifact; the required retry wrote `tracer.md` and was interrupted only after the artifact was present and stable.
- Additional local reviewer prompts covered: `product-marketer-reviewer`, `ui-ux-designer-reviewer`.
- Security review found no confirmed security vulnerability, but carried manual TLS/proxy/dependency validation risks.

## Deduplicated Confirmed Findings

### C92-01 — Restore maintenance does not fence already-in-flight non-upload admin mutations

Severity: High
Confidence: High
Cross-agent agreement: `code-reviewer`, `architect`, `critic`, `debugger`, `document-specialist`, `tracer`.

Evidence: restore begins durable maintenance only after acquiring restore/upload/backfill locks in `apps/web/src/app/[locale]/admin/db-actions.ts:374`-`452`; upload/LR paths have upload-contract and late restore checks in `apps/web/src/app/actions/images.ts:189`-`205` / `apps/web/src/app/actions/images.ts:418`-`430` and `apps/web/src/app/api/admin/lr/upload/route.ts:252`-`279`; representative non-upload writers such as `updateTopic`, `updateGallerySettings`, and `updateTag` check maintenance once at entry and later write in `apps/web/src/app/actions/topics.ts:182`-`340`, `apps/web/src/app/actions/settings.ts:41`-`175`, and `apps/web/src/app/actions/tags.ts:42`-`98`.

Failure scenario: a slow foreground admin mutation passes its entry check, restore starts, imports SQL, and the earlier request resumes and writes route/settings/tag state into the restored database.

Disposition: carry-forward deferred under the existing broad restore-barrier item (`C77-ARCH-01`); not safe for this cycle's narrow implementation scope.

### C92-02 — `image_embeddings` storage cannot retain multiple model versions per image

Severity: Medium
Confidence: High
Cross-agent agreement: `code-reviewer`, `architect`, `critic`, `document-specialist`, `tracer`.

Evidence: `image_embeddings.image_id` is the primary key in `apps/web/src/db/schema.ts:284`-`290` and `apps/web/drizzle/0012_image_embeddings.sql:5`-`11`, while semantic/similar routes filter by `model_version` and writers/backfills upsert the one row in `apps/web/src/app/api/search/semantic/route.ts:202`-`279`, `apps/web/src/app/api/search/similar/[id]/route.ts:121`-`177`, `apps/web/src/lib/image-queue.ts:379`-`390`, `apps/web/scripts/backfill-clip-embeddings.ts:161`-`223`, and `apps/web/src/app/actions/embeddings.ts:120`-`179`.

Failure scenario: switching between stub, production, or a future production model overwrites the prior row, so a rollback or parallel migration can leave active routes with incomplete rows for their filtered model version.

Disposition: carry-forward deferred under the existing semantic-storage migration item (`C88-03`); schema/reconcile/backfill changes are broader than this cycle.

### C92-03 — `/api/health` lacks an explicit Node runtime pin despite optional DB probing

Severity: Medium
Confidence: High
Cross-agent agreement: `test-engineer`, `architect`, `tracer`.

Evidence: `/api/health` imports the DB and can execute `SELECT 1` when `HEALTH_CHECK_DB=true` in `apps/web/src/app/api/health/route.ts:1`-`31`, but lacks `export const runtime = 'nodejs'`; existing tests cover behavior but not runtime pinning in `apps/web/src/__tests__/health-route.test.ts:21`-`70`.

Failure scenario: a future Next/runtime config change can move the health route into an incompatible runtime, breaking private readiness checks while liveness-only tests still pass.

Disposition: scheduled for this cycle as a safe source-contract fix.

### C92-04 — Terminal release ledger does not evidence deployment of current pushed HEAD

Severity: Medium
Confidence: High
Cross-agent agreement: `document-specialist`, `verifier`, `architect`.

Evidence: `.context/plans/README.md` records Cycle 91 completion as signed `aacccbc`, but the expected deployed HEAD for this cycle is `508d35572563705008693da2dbff3e5d85442cdd`. The review lanes did not find a committed terminal ledger proving deployment/smoke for `508d355`.

Failure scenario: the next cycle cannot establish which pushed commit production actually ran and may reuse stale deployment evidence.

Disposition: scheduled for this cycle through plan/README deployment-evidence updates.

### C92-05 — Freshness-ordered feed/sitemap queries lack matching `updated_at` indexes

Severity: Medium
Confidence: High
Cross-agent agreement: `performance-reviewer`.

Evidence: feed and sitemap freshness queries order/filter by `updated_at` without matching schema indexes; the current schema index set is optimized mostly for `processed`, `capture_date`, `created_at`, topic, and view analytics patterns.

Failure scenario: crawler/feed requests over a larger image table require broader scans/sorts and degrade tail latency.

Disposition: deferred pending `EXPLAIN` and a migration/reconcile plan.

### C92-06 — Topic navigation freshness uses a correlated `MAX(updated_at)` subquery without a matching topic/freshness index

Severity: Medium
Confidence: High
Cross-agent agreement: `performance-reviewer`.

Evidence: topic navigation freshness is computed with correlated `MAX(updated_at)` logic but no matching topic/freshness index in the schema/index ledger.

Failure scenario: large topic/image sets make navigation metadata expensive on public pages.

Disposition: deferred pending `EXPLAIN` and index migration design.

### C92-07 — Sidecar backfill/diagnostic scripts still materialize all candidates/enqueue whole runs in memory

Severity: Medium
Confidence: High
Cross-agent agreement: `performance-reviewer`.

Evidence: sidecar backfill/diagnostic scripts load full candidate lists before processing, while the in-app runner has safer bounded batching patterns.

Failure scenario: a large gallery backfill can produce avoidable RSS spikes or fail on a disk/memory-constrained deploy host.

Disposition: deferred as operator-script refactor; requires chunked cursor changes and focused script tests.

### C92-08 — Transient queue/DB infrastructure failures can leave processed=false images invisible until restart/manual recovery

Severity: Medium
Confidence: Medium-High
Cross-agent agreement: `debugger`.

Evidence: `debugger.md` traces queue/bootstrap retry surfaces where transient queue or DB errors can move an image into a pending/failed state that is not surfaced clearly to public users until bootstrap/retry/manual recovery catches it.

Failure scenario: an uploaded image can remain absent from public listings after a transient infrastructure failure even though the original file exists.

Disposition: deferred pending a focused failure-mode test and operator-visible recovery design.

### C92-09 — Smart-collection CRUD exists server-side but is not reachable from the visible admin surface

Severity: Medium
Confidence: High
Cross-agent agreement: `critic`.

Evidence: `critic.md` found server-side smart-collection actions/routes but no first-class visible admin navigation/editor surface to manage them.

Failure scenario: operators cannot create or repair smart collections through the product despite public collection pages existing.

Disposition: deferred as UX/product-surface work.

### C92-10 — Smart-collection documentation mentions color-pipeline criteria not supported by the current predicate compiler

Severity: Low
Confidence: High
Cross-agent agreement: `critic`.

Evidence: repository docs describe smart-collection criteria examples including color pipeline decisions, while the valid smart-collection columns inspected by `critic.md` do not include `color_pipeline_decision`.

Failure scenario: an operator tries to build a documented collection criterion that the UI/action compiler rejects or cannot express.

Disposition: scheduled for this cycle as a docs-only source-of-truth correction.

### C92-11 — Indexable public archive/collection surfaces are omitted from the sitemap

Severity: Medium
Confidence: High
Cross-agent agreement: `critic`, `product-marketer-reviewer`.

Evidence: sitemap generation omits indexable timeline/year/map/smart-collection or collection-like public surfaces even though those pages emit metadata/JSON-LD and are meant to be discoverable.

Failure scenario: search engines under-discover important public archive/collection pages.

Disposition: deferred pending SEO route inventory and sitemap test coverage.

### C92-12 — Public archive/collection pages request large social cards but often provide no image

Severity: Medium
Confidence: High
Cross-agent agreement: `product-marketer-reviewer`.

Evidence: archive/collection metadata requests large OG/Twitter cards, but several routes fall back to text-only/generic metadata rather than a representative image.

Failure scenario: shared public archive/collection links render weak or blank social previews.

Disposition: deferred pending metadata/OG design and route tests.

### C92-13 — "Private share links" wording overstates unauthenticated bearer-link semantics

Severity: Low
Confidence: High
Cross-agent agreement: `product-marketer-reviewer`.

Evidence: user-facing copy describes share links as private even though access is by possession of an unauthenticated bearer URL.

Failure scenario: an operator overestimates the protection level and shares links as if they require authentication.

Disposition: scheduled for this cycle as a copy correction.

### C92-14 — SEO "OG Locale" field copy implies broader control than the code provides

Severity: Low
Confidence: High
Cross-agent agreement: `product-marketer-reviewer`.

Evidence: SEO settings copy implies a broad OG-locale control, while `normalizeOpenGraphLocale` and metadata consumers only use it as the Open Graph locale value/fallback.

Failure scenario: operators expect locale routing/content behavior that the setting does not provide.

Disposition: scheduled for this cycle as a copy correction.

### C92-15 — Lightroom/PAT upload route lacks route-level behavior tests for success and main rejection paths

Severity: Medium
Confidence: High
Cross-agent agreement: `test-engineer`.

Evidence: tests cover helper/source-contract pieces, but `apps/web/src/app/api/admin/lr/upload/route.ts` lacks direct route-level tests for success, token rejection, size/header rejection, maintenance, and cleanup paths.

Failure scenario: wrapper/auth/body-limit/route integration can regress while lower-level helper tests stay green.

Disposition: deferred as broader route-test scaffolding.

### C92-16 — `OptimisticImage` retry/fallback state machine lacks direct behavior tests

Severity: Medium
Confidence: High
Cross-agent agreement: `test-engineer`.

Evidence: component fallback/retry behavior is not directly covered by a behavior test.

Failure scenario: derivative fallback or retry state can regress visually while source-contract tests remain green.

Disposition: deferred as focused component test work.

### C92-17 — Admin E2E navigation does not smoke every first-class admin page

Severity: Medium
Confidence: High
Cross-agent agreement: `test-engineer`.

Evidence: current admin E2E navigation does not traverse every first-class admin page exposed in the UI.

Failure scenario: a protected admin route can break while the main dashboard/login flow stays green.

Disposition: deferred as E2E expansion.

### C92-18 — Admin GPS-toggle E2E mutates persistent settings without `try/finally` cleanup

Severity: Medium
Confidence: High
Cross-agent agreement: `test-engineer`.

Evidence: GPS-toggle E2E changes a persistent admin setting without guaranteed cleanup if assertions fail.

Failure scenario: later E2E runs inherit a changed privacy setting and produce order-dependent failures or unsafe test state.

Disposition: deferred as E2E cleanup hardening.

### C92-19 — No coverage instrumentation or threshold exists for the large unit suite

Severity: Low
Confidence: High
Cross-agent agreement: `test-engineer`.

Evidence: the Vitest suite has no coverage threshold/instrumentation gate despite broad source-contract reliance.

Failure scenario: test quantity can grow while meaningful behavioral coverage declines unnoticed.

Disposition: deferred; adding coverage thresholds is tooling/policy work.

### C92-20 — Zoomed photo can be toggled by keyboard but cannot be panned by keyboard

Severity: Medium
Confidence: High
Cross-agent agreement: `designer`.

Evidence: lightbox/image zoom supports keyboard toggling/focus paths, but review did not find keyboard pan controls for zoomed images.

Failure scenario: keyboard-only users can enter a zoomed state but cannot inspect off-center content.

Disposition: deferred as interactive behavior/a11y design work.

### C92-21 — Lightroom token create dialog uses toast-only validation for empty labels

Severity: Medium
Confidence: High
Cross-agent agreement: `designer`.

Evidence: token-create empty-label validation is surfaced via toast rather than persistent field-level error text tied to the input.

Failure scenario: screen-reader or distracted users may miss the validation reason and cannot associate it with the field.

Disposition: deferred as admin form UX/test work.

### C92-22 — Load-more failure states leave live regions stale and lack persistent inline error state

Severity: Low
Confidence: High
Cross-agent agreement: `designer`.

Evidence: load-more actions can fail without updating a durable inline/live-region error that remains available after the toast disappears.

Failure scenario: assistive-technology users do not receive a persistent explanation for a failed pagination/search action.

Disposition: deferred as public UI accessibility work.

### C92-23 — Admin image management remains desktop-table-first on mobile

Severity: Medium
Confidence: High
Cross-agent agreement: `ui-ux-designer-reviewer`.

Evidence: mobile admin image management presents a dense desktop-style table rather than a responsive task layout.

Failure scenario: mobile admins struggle to scan and operate image management controls safely.

Disposition: deferred as broader responsive UX redesign.

### C92-24 — Mobile admin navigation is a flat wrapped 10-link header

Severity: Medium
Confidence: High
Cross-agent agreement: `ui-ux-designer-reviewer`.

Evidence: admin mobile navigation exposes many links as a wrapped header list rather than a compact mobile navigation pattern.

Failure scenario: navigation consumes excessive vertical space and harms repeat admin workflows on small screens.

Disposition: deferred as broader admin IA work.

## Likely Issues And Manual-Validation Risks

- `C92-RISK-01` / `C92-ARCH-L1` / `MV-C92-DOC-01`: runtime `site-config.json` bind-mount behavior remains ambiguous with static JSON imports; defer under existing `C80-06` until standalone/Docker validation proves actual behavior.
- `C92-DOC-L01`: `settings-hash` test comment overstates what the source-contract test can catch; schedule as a low-risk comment correction only if touched with nearby docs.
- `C92-TE-L1`: public E2E does not smoke map, timeline/year, smart collections, or ordinary topic pages; defer as browser-flow expansion.
- `C92-TE-L2`: PWA installability contracts stop short of manifest/static-icon/service-worker parity; defer as PWA contract expansion.
- `C92-TE-L3`: E2E upload cleanup is partial when the row never becomes visible; defer as E2E cleanup hardening.
- `PMR-92-L1`: timeline `?year=` variants may have canonical/JSON-LD drift; defer pending metadata route inventory.
- `C92-CRIT likely`: malformed stored smart-collection queries can 404/no-diagnostics; defer pending smart-collection admin/editor work.
- `C92-CRIT likely`: admin delete may not clean up corrupt/legacy unsafe filenames; defer pending legacy-data cleanup design.
- Performance likely risks: exact `COUNT(*) OVER()` totals, public smart-collection `LIKE '%term%'`, public keyword leading-wildcard scans, non-sargable archive date functions, brute-force semantic vector scans, and 10k map markers remain deferred pending measurement and targeted designs.
- Manual operational risks remain for production proxy/TLS exposure, dependency audit freshness, single-instance topology, DB-only restore versus filesystem snapshots, semantic production activation, browser matrix/visual baseline gaps, and real CLIP opt-in test coverage.

## Agent Failures

None in the final provenance set. The tracer lane needed one retry because the first run did not leave `tracer.md`; the retry wrote the artifact and was interrupted only after the file existed and contained the final missed-issue sweep.

## Plan Disposition

Cycle 92 schedules safe narrow fixes for `C92-03`, `C92-04`, `C92-10`, `C92-13`, and `C92-14`. All other findings are recorded in `.context/plans/cycle-92-2026-07-01-deferred.md` with severity/confidence preserved and exit criteria.
