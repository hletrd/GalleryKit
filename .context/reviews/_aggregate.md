# Cycle 32 Aggregate Review

Reviewed HEAD at fan-out start: `3d174c96` (two review-artifact commits landed during fan-out: `7143d826`, `8849f5b1`).
Date: 2026-06-30 KST

## Agent Coverage

Completed review artifacts:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/verifier.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/architect.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/designer.md`
- `.context/reviews/ui-ux-designer-reviewer.md`
- `.context/reviews/product-marketer-reviewer.md`

Agent failures: none. Two subagents committed/pushed review artifacts despite Prompt 1 being review-only; history was preserved and this aggregate accounts for those commits.

## High Signal Findings

### AGG32-01 - Aborted queued CLIP request can leak an inference slot

Severity: High
Confidence: High
Sources: perf-reviewer

Citations: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-170`, `apps/web/src/app/api/search/semantic/route.ts:247-260`, `apps/web/src/components/search.tsx:184-193`.

`releaseInferenceSlot()` reserves an active slot while handing it to a queued waiter. If that waiter aborts after the handoff but before `withInferenceSlot()` enters its `try/finally`, the reserved slot is never released. With concurrency 1, production semantic search and image embedding can stall until restart.

Fix: make slot acquisition release-safe for abort-after-handoff and add a behavioral regression test.

### AGG32-02 - Bulk edit can silently ignore invalid tag mutations while reporting success

Severity: Medium
Confidence: High
Sources: critic

Citations: `apps/web/src/components/bulk-edit-dialog.tsx:112-153`, `apps/web/src/app/actions/images.ts:995-1003`, `apps/web/src/app/actions/images.ts:1132-1155`, `apps/web/src/app/actions/images.ts:1169-1184`, `apps/web/src/__tests__/bulk-update-images.test.ts:202-278`.

`bulkUpdateImages()` skips invalid add/remove tag names with `continue`, then can still return success and audit the requested tag names. Operators can believe a batch tag correction applied when the server ignored it.

Fix: validate all add/remove tag candidates before transaction start and fail the batch on any rejected tag; add mixed valid/invalid tests.

### AGG32-03 - Lightbox color pip exposes admin-only transfer metadata outside the `isAdmin` gate

Severity: Medium
Confidence: High
Sources: verifier

Citations: `apps/web/src/components/lightbox-color-pip.tsx:44-84`, `apps/web/src/components/lightbox-color-pip.tsx:161-185`, `apps/web/src/__tests__/lightbox-color-pip-hdr.test.ts:208-220`.

The public canonical data path omits `transfer_function`, but the component computes and renders it in collapsed text/aria labels whenever an admin-shaped image is passed with `isAdmin={false}`. This violates the component's own privacy boundary.

Fix: gate collapsed transfer text and aria label on `isAdmin`; add a regression test with admin-shaped data rendered as non-admin.

### AGG32-04 - Atom feed conditional 304 ignores feed-shaping SEO settings

Severity: Medium
Confidence: High
Sources: tracer

Citations: `apps/web/src/app/feed.xml/route.ts:29-44`, `apps/web/src/app/feed.xml/route.ts:46-141`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50-72`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:74-153`, `apps/web/src/app/actions/seo.ts:136-157`.

The feed routes return 304 based only on image freshness before loading SEO/feed settings. Changing feed title, author, rights, or related SEO copy can leave feed readers with stale metadata until an image changes.

Fix: include feed-shaping settings freshness/revision in the feed validator or remove early 304 for settings-dependent feeds; add tests for SEO changes plus conditional requests.

### AGG32-05 - Load-more sentinel can repeat server actions indefinitely on transient failures

Severity: Medium
Confidence: High
Sources: debugger

Citations: `apps/web/src/components/load-more.tsx:41-50`, `apps/web/src/components/load-more.tsx:72-95`, `apps/web/src/components/load-more.tsx:122-132`, `apps/web/src/app/actions/public.ts:24-27`.

Transient `maintenance`, `rateLimited`, and `error` results keep `hasMore: true`; the observed sentinel remains mounted and can immediately call the server action again after `loadingRef` clears.

Fix: add a retry/cooldown gate or explicit retry affordance for non-ok transient responses; add a component/source test.

### AGG32-06 - Lightbox auto-hide removes essential modal controls from AT/keyboard

Severity: Medium
Confidence: High
Sources: designer, ui-ux-designer-reviewer

Citations: `apps/web/src/components/lightbox.tsx:270`, `apps/web/src/components/lightbox.tsx:371-373`, `apps/web/src/components/lightbox.tsx:546-687`.

After idle, lightbox controls receive `tabIndex=-1` and `aria-hidden=true`. Browser evidence showed the dialog accessibility tree reduced to the image, removing close/navigation discoverability for screen-reader, switch-control, and voice-control users.

Fix: keep essential controls accessible while visually faded, or add a persistent accessible command group.

### AGG32-07 - Dependabot watches `/apps/web` instead of the root workspace lockfile

Severity: Medium
Confidence: High
Sources: architect

Citations: `.github/dependabot.yml:1-18`, `package.json:1-10`, `package-lock.json:1-14`.

The canonical npm lockfile and root overrides live at repository root, but Dependabot is configured for `/apps/web`. Dependency automation can miss the actual workspace dependency graph.

Fix: point the npm Dependabot entry at `/`, or add root coverage while preserving any app-specific entry that is proven useful.

### AGG32-08 - Listing helpers can request 102 rows despite a documented 100-row visible cap

Severity: Low
Confidence: High
Sources: code-reviewer

Citations: `apps/web/src/lib/data.ts:664-670`, `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1437-1480`, `apps/web/src/app/actions/public.ts:121-157`.

Helpers clamp page size to `LISTING_QUERY_LIMIT_PLUS_ONE`, then add one more lookahead. Public callers clamp to 100 today, but the exported helper contract can exceed its intended cap.

Fix: clamp visible page size to `LISTING_QUERY_LIMIT`, keep one-row lookahead, add a source/behavior test.

## Additional Findings And Risks

### Performance and Scale

- AGG32-09: Initial dynamic gallery pages use grouped `COUNT(*) OVER()` over all matching rows before limit. Severity Medium, confidence High. Source: perf-reviewer. Citations: `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1466-1481`.
- AGG32-10: Semantic/similar search scans newest embeddings only; relevant older photos beyond `SEMANTIC_SCAN_LIMIT` are unsearchable. Severity Medium, confidence High. Sources: architect, debugger. Citations: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`.
- AGG32-11: Timeline and On This Day predicates use `YEAR()`, `MONTH()`, and `DAY()` functions on `capture_date`, limiting index use. Severity Low, confidence High. Source: perf-reviewer. Citations: `apps/web/src/lib/data-timeline.ts:88-117`, `apps/web/src/lib/data-timeline.ts:125-145`.
- AGG32-12: Masonry JPEG fallback can load the base JPEG rather than a sized derivative. Severity Low, confidence Medium. Source: perf-reviewer. Citations: `apps/web/src/components/grid-picture.tsx:30-50`, `apps/web/src/components/home-client.tsx:334-361`.
- AGG32-13: Optional DB health check is unauthenticated and unthrottled when `HEALTH_CHECK_DB=true`. Severity Low, confidence Medium. Source: debugger. Citation: `apps/web/src/app/api/health/route.ts:6-40`.

### Security and Operational Boundaries

- AGG32-14: Every admin is root-equivalent, including backup, restore, and user management. Severity Medium, confidence High. Source: security-reviewer. Citations: `CLAUDE.md:5`, `CLAUDE.md:234-236`, `apps/web/src/app/actions/admin-users.ts:77-84`, `apps/web/src/app/[locale]/admin/db-actions.ts:365-371`.
- AGG32-15: DB restore treats scanner-allowed app tables, including auth tables, as trusted full-state input. Severity Medium, confidence High. Source: security-reviewer. Citations: `apps/web/src/lib/sql-restore-scan.ts:12-31`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-680`.
- AGG32-16: Public/token-spray limits are process-local under the single-instance deployment assumption. Severity Low, confidence High. Sources: security-reviewer, code-reviewer. Citations: `CLAUDE.md:234-236`, `apps/web/src/lib/rate-limit.ts:74-99`, `apps/web/src/lib/rate-limit.ts:318-375`.
- AGG32-17: Plaintext SQL backups are an operator storage boundary. Severity Low, confidence High. Source: security-reviewer. Citations: `CLAUDE.md:213-218`, `apps/web/src/app/[locale]/admin/db-actions.ts:185-230`, `apps/web/src/app/api/admin/db/download/route.ts:45-90`.
- AGG32-18: Production reverse-proxy rate limiting depends on live `TRUST_PROXY=true` configuration. Severity Medium, confidence Medium. Source: code-reviewer. Citation: `apps/web/src/lib/rate-limit.ts:166-196`.
- AGG32-19: Advisory lock names are global across a MySQL server, so multiple GalleryKit DBs on one server can block each other. Severity Low, confidence High. Source: architect. Citations: `apps/web/src/lib/advisory-locks.ts:8-47`, `CLAUDE.md:234-237`.

### Tests and Delivery Automation

- AGG32-20: Schema reconcile is tested by source tripwires, not a structural MySQL/information_schema diff. Severity High, confidence High. Source: test-engineer. Citations: `apps/web/scripts/migrate.js:317-819`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-172`.
- AGG32-21: Restore/backup state-machine tests are mostly source-order checks. Severity High, confidence Medium. Source: test-engineer. Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:365-820`, `apps/web/src/__tests__/db-restore.test.ts:42-77`.
- AGG32-22: Production CLIP activation/integration is outside default CI. Severity Medium, confidence High. Sources: test-engineer, code-reviewer. Citations: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `.github/workflows/quality.yml:66-80`.
- AGG32-23: Deploy/nginx safety tests are string contracts, not parser/runtime checks. Severity Medium, confidence High. Source: test-engineer. Citations: `apps/web/deploy.sh:1-85`, `apps/web/nginx/default.conf:21-203`, `apps/web/src/__tests__/deploy-script-contract.test.ts:21-127`.
- AGG32-24: Docker production image is not built in CI while native package pins are manually synchronized. Severity Medium, confidence High. Source: architect. Citations: `apps/web/Dockerfile:49-61`, `.github/workflows/quality.yml:48-80`.

### UI/UX and Documentation

- AGG32-25: Mobile gallery hierarchy puts the tag wall before the first photo. Severity Medium, confidence High. Sources: designer, ui-ux-designer-reviewer. Citations: `apps/web/src/components/home-client.tsx:255-286`, `apps/web/src/components/tag-filter.tsx:63-120`.
- AGG32-26: Live search for visible tag `jihoon` returned a generic outage message. Severity Medium, confidence High for live symptom; root cause unconfirmed. Source: designer. Citations: `apps/web/src/components/search.tsx:160-245`, `apps/web/src/app/actions/public.ts:305`.
- AGG32-27: Admin image management is table-first and awkward on small screens. Severity Medium, confidence High. Source: ui-ux-designer-reviewer. Citations: `apps/web/src/components/image-manager.tsx:424-594`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`.
- AGG32-28: Photo card accessible names are repetitive. Severity Low, confidence Medium. Sources: designer, ui-ux-designer-reviewer. Citations: `apps/web/src/components/home-client.tsx:323-355`, `apps/web/src/components/home-client.tsx:395-405`.
- AGG32-29: Routine UI transitions use 500 ms durations in repeated browsing surfaces. Severity Low, confidence High. Source: ui-ux-designer-reviewer. Citations: `apps/web/src/components/home-client.tsx:357-371`, `apps/web/src/components/photo-viewer.tsx:716-724`.
- AGG32-30: Generic route error is usable but not operator-informative. Severity Low, confidence High. Source: ui-ux-designer-reviewer. Citation: `apps/web/src/app/[locale]/error.tsx:22-57`.
- AGG32-31: Auto-alt-text docs describe a fallback chain the core public UI does not implement. Severity Medium, confidence High. Source: document-specialist. Citations: `CLAUDE.md:561-563`, `apps/web/src/lib/photo-title.ts:85-125`, `apps/web/src/components/home-client.tsx:293-355`.
- AGG32-32: `.context/plans/README.md` is stale and contains broken links. Severity Low, confidence High. Source: document-specialist. Citations: `.context/plans/README.md:3-16`, `.context/plans/README.md:61-62`.
- AGG32-33: README "private originals" positioning does not front-load that GPS stripping is off by default. Severity Medium, confidence High. Source: product-marketer-reviewer. Citations: `README.md:8`, `README.md:29`, `README.md:40`, `apps/web/src/lib/gallery-config-shared.ts:93-105`.
- AGG32-34: Legacy `lr` upload namespace can imply broader Lightroom parity. Severity Low, confidence High. Source: product-marketer-reviewer. Citations: `README.md:207-216`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-19`, `apps/web/src/lib/admin-tokens.ts:25-29`.
- AGG32-35: README feature list has duplicate sharing/polish debt. Severity Low, confidence High. Source: product-marketer-reviewer. Citations: `README.md:39-49`.
- AGG32-36: Gallery scroll restoration keys only by pathname, so tag-filtered states collide. Severity Low, confidence High. Source: critic. Citations: `apps/web/src/components/home-client.tsx:124-170`, `apps/web/src/components/tag-filter.tsx:23-45`.

## Cross-Agent Agreement

- Lightbox accessibility is high signal: both designer lanes independently found the controls are removed from AT/keyboard on idle.
- Semantic search scan-window limitations were independently flagged by architect and debugger; perf also found a separate CLIP inference concurrency defect.
- UI mobile filter hierarchy was independently flagged by both designer lanes.
- The strongest immediately actionable correctness/security fixes are AGG32-01 through AGG32-08.

## Verification Performed During Review

Subagents ran targeted gates including `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, `npm audit`, focused Vitest suites, and browser/Playwright checks. Full cycle gates remain required in Prompt 3 after implementation.
