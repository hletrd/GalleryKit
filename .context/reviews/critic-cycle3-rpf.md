# Critic review — cycle 3 / Prompt 1

Date: 2026-04-29  
Role: critic  
Scope: whole codebase skeptical review (architecture, correctness, security, performance, UX, docs, tests)  
Constraint honored: implementation files were not edited; this review is the only intended write.

## Inventory first

Tracked project surfaces inventoried before issue analysis:

- Workspace/config/docs: `package.json`, `package-lock.json`, `.nvmrc`, `AGENTS.md`, `README.md`, `.github/workflows/quality.yml`.
- Web app config/deploy: `apps/web/package.json`, `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/drizzle.config.ts`, `apps/web/tsconfig.json`.
- App router/API/actions: `apps/web/src/app/**`, including public pages, localized upload routes, admin pages/layouts, `actions/{auth,images,public,seo,settings,sharing,tags,topics}.ts`, `api/{health,live,og}`, and `api/admin/db/download/route.ts`.
- Data/security/runtime libraries: `apps/web/src/db/{index,schema,seed}.ts`, `apps/web/src/lib/**` including session, rate limits, same-origin checks, upload serving/paths, image processing queue, DB restore scanner, storage, validation, CSP, SEO/config, and revalidation.
- UI: `apps/web/src/components/**` including gallery, search, lightbox/photo viewer, upload dropzone, image manager, admin navigation, and shadcn UI wrappers.
- Tests/tooling: `apps/web/src/__tests__/**`, `apps/web/e2e/**`, `apps/web/scripts/{check-action-origin,check-api-auth,run-e2e-server,migrate,seed-*}.ts/mjs/js`.
- Database migrations: `apps/web/drizzle/**`.

Review method: validate behavior from source/config rather than comments or test names. Tests/docs were read to identify coverage and operational expectations, but findings below are based on executable code paths and shipped configuration.

## Findings

### C3-P1-01 — Shipped nginx config rewrites HTTPS requests as `http`, breaking production admin/auth paths behind the documented TLS edge

- **Severity:** High
- **Confidence:** High
- **Perspective:** correctness / deployment architecture / security control availability
- **Evidence:**
  - `apps/web/nginx/default.conf:16-19` describes this server block as a local HTTP listener behind a TLS-terminating edge/load balancer.
  - The same nginx config forwards `X-Forwarded-Proto $scheme` in every proxied location: login/admin at `apps/web/nginx/default.conf:53-57`, DB admin at `apps/web/nginx/default.conf:70-74`, admin mutations at `apps/web/nginx/default.conf:85-89`, and the generic app path at `apps/web/nginx/default.conf:120-124`.
  - `apps/web/docker-compose.yml:18-20` sets `TRUST_PROXY: "true"`, causing the app to trust `x-forwarded-proto`.
  - `apps/web/src/lib/request-origin.ts:45-68` builds the expected origin from trusted `x-forwarded-proto`/`x-forwarded-host`; `apps/web/src/lib/request-origin.ts:91-106` compares that expected origin to the browser `Origin`/`Referer` and fails closed.
  - Login checks this before authenticating at `apps/web/src/app/actions/auth.ts:91-95`; mutating admin actions centralize the same check at `apps/web/src/lib/action-guards.ts:37-44`. Backup download uses the same primitive at `apps/web/src/app/api/admin/db/download/route.ts:13-31`.
- **Failure scenario:** A user deploys the provided nginx behind an HTTPS load balancer as described. The load balancer sends HTTPS browser traffic to nginx over HTTP, so nginx's `$scheme` is `http`. Nginx overwrites any upstream `X-Forwarded-Proto: https` with `http`. The browser sends `Origin: https://gallery.example`; the app computes `http://gallery.example` as the expected origin and rejects login, logout, password change, uploads, DB backup/restore, and other admin mutations as unauthorized. Login cookies may also be marked non-secure because `getTrustedRequestProtocol()` sees `http`.
- **Fix:** Do not derive public protocol from nginx's local listener scheme in this topology. Use a sanitized/whitelisted upstream proto (`map $http_x_forwarded_proto $gallery_forwarded_proto { https https; http http; default $scheme; }`) when nginx is behind a trusted TLS edge, or set `X-Forwarded-Proto https` in the HTTPS-edge deployment. If nginx is the public TLS terminator, add the actual `listen 443 ssl` server and keep `$scheme` there. Add an integration test that sends `Origin: https://host` with `X-Forwarded-Proto: http` as produced by the current config and proves the shipped reverse-proxy path works.

### C3-P1-02 — Rate limits trust spoofable `X-Forwarded-For` in common nginx adaptations, and docs overstate the `TRUSTED_PROXY_HOPS=2` topology

- **Severity:** High for public-edge nginx; Medium for CDN/LB deployments that follow the current `TRUSTED_PROXY_HOPS=2` documentation without validating headers.
- **Confidence:** High
- **Perspective:** security / abuse resistance / observability
- **Evidence:**
  - Nginx forwards `X-Forwarded-For $proxy_add_x_forwarded_for` at `apps/web/nginx/default.conf:53-57`, `apps/web/nginx/default.conf:70-74`, `apps/web/nginx/default.conf:85-89`, and `apps/web/nginx/default.conf:120-124`.
  - The app trusts forwarded IPs whenever `TRUST_PROXY=true` (`apps/web/docker-compose.yml:18-20`). In `apps/web/src/lib/rate-limit.ts:82-104`, it splits `x-forwarded-for`, validates the IP-looking entries, and returns the entry immediately before the configured trusted suffix (`validParts.length - hopCount - 1`), falling back to `x-real-ip` only when the chain is too short or invalid.
  - README guidance says `TRUST_PROXY=true` is required and describes `TRUSTED_PROXY_HOPS=1/2` behavior at `README.md:146-148`; `apps/web/README.md:42` repeats that `TRUSTED_PROXY_HOPS=2` is for a CDN/LB → nginx → app chain.
  - Tests lock the helper behavior for synthetic chains (`apps/web/src/__tests__/rate-limit.test.ts:97-119`) but do not test the actual checked-in nginx header construction.
- **Failure scenario:** If nginx is adapted into the public TLS edge (explicitly suggested by the config comment at `apps/web/nginx/default.conf:16-19`) and a client sends `X-Forwarded-For: 198.51.100.123`, `$proxy_add_x_forwarded_for` passes `198.51.100.123, <real-client-ip>` to the app. With `TRUST_PROXY=true` and default one trusted hop, `getClientIp()` returns the attacker-chosen left value. The attacker can rotate spoofed IPs to bypass login/search/share/OG/upload quotas and pollute audit IPs. Separately, in a CDN/LB → nginx → app deployment where nginx sees `X-Forwarded-For: <client>` and appends `$remote_addr` (the CDN/LB), the app-visible chain is usually `<client>, <cdn/lb>`. Setting `TRUSTED_PROXY_HOPS=2` as documented makes the chain too short, so the app falls back to `X-Real-IP` (`$remote_addr`, the CDN/LB), collapsing many clients into one bucket.
- **Fix:** For a single trusted nginx edge, overwrite rather than append: `proxy_set_header X-Forwarded-For $remote_addr;`. For CDN/LB → nginx, configure nginx `real_ip_header X-Forwarded-For`, `set_real_ip_from` for trusted upstreams, `real_ip_recursive on`, and then forward a sanitized single client IP (or adjust the app/header contract so hop counts match what nginx actually sends). Document the exact supported header chain and add tests that feed the app the literal headers emitted by `apps/web/nginx/default.conf` for public-edge and CDN-edge deployments.

### C3-P1-03 — Public search remains a multi-table leading-wildcard scan with no matching full-text/index strategy

- **Severity:** Medium
- **Confidence:** Medium-High
- **Perspective:** performance / public abuse resistance / scalability
- **Evidence:**
  - Public search validates length and rate-limits to 30 requests/minute per derived IP in `apps/web/src/app/actions/public.ts:108-163`.
  - The actual search uses `%query%` leading-wildcard `LIKE` across image title, description, camera model, topic slug, and topic label at `apps/web/src/lib/data.ts:909-941`.
  - If the first query does not fill the limit, it performs additional leading-wildcard tag and topic-alias searches at `apps/web/src/lib/data.ts:950-1004`.
  - The schema has ordinary indexes for processed/capture/created/topic/user filename and tag uniqueness, but no full-text or search-specific indexes for the searched text fields (`apps/web/src/db/schema.ts:16-80`).
  - The OG/search rate limits depend on `getClientIp()`, so C3-P1-02 can weaken this protection behind a misconfigured proxy.
- **Failure scenario:** On a gallery that grows from personal scale to tens of thousands of images/tags, each public search can scan large portions of `images`, `tags`, and `topic_aliases`, then group/order rows. A crawler or attacker can stay within 30/minute per spoofed/rotated IP and still keep MySQL CPU and buffer pool busy. Normal users see slow search and delayed public page rendering because the app shares the same DB pool (`apps/web/src/db/index.ts:13-22`).
- **Fix:** Define a supported scale target and run `EXPLAIN ANALYZE` on representative datasets. If public search is expected above small personal-gallery scale, add a dedicated search table or MySQL FULLTEXT indexes (with language/tokenization validation for Korean/CJK if needed), consider prefix-only modes for tags/topics, and cache or debounce repeated searches. Keep the current length/rate limit, but do not treat it as the primary scalability control.

### C3-P1-04 — Bearer share links are effectively indefinite and revocation actions are not reachable from the UI

- **Severity:** Medium
- **Confidence:** High
- **Perspective:** privacy / UX / product correctness
- **Evidence:**
  - Per-photo share keys live directly on `images.share_key` with no expiry field (`apps/web/src/db/schema.ts:16-30`).
  - Shared groups have an `expires_at` column (`apps/web/src/db/schema.ts:87-95`) and the public group lookup honors it (`apps/web/src/lib/data.ts:787-798`), but group creation inserts only `{ key: groupKey }` at `apps/web/src/app/actions/sharing.ts:248-255`, leaving `expires_at` null.
  - Photo share creation reuses an existing `share_key` or writes a new one at `apps/web/src/app/actions/sharing.ts:109-153`; no TTL is available there.
  - The UI only calls `createPhotoShareLink()` from the photo viewer (`apps/web/src/components/photo-viewer.tsx:303-335`) and `createGroupShareLink()` from the image manager (`apps/web/src/components/image-manager.tsx:171-187`, `apps/web/src/components/image-manager.tsx:303-310`). A source sweep found no UI call sites for `revokePhotoShareLink()` or `deleteGroupShareLink()` outside their server-action definitions/exports.
  - README advertises “per-photo and group share links with Base56 short keys” but does not warn that links are indefinite by default (`README.md:36`).
- **Failure scenario:** An admin shares a private family photo or temporary group link in chat. Months later the link is forwarded or leaked. Unless the admin deletes the image/group at the data layer or a future UI exposes the unused revoke actions, the public `/s/<key>` or `/g/<key>` route remains accessible. For group links, the schema appears to support expiry, which may lead maintainers/operators to assume expiration exists when creation never sets it.
- **Fix:** Make share lifecycle explicit. Either document “links never expire until manually revoked” and expose visible revoke/list/manage controls for photo and group shares, or add TTL selection/default expiry and persist `expires_at` during group creation. Consider adding an expiry mechanism for per-photo `share_key` as well, or model photo shares in a separate table with created/expiry/revoked metadata.

### C3-P1-05 — CI exercises local HTTP app behavior, not the production reverse-proxy header contract that now carries the highest risk

- **Severity:** Medium
- **Confidence:** High
- **Perspective:** tests / release safety
- **Evidence:**
  - CI runs lint, typecheck, static security scripts, unit tests, Playwright, and build in `.github/workflows/quality.yml:54-79`.
  - Playwright defaults to a direct local app URL (`http://127.0.0.1:<port>`) in `apps/web/playwright.config.ts:15-29` and starts the app directly via `apps/web/playwright.config.ts:71-78`.
  - The origin-guard E2E test covers spoofed cross-origin rejection for an admin API route (`apps/web/e2e/origin-guard.spec.ts:33-72`) but does not run through nginx or assert the HTTPS-origin/TLS-edge happy path.
  - Static gates pass for admin API auth and mutating server-action origin checks, but those gates only inspect source/action coverage; they do not validate nginx’s emitted `X-Forwarded-*` values.
- **Failure scenario:** The suite stays green while the shipped nginx config rejects all real HTTPS admin actions (C3-P1-01) or permits rate-limit bypass / bucket collapse (C3-P1-02). Future hardening of `hasTrustedSameOrigin()` or `getClientIp()` can regress production-only behavior without being caught because the test topology does not include the deployment topology.
- **Fix:** Add a small reverse-proxy integration suite. It does not need full Docker orchestration: a Node/undici test can construct headers exactly as nginx emits them for (a) TLS-edge → nginx HTTP → app, (b) public nginx edge, and (c) CDN/LB → nginx → app, then assert `hasTrustedSameOrigin()` and `getClientIp()` outcomes. A higher-fidelity Playwright job can start nginx with `apps/web/nginx/default.conf` and hit the app through it before build/release.

## Manual-validation risks / lower-priority notes

- **Single-instance assumption is real.** README states this is intended as a single web-instance/single-writer deployment (`README.md:146`). Code confirms process-local coordination for upload quotas (`apps/web/src/lib/upload-tracker-state.ts:15-61`), the image queue (`apps/web/src/lib/image-queue.ts:67-144`), and buffered group view counts (`apps/web/src/lib/data.ts:11-134`). This is acceptable if operators keep one Node process, but any PM2/cluster/Kubernetes scaling needs a design change, not just more replicas.
- **Host-side static uploads config is easy to miscopy.** The app README warns that `apps/web/nginx/default.conf` uses a container-internal upload root and host nginx must point elsewhere (`README.md:181`, `apps/web/README.md:44`). The shipped compose comments say nginx is host-managed (`apps/web/docker-compose.yml:13-15`) while nginx’s static location uses `/app/apps/web/public` (`apps/web/nginx/default.conf:96-103`). This is documented, so I did not rank it as a primary defect, but deployment docs should keep it prominent.
- **Database restore remains inherently high-trust.** The restore path has authentication, same-origin checks, file size limits, header validation, dangerous-SQL scanning, advisory locks, and temp-file cleanup (`apps/web/src/app/[locale]/admin/db-actions.ts:275-522`; scanner in `apps/web/src/lib/sql-restore-scan.ts`). Still, an admin-supplied SQL dump is executed by the configured DB user. Manual validation should confirm that production DB credentials are scoped only to the gallery schema and that restore is never exposed to untrusted admins.

## Positive controls observed

- Mutating server actions consistently route through auth and same-origin checks; the static gate confirmed this during the final sweep.
- Public upload serving is constrained to known derivative directories and checks realpath/lstat containment (`apps/web/src/lib/serve-upload.ts`).
- Public select fields intentionally omit GPS/original filename/user filename fields (`apps/web/src/lib/data.ts:179-225`), and public photo JSON-LD uses safe JSON serialization (`apps/web/src/lib/safe-json-ld.ts:14-18`).
- Image processing, restore, and upload flows have many race/rollback guards; I did not find a concrete implementation bug there during this pass.

## Final missed-issues sweep

Commands run after the manual review:

```bash
npm run lint:api-auth --workspace=apps/web
npm run lint:action-origin --workspace=apps/web
rg -n "revokePhotoShareLink\(|deleteGroupShareLink\(" apps/web/src --glob '!**/app/actions/sharing.ts' --glob '!**/app/actions.ts'
rg -n "proxy_set_header X-Forwarded-(For|Proto)" apps/web/nginx/default.conf
rg -n "like\(images\.(title|description|camera_model|topic)|like\(tags\.name|like\(topicAliases\.alias" apps/web/src/lib/data.ts
```

Results:

- `lint:api-auth`: passed (`OK: src/app/api/admin/db/download/route.ts`).
- `lint:action-origin`: passed; all mutating server actions enforce same-origin provenance.
- No UI call sites found for share revocation/deletion actions beyond definitions/exports.
- Nginx forwarded-header sweep confirmed all proxied locations use `$proxy_add_x_forwarded_for` and `$scheme` for forwarded headers.
- Search sweep confirmed the public search leading-wildcard `LIKE` surfaces listed in C3-P1-03.

## Suggested fix order

1. Fix and test the reverse-proxy forwarded header contract (C3-P1-01 and C3-P1-02) before further production hardening.
2. Add reverse-proxy integration tests (C3-P1-05) so the same class does not regress.
3. Decide whether share links are intentionally permanent; either expose revocation/expiry UX or document the permanence clearly (C3-P1-04).
4. Benchmark public search with production-like data and choose whether FULLTEXT/search-table work is warranted (C3-P1-03).
