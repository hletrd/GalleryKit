# Cycle 22 Aggregate Review

Date: 2026-07-08 KST  
Cycle: 22/100  
Start HEAD: `8b795862079b0e5318242a09390b4cdff1dc2058`  
Review artifacts: `code-reviewer.md`, `critic.md`, `perf-reviewer.md`, `debugger.md`, `security-reviewer.md`, `tracer.md`, `verifier.md`, `test-engineer.md`, `architect.md`, `document-specialist.md`, `designer.md`, `ui-ux-designer-reviewer.md`, `product-marketer-reviewer.md`

## Agent Coverage

Native callable agent capacity allowed five concurrent lanes plus one retry after a slot freed. The minimum named reviewer roles were covered through composite lanes, and the two local reviewer-style prompts were adapted to GalleryKit.

- `code-reviewer` and `critic`: completed.
- `perf-reviewer` and `debugger`: completed.
- `security-reviewer` and `tracer`: completed.
- `verifier` and `test-engineer`: completed.
- `architect` and `document-specialist`: completed.
- `designer`, `ui-ux-designer-reviewer`, and `product-marketer-reviewer`: completed with agent-browser evidence against local `next start` on port 3100.

## AGENT FAILURES

None. The first designer/product spawn hit the active agent limit and was retried successfully after closing a completed lane.

## Deduped Findings

### AGG-C22-01 - Positive mutation-slot guard shape can pass while later mutations run outside the acquired branch

- Severity / confidence: High / High
- Status: Confirmed correctness/security lint defect
- Reported by: verifier, test-engineer
- Citations: `apps/web/scripts/check-action-origin.ts:641-650`, `apps/web/scripts/check-action-origin.ts:664-708`, `apps/web/src/__tests__/check-action-origin.test.ts:640-655`, `apps/web/src/app/actions/auth.ts:290-302`
- Problem: Cycle 21 hardened the negative early-return mutation barrier shape, but the accepted positive shape only checks that `if (mutationSlot.acquired)` appears after `using`. It does not prove later mutations are lexically inside that branch.
- Failure scenario: a future server action logs or no-ops inside `if (slot.acquired) {}` and performs `await db.update(...)` afterward. `lint:action-origin` stays green while restore maintenance can be bypassed.
- Suggested fix: add a failing fixture for positive guard followed by an external mutation, then either require all protected writes after `using` to be inside the acquired branch or disallow the positive shape except for explicit exemptions.

### AGG-C22-02 - `pending_file_deletions` records failures but no later drain retries them

- Severity / confidence: High / High
- Status: Confirmed data-retention/privacy bug
- Reported by: code-reviewer, critic, debugger, security-reviewer, tracer, verifier, test-engineer, architect, document-specialist
- Citations: `apps/web/src/db/schema.ts:134-152`, `apps/web/src/app/actions/images.ts:677-727`, `apps/web/src/app/actions/images.ts:808-907`, `apps/web/src/lib/pending-file-deletions.ts:70-90`, `apps/web/src/lib/maintenance-scheduler.ts:34-45`, `apps/web/src/__tests__/pending-file-deletions-source.test.ts:39-45`, `.context/plans/cycle-21-2026-07-08-plan.md:55-68`
- Problem: Cycle 21 made delete cleanup failures durable, but `cleanupPendingFileDeletion()` is only called by the same delete request that just failed. Startup, hourly maintenance, restore recovery, admin UI, and scripts never select old rows for retry.
- Failure scenario: an admin deletes a photo during transient NAS/permission/ENOSPC failure. The DB row disappears and the admin sees success plus a warning, but originals or public derivatives can remain indefinitely by direct URL until ad hoc manual cleanup.
- Suggested fix: add a bounded restore-aware drain for oldest `pending_file_deletions` rows, with tests for transient failure then success, missing-file idempotency, repeated failure retention, and restore-maintenance suppression.

### AGG-C22-03 - Restored pending deletion rows are preserved but not recovered after DB restore

- Severity / confidence: Medium / High
- Status: Confirmed restore-state risk
- Reported by: architect, tracer
- Citations: `apps/web/src/lib/sql-restore-scan.ts:12-32`, `apps/web/src/app/[locale]/admin/db-actions.ts:593-670`, `apps/web/src/lib/maintenance-scheduler.ts:34-45`
- Problem: app SQL backups include `pending_file_deletions`, but restore completion does not drain or surface those restored rows.
- Failure scenario: a DB restore reintroduces cleanup rows describing files that still exist on the host filesystem. Because database restore is row-only, the app preserves dirty cleanup state without acting on it.
- Suggested fix: once AGG-C22-02 adds a drain, schedule or trigger it after successful restore maintenance clears and document whether this recovery is automatic or operator-driven.

### AGG-C22-04 - Cycle 21 release/deploy ledger remains internally stale

- Severity / confidence: Medium / High
- Status: Confirmed docs/provenance drift
- Reported by: critic, verifier, document-specialist
- Citations: `.context/plans/cycle-21-2026-07-08-plan.md:1-6`, `.context/plans/cycle-21-2026-07-08-plan.md:221-253`, `.context/plans/README.md:34-37`, commit `8b795862`
- Problem: the Cycle 21 plan still says commit/push/deploy are pending even though HEAD is pushed and the orchestrator supplied live-smoke deploy success for Cycle 21. The commit body still says production deploy pending.
- Failure scenario: later cycles cannot tell from tracked ledgers whether Cycle 21 is deployed, pending, or superseded, and may mix source-state and production-state assumptions.
- Suggested fix: append terminal evidence to the Cycle 21 plan, mark the stale commit-body wording superseded by tracked ledger evidence, and move Cycle 21 from active to recently completed in the plan index.

### AGG-C22-05 - Browser and PAT upload paths still duplicate the same ingest contract

- Severity / confidence: High / High
- Status: Confirmed recurring architecture risk
- Reported by: code-reviewer, critic, debugger
- Citations: `apps/web/src/app/actions/images.ts:87-227`, `apps/web/src/app/actions/images.ts:325-445`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`, `apps/web/src/app/api/admin/lr/upload/route.ts:254-631`
- Problem: browser uploads and Lightroom/PAT uploads independently implement validation, config snapshot, quota settlement, original save, HDR/GPS gates, metadata insert, queue payload, audit, cleanup, and revalidation.
- Failure scenario: a future upload privacy/color/audit/queue invariant lands in one adapter and not the other, producing divergent stored metadata or derivatives.
- Suggested fix: extract a shared domain ingest service and keep only auth/multipart/response adaptation in the entrypoints; add parity tests for insert values and queue jobs.

### AGG-C22-06 - Large upload and restore ingress still materializes multipart bodies before domain backpressure

- Severity / confidence: High / High for source shape; Medium for live impact
- Status: Confirmed risk needing RSS validation or streaming redesign
- Reported by: code-reviewer, critic, perf-reviewer, debugger
- Citations: `apps/web/src/app/actions/images.ts:87-106`, `apps/web/src/app/api/admin/lr/upload/route.ts:174-188`, `apps/web/src/app/[locale]/admin/db-actions.ts:409-420`, `apps/web/src/app/[locale]/admin/db-actions.ts:717-729`, `apps/web/next.config.ts:111-119`, `apps/web/src/lib/upload-limits.ts:1-35`
- Problem: Server Actions and `request.formData()` parse large multipart bodies before application code can stream, enforce backpressure, or hand off temp files.
- Failure scenario: valid 200-250 MiB uploads/restores can spike RSS or cause long GC/OOM while Sharp, CLIP, SSR, or DB work is active.
- Suggested fix: move large binary ingress to streaming route handlers with pre-parse `Content-Length` gates, per-part caps, temp-file handoff, and a process-wide large-body semaphore.

### AGG-C22-07 - Image queue and admin backfill budget independently against shared DB/CPU headroom

- Severity / confidence: High / High
- Status: Confirmed performance/concurrency risk
- Reported by: code-reviewer, critic, perf-reviewer
- Citations: `apps/web/src/db/index.ts:21-45`, `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:106-143`, `apps/web/src/lib/admin-backfill-runner.ts:716-727`, `apps/web/src/lib/process-image.ts:36-1418`
- Problem: image queue and in-app backfill each reserve live headroom locally, but neither subtracts the other background consumer while both can run under different locks.
- Failure scenario: uploads plus admin re-encode can pin most DB connections and oversubscribe Sharp/libvips, queuing public SSR/search/admin requests behind background work.
- Suggested fix: introduce a shared process-wide background resource budget for image queue, color backfill, semantic bootstrap, and other heavy work.

### AGG-C22-08 - Shared-group cached reader still performs a view-count side effect

- Severity / confidence: Medium / Medium
- Status: Confirmed design risk
- Reported by: code-reviewer, critic, debugger
- Citations: `apps/web/src/lib/data.ts:1392-1407`, `apps/web/src/lib/data.ts:1830-1834`, `apps/web/src/app/actions/public.ts:517-559`
- Problem: `getSharedGroupCached = cache(getSharedGroup)` wraps a reader that can buffer denormalized view counts, while durable analytics are recorded elsewhere.
- Failure scenario: a preload/layout/metadata call with different options can let React request-cache ordering decide whether the denormalized counter increments.
- Suggested fix: split pure cached reading from explicit page/action-layer counter buffering and test that repeated cached reads are side-effect-free.

### AGG-C22-09 - Safety-critical test coverage remains too source-contract-heavy

- Severity / confidence: High / High
- Status: Confirmed test-design risk
- Reported by: critic, debugger, verifier, test-engineer
- Citations: `apps/web/src/__tests__/pending-file-deletions-source.test.ts:25-45`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-180`, `apps/web/src/__tests__/db-restore.test.ts:47-136`, `apps/web/src/__tests__/semantic-scan-limit-source.test.ts:42-77`
- Problem: migration/reconcile, restore child processes, semantic scan caps, stale client response handling, and the new deletion ledger rely heavily on source-string/shape assertions.
- Failure scenario: a refactor preserves expected strings while changing transaction behavior, DB defaults, child-process settlement, or cleanup retry behavior; tests remain green.
- Suggested fix: keep source tripwires as lint-like checks but add executable behavior gates for the highest-risk classes, starting with pending deletion drains and the mutation-barrier scanner fixture from AGG-C22-01.

### AGG-C22-10 - Timeline grouping tests still reimplement `Date` behavior instead of parser-backed grouping

- Severity / confidence: Medium / High
- Status: Confirmed test gap
- Reported by: test-engineer
- Citations: `apps/web/src/__tests__/data-timeline.test.ts:121-204`, `apps/web/src/lib/mysql-datetime.ts:31-69`, `apps/web/src/lib/data-timeline.ts:15`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:18`
- Problem: production no longer depends on `Date.parse`, but some grouping tests still use Date-based helper behavior.
- Failure scenario: a later production refactor regresses to `new Date(...)` while parser unit tests pass and helper tests continue to bless Date semantics.
- Suggested fix: test a pure parser-backed grouping helper with timezone-sensitive fixtures.

### AGG-C22-11 - Browser-flow coverage remains narrow and screenshot artifacts are not deterministic assertions

- Severity / confidence: Medium / High
- Status: Recurring test-risk
- Reported by: test-engineer
- Citations: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:75-80`, `apps/web/e2e/nav-visual-check.spec.ts:40-86`, `apps/web/e2e/hydration-photo-page.spec.ts:20-49`
- Problem: Playwright coverage is single-project Chromium-heavy, visual outputs are mostly artifacts rather than deterministic baselines, and `networkidle` remains a flake-prone readiness proxy.
- Failure scenario: WebKit/mobile touch, Firefox color capability, PWA offline behavior, visual spacing, or hydration readiness regresses while CI stays green or flaky.
- Suggested fix: add a small tagged matrix for mobile WebKit/mobile Chromium/PWA smoke and use deterministic readiness sentinels or screenshot assertions where stable.

### AGG-C22-12 - Public map still scales by shipping and rendering up to 10,000 markers

- Severity / confidence: Medium / High
- Status: Confirmed performance risk
- Reported by: perf-reviewer
- Citations: `apps/web/src/lib/data.ts:1766-1817`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`
- Problem: `/map` queries and serializes all visible map markers, SSR-renders a fallback item for every marker, computes bounds from full arrays, and mounts one Leaflet marker per photo.
- Failure scenario: a GPS-rich gallery near the cap causes slow SSR/hydration and poor mobile interaction.
- Suggested fix: add viewport/clustering or paged marker APIs, and avoid full fallback rendering for huge result sets.

### AGG-C22-13 - Home on-this-day remains a non-sargable month/day scan

- Severity / confidence: Medium / High
- Status: Confirmed performance risk
- Reported by: perf-reviewer
- Citations: `apps/web/src/components/on-this-day-widget.tsx:10-22`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`, `apps/web/src/lib/data-timeline.ts:102-130`, `apps/web/src/db/schema.ts:123-131`
- Problem: the home widget filters with `MONTH(capture_date)` and `DAY(capture_date)`, preventing index seeks.
- Failure scenario: a large dated corpus plus crawler traffic turns a six-photo widget into repeated scans.
- Suggested fix: add generated month/day columns or another indexed lookup strategy in a schema/performance cycle.

### AGG-C22-14 - Public keyword search and smart-collection `contains` predicates still use leading-wildcard scans

- Severity / confidence: Medium / High
- Status: Confirmed performance risk
- Reported by: critic, perf-reviewer
- Citations: `apps/web/src/app/actions/public.ts:248-317`, `apps/web/src/lib/data.ts:1574-1737`, `apps/web/src/lib/smart-collections.ts:221-267`
- Problem: accepted searches and smart-collection contains predicates compile to `%term%` scans across several text fields.
- Failure scenario: common substrings remain inside rate limits but spend DB CPU and compete with SSR/background work.
- Suggested fix: introduce full-text/indexed search strategy or constrain expensive predicates with clearer corpus/performance limits.

### AGG-C22-15 - Semantic and similar-photo routes score vector scans synchronously in request handlers

- Severity / confidence: Low / High
- Status: Confirmed bounded risk
- Reported by: critic, perf-reviewer
- Citations: `apps/web/src/lib/clip-embeddings.ts:36-235`, `apps/web/src/db/schema.ts:292-304`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:178-214`
- Problem: bounded embedding scans still decode and score vectors inside the Node request path.
- Failure scenario: semantic traffic during uploads/backfill consumes CPU/heap/event-loop headroom despite hard scan caps.
- Suggested fix: move scoring to a worker/vector index/cache when semantic production traffic or gallery size warrants it.

### AGG-C22-16 - Public SSR/page limiter remains a host-nginx manual-validation boundary

- Severity / confidence: Medium / Medium
- Status: Manual-validation risk
- Reported by: critic, security-reviewer
- Citations: `apps/web/nginx/default.conf:1-10`, `apps/web/nginx/default.conf:274-295`, `apps/web/deploy.sh:51-55`, `CLAUDE.md:510-522`
- Problem: committed nginx page limiter config is inert until an operator applies/reloads host nginx; deploy does not manage it.
- Failure scenario: live host still running older nginx leaves dynamic public pages outside app-layer route/action limiters.
- Suggested fix: record production `nginx -T`/reload evidence or make deploy manage and validate host config.

### AGG-C22-17 - Client-IP protections depend on exact live proxy topology

- Severity / confidence: Medium / Medium
- Status: Manual-validation risk
- Reported by: security-reviewer, tracer
- Citations: `apps/web/nginx/default.conf:20-28`, `apps/web/nginx/default.conf:59-71`, `apps/web/src/lib/rate-limit.ts:175-216`, `apps/web/src/lib/request-origin.ts:81-107`
- Problem: edge and app rate limits rely on correct `real_ip`, `TRUST_PROXY`, `TRUSTED_PROXY_HOPS`, Host, and Proto behavior.
- Failure scenario: CDN/LB-to-nginx mismatch collapses many visitors into one bucket or destroys audit/rate-limit fidelity.
- Suggested fix: add release evidence for actual request headers, nginx access log client IP, proxy config, and app settings.

### AGG-C22-18 - Multi-instance deployment remains warn-only despite process-local security and coordination state

- Severity / confidence: Medium / Medium
- Status: Accepted topology risk
- Reported by: security-reviewer, tracer
- Citations: `CLAUDE.md:245-247`, `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`
- Problem: the singleton guard warns but does not fail closed, while upload quota, fast rate-limit maps, queue memory, restore state, and backfill status are process-local.
- Failure scenario: a misconfigured second permanent web instance splits abuse controls and coordination state.
- Suggested fix: preserve single-instance as a product invariant; if scale-out is introduced, move state to shared storage or fail closed after a verified non-rolling contention window.

### AGG-C22-19 - Backup confidentiality and DB/file rollback remain operator boundaries

- Severity / confidence: Low / High
- Status: Confirmed residual risk
- Reported by: security-reviewer
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:228-243`, `apps/web/src/app/api/admin/db/download/route.ts:21-89`, `CLAUDE.md:223-228`
- Problem: SQL backups are plaintext at rest and DB restores do not restore private originals, derivatives, or resources.
- Failure scenario: host compromise exposes dumps, or DB restore creates DB/filesystem drift.
- Suggested fix: keep host/storage encryption explicit and pair DB dumps with filesystem snapshots or reconciliation tooling when full rollback is needed.

### AGG-C22-20 - Admin accounts remain password-only

- Severity / confidence: Low / High
- Status: Risk / product decision
- Reported by: security-reviewer
- Citations: `apps/web/src/db/schema.ts:193-200`, `apps/web/src/app/actions/auth.ts:79-150`, `apps/web/src/app/actions/auth.ts:230-253`, `apps/web/src/db/schema.ts:225-241`, `CLAUDE.md` "Permanently Deferred"
- Problem: browser admin login has no TOTP/WebAuthn/passkey step, though PATs are scoped and hashed.
- Failure scenario: a stolen admin password or active session is enough for full admin access until revoked.
- Suggested fix: only if product posture changes, add optional WebAuthn/TOTP. Current repo rule permanently defers 2FA/WebAuthn as not planned for this personal-gallery threat model.

### AGG-C22-21 - Restore drain checklist is a manual registry for future background writers

- Severity / confidence: Low / Medium
- Status: Future-risk
- Reported by: tracer
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:593-635`, `apps/web/src/lib/restore-drain-checklist.ts:10-17`
- Problem: future buffered DB writers or filesystem cleanup workers must remember to register restore drain/suppression policy.
- Failure scenario: a new background writer commits stale state after restore because it was not added to the checklist.
- Suggested fix: keep checklist tests close to every new background writer, or introduce a registry API that requires explicit drain policy declaration.

### AGG-C22-22 - Admin image management remains table-first on narrow screens

- Severity / confidence: Medium / High
- Status: Confirmed UI/UX issue
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-144`, `apps/web/src/components/image-manager.tsx:427-620`
- Problem: recent uploads and image management use nested scroll/table layouts, with thumbnail, metadata, tags, status, and actions spread across a wide row.
- Failure scenario: on tablet or narrow laptop, admins lose row context while scrolling to connect image preview with far-right actions.
- Suggested fix: keep the table for wide desktop but add a responsive card/list workbench below large desktop widths.

### AGG-C22-23 - Admin navigation is a flat ten-link strip with no workflow grouping

- Severity / confidence: Low-Medium / High
- Status: Confirmed IA issue
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-26`
- Problem: routine publishing links and high-risk operational pages are visually equal peers in one wrapping row.
- Failure scenario: on mobile/tablet, content tasks, access controls, and database operations mix in wrap order and require more scanning.
- Suggested fix: group admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights, with a sectioned mobile drawer/menu.

### AGG-C22-24 - Mobile masonry cards permanently overlay metadata on finished photos

- Severity / confidence: Low / High
- Status: Confirmed presentation issue
- Reported by: designer, ui-ux-designer-reviewer
- Citations: `apps/web/src/components/masonry-card.tsx:149-155`
- Problem: mobile cards always render a top gradient metadata overlay, while desktop hides metadata until hover/focus.
- Failure scenario: important crop detail near the top of a phone-gallery image is covered before the visitor opens the photo.
- Suggested fix: move mobile metadata below the image, use a caption band, or add a clean-grid mode while preserving accessible labels.

### AGG-C22-25 - Checked-in Atik `site-config.json` can become a copied install's public brand/canonical

- Severity / confidence: Medium / High
- Status: Confirmed product/distribution risk
- Reported by: product-marketer-reviewer
- Citations: `apps/web/src/site-config.json:2-10`, `README.md:60-77`, `README.md:121-122`, `apps/web/README.md:15-20`, `apps/web/scripts/ensure-site-config.mjs:12-42`, `apps/web/src/app/sitemap.ts:14-18`, `apps/web/src/app/[locale]/layout.tsx:15-26`
- Problem: this production checkout intentionally carries the Atik canonical config, but the same committed defaults can leak if the repo is distributed as a reusable template.
- Failure scenario: a copied install that forgets to edit config can publish `gallery.atik.kr` canonical metadata or branding.
- Suggested fix: before packaging/distribution, switch to a placeholder/example generation flow or hard-fail copied installs until site-config is explicitly replaced.

## Closed / Not Re-Raised

- Cycle 21's negative mutation-barrier order proof is fixed for the `if (!slot.acquired) return` shape; AGG-C22-01 is the remaining positive-guard hole.
- Cycle 21's direct "no durable deletion row" bug is partially fixed; AGG-C22-02 is the missing replay/drain half.
- Permanent-failure marking is centralized through `markPermanentlyFailed`.
- The backfill candidate index exists in schema, migration, and reconcile.
- Timeline/on-this-day production code now uses deterministic MySQL datetime parsing.
- `pending_file_deletions` is included in app backup-table allowlists.
- Map marker accessible names, search modal focus isolation, admin login labels, touch-targets, i18n parity, and DB TLS README wording passed focused checks in review lanes.

## Prompt 2 Requirements

Every finding above must be scheduled for implementation or explicitly recorded in the plan directory as deferred with preserved severity/confidence, citation, reason, and exit criterion. Security, correctness, and data-loss findings are not deferrable unless a repo rule explicitly permits it and the rule is quoted.
