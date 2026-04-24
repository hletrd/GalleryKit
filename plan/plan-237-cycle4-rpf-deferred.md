# Plan 237 — Cycle 4 RPF deferred review findings
Status: active-deferred

## Repo rules consulted
- `CLAUDE.md`, `AGENTS.md`, existing `.context/**` and `plan/**` artifacts were read before deferral.
- No deferred item below downgrades original severity/confidence.
- Deferred items here are non-security/non-data-loss architectural, product, performance, or test-surface expansion items whose full implementation is larger than this cycle's bounded fix set. Security/correctness/data-loss findings from the aggregate are scheduled in Plans 235/236 instead.

## Deferred items

### D-C4-001 — Storage backend abstraction split
- **Finding:** AGG-C4-006; `apps/web/src/lib/storage/index.ts:52-143`, `process-image.ts:242-253,362-444`, `serve-upload.ts:63-103`, `upload-paths.ts:12-46`; MEDIUM/High.
- **Reason for deferral:** CLAUDE.md explicitly says storage abstraction is not integrated and local filesystem is the only supported production backend. Fully deleting or wiring the abstraction is architectural product scope, not required to fix current supported behavior.
- **Exit criterion:** A roadmap decision to support object storage, or a new runtime code path that depends on `getStorage()` for live uploads/serving.

### D-C4-002 — Distributed/single-instance coordination enforcement
- **Finding:** AGG-C4-012; `restore-maintenance.ts`, `upload-tracker-state.ts`, `image-queue.ts`, `data.ts`; HIGH/High risk.
- **Reason for deferral:** Current CLAUDE.md/README define single web-instance/single-writer topology. Implementing shared coordination (DB/Redis/job table) is a large architectural migration.
- **Exit criterion:** Any deployment target adds multiple web replicas, worker split, or load-balancer topology; then restore/upload/queue/view-count state must move to shared infrastructure or singleton startup enforcement.

### D-C4-003 — Persistent image-processing failure state machine
- **Finding:** AGG-C4-015; `actions/images.ts:216-239`, `image-queue.ts:196-223,305-318,381-428`, `image-manager.tsx:372-385`; HIGH/High risk.
- **Reason for deferral:** Requires schema migration, admin UI, queue retry semantics, and operator workflow. Existing prior plan `plan-234-cycle3-rpf-deferred.md` already tracks this as persistent processing failure state.
- **Exit criterion:** Any repeated stuck `processed=false` incident, admin retry request, or schema migration window.

### D-C4-004 — Role/capability model for admins
- **Finding:** AGG-C4-018; `admin-users.ts`, `settings.ts`, `db-actions.ts`; MEDIUM/High.
- **Reason for deferral:** Current product model documented in CLAUDE.md is multiple root admins with no role separation. Roles require product requirements, schema, authz policy, and UX.
- **Exit criterion:** Need to invite non-owner operators/editors or expose destructive DB/settings features to lower-trust users.

### D-C4-005 — RTL layout readiness
- **Finding:** AGG-C4-027; `app/[locale]/layout.tsx:79-84` plus physical left/right layout; LOW/High.
- **Reason for deferral:** Current supported locales are English/Korean (both LTR). Full RTL support requires design and layout audit beyond current locale scope.
- **Exit criterion:** Add an RTL locale or accept user requirement for RTL support.

### D-C4-006 — Real blur/dominant-color placeholders
- **Finding:** AGG-C4-029; `home-client.tsx:219-228`; LOW/High.
- **Reason for deferral:** Requires ingest-time metadata generation/storage migration or derivative pipeline changes.
- **Exit criterion:** Perceived loading becomes a product priority or image metadata schema is migrated for placeholders.

### D-C4-007 — Stable `drizzle-kit` migration tool decision
- **Finding:** AGG-C4-031; `apps/web/package.json:56-63`, lockfile; LOW-MEDIUM/Medium.
- **Reason for deferral:** Migration tooling upgrade can change schema generation output and should be handled in its own migration-readiness pass.
- **Exit criterion:** Drizzle stable release is selected, migration CI is added, or current beta causes command breakage.

### D-C4-008 — Public listing exact-count query optimization
- **Finding:** AGG-C4-037; `data.ts:371-385`; MEDIUM/High.
- **Reason for deferral:** Performance optimization affects visible total-count UX and may require product decision on exact vs approximate/lazy counts.
- **Exit criterion:** Large-gallery benchmark shows first-page TTFB regression, or product accepts removing/lazily loading exact counts.

### D-C4-009 — Full-text/dedicated search backend
- **Finding:** AGG-C4-038; `data.ts:725-831`, schema indexes; MEDIUM/High.
- **Reason for deferral:** Requires schema/index design and search behavior changes. Current rate limits bound abuse volume.
- **Exit criterion:** Search latency/rows-examined metrics show degradation, or DB migration window opens for FULLTEXT/search table.

### D-C4-010 — Streaming CSV export
- **Finding:** AGG-C4-041; `db-actions.ts:51-99`, DB page Blob creation; MEDIUM/Medium-High.
- **Reason for deferral:** Prior plans already track CSV streaming. It requires replacing server-action return with authenticated streaming route and UI download flow.
- **Exit criterion:** CSV export approaches memory cap, timeouts occur, or admin requires >50k row exports.

### D-C4-011 — Broad test coverage expansion / thresholds
- **Finding:** AGG-C4-062; auth, sharing, image processing, settings, startup/shutdown, visual assertions, upload E2E, coverage thresholds; LOW-HIGH/High.
- **Reason for deferral:** This is a broad test investment, not a single confirmed runtime defect. Current cycle will add targeted regressions for shipped fixes.
- **Exit criterion:** Next cleanup cycle has test-only scope, a coverage budget is adopted, or a regression escapes in one of the named areas.

### D-C4-012 — Gallery-specific public DB outage shell
- **Finding:** AGG-C4-021; `nav.tsx`, public home page, error boundary; MEDIUM/High.
- **Reason for deferral:** Requires route-level error boundary/product copy design for partial DB outage. Current generic error boundary is functional, and this cycle prioritizes direct correctness/security fixes.
- **Exit criterion:** Operator/customer reports public outage UX confusion, or a maintenance-mode feature is planned.
