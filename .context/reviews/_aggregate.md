# Cycle 5/100 Aggregate Review

Source reviews written this cycle:
`architect.md`, `code-reviewer.md`, `critic.md`, `debugger.md`, `designer.md`, `document-specialist.md`, `perf-reviewer.md`, `product-marketer-reviewer.md`, `security-reviewer.md`, `test-engineer.md`, `tracer.md`, `ui-ux-designer-reviewer.md`, `verifier.md`.

Agent availability notes: required registered roles were reviewed. `perf-reviewer`, `tracer`, `document-specialist`, `product-marketer-reviewer`, and `ui-ux-designer-reviewer` were executed through registered default/writer/designer-capable agents because those exact names were not native `spawn_agent.agent_type` values. `designer` was included because this is a Next.js/Tailwind web UI repo. Native child-agent concurrency was capped by the environment, so fan-out was staged while preserving all requested review lanes.

## AGENT FAILURES

None. The architect lane could not write directly from its read-only lane, but returned paste-ready content; it is preserved in `architect.md`.

## Cross-agent agreement highlights

- **Proxy/rate-limit client IP trust**: flagged by code-reviewer, security-reviewer, document-specialist, tracer.
- **Image queue/durable failure state**: flagged by code-reviewer, debugger, tracer, architect.
- **Process-local coordination/single-instance constraint**: flagged by critic, architect, perf-reviewer, tracer.
- **Search/listing scalability**: flagged by perf-reviewer and architect.
- **CSV export memory behavior**: flagged by critic and perf-reviewer.
- **UI/admin metadata/i18n issues**: flagged by designer, product-marketer-reviewer, and ui-ux-designer-reviewer.

## Dedupe methodology

Overlapping reports were merged by failure mode and affected code path. Severity/confidence preserve the highest rating supplied by any agent; individual per-agent reports remain the provenance source.

## MERGED FINDINGS

### AGG-C5-01 — Trusted proxy client-IP handling is unsafe/ambiguous behind forwarded chains
- **Severity / confidence:** High / High
- **Sources:** code-reviewer #1; security-reviewer #3; document-specialist WDS-02; tracer proxy finding.
- **Citations:** `apps/web/src/lib/rate-limit.ts:61-78`; `README.md:145-147`; `apps/web/nginx/default.conf`; `apps/web/.env.local.example`.
- **Problem:** `TRUST_PROXY=true` handling selects/depends on the wrong or ambiguous `X-Forwarded-For` hop and can collapse all clients to `unknown` or the proxy IP if deployment docs are followed imperfectly.
- **Failure scenario:** Brute-force or upload/search throttles are applied to the wrong principal, either bypassing per-client limits or locking out all users behind the same proxy.
- **Fix:** Parse the trusted hop explicitly, document the expected header chain, and add regression tests for spoofed multi-hop values and missing proxy config.

### AGG-C5-02 — SQL restore scanner can miss malformed/dangerous input
- **Severity / confidence:** Medium / High
- **Sources:** security-reviewer #1; debugger #2.
- **Citations:** `apps/web/src/lib/sql-restore-scan.ts`; `apps/web/src/__tests__/sql-restore-scan.test.ts`; restore path in `apps/web/src/app/[locale]/admin/db-actions.ts`.
- **Problem:** Stateful scanning has chunk-boundary and regex-grouping weaknesses, including malformed dump header acceptance.
- **Failure scenario:** A crafted restore file bypasses validation or is accepted despite not being a valid dump, increasing destructive-restore risk.
- **Fix:** Preserve enough rolling scanner state, correct header grouping, and add split-token/header regression tests.

### AGG-C5-03 — Known vulnerable PostCSS remains in dependency graph
- **Severity / confidence:** Medium / High
- **Sources:** security-reviewer #2.
- **Citations:** `package-lock.json`; `apps/web/package.json`.
- **Problem:** Review reported a vulnerable PostCSS version still present somewhere in the resolved dependency graph.
- **Failure scenario:** Tooling that processes untrusted CSS could be exposed to upstream PostCSS CVEs.
- **Fix:** Verify with `npm audit`/lockfile inspection and update/override within the existing dependency family if applicable.

### AGG-C5-04 — `createAdminUser()` can reset its hourly rate-limit bucket
- **Severity / confidence:** Medium / High
- **Sources:** code-reviewer #3.
- **Citations:** `apps/web/src/app/actions/admin-users.ts:106-189`.
- **Problem:** Success/duplicate/error paths clear the whole `user_create` hourly bucket rather than rolling back only the current attempt.
- **Failure scenario:** Repeated admin-create attempts can evade the intended hourly limit.
- **Fix:** Replace full bucket reset with a scoped decrement/rollback and add regression coverage.

### AGG-C5-05 — Image processing can abandon or deadlock failed jobs without durable recovery
- **Severity / confidence:** High / High
- **Sources:** code-reviewer #2; debugger #1; tracer image queue finding; architect #1/#5.
- **Citations:** `apps/web/src/lib/image-queue.ts:181-327,378-455`; `apps/web/src/app/actions/images.ts:217-232,297-312`; `apps/web/src/lib/data.ts:295-303`.
- **Problem:** Failed/claim-miss processing attempts can be dropped after retries and only rediscovered on process restart; there is no durable failed state or admin retry path.
- **Failure scenario:** A transient DB or file-system issue leaves images permanently `processed=false` and invisible/stuck until restart/manual intervention.
- **Fix:** Ensure failed jobs remain retryable or are durably marked with an operator-visible retry/dead-letter path.

### AGG-C5-06 — Auth rate-limit cleanup can drift if DB reset fails
- **Severity / confidence:** Medium / High
- **Sources:** debugger #3.
- **Citations:** auth/rate-limit cleanup path in `apps/web/src/app/actions/auth.ts`; `apps/web/src/lib/auth-rate-limit.ts`.
- **Problem:** In-memory auth limiter cleanup mutates local state before the DB reset succeeds.
- **Failure scenario:** Runtime memory and persisted rate-limit state diverge after reset failure.
- **Fix:** Mutate in-memory state only after durable reset succeeds or add rollback semantics.

### AGG-C5-07 — Tag slug normalization is host-locale-sensitive
- **Severity / confidence:** Medium / High
- **Sources:** debugger #4.
- **Citations:** `apps/web/src/lib/tag-slugs.ts`; tag creation/search call sites.
- **Problem:** Locale-sensitive normalization can produce different slugs across hosts/browsers.
- **Failure scenario:** Tag identity drifts between environments for Turkish/CJK/Unicode edge cases.
- **Fix:** Use locale-independent casing/normalization and add Unicode regression tests.

### AGG-C5-08 — Process-local coordination is a hard runtime boundary but only documented
- **Severity / confidence:** High / High
- **Sources:** critic #1; architect #1; perf-reviewer PERF-11; tracer restore/process-local finding.
- **Citations:** `README.md:145`; `apps/web/src/lib/restore-maintenance.ts`; `apps/web/src/lib/upload-tracker-state.ts`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/data.ts` shared-group counters.
- **Problem:** Restore maintenance, upload quota claims, image queue state, and buffered view counts are process-local despite operational risk.
- **Failure scenario:** Rolling deploy/accidental scale-out accepts writes during restore, bypasses upload quotas, loses counters, or duplicates processing.
- **Fix:** Enforce singleton runtime at startup/deploy or move these states into shared coordination.

### AGG-C5-09 — Upload disk-space precheck can be bypassed when upload root is absent or `statfs` fails
- **Severity / confidence:** Medium / High
- **Sources:** tracer.
- **Citations:** upload disk precheck in `apps/web/src/app/actions/images.ts` / upload path helpers.
- **Problem:** Failure to inspect disk capacity may allow upload attempts to proceed when capacity is unknown.
- **Failure scenario:** An operator with missing/broken data volume hits disk-full errors mid-upload/processing.
- **Fix:** Fail closed or surface a blocking admin error when capacity cannot be checked.

### AGG-C5-10 — DB backup/restore does not cover uploaded image assets or reconcile files
- **Severity / confidence:** Medium / High
- **Sources:** tracer.
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts`; `apps/web/public/uploads`; private upload store.
- **Problem:** Database dumps exclude uploaded originals/derivatives and restore does not reconcile rows with filesystem assets.
- **Failure scenario:** Restored DB references missing images, or old files remain orphaned after restore.
- **Fix:** Document scope clearly or add asset backup/restore/reconciliation workflow.

### AGG-C5-11 — File-serving/backup download has local filesystem TOCTOU gaps
- **Severity / confidence:** Low / Medium
- **Sources:** tracer.
- **Citations:** `apps/web/src/lib/serve-upload.ts`; `apps/web/src/app/api/admin/db/download/route.ts`.
- **Problem:** Validation and stream-open are separated on mutable local files.
- **Failure scenario:** A local attacker or compromised process swaps a file between checks.
- **Fix:** Use safer open-after-lstat/fd streaming patterns where practical.

### AGG-C5-12 — Photo download serves a generated JPEG derivative, not the original
- **Severity / confidence:** Medium / High
- **Sources:** critic #2.
- **Citations:** `apps/web/src/components/photo-viewer.tsx`; download labels/messages.
- **Problem:** User-visible download behavior can imply original file download while serving the largest derivative.
- **Failure scenario:** Users believe they exported originals but receive recompressed/converted images.
- **Fix:** Rename/copy to “download JPEG” everywhere or add authenticated original download.

### AGG-C5-13 — CSV export materializes large datasets instead of streaming
- **Severity / confidence:** Medium / High
- **Sources:** critic #3; perf-reviewer PERF-09.
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts`; CSV export client code.
- **Problem:** Server rows, CSV lines, final string, and client Blob are all held in memory.
- **Failure scenario:** Large exports cause high memory usage or request failure.
- **Fix:** Move to paged/streaming export or lower explicit caps with user messaging.

### AGG-C5-14 — DB backup/restore is embedded in the web request path and depends on host binaries
- **Severity / confidence:** Medium / High
- **Sources:** critic #4; architect #6.
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:102-469`; `apps/web/Dockerfile:10-16`; `apps/web/docker-compose.yml`; host README.
- **Problem:** Admin backup/restore relies on `mysql`/`mysqldump` availability and runs heavy operations inside the web tier.
- **Failure scenario:** Non-container/host deployments fail at runtime or backup/restore contends with live traffic.
- **Fix:** Document the host requirement, preflight binaries, or move to dedicated ops jobs.

### AGG-C5-15 — Shared-group pages duplicate expensive DB work
- **Severity / confidence:** Medium / High
- **Sources:** critic #5.
- **Citations:** shared-group page metadata/rendering loaders in `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`; `apps/web/src/lib/data.ts`.
- **Problem:** Metadata and page rendering call a cached loader with different argument shapes, defeating request-level dedupe.
- **Failure scenario:** Shared-group visits perform duplicate expensive queries.
- **Fix:** Normalize loader args or split shared metadata/page data fetches.

### AGG-C5-16 — Public gallery chrome collapses with DB-backed page data failures
- **Severity / confidence:** High / Medium
- **Sources:** designer UX-C5-01.
- **Citations:** public route/page data loading and shell components.
- **Problem:** Header/footer/chrome are too tightly coupled to DB-backed content and can show only a generic error shell.
- **Failure scenario:** A transient DB issue removes navigational recovery context from public users.
- **Fix:** Decouple static chrome from dynamic DB data and improve route error boundaries.

### AGG-C5-17 — Admin pages mostly lack route-specific metadata
- **Severity / confidence:** Medium / High
- **Sources:** designer UX-C5-02.
- **Citations:** admin pages under `apps/web/src/app/[locale]/admin/(protected)/**/page.tsx`.
- **Problem:** Browser tabs/bookmarks are indistinguishable across admin sections.
- **Failure scenario:** Admins working across multiple tabs misidentify destructive surfaces.
- **Fix:** Export localized route metadata per admin page.

### AGG-C5-18 — Localized footer leaks English copy
- **Severity / confidence:** Low / High
- **Sources:** designer UX-C5-03.
- **Citations:** `apps/web/src/components/footer.tsx`; `apps/web/src/site-config.json`; message files.
- **Problem:** Footer text is global English config even on Korean pages.
- **Failure scenario:** Non-English pages show mixed-language chrome.
- **Fix:** Move footer copy to localized messages or store per-locale config.

### AGG-C5-19 — Admin login visible labels are hidden behind placeholders
- **Severity / confidence:** Low / High
- **Sources:** designer UX-C5-04.
- **Citations:** admin login form component/page.
- **Problem:** Form fields rely visually on placeholders rather than persistent labels.
- **Failure scenario:** Autofill or typing removes the only visible prompt.
- **Fix:** Render visible labels while preserving accessible names.

### AGG-C5-20 — Production builds can ship localhost canonical/OG/sitemap URLs
- **Severity / confidence:** High / High
- **Sources:** product-marketer-reviewer PMR5-01.
- **Citations:** `apps/web/src/site-config.example.json`; `apps/web/src/site-config.json`; `apps/web/scripts/ensure-site-config.mjs`; metadata/sitemap routes.
- **Problem:** Committed default config can be accepted as production-valid.
- **Failure scenario:** Production SEO/social links point to localhost.
- **Fix:** Fail production build if canonical URL remains localhost/example placeholder.

### AGG-C5-21 — Add Admin dialog understates root-admin powers
- **Severity / confidence:** High / High
- **Sources:** product-marketer-reviewer PMR5-02.
- **Citations:** `apps/web/src/components/admin-user-manager.tsx`; admin messages.
- **Problem:** Copy does not warn that every admin has full root-equivalent powers.
- **Failure scenario:** Operator creates an account expecting scoped privileges.
- **Fix:** Update dialog/help copy before account creation.

### AGG-C5-22 — GPS privacy switch remains interactive after server-side lock
- **Severity / confidence:** Medium / High
- **Sources:** product-marketer-reviewer PMR5-03.
- **Citations:** admin settings UI/server settings action.
- **Problem:** UI suggests a setting can be changed after images exist although server rejects it.
- **Failure scenario:** Admin thinks privacy setting changed but it did not persist.
- **Fix:** Disable/annotate the control once locked and verify persisted state.

### AGG-C5-23 — Photo metadata can emit blank-author snippets/JSON-LD
- **Severity / confidence:** Medium / High
- **Sources:** product-marketer-reviewer PMR5-04.
- **Citations:** photo metadata/JSON-LD generation; site config example.
- **Problem:** Example/blank author config can leak empty author structures.
- **Failure scenario:** SEO/social structured data quality degrades.
- **Fix:** Omit author fields when blank and add tests.

### AGG-C5-24 — Global free-text OG locale is emitted on every localized page
- **Severity / confidence:** Medium / High
- **Sources:** product-marketer-reviewer PMR5-05.
- **Citations:** metadata generation; site config locale field; localized routes.
- **Problem:** One OG locale value cannot be correct for both English and Korean pages.
- **Failure scenario:** Social previews label the wrong locale.
- **Fix:** Derive OG locale from route locale or support per-locale config.

### AGG-C5-25 — Upload copy hides the 200 MB per-file cap
- **Severity / confidence:** Low / High
- **Sources:** product-marketer-reviewer PMR5-06.
- **Citations:** upload UI/messages; upload limit constants.
- **Problem:** UI emphasizes 2 GiB window but not the hard per-file limit.
- **Failure scenario:** User selects an oversized file and learns only after failure.
- **Fix:** Add per-file cap to upload helper copy.

### AGG-C5-26 — `parent_url` is documented/shipped but unused
- **Severity / confidence:** Low / High
- **Sources:** product-marketer-reviewer PMR5-07.
- **Citations:** site config docs/example; repo search for `parent_url`.
- **Problem:** Config promises a customization that implementation ignores.
- **Failure scenario:** Operators set it and expect navigation/SEO behavior that never happens.
- **Fix:** Remove/deprecate the field or implement its use.

### AGG-C5-27 — Nginx sample conflicts with documented deployment
- **Severity / confidence:** Medium / High
- **Sources:** product-marketer-reviewer PMR5-08.
- **Citations:** `apps/web/nginx/default.conf`; README deployment docs.
- **Problem:** Sample includes real demo domain/container-root assumptions that conflict with host-nginx instructions.
- **Failure scenario:** Operators copy a misleading config and misroute/cache uploads.
- **Fix:** Generalize sample and align paths/domain with docs.

### AGG-C5-28 — `IMAGE_BASE_URL` docs omit parser/build constraints
- **Severity / confidence:** Low / High
- **Sources:** document-specialist WDS-01.
- **Citations:** README/env docs; `apps/web/next.config.ts` image remote pattern parsing.
- **Problem:** Docs omit that query strings, hashes, and credentials are rejected.
- **Failure scenario:** Operator sets an unsupported URL and gets build/runtime surprise.
- **Fix:** Document accepted URL shape.

### AGG-C5-29 — Same-origin docs omit fail-closed behavior when Origin/Referer are absent
- **Severity / confidence:** Low / High
- **Sources:** document-specialist WDS-03.
- **Citations:** `apps/web/src/lib/request-origin.ts`; README/CLAUDE same-origin docs.
- **Problem:** Docs do not explain deliberate fail-closed behavior.
- **Failure scenario:** Integrators misdiagnose rejected requests from clients that strip both headers.
- **Fix:** Add operator/developer doc note.

### AGG-C5-30 — Public pages disable ISR, forcing hot SSR/DB work
- **Severity / confidence:** High / High
- **Sources:** perf-reviewer PERF-01.
- **Citations:** public route dynamic/revalidate settings; data loaders.
- **Problem:** Hot public hits rerun SSR and DB work.
- **Failure scenario:** Gallery traffic scales linearly with DB load.
- **Fix:** Revisit caching strategy or document deliberate dynamic behavior with a capacity plan.

### AGG-C5-31 — Listing pagination uses OFFSET and `COUNT(*) OVER()`
- **Severity / confidence:** High / High
- **Sources:** perf-reviewer PERF-02.
- **Citations:** `apps/web/src/lib/data.ts` listing queries.
- **Problem:** Large galleries force scans/sorts for each page.
- **Failure scenario:** Infinite scroll becomes slow at high offsets.
- **Fix:** Introduce keyset pagination and cheaper total-count strategy.

### AGG-C5-32 — Public search is leading-wildcard SQL, not full-text/indexed search
- **Severity / confidence:** High / High
- **Sources:** perf-reviewer PERF-03; architect #2.
- **Citations:** `apps/web/src/components/search.tsx`; `apps/web/src/app/actions/public.ts`; `apps/web/src/lib/data.ts:744-820`; `apps/web/src/db/schema.ts`.
- **Problem:** Debounced live search runs unindexed wildcard scans plus tag/alias fallbacks.
- **Failure scenario:** Search latency and DB CPU spike as gallery size grows.
- **Fix:** Full-text/search table or explicit submit/prefix-limited search.

### AGG-C5-33 — Photo prev/next navigation index omits `id`
- **Severity / confidence:** Medium / High
- **Sources:** perf-reviewer PERF-04.
- **Citations:** `apps/web/src/lib/data.ts`; `apps/web/src/db/schema.ts` indexes.
- **Problem:** Prev/next sort/filter can filesort/range-scan because tie-breaker `id` is not included.
- **Failure scenario:** Photo navigation slows on large timestamp ties.
- **Fix:** Add composite index including `id` after migration planning.

### AGG-C5-34 — Batch delete can launch many full directory scans concurrently
- **Severity / confidence:** High / High
- **Sources:** perf-reviewer PERF-05.
- **Citations:** batch delete implementation and file cleanup helpers.
- **Problem:** Large deletes can fan out expensive scans.
- **Failure scenario:** Admin delete operation saturates I/O.
- **Fix:** Bound concurrency and/or compute exact files to delete.

### AGG-C5-35 — Image processing can oversubscribe CPU/memory
- **Severity / confidence:** High / High
- **Sources:** perf-reviewer PERF-06.
- **Citations:** `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/process-image.ts`; Sharp concurrency/env docs.
- **Problem:** Queue concurrency and per-job variant processing can exceed host capacity.
- **Failure scenario:** Upload bursts cause CPU/memory pressure or OOM.
- **Fix:** Cap effective concurrency based on CPU/memory and document tuning.

### AGG-C5-36 — Upload transport uses Server Actions with large body budgets and concurrent per-file requests
- **Severity / confidence:** Medium / High
- **Sources:** perf-reviewer PERF-07.
- **Citations:** upload UI/server action path; Next config body size.
- **Problem:** Large uploads stress Server Action request handling.
- **Failure scenario:** Many large files contend with normal app requests.
- **Fix:** Dedicated upload API/streaming path or explicit concurrency limits.

### AGG-C5-37 — Upload selection UI can decode/render too many previews and tag inputs
- **Severity / confidence:** Medium / High
- **Sources:** perf-reviewer PERF-08.
- **Citations:** `apps/web/src/components/upload-dropzone.tsx`; `TagInput` usage.
- **Problem:** Many selected files trigger many previews/components.
- **Failure scenario:** Browser becomes unresponsive before upload.
- **Fix:** Virtualize/cap previews and lazy-render heavy controls.

### AGG-C5-38 — Pre-generated upload derivatives still go through Next Image optimization
- **Severity / confidence:** Medium / High
- **Sources:** perf-reviewer PERF-10.
- **Citations:** public image rendering components/routes.
- **Problem:** Already optimized derivatives can be re-optimized by Next Image.
- **Failure scenario:** Unnecessary CPU/cache pressure.
- **Fix:** Use unoptimized/static serving where appropriate.

### AGG-C5-39 — Storage abstraction is dormant and not the real pipeline
- **Severity / confidence:** Medium / High
- **Sources:** architect #4.
- **Citations:** `apps/web/src/lib/storage/index.ts`; `apps/web/src/lib/process-image.ts`; `apps/web/src/lib/serve-upload.ts`; `apps/web/src/lib/upload-paths.ts`.
- **Problem:** Future storage work can partially land through abstraction while live paths bypass it.
- **Failure scenario:** Split-brain local/object storage behavior.
- **Fix:** Remove dormant abstraction or route all storage operations through it.

### AGG-C5-40 — Retention jobs are coupled to image-queue bootstrap
- **Severity / confidence:** Medium / High
- **Sources:** architect #5.
- **Citations:** `apps/web/src/instrumentation.ts`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/audit.ts`; `apps/web/src/lib/rate-limit.ts`.
- **Problem:** Auth/rate-limit/audit retention depends on image queue lifecycle.
- **Failure scenario:** If queue bootstrap is disabled/fails, unrelated cleanup stops.
- **Fix:** Extract maintenance runner/job.

### AGG-C5-41 — Share-link/group flows lack direct regression tests
- **Severity / confidence:** High / High
- **Sources:** test-engineer #1.
- **Citations:** `apps/web/src/app/actions/sharing.ts`; related e2e/unit tests.
- **Problem:** Creation/revocation/group flows are under-tested.
- **Failure scenario:** Sharing regressions ship unnoticed.
- **Fix:** Add direct unit/e2e coverage for critical flows.

### AGG-C5-42 — Locale/admin middleware and request CSP behavior are under-tested
- **Severity / confidence:** High / High
- **Sources:** test-engineer #2.
- **Citations:** `apps/web/src/proxy.ts`; CSP/request-origin tests.
- **Problem:** Middleware/CSP integration lacks regression coverage.
- **Failure scenario:** Auth redirects or CSP headers regress without a failing test.
- **Fix:** Add targeted integration/e2e coverage.

### AGG-C5-43 — Upload tracker global state lacks contract tests
- **Severity / confidence:** Medium / High
- **Sources:** test-engineer #3.
- **Citations:** `apps/web/src/lib/upload-tracker-state.ts`; `apps/web/src/app/actions/images.ts`.
- **Problem:** Process-local quota lock behavior is not directly locked by tests.
- **Failure scenario:** Future changes break rollback/cleanup semantics.
- **Fix:** Add direct tests for reserve/commit/rollback/reset behavior.

### AGG-C5-44 — Visual-check tests do not assert visual correctness
- **Severity / confidence:** Medium / High
- **Sources:** test-engineer #4.
- **Citations:** `apps/web/e2e/nav-visual-check.spec.ts`.
- **Problem:** Tests capture state but do not compare or assert meaningful visual invariants.
- **Failure scenario:** Visual regressions pass.
- **Fix:** Add explicit DOM/ARIA/layout assertions or image diff threshold.

### AGG-C5-45 — Settings E2E verifies optimistic toggle, not persisted behavior
- **Severity / confidence:** Medium / High
- **Sources:** test-engineer #5.
- **Citations:** `apps/web/e2e/admin.spec.ts`; settings UI/server action.
- **Problem:** The E2E can pass before persistence/server rejection is verified.
- **Failure scenario:** Locked GPS setting or failed save appears successful.
- **Fix:** Assert persisted/reloaded state and server feedback.

### AGG-C5-46 — Some regression tests assert source text, not runtime behavior
- **Severity / confidence:** Medium / High
- **Sources:** test-engineer #6.
- **Citations:** source-text regression tests in `apps/web/src/__tests__`.
- **Problem:** Tests can pass while behavior regresses.
- **Failure scenario:** Refactors preserve strings but break runtime behavior.
- **Fix:** Replace with behavioral tests where feasible.

### AGG-C5-47 — Client pagination/filter state transitions are under-tested
- **Severity / confidence:** Medium / High
- **Sources:** test-engineer #7.
- **Citations:** `apps/web/src/components/home-client.tsx`, `load-more.tsx`, filters/search tests.
- **Problem:** UI state transitions are not exercised.
- **Failure scenario:** Infinite scroll/search/filter bugs ship.
- **Fix:** Add component tests for transitions and reset behavior.

### AGG-C5-48 — Startup/shutdown runtime wiring is under-tested
- **Severity / confidence:** Medium / High
- **Sources:** test-engineer #8.
- **Citations:** `apps/web/src/instrumentation.ts`; queue shutdown/bootstrap tests.
- **Problem:** Runtime boot hooks are not comprehensively validated.
- **Failure scenario:** Production startup/shutdown regressions pass unit tests.
- **Fix:** Add targeted tests around bootstrap guards and cleanup registration.

### AGG-C5-49 — Keyboard focus on zoomable photo has no visible indicator
- **Severity / confidence:** High / High
- **Sources:** ui-ux-designer-reviewer UX-C5-01.
- **Citations:** `apps/web/src/components/photo-viewer.tsx`; focusable zoom control selector.
- **Problem:** Keyboard users can focus the zoomable photo without visible focus.
- **Failure scenario:** Keyboard navigation context is lost.
- **Fix:** Add visible focus ring/styles and test selectors.

### AGG-C5-50 — Upload progress is visual-only
- **Severity / confidence:** Medium / High
- **Sources:** ui-ux-designer-reviewer UX-C5-02.
- **Citations:** `apps/web/src/components/upload-dropzone.tsx`.
- **Problem:** Progress is not exposed as a semantic progressbar/live status.
- **Failure scenario:** Assistive-tech users cannot track upload progress.
- **Fix:** Add `role="progressbar"`/ARIA values or live text.

### AGG-C5-51 — Database page uses one pending state for backup, restore, and CSV export
- **Severity / confidence:** Medium / High
- **Sources:** ui-ux-designer-reviewer UX-C5-03.
- **Citations:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` or DB client component.
- **Problem:** Multiple actions share one disabled/loading state.
- **Failure scenario:** Admin cannot tell which destructive/export action is running.
- **Fix:** Split pending state per action.

### AGG-C5-52 — Category alias input is unlabeled
- **Severity / confidence:** Medium / High
- **Sources:** ui-ux-designer-reviewer UX-C5-04.
- **Citations:** categories/topic manager component.
- **Problem:** Alias input lacks accessible label.
- **Failure scenario:** Screen-reader users cannot identify the field.
- **Fix:** Add visible or `sr-only` label tied to input.

### AGG-C5-53 — Collapsed mobile info sheet can leave off-screen controls in tab order
- **Severity / confidence:** Medium / Medium
- **Sources:** ui-ux-designer-reviewer UX-C5-05.
- **Citations:** `apps/web/src/components/info-bottom-sheet.tsx`.
- **Problem:** Hidden controls may remain keyboard-reachable.
- **Failure scenario:** Focus moves off-screen on mobile.
- **Fix:** Apply inert/tabIndex management when collapsed.

### AGG-C5-54 — Lightbox alt text falls back to raw filenames
- **Severity / confidence:** Medium / High
- **Sources:** ui-ux-designer-reviewer UX-C5-06.
- **Citations:** `apps/web/src/components/lightbox.tsx`.
- **Problem:** Raw filenames are exposed as image alternatives.
- **Failure scenario:** Assistive-tech users hear UUID/original filenames instead of meaningful descriptions.
- **Fix:** Prefer title/description/date and use empty alt for decorative fallback.

### AGG-C5-55 — Admin action columns have empty header text
- **Severity / confidence:** Low-medium / High
- **Sources:** ui-ux-designer-reviewer UX-C5-07.
- **Citations:** admin tables in image/user/category managers.
- **Problem:** Action columns have blank headers.
- **Failure scenario:** Screen-reader/table navigation loses context.
- **Fix:** Add `sr-only` action headers.

### AGG-C5-56 — Public shortcut hint contradicts lightbox keyboard behavior
- **Severity / confidence:** Low-medium / High
- **Sources:** ui-ux-designer-reviewer UX-C5-08.
- **Citations:** public photo viewer/lightbox shortcut hints.
- **Problem:** UI says one shortcut behavior but lightbox handles another.
- **Failure scenario:** Keyboard users get misleading instructions.
- **Fix:** Align copy with implementation or implementation with copy.

### AGG-C5-57 — Admin nav links are small touch targets
- **Severity / confidence:** Low-medium / Medium
- **Sources:** ui-ux-designer-reviewer UX-C5-09.
- **Citations:** `apps/web/src/components/admin-nav.tsx`.
- **Problem:** Text links may not meet comfortable touch target size.
- **Failure scenario:** Mobile admins mis-tap navigation.
- **Fix:** Increase padding/min-height.

### AGG-C5-58 — Future RTL support is blocked by hard-coded `dir="ltr"`
- **Severity / confidence:** Low / High
- **Sources:** ui-ux-designer-reviewer UX-C5-10.
- **Citations:** app/layout HTML `dir` setting.
- **Problem:** Direction is not locale-aware.
- **Failure scenario:** Future RTL locales render incorrectly.
- **Fix:** Derive `dir` from locale metadata if/when RTL is supported.

### AGG-C5-59 — Photo swipe navigation is registered globally on `window`
- **Severity / confidence:** Medium / Medium
- **Sources:** ui-ux-designer-reviewer UX-C5-11.
- **Citations:** `apps/web/src/components/photo-viewer.tsx`.
- **Problem:** Global swipe listeners can affect gestures outside the intended image area.
- **Failure scenario:** Page scroll or UI controls trigger navigation unexpectedly.
- **Fix:** Scope listeners to the photo/lightbox region.

### AGG-C5-60 — Upload-dropzone limit warning is emitted from a functional state updater
- **Severity / confidence:** Low / High
- **Sources:** debugger #5.
- **Citations:** `apps/web/src/components/upload-dropzone.tsx`.
- **Problem:** Toast/side-effect is emitted inside a state updater.
- **Failure scenario:** React may re-run updater logic and duplicate warnings.
- **Fix:** Move side-effect outside the updater.
