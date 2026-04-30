# Plan 194 — Deferred Cycle 11 Ultradeep Review Items

**Source review:** Cycle 11 Aggregate Review deferred items (`C11-08` through `C11-12`) plus operational audit/history follow-ups
**Status:** TODO / deferred

Deferred-fix rules honored:
- Every deferred item preserves its original severity/confidence.
- No severity was downgraded to justify deferral.
- Repo policy still applies when these items are eventually picked up.

| ID | File / Citation | Severity | Confidence | Reason for deferral this cycle | Exit criterion / reopen trigger |
|---|---|---|---|---|---|
| C11-08 | `apps/web/src/lib/storage/local.ts` | MEDIUM | HIGH | The local storage backend is not the active production pipeline and needs a slightly broader read-path review before changing semantics. | Reopen when the storage abstraction or local backend is promoted beyond experimental/live-FS parity. |
| C11-09 | `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/exif-datetime.ts` | MEDIUM | HIGH | EXIF round-trip validation is bounded but independent from the higher-priority live routing/share/auth/runtime fixes landed in Plan 193. | Reopen in the next image-metadata correctness pass. |
| C11-10 | `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts` | HIGH | HIGH | A robust fix needs shared maintenance state and/or queue replay semantics across processes, which is larger than a safe bounded cycle. | Reopen when multi-process maintenance fencing or durable queue replay is being designed. |
| C11-11 | `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/base56.ts`, `apps/web/src/lib/data.ts` | MEDIUM | HIGH | Share-link expiry and binary/case-safe storage both require schema-level or data-contract changes. | Reopen when share-link schema work is approved. |
| C11-12 | `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/e2e/nav-visual-check.spec.ts` | MEDIUM | HIGH | The test gaps are real, but closing them comprehensively is a dedicated test-engineering lane rather than a bounded code-hardening tweak. | Reopen when a coverage-focused cycle is scheduled. |
| O11-01 | historical `apps/web/.env.local.example` secret in commit `d068a7fbd62642d574d605055afe8df9c223f635` | MEDIUM | HIGH | Requires operational secret rotation / session invalidation outside the repo, not just code edits. | Reopen when operators are ready to rotate secrets and invalidate sessions. |
| O11-02 | local untracked `apps/web/.env.local` plaintext credentials | MEDIUM | HIGH | Local workstation/ops hygiene item, not a tracked-code change. | Reopen if those credentials are reused outside local development or if workstation-hardening work is scheduled. |
| O11-03 | dev-only `esbuild` advisory via `drizzle-kit` toolchain | LOW | HIGH | Toolchain upgrade should be isolated from the current bounded fixes to avoid widening scope mid-cycle. | Reopen when dependency-upgrade work is scheduled. |
| O11-04 | storage backend switching affordance vs live pipeline | MEDIUM | HIGH | This is an architectural/product-surface decision, not a narrow bug fix. | Reopen when the storage abstraction is either fully wired through the pipeline or explicitly hidden from production operators. |
| C11-13 | `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-paths.ts`, `README.md` | HIGH | HIGH | The current restore flow is DB-only and needs a broader product/runtime contract before it can safely snapshot filesystem-backed images too. | Reopen when DB + upload-volume restore semantics are explicitly designed. |
| C11-14 | `apps/web/src/lib/data.ts`, `apps/web/src/db/schema.ts`, `apps/web/src/app/actions/public.ts` | MEDIUM | HIGH | Search scalability needs schema/index/projection work that is larger than this bounded hardening pass. | Reopen when search performance becomes a prioritized workstream. |
| C11-15 | `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-tracker.ts` | MEDIUM | HIGH | Moving process-local counters to shared state is architectural work, not a safe same-cycle tweak. | Reopen when multi-instance correctness work is scheduled. |
| C11-16 | `apps/web/src/components/search.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/components/image-manager.tsx`, `apps/web/src/components/lightbox.tsx` | MEDIUM | HIGH | These UX/accessibility follow-ups are real but belong in a focused design/accessibility cycle after the current bounded fixes. | Reopen when a UI/accessibility polish pass is scheduled. |

| C11-17 | `apps/web/Dockerfile`, `apps/web/src/app/api/health/route.ts` | HIGH | HIGH | Splitting liveness vs readiness needs a broader deploy/orchestration contract than this bounded app pass. | Reopen when deploy health semantics are being redesigned. |
| C11-18 | `apps/web/Dockerfile`, `README.md`, `apps/web/README.md` | MEDIUM | HIGH | Failing production builds without a real site config changes deploy ergonomics and should be handled together with docs/runtime policy. | Reopen when site-config policy is explicitly tightened. |
| C11-19 | `README.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf` | MEDIUM | MEDIUM | Clarifying or bundling the host-managed nginx contract is a documentation/runtime topology task beyond the current bounded fixes. | Reopen when deploy docs/topology alignment is prioritized. |
