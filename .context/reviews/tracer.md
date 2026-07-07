# Cycle 8 Tracer Lane Review

Role: `tracer`
Scope: read-only causal tracing of suspicious end-to-end flows. Source code was not modified.
Allowed write: this file only.
Runtime constraints honored: no fixes, commits, pushes, deploys, service stops, file removals, or mutation of `gallerykit-e2e-mysql-cycle7-47691` on `127.0.0.1:33307`.
Validation method: traced executable code paths and existing tests/source contracts. I did not rely on comments as proof, and I did not run database/e2e flows.

## Inventory

- Required docs read first: `AGENTS.md`, `CLAUDE.md`.
- Public semantic/similar search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/lib/clip-*.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, semantic/similar route tests.
- Upload -> process -> persist -> serve: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, upload routes and upload/process/serve tests.
- Admin auth/login/session: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`, login/password components, auth/session/barrier tests.
- Sharing: `apps/web/src/app/actions/sharing.ts`, public `/s/[key]` and `/g/[key]` pages, `apps/web/src/lib/data.ts`, sharing/shared-link tests.
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, restore maintenance/barrier modules, `apps/web/src/app/api/admin/db/download/route.ts`, restore/download tests.
- Image deletion/revalidation: `deleteImage`/`deleteImages` in `apps/web/src/app/actions/images.ts`, variant cleanup in `apps/web/src/lib/process-image.ts`, deletion/revalidation tests.
- Service worker/PWA assets: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/app/manifest.ts`, icon assets, service-worker tests.
- Sitemap/OG metadata: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/og-photo-fetch.ts`, `apps/web/src/lib/seo-og-url.ts`, sitemap/OG tests.
- Deploy/migration startup: `apps/web/scripts/migrate.js`, `apps/web/scripts/entrypoint.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, migration/deploy startup tests.

## Findings

### TRC8-01: `updatePassword` ignores failed restore-barrier acquisition and can write during restore

- Severity: High
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/app/actions/auth.ts:291-416`, `apps/web/src/lib/admin-mutation-barrier.ts:67-80`, `apps/web/src/app/[locale]/admin/db-actions.ts:550-562`, `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:14-25`

Competing hypotheses:
- Safe: password updates participate in the foreground admin mutation barrier, so restore waits for them or refuses new entrants.
- Unsafe: the action acquires a slot object but checks the object truthiness instead of its `acquired` flag, so the exclusive restore window does not block this action.

Evidence:
- The barrier contract returns an object in both cases. On exclusive restore, `acquireAdminMutationSlot()` returns `{ acquired: false, [Symbol.dispose]() { ... } }`, not `null` or `undefined` (`apps/web/src/lib/admin-mutation-barrier.ts:67-80`).
- The documented usage pattern is `if (!mutationSlot.acquired)` (`apps/web/src/lib/admin-mutation-barrier.ts:73-75`), and other admin mutation actions use that shape.
- `updatePassword` instead does `using mutationSlot = acquireAdminMutationSlot(); if (!mutationSlot) ...` (`apps/web/src/app/actions/auth.ts:309-312`). A failed acquisition is still truthy, so the action proceeds.
- The restore flow sets the durable marker, then drains foreground admin mutations through `drainAdminMutationsForRestore()` before importing (`apps/web/src/app/[locale]/admin/db-actions.ts:550-562`). A password update that failed acquisition is not counted as in-flight.
- The existing auth barrier test only checks that slot acquisition appears before rate-limit/Argon2/transaction work; it does not assert the failed-acquire branch checks `.acquired` (`apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:14-25`).

Failure scenario:
An admin submits a password change just before restore begins. The action passes the one-time maintenance check, restore flips the exclusive barrier, and `acquireAdminMutationSlot()` returns `{ acquired: false }`. Because the object is truthy, `updatePassword` continues through Argon2 and the transaction that updates `admin_users.password_hash`, deletes sessions, and inserts a new session (`apps/web/src/app/actions/auth.ts:405-416`). Restore can drain with no counted in-flight mutation and import the backup while the password action later writes into the restored database.

Suggested fix:
Change the guard to `if (!mutationSlot.acquired) return { error: t('restoreInProgress') };`. Add a behavior test that mocks/forces `acquireAdminMutationSlot()` to return `{ acquired: false }` and asserts no rate-limit increment, Argon2 verify/hash, DB transaction, session rotation, or cookie set occurs. Also tighten the source contract to require `.acquired` inside `updatePassword`.

### TRC8-02: Admin CSV export still uses the MySQL-invalid `GROUP_CONCAT ... SEPARATOR CHAR(1)` form

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/app/[locale]/admin/db-actions.ts:83-164`, `apps/web/src/__tests__/shared-link-runtime-contracts.test.ts:14-29`, `apps/web/src/lib/data.ts:1247-1276`

Competing hypotheses:
- Safe: admin CSV export uses the same string-literal separator shape that the public shared-link flow already fixed and test-locked.
- Unsafe: the export query retained `SEPARATOR CHAR(1)`, which the existing MySQL source contract identifies as an `ER_PARSE_ERROR` shape.

Evidence:
- `exportImagesCsv()` selects `tags: sql<string>\`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name} SEPARATOR CHAR(1))\`` (`apps/web/src/app/[locale]/admin/db-actions.ts:106-121`) and later splits on `\x01` (`apps/web/src/app/[locale]/admin/db-actions.ts:138-143`).
- The repo already carries a regression test for the same MySQL grammar issue: `SEPARATOR CHAR(1)` is invalid and must be replaced by a quoted string literal (`apps/web/src/__tests__/shared-link-runtime-contracts.test.ts:14-29`).
- The fixed public data path defines a literal separator and embeds it through `sql.raw` (`apps/web/src/lib/data.ts:1247-1276`).
- Existing tests mention `db-actions.ts`, but no test currently covers `exportImagesCsv()` for this separator contract; `cycle-20-source-contracts.test.ts` slices only the watchdog before `exportImagesCsv`.

Failure scenario:
An authenticated admin opens the database tools and exports image CSV. The action reaches the SELECT and MySQL rejects the query with a parse error before any CSV can be returned. Because `exportImagesCsv()` has no local catch around the query, the server action fails instead of returning `{ error }`.

Suggested fix:
Mirror the public shared-link fix: define an export separator constant such as `const CSV_TAG_SEPARATOR = '\u0001'` and use `SEPARATOR ${sql.raw(\`'${CSV_TAG_SEPARATOR}'\`)}` or an equivalent quoted literal. Add a source or behavior test that scans `db-actions.ts`/`exportImagesCsv()` for absence of `SEPARATOR CHAR(1)` and presence of the matching split delimiter.

## Flow Traces Without New Findings

- Public semantic/similar search: semantic search checks same-origin, maintenance, content type, transfer encoding, content length, rate limit, mode, aborts, model-version isolation, processed rows, byte-safe embedding decode, enrichment through `searchEnrichmentSelectFields`, and no score leakage (`apps/web/src/app/api/search/semantic/route.ts:107-368`). Similar search is production-only, excludes self, filters processed rows and production embeddings, and strips scores (`apps/web/src/app/api/search/similar/[id]/route.ts:68-285`). Residual test gap: similar-route tests mock `hasTrustedSameOrigin`, so browser provenance coverage depends on integration/e2e behavior rather than that unit test.
- Upload -> process -> persist -> serve: upload validates origin/auth/maintenance/barrier, saves originals privately, inserts pending DB rows, enqueues processing, and revalidates public/admin paths (`apps/web/src/app/actions/images.ts:129-635`). The queue uses per-image locks, source existence checks, atomic derivative processing, conditional processed updates, cleanup on deleted-mid-process races, caption/embedding side effects after the core processed update, and retry/failure persistence (`apps/web/src/lib/image-queue.ts:715-1062`). Serving confines paths to derivative roots, validates realpaths, supports ETag/HEAD, and streams via file handles (`apps/web/src/lib/serve-upload.ts:168-384`).
- Sharing: single-photo and group sharing use same-origin/admin checks, mutation-barrier `.acquired` checks, rate limiting, collision-safe key creation, revoke/delete revalidation, and public pages validate keys, rate-limit lookups, and avoid caching revoked share HTML through the service worker (`apps/web/src/app/actions/sharing.ts:92-423`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:90-149`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:96-209`).
- Backup/restore: dump/restore enforce admin origin, advisory locks, upload/backfill/semantic locks, durable restore maintenance, queue quiesce, background write drains, foreground mutation drains, dump header/trailer validation, dangerous SQL scan, and maintenance retention on restore failure (`apps/web/src/app/[locale]/admin/db-actions.ts:166-636`, `apps/web/src/app/[locale]/admin/db-actions.ts:640-860`). Backup download streams from a validated open file handle and is test-locked (`apps/web/src/app/api/admin/db/download/route.ts:21-109`).
- Image deletion/revalidation: delete paths acquire the mutation barrier correctly, select share/group keys before deletion, remove queue state, delete image/tag rows transactionally, cleanup variants with strict full-scan semantics, and revalidate home/photo/topic/admin/share/group paths (`apps/web/src/app/actions/images.ts:655-754`). Existing source tests pin raced zero-row delete and share revalidation contracts.
- Service worker/PWA assets: generated `sw.js` matches the template plus `IMAGE_PIPELINE_VERSION` stamp (`36c91deb-p7` in this checkout), manifest icon paths resolve to existing app/public assets, admin/revocable routes bypass SW HTML caching, and tests compare template/generated worker cache behavior (`apps/web/scripts/build-sw.ts:27-43`, `apps/web/public/sw.template.js:525-560`, `apps/web/src/app/manifest.ts:24-51`, `apps/web/src/__tests__/sw-template-contract.test.ts:59-349`).
- Sitemap/OG metadata: sitemap reserves localized homepage/topic/feed budgets before image rows and clamps to 50,000 URLs; robots allows OG endpoints before disallowing `/api/`; topic/photo OG routes rate-limit before expensive work, use ETags, sanitize rendered text, constrain canonical origins, and use non-cacheable temporary fallbacks for pending derivatives (`apps/web/src/app/sitemap.ts:26-135`, `apps/web/src/app/robots.ts:15-23`, `apps/web/src/app/api/og/route.tsx:71-270`, `apps/web/src/app/api/og/photo/[id]/route.tsx:87-375`).
- Deploy/migration startup: container startup runs migrations before `server.js`, migration startup includes legacy/fresh reconcile, per-entry baselining, above-cursor/DML guards, post-condition hash verification, strong admin bootstrap password enforcement, and connection cleanup; deploy waits for health before Docker cleanup and only prunes after the new container is healthy (`apps/web/Dockerfile:187-197`, `apps/web/scripts/migrate.js:843-1013`, `apps/web/deploy.sh:51-104`, `apps/web/src/__tests__/migrate-pending-migrations.test.ts:89-356`).

## Final Sweep

Checked causal boundaries across request provenance, maintenance/restore gates, foreground mutation barriers, background drains, DB write ordering, queue handoff, file-system atomicity, public cache/revalidation, service-worker caching, crawler metadata, startup migration state, and existing regression tests. New high-confidence findings are limited to the auth restore-barrier gap and the admin CSV separator regression above. Remaining risk is mainly timing-sensitive restore concurrency and browser-header provenance that static tracing cannot fully exercise without live browser/database tests.
