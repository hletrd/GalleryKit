# Plan 248 — Cycle 2 RPF deferred findings
Status: active-deferred

Purpose: record every Cycle 2 aggregate finding from `.context/reviews/_aggregate.md` that is not scheduled for direct implementation in `plan/done/plan-247-cycle2-rpf-review-fixes.md`. Original severity/confidence are preserved; no finding is silently dropped.

## Repo-policy basis for deferral

- `AGENTS.md`: "Keep diffs small, reviewable, and reversible" and "No new dependencies without explicit request."
- `CLAUDE.md`: the shipped deployment is explicitly a "single web-instance / single-writer" topology; restore maintenance flags, upload quota tracking, and image queue state are process-local and must not be horizontally scaled unless moved to shared storage.
- `CLAUDE.md`: local filesystem storage is the only supported backend; `@/lib/storage` is an internal abstraction and must not be documented or exposed as S3/MinIO support until wired end-to-end.
- Existing `.context/**` and `plan/**`: broad performance/indexing/search/test-gap items are tracked as explicit deferred work rather than being mixed into a small hardening cycle.
- `.cursorrules`, `CONTRIBUTING.md`, and `docs/**` style/policy files are absent.

No confirmed security, correctness, or data-loss finding is deferred below unless the cited repo rule makes it non-live or operationally out-of-scope for this cycle.

## Deferred items

### D247-12 — Exact grouped counts on uncached public listing pages
- **Finding:** AGG2-12.
- **Citation:** `apps/web/src/lib/data.ts:435-464`; `apps/web/src/app/[locale]/(public)/page.tsx:14-16`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`.
- **Original severity / confidence:** Medium / High.
- **Reason for deferral:** performance-at-scale finding. Replacing exact totals with `limit+1`, approximate counters, or cached counts changes user-visible counts and pagination semantics; this is broader than the correctness/security hardening selected for this cycle.
- **Exit criterion:** slow-query logs or production telemetry show public listing counts dominating request latency, or a product decision removes exact public totals.

### D247-13 — Public search uses leading-wildcard LIKE scans
- **Finding:** AGG2-13.
- **Citation:** `apps/web/src/app/actions/public.ts:103-158`; `apps/web/src/lib/data.ts:810-916`.
- **Original severity / confidence:** Medium / High.
- **Reason for deferral:** performance/search-architecture work that likely requires FULLTEXT indexes or a denormalized search table. No new dependency/indexing strategy is introduced without a dedicated plan.
- **Exit criterion:** public search latency appears in slow-query logs or a search-index migration is scheduled.

### D247-14 — Prev/next lookups lack full tie-breaker index
- **Finding:** AGG2-14.
- **Citation:** `apps/web/src/lib/data.ts:547-619`; `apps/web/src/db/schema.ts:61-66`; `apps/web/drizzle/0001_sync_current_schema.sql:77-81`.
- **Original severity / confidence:** Medium / Medium.
- **Reason for deferral:** DB indexing/performance work requiring migration design and production index sizing. Current correctness is not disputed; the concern is query-plan efficiency at scale.
- **Exit criterion:** photo navigation slow-query evidence appears or a database-index migration cycle is opened.

### D247-16 — Process-local deployment-critical coordination state is not runtime-enforced
- **Finding:** AGG2-16.
- **Citation:** `README.md:146-148`; `apps/web/src/lib/data.ts:11-23`; `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/lib/upload-tracker-state.ts:7-20`; `apps/web/src/lib/image-queue.ts:121-140,469-498`.
- **Original severity / confidence:** Medium / High.
- **Reason for deferral:** `CLAUDE.md` and README explicitly define the shipped topology as a single web-instance / single-writer deployment and list these process-local coordination states. Moving them to shared storage is a larger architectural change.
- **Exit criterion:** horizontal scaling is planned, multiple Node workers are introduced, or runtime topology enforcement is requested.

### D247-17 — Experimental storage abstraction conflicts with private-original boundary
- **Finding:** AGG2-17.
- **Citation:** `apps/web/src/lib/storage/index.ts:1-12`; `apps/web/src/lib/storage/types.ts:11-14`; `apps/web/src/lib/storage/local.ts:20,123-126`; `apps/web/src/lib/upload-paths.ts:24-40,82-102`.
- **Original severity / confidence:** Medium / High.
- **Reason for deferral:** `CLAUDE.md` explicitly states the storage module is not integrated and local filesystem storage is the only supported backend. Because the abstraction is non-live, changing/removing it is a cleanup/design decision rather than a live security boundary fix.
- **Exit criterion:** the storage abstraction is wired into upload/processing/serving, documented as supported, or a dead-code cleanup pass is scheduled.

### D247-20 — Nginx config relies on an external TLS terminator
- **Finding:** AGG2-20.
- **Citation:** `apps/web/nginx/default.conf`; README deployment section.
- **Original severity / confidence:** Medium / Medium.
- **Reason for deferral:** deployment topology policy. The repo ships app/nginx snippets but does not own certificates, DNS, or the external reverse proxy in this environment. This cycle documents upload-serving path expectations in P247-04 but does not provision TLS.
- **Exit criterion:** a production deployment target is selected for this loop, or the repo adds a full TLS-terminating nginx/compose profile.

### D247-23 — `process-topic-image.ts` direct Sharp/temp-file tests missing
- **Finding:** AGG2-23.
- **Citation:** `apps/web/src/lib/process-topic-image.ts:42-106`; `apps/web/src/__tests__/topics-actions.test.ts:111-114,183-260`.
- **Original severity / confidence:** Medium / High.
- **Reason for deferral:** test-gap item without an active reported regression. Adding file-system/Sharp fixtures is useful but less urgent than current correctness/security/gate blockers.
- **Exit criterion:** topic image processing changes, Sharp is upgraded, or a topic-image regression is reported.

### D247-26 — Listing helper can exceed documented 100-row cap
- **Finding:** AGG2-26.
- **Citation:** `apps/web/src/lib/data.ts:371-373`; `apps/web/src/lib/data.ts:435-464`; `apps/web/src/__tests__/data-pagination.test.ts:1-30`.
- **Original severity / confidence:** Low / High.
- **Reason for deferral:** low-severity contract polish tied to pagination internals. No current user-visible failure is reported.
- **Exit criterion:** pagination code is touched for AGG2-12 or a caller begins depending on the documented hard cap.

### D247-28 — Drizzle CLI config malformed DB URLs on missing env
- **Finding:** AGG2-28.
- **Citation:** `apps/web/drizzle.config.ts:4-12`; `apps/web/src/db/index.ts:8-18`.
- **Original severity / confidence:** Low / High.
- **Reason for deferral:** operability polish. Runtime DB config and tests are already robust; migration CLI hardening can be handled in a focused tooling pass.
- **Exit criterion:** a developer hits a confusing Drizzle CLI URL error or migration tooling is changed.

### D247-30 — Nested PostCSS audit advisory under Next
- **Finding:** AGG2-30.
- **Citation:** `package-lock.json`; `npm audit` advisory for transitive PostCSS under Next.
- **Original severity / confidence:** Low / High.
- **Reason for deferral:** dependency is transitive through Next. `AGENTS.md` forbids new dependencies without explicit request; upgrading framework/transitives requires a dedicated dependency pass and official compatibility verification.
- **Exit criterion:** a patched Next release is adopted, `npm audit fix` can resolve without unsafe upgrades, or the advisory becomes directly exploitable in this app.

### D247-31 — CSV export materializes up to 50k rows in memory
- **Finding:** AGG2-31.
- **Citation:** `apps/web/src/app/[locale]/admin/db-actions.ts:53-124`.
- **Original severity / confidence:** Low / High.
- **Reason for deferral:** bounded admin-only performance concern. Streaming export is a route/API design change and not needed for current gate/root-cause fixes.
- **Exit criterion:** CSV export memory pressure is observed or export row caps change.

### D247-33 — CI builds the Next app twice around E2E
- **Finding:** AGG2-33.
- **Citation:** `.github/workflows/quality.yml:75-79`; `apps/web/playwright.config.ts:61-68`.
- **Original severity / confidence:** Low / High.
- **Reason for deferral:** CI efficiency, not correctness. This cycle focuses on local gate reliability and root-cause failures.
- **Exit criterion:** CI runtime approaches job limits or workflow refactoring is scheduled.

### D247-34 — Startup permission repair is O(file-count)
- **Finding:** AGG2-34.
- **Citation:** `apps/web/scripts/entrypoint.sh:4-22`; `apps/web/docker-compose.yml:22-25`.
- **Original severity / confidence:** Low / Medium.
- **Reason for deferral:** deployment performance risk that requires deciding whether startup should repair legacy host ownership. Removing recursive repair could break existing installs.
- **Exit criterion:** startup time on large upload trees becomes a reported issue or a migration guide replaces recursive repair.

### D247-35 — Server-action origin lint gate relies on file topology
- **Finding:** AGG2-35.
- **Citation:** `apps/web/scripts/check-action-origin.ts:13-21,86-97,221-262`; `apps/web/src/proxy.ts:96-101`.
- **Original severity / confidence:** Low / Medium.
- **Reason for deferral:** lint-architecture enhancement. Current known server action locations are covered by the gate and repo conventions.
- **Exit criterion:** a mutating server action is added outside scanned paths or lint scanner work is scheduled.

### D247-36 — Nav visual checks capture screenshots without baseline comparisons
- **Finding:** AGG2-36.
- **Citation:** `apps/web/e2e/nav-visual-check.spec.ts:5-40`.
- **Original severity / confidence:** Low / High.
- **Reason for deferral:** test-quality improvement. Introducing stable visual baselines can be noisy across local/CI rendering environments and should be done deliberately.
- **Exit criterion:** visual regression baselines are adopted or these tests are renamed during E2E cleanup.

### D247-39 — RTL support is not wired into the current locale model
- **Finding:** AGG2-39.
- **Citation:** `apps/web/src/app/[locale]/layout.tsx:88-95`; `apps/web/src/i18n/request.ts:4-14`.
- **Original severity / confidence:** Low / Medium.
- **Reason for deferral:** current supported locales are English and Korean, both LTR. RTL support is a future product expansion, not a current defect.
- **Exit criterion:** an RTL locale is added or locale direction becomes configurable.

## Deferred gate warnings observed during Prompt 3

### D247-GW01 — Build-time sitemap fallback warning when DB credentials are absent
- **Gate:** `npm run build`.
- **Citation:** `apps/web/src/app/sitemap.ts:28-45`; final build output on 2026-04-28 emitted `[sitemap] falling back to homepage-only sitemap` after MySQL rejected empty credentials.
- **Original severity / confidence:** Low / High (warning only; build exited 0).
- **Reason for deferral:** The warning is from an intentional fallback documented in `sitemap.ts`: Docker/build-time prerendering may not have DB access, and ISR replaces the homepage-only sitemap at runtime. Existing plan history already tracks broader sitemap/index work; changing this now would be a behavior/logging policy decision rather than a gate error.
- **Exit criterion:** The warning becomes CI-failing/noisy, production observability needs quieter builds, or sitemap generation is moved to a runtime route/index architecture.
