# Cycle 13 Architect Review

## Scope and Coverage

Reviewed the repository architecture against `AGENTS.md` and `CLAUDE.md`, then checked implementation boundaries across the web app, DB layer, migrations, auth/session paths, public/admin route split, image pipeline, upload serving, deployment scripts, Docker/Nginx runtime, and architecture-relevant tests.

Inventory method: `rg --files` with `node_modules`, `.git`, build output, Playwright output, runtime `apps/web/data`, `apps/web/public/uploads`, and `apps/web/public/resources` excluded. Architecture-relevant inventory included root/package config, `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/db`, `apps/web/drizzle`, `apps/web/scripts`, `apps/web/{Dockerfile,docker-compose.yml,deploy.sh,nginx}`, `apps/web/e2e`, `apps/web/src/__tests__`, `.context`, `AGENTS.md`, and `CLAUDE.md`.

Validation run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- `npm test --workspace=apps/web -- smart-collections.test.ts privacy-fields.test.ts migrate-reconcile-coverage.test.ts migration-journal-monotonicity.test.ts` - passed, 4 files / 110 tests.

## Confirmed Issues

No confirmed architecture/design defects found in the reviewed auth boundaries, public/admin separation, migration postconditions, upload/original-file split, derivative serving path, or documented single-instance deployment path.

## Likely Issues

### ARCH-C13-01 - Smart collection predicate contract is still column-global

- Severity: Medium
- Confidence: Medium
- Status: Likely issue
- Citations:
  - `apps/web/src/lib/smart-collections.ts:21`-`30` defines columns with mixed numeric, text, date, topic, and tag semantics.
  - `apps/web/src/lib/smart-collections.ts:274`-`276` keeps one global operator set for every column.
  - `apps/web/src/lib/smart-collections.ts:346`-`392` validates only column allowlist, global operator membership, tag narrowing, and scalar value shape.
  - `apps/web/src/lib/smart-collections.ts:202`-`235` compiles direct-column predicates by applying the requested operator to whatever allowed column was supplied.
  - `apps/web/src/app/actions/collections.ts:32`-`50` and `apps/web/src/app/actions/collections.ts:83`-`90` persist admin-supplied queries after `parseSmartCollectionQuery()` only.
  - `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:86`-`101` parses, compiles, and executes public smart collection queries on visitor requests.
  - `apps/web/src/lib/data.ts:1409`-`1452` runs the compiled condition against the public listing query.

Failure scenario: an admin can save a public collection using semantically invalid but structurally accepted predicates such as `{"column":"iso","operator":"contains","value":"1"}`, `{"column":"camera_model","operator":"gt","value":0}`, or `{"column":"capture_date","operator":"in","values":[1,2,3]}`. Those predicates are then executed on unauthenticated public collection page loads. MySQL may use implicit casts or LIKE/range comparisons on columns that were not designed for those operators, producing confusing collection results and avoidable table scans as the gallery grows.

Suggested fix: replace the global operator/value contract with a per-column schema. Numeric fields should accept numeric equality/range/in predicates; text fields should accept string equality/contains/in predicates; `capture_date` should require a date-shaped string/range contract; `topic` should allow exact slug identity and explicit slug sets unless substring/range behavior is intentionally supported; `tag` can keep its current `eq`/`contains` subquery contract. Pin it with tests that assert invalid column/operator/value combinations fail at save time, not on the public page.

## Risks Needing Manual Validation

### ARCH-C13-02 - Single-instance runtime is an explicit correctness boundary

- Severity: High if violated
- Confidence: High
- Status: Risk needing manual validation / accepted topology constraint
- Citations:
  - `CLAUDE.md:227`-`228` documents the shipped deployment as single web instance / single writer and lists process-local restore flags, upload tracking, image queue state, backfill status, rate-limit fast paths, and view-count buffering.
  - `apps/web/docker-compose.yml:1`-`21` defines one `web` service with host networking and `TRUST_PROXY=true`.
  - `apps/web/src/lib/restore-maintenance.ts:1`-`18` stores restore maintenance state on `globalThis`; `apps/web/src/lib/restore-maintenance.ts:44`-`55` toggles that local flag.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:339`-`371` starts local restore maintenance and quiesces the local queue before import.
  - `apps/web/src/lib/image-queue.ts:76`-`90` and `apps/web/src/lib/image-queue.ts:275`-`323` keep queue state in a process-local global; `apps/web/src/lib/image-queue.ts:489`-`493` rejects jobs only when the local process sees shutdown/restore maintenance.
  - `apps/web/src/lib/image-queue.ts:1035`-`1088` quiesces and resumes only the local queue.
  - `apps/web/src/lib/rate-limit.ts:75`-`96` and `apps/web/src/lib/rate-limit.ts:110`-`119` define process-local public/admin-token rate-limit maps alongside DB-backed paths.
  - `apps/web/src/lib/data.ts:75`-`145` buffers shared-group view counts in process memory before DB flush.

Failure scenario: if operations later add a second web container, blue/green overlap, or multiple Node workers without moving coordination state, one process can run DB restore maintenance while another still accepts uploads, processes queued images, records view-count buffers, or serves a separate in-memory rate-limit budget. The DB advisory locks cover some critical sections, but the user-facing maintenance gate, queue quiescence, upload tracker, public rate-limit fast paths, and approximate view-count buffer are not cluster-wide.

Suggested fix: keep this as a deploy-time invariant and add a release/deploy checklist assertion that production has exactly one active web process. If horizontal scaling is desired, first move restore maintenance, upload-claim tracking, image/backfill queue state, public rate limits, and view-count buffering to shared durable state such as MySQL/Redis or a dedicated worker queue; then add multi-process tests around restore/upload/queue interleavings.

## Final Sweep Notes

- Docs vs implementation: `CLAUDE.md` accurately describes the major runtime topology, privacy fields, migration reconcile/baseline behavior, upload/original split, OG hardening, and derivative cache policy observed in implementation.
- Auth boundaries: admin API exports are covered by `withAdminAuth(...)`; mutating server actions are same-origin guarded; public mutating/expensive route checks are covered by the route-rate-limit linter.
- Data privacy: public selects remain separated from admin selects and the focused privacy test passed. Map GPS exposure is intentionally routed through the map-visible topic path.
- Migrations: `apps/web/scripts/migrate.js:731`-`808` contains the documented reconcile/baseline/postcondition flow, and the migration coverage and journal monotonicity tests passed.
- Image pipeline: originals are private under `data/uploads/original`; public derivatives are whitelisted by format and served through containment/symlink checks; upload and Lightroom paths both snapshot processing settings before queueing.
- Operational architecture: deploy and container files match the documented single-host, bind-mounted-data topology. The primary residual risk is operational drift away from that topology, captured above.
