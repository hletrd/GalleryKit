# Plan 242 — Cycle 8 RPF deferred / operational findings
Status: active-deferred

Purpose: record every Cycle 8 RPF review finding not scheduled for direct implementation in `plan/plan-241-cycle8-rpf-fixes.md`. Original severity/confidence are preserved; no review finding is silently dropped.

## Repo-policy basis for deferral

- `AGENTS.md`: “Keep diffs small, reviewable, and reversible”; “No new dependencies without explicit request.”
- `CLAUDE.md`: the shipped deployment is explicitly “single web-instance / single-writer”; local filesystem is the only supported storage backend; TypeScript 6 / Next.js 16 are documented project baselines; historical git secrets must be treated as compromised and rotated rather than reused.
- Existing `.context/**` and `plan/**`: broad behavior-test replacement, visual baselines, CSV streaming, distributed coordination, storage abstraction, and upstream dependency advisories are carried as dedicated product/ops tracks rather than mixed into small hardening cycles.
- Deferred work remains bound by repo policy when reopened: signed commits, gitmoji messages, no `--no-verify`, no force-push, Node 24+ / TypeScript 6+ unless the project baseline is intentionally changed.

## Deferred items

### D-C8RPF-01 — TypeScript 6 vs `typescript-eslint` peer range
- **Finding:** C8RPF-25.
- **Citation:** `apps/web/package.json:56-70`; `package-lock.json` entries for `@typescript-eslint/*` peer dependency ranges.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** dependency/toolchain baseline decision. `CLAUDE.md` currently declares “TypeScript 6.0+” as a project requirement, so pinning below 6 would contradict repo policy; upgrading the lint stack must wait for a compatible release and lockfile refresh.
- **Repo rule quoted for deferral:** `CLAUDE.md` Important Notes — “Node.js 24+ required, TypeScript 6.0+”.
- **Exit criterion:** `typescript-eslint` publishes a release declaring TypeScript 6 support, or the repo owner approves lowering the TypeScript baseline.

### D-C8RPF-02 — Nested Next/PostCSS advisory remains upstream-blocked
- **Finding:** C8RPF-26.
- **Citation:** `apps/web/package.json` overrides; `package-lock.json` `next@16.2.3` dependency on `postcss@8.4.31`; GHSA-qx2v-qp2m-jg93.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** security dependency risk, but prior cycle evidence found latest/canary Next 16 still pins the vulnerable nested PostCSS copy and `npm audit fix --force` proposes downgrading Next to an incompatible major. This cycle must not mask the advisory by breaking the documented framework baseline.
- **Repo rule quoted for deferral:** `CLAUDE.md` Tech Stack — “Framework: Next.js 16.2 (App Router, React 19, TypeScript 6)”; `AGENTS.md` — “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** a compatible Next 16 release or supported override removes the nested vulnerable PostCSS copy; close after `npm audit --omit=dev` no longer reports that path.

### D-C8RPF-03 — Historical bootstrap/session secrets in git history
- **Finding:** C8RPF-27.
- **Citation:** historical git values; current warning in `CLAUDE.md:67-70` and env examples.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral / operational closure:** current HEAD contains placeholders and explicit rotation warnings. Rewriting published git history or running an operator rotation campaign is a destructive operational decision outside a code-fix cycle.
- **Repo rule quoted for deferral:** `CLAUDE.md` Environment Variables — “If you ever seeded an environment from older checked-in examples, rotate both `SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical git values must be treated as compromised and must not be reused.”
- **Exit criterion:** repo owner approves a coordinated history rewrite/security notice, or current docs stop warning operators.

### D-C8RPF-04 — Reverse-proxy trust operational validation residue
- **Finding:** C8RPF-28 residual after P241-01/P241-05.
- **Citation:** README/app README proxy docs; `apps/web/src/lib/request-origin.ts`; `apps/web/src/lib/rate-limit.ts`.
- **Original severity / confidence:** LOW / HIGH.
- **Reason for deferral:** P241-01/P241-05 will fix code/docs drift, but validating actual production header overwrite behavior requires deployment access and operational authority outside this repo cycle.
- **Exit criterion:** production proxy configuration is audited against documented header overwrite/trusted-hop requirements or deployment topology changes.

### D-C8RPF-05 — Plaintext database backups at rest
- **Finding:** C8RPF-29.
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts`; `apps/web/src/app/api/admin/db/download/route.ts`.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** operational storage-encryption policy. The app already stores backups in a non-public volume behind admin auth/same-origin checks; application-level encryption/key management would add new product/security design and possibly new dependencies.
- **Repo rule quoted for deferral:** `AGENTS.md` — “No new dependencies without explicit request”; “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** threat model requires app-managed backup encryption, backup volume leaves trusted infrastructure, or owner approves encryption/key-management design.

### D-C8RPF-06 — Public gallery list over-fetches EXIF-heavy columns
- **Finding:** C8RPF-30.
- **Citation:** public list query/projection code in `apps/web/src/lib/data.ts` and public card usage.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** broad data-query/projection refactor with high regression risk across public list/search/detail privacy contracts. It is a performance issue, not a current correctness/security failure.
- **Exit criterion:** dedicated data-layer performance pass, large-gallery profiling shows list payload/query cost is material, or next public projection refactor.

### D-C8RPF-07 — Admin dashboard list over-fetches full admin image records
- **Finding:** C8RPF-31.
- **Citation:** admin dashboard data query and `apps/web/src/components/image-manager.tsx` row usage.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** dashboard-specific projection split affects admin edit/tag/delete surfaces and should be handled in a focused performance pass with before/after payload checks.
- **Exit criterion:** dashboard latency/payload profiling shows material cost, or admin data-query refactor is scheduled.

### D-C8RPF-08 — Batch delete full directory scan fan-out
- **Finding:** C8RPF-32.
- **Citation:** `apps/web/src/app/actions/images.ts` batch delete cleanup and derivative cleanup helpers.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** performance/I/O refactor that should be paired with helper-level tests and careful legacy-variant coverage; P241-02 addresses cleanup failure signaling but not batch scan topology.
- **Exit criterion:** large batch-delete profiling shows disk saturation, or image cleanup helper refactor cycle begins.

### D-C8RPF-09 — CSV export should stream instead of materializing memory
- **Finding:** C8RPF-33.
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts` CSV export and client Blob handling.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** route-handler streaming changes the export interface and needs browser/download/E2E coverage; existing prior plans already carry CSV memory work as a performance project.
- **Exit criterion:** gallery size or memory pressure exceeds current safe operating envelope, or export route redesign is scheduled.

### D-C8RPF-10 — Live search lacks a real search index
- **Finding:** C8RPF-34.
- **Citation:** search query construction in `apps/web/src/lib/data.ts` / public search action.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** index/search-table design is schema and migration work, not a bounded bug fix. Current rate limits remain a safety guard for abuse but not a performance solution.
- **Exit criterion:** large-gallery search latency becomes user-visible or product accepts a FULLTEXT/search-table migration.

### D-C8RPF-11 — Queue/job format-level concurrency oversubscription
- **Finding:** C8RPF-35.
- **Citation:** `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/process-image.ts`.
- **Original severity / confidence:** MEDIUM / MEDIUM.
- **Reason for deferral:** P241-03 will improve CPU detection, but changing format-level conversion scheduling requires performance benchmarking to avoid regressing throughput.
- **Exit criterion:** upload profiling shows queue workers causing user-facing lag, or a dedicated image-pipeline tuning pass starts.

### D-C8RPF-12 — Admin rows mount many TagInput listeners
- **Finding:** C8RPF-36.
- **Citation:** `apps/web/src/components/image-manager.tsx`; `apps/web/src/components/tag-input.tsx`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** UI interaction redesign (lazy tag editing/centralized listener) exceeds a bounded cycle and should be covered by admin interaction tests.
- **Exit criterion:** dashboard profiling shows tag editing/listeners are a bottleneck or admin row UX redesign begins.

### D-C8RPF-13 — Add executable auth action tests
- **Finding:** C8RPF-37.
- **Citation:** `apps/web/src/app/actions/auth.ts`; current source-text auth tests under `apps/web/src/__tests__`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** high-value security coverage gap but not a newly observed auth bypass. Stable mocks for Next cookies/headers, redirects, db transactions, Argon2, audit, and rate-limit helpers are a dedicated test-hardening project.
- **Repo rule quoted for deferral:** `AGENTS.md` — “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** next auth-sensitive code change, dedicated auth test-hardening cycle, or escaped auth regression.

### D-C8RPF-14 — Add direct sharing action tests
- **Finding:** C8RPF-38.
- **Citation:** `apps/web/src/app/actions/sharing.ts`; absence of `sharing*.test.ts`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** broad behavior-test addition across retry, transaction, FK, and rollback paths. P241-01 addresses the concrete rate-limit bucket bug first.
- **Repo rule quoted for deferral:** `AGENTS.md` — “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** next sharing action change, dedicated sharing test pass, or escaped share/regression incident.

### D-C8RPF-15 — Add settings/SEO mutation tests
- **Finding:** C8RPF-39.
- **Citation:** `apps/web/src/app/actions/settings.ts`; `apps/web/src/app/actions/seo.ts`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** broad coverage project. P241-02/P241-05 target concrete settings/SEO race/docs issues first.
- **Repo rule quoted for deferral:** `AGENTS.md` — “Keep diffs small, reviewable, and reversible.”
- **Exit criterion:** next settings/SEO action change, dedicated mutation-test cycle, or escaped settings/SEO regression.

### D-C8RPF-16 — Shared-group view-count buffering tests
- **Finding:** C8RPF-40.
- **Citation:** `apps/web/src/lib/data.ts` shared-group view-count buffer functions.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** approximate analytics are explicitly non-billing/non-audit-grade in repo docs; test seam extraction should be a focused data-layer coverage pass.
- **Repo rule quoted for deferral:** `CLAUDE.md` Runtime topology — “Shared-group `view_count` is best-effort approximate analytics ... Do not treat it as billing/audit-grade state unless it is moved to durable storage.”
- **Exit criterion:** view counts become contractual/billing/audit data, or data-layer test seam work is scheduled.

### D-C8RPF-17 — Search UI concurrency/keyboard component tests
- **Finding:** C8RPF-41.
- **Citation:** search component and current E2E coverage.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** component-test harness expansion; no current escaped regression cited.
- **Exit criterion:** next search UI change or dedicated component-test pass.

### D-C8RPF-18 — Replace source-inspection tests with behavioral tests
- **Finding:** C8RPF-42.
- **Citation:** source-contract tests under `apps/web/src/__tests__`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** broad test-suite modernization, already a carried-forward category in prior plans. Keep source tests where static shape is the actual contract.
- **Exit criterion:** source-test false positive/false negative blocks work, or dedicated behavior-test modernization cycle begins.

### D-C8RPF-19 — Admin settings Playwright persistence check
- **Finding:** C8RPF-43.
- **Citation:** `apps/web/e2e/admin.spec.ts` settings test.
- **Original severity / confidence:** MEDIUM / MEDIUM.
- **Reason for deferral:** e2e auth/admin suite is opt-in and seeded-environment dependent; adding persistence assertions should be paired with admin E2E reliability work.
- **Exit criterion:** admin E2E is made required in CI, or settings UI/server action changes.

### D-C8RPF-20 — Configurable E2E upload polling timeout
- **Finding:** C8RPF-44.
- **Citation:** `apps/web/e2e/helpers.ts` upload polling helper.
- **Original severity / confidence:** MEDIUM / MEDIUM.
- **Reason for deferral:** probable flake rather than observed gate failure this cycle; changing e2e timing policy should be done with CI duration data.
- **Exit criterion:** upload/delete e2e flakes on timeout, or CI timing logs show the 30s limit is too tight.

### D-C8RPF-21 — Convert visual nav artifacts into assertions
- **Finding:** C8RPF-45.
- **Citation:** `apps/web/e2e/nav-visual-check.spec.ts`.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** visual baseline policy requires stable screenshots, threshold/masking decisions, and binary artifact review.
- **Exit criterion:** CI adopts visual-regression baselines or a nav visual regression escapes.

### D-C8RPF-22 — Storage abstraction drift
- **Finding:** C8RPF-46.
- **Citation:** `apps/web/src/lib/storage/*`; upload/process/serve code paths.
- **Original severity / confidence:** MEDIUM / HIGH.
- **Reason for deferral:** architecture/product decision. The repo explicitly says local filesystem is the only supported production backend and warns not to expose S3/MinIO switching until wired end-to-end.
- **Repo rule quoted for deferral:** `CLAUDE.md` Key Files & Patterns — “Storage Backend (Not Yet Integrated): The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end.”
- **Exit criterion:** object-storage support becomes a product goal, or any runtime upload/serving path starts depending on `getStorage()`.

### D-C8RPF-23 — Cross-process coordination / singleton invariant
- **Finding:** C8RPF-47.
- **Citation:** `CLAUDE.md` runtime topology; `apps/web/src/lib/restore-maintenance.ts`; `apps/web/src/lib/upload-tracker-state.ts`; `apps/web/src/lib/data.ts`; `apps/web/src/lib/image-queue.ts`.
- **Original severity / confidence:** HIGH / HIGH.
- **Reason for deferral:** data/correctness architecture risk, but current repo policy explicitly defines a single web-instance/single-writer deployment. P241-02 improves intra-process/DB-backed upload/settings and restore edges; full multi-instance coordination remains a larger design.
- **Repo rule quoted for deferral:** `CLAUDE.md` Runtime topology — “The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store.”
- **Exit criterion:** any deployment target adds multiple web replicas, worker split, Node clustering, blue/green overlap without singleton guard, or product requirement for horizontal scaling.

### D-C8RPF-24 — Public throttling strategy drifts by surface in multi-node deployments
- **Finding:** C8RPF-48.
- **Citation:** search/load-more/public action rate-limit code.
- **Original severity / confidence:** MEDIUM / MEDIUM.
- **Reason for deferral:** same singleton topology basis as D-C8RPF-23. This is not a current supported deployment mode.
- **Repo rule quoted for deferral:** `CLAUDE.md` Runtime topology singleton quote above.
- **Exit criterion:** multi-node deployment is allowed or public throttling is redesigned.

### D-C8RPF-25 — CDN/asset-origin support is upload-only
- **Finding:** C8RPF-49.
- **Citation:** `IMAGE_BASE_URL` asset URL helpers and topic/static thumbnail paths.
- **Original severity / confidence:** LOW / MEDIUM.
- **Reason for deferral:** topology/product cleanup. P241-05 will document URL constraints; unifying all asset origins needs a design choice about topic/static assets and CDN scope.
- **Exit criterion:** CDN support is broadened beyond upload derivatives, or mixed-origin asset behavior causes a deployment issue.

### D-C8RPF-26 — Infinite load-more DOM/windowing risk
- **Finding:** C8RPF-50.
- **Citation:** public masonry/load-more components.
- **Original severity / confidence:** MEDIUM / MEDIUM.
- **Reason for deferral:** manual-validation performance risk dependent on gallery size/device memory. Virtualization would change UI behavior and should follow profiling.
- **Exit criterion:** low-memory mobile profiling shows long-scroll jank, or gallery sizes require windowing.

### D-C8RPF-27 — Server Action upload transport body budget
- **Finding:** C8RPF-51.
- **Citation:** upload server action and body-size config.
- **Original severity / confidence:** MEDIUM / MEDIUM.
- **Reason for deferral:** runtime/deployment memory validation needed; switching uploads to streaming route handlers is a larger API/UX change.
- **Exit criterion:** production/load-test RSS or temp-file pressure is observed, or upload transport redesign is scheduled.
