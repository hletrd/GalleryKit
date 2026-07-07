# Cycle 15 Critic Review

Date: 2026-07-07
Reviewer: critic
Mode: read-only review except this report.
Specialty: strongest objections, hidden tradeoffs, and aging risks.

## Inventory And Coverage

Inventory was built before finding selection.

- Tracked repository inventory: 3,468 files.
- Review-relevant tracked inventory: 736 files.
- Included surfaces: `AGENTS.md`, relevant `CLAUDE.md`, required review prompts, root/app package and lock files, app build/config/deploy files, nginx template, `apps/web/src` routes/actions/lib/components/db/instrumentation/proxy, scripts, migrations, public/service-worker assets, messages, e2e tests, and unit/source-contract tests.
- Relevant inventory by bucket: app routes/actions 81, lib 114, components 61, db 3, tests 359, scripts 28, migrations 34, e2e 12, public assets/SW 9, build/config 12, nginx 1, i18n 2, required docs/prompts 14, other app entry/config files 6.
- Excluded from behavioral conclusions: generated/dependency/runtime outputs (`.git`, `node_modules`, `.next`, `.omx`, `.omc`), local secret/env files, and historical review/plan archives except the required prompt files and current operator docs.

Primary validation and sweeps:

- Read required instructions: `AGENTS.md`, relevant architecture/security/testing/deploy sections in `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/critic.md`.
- Ran repo-wide static sweeps over TODO/FIXME/HACK/manual/operator/process-local warnings, raw SQL/security sinks, admin API wrapping, server-action origin guards, public route rate limits, cache/revalidation, service worker paths, semantic search, nginx/proxy, deployment, migrations, privacy/public select fields, and rate-limit state.
- Ran guard scanners:
  - `npm run lint:api-auth --workspace=apps/web` passed.
  - `npm run lint:action-origin --workspace=apps/web` passed.
  - `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Verified committed `apps/web/public/sw.js` matches `apps/web/public/sw.template.js` stamped with `IMAGE_PIPELINE_VERSION=7` (`36c91deb-p7`).
- Full lint/typecheck/build/unit/e2e were not run because this task is review-only and made no code changes beyond this report.

## Confirmed Issues

### C15-CRIT-01 - Nginx multi-hop proxy comments still contradict the tested/documented client-IP contract

- Severity: Medium
- Confidence: High
- Status: Confirmed issue
- File/region:
  - `apps/web/nginx/default.conf:20-28`
  - `apps/web/nginx/default.conf:59-71`
  - `apps/web/nginx/default.conf:100-112`
  - `apps/web/nginx/default.conf:270-306`
  - `README.md:172-174`
  - `apps/web/README.md:56`
  - `apps/web/.env.local.example:63-70`
  - `apps/web/src/__tests__/nginx-config.test.ts:33-44`
  - `apps/web/src/lib/rate-limit.ts:175-197`
- Problem: The nginx template still tells operators that in an upstream-LB topology they `MUST` switch `X-Forwarded-For` from `$remote_addr` to `$proxy_add_x_forwarded_for` and set `TRUSTED_PROXY_HOPS` to the real hop count. The root README, app README, env example, and test suite define the opposite shipped contract: nginx overwrites incoming XFF with `$remote_addr`, operators keep `TRUSTED_PROXY_HOPS=1`, and any outer edge must be normalized with nginx `real_ip` or PROXY protocol before forwarding to the app. The test suite explicitly rejects `$proxy_add_x_forwarded_for`.
- Concrete failure scenario: An operator follows `apps/web/nginx/default.conf:69-71` for `client -> LB -> nginx -> app`, switches locations to `$proxy_add_x_forwarded_for`, and sets `TRUSTED_PROXY_HOPS=2`. `getClientIp()` selects the address before the trusted suffix when the chain is long enough and otherwise falls back to `X-Real-IP`; with the template still setting `X-Real-IP $remote_addr`, app-layer login/search/share budgets can collapse to the LB address. That causes global 429s for legitimate users and weakens abuse isolation.
- Suggested fix: Make the nginx comments match the tested contract: use nginx `real_ip` / PROXY protocol to normalize `$remote_addr`, keep overwriting XFF to the app, and keep `TRUSTED_PROXY_HOPS=1` for the shipped nginx-app hop. If append-mode support is desired, change the nginx template, READMEs, env example, tests, proxy checker, and `getClientIp()` examples together with concrete header-chain examples.

## Likely Issues

### C15-CRIT-02 - Docker native-package pins duplicate the lockfile and will drift on dependency upgrades

- Severity: Medium
- Confidence: High
- Status: Likely issue, not currently broken
- File/region:
  - `apps/web/Dockerfile:50-62`
  - `apps/web/Dockerfile:76-85`
  - `apps/web/package.json:59-68`
  - `apps/web/package.json:79-87`
  - `package-lock.json` entries for `next`, `sharp`, `@next/swc-linux-*`, `@img/sharp-*`, `@swc/core-linux-*`, `lightningcss-linux-*`, `@parcel/watcher-linux-*`
- Problem: The Dockerfile installs Linux native packages with literal versions after `npm ci --no-save`. Those versions currently match the lockfile (`next 16.2.10`, `sharp 0.34.5`, native pins matching the same versions), but nothing enforces that relationship. The normal dependency bump path updates `package.json`/`package-lock.json`; it does not force a Dockerfile edit.
- Concrete failure scenario: A future Next or Sharp upgrade passes local macOS tests and updates the lockfile, but leaves `@next/swc-linux-${npm_arch}@16.2.10` or `@img/sharp-linux-${npm_arch}@0.34.5` in the Dockerfile. The deploy-only Linux build can then fail at `next build`, load an incompatible native binary, or ship a runtime image whose externalized `sharp` dependency does not match the JS package.
- Suggested fix: Remove hand-copied native versions from the Dockerfile. Either derive them from `package-lock.json` during the Docker build with a small Node helper, or add a blocking source-contract test that parses Dockerfile pins and compares them to the lockfile. Prefer a single source of truth over another comment reminding future agents to update both.

## Risks Requiring Manual Validation

### C15-RISK-01 - Public SSR and image-optimizer rate limits depend on manually applied host nginx

- Severity: High if production host config is stale; otherwise low
- Confidence: Medium
- Status: Risk requiring production/host validation
- File/region:
  - `apps/web/nginx/default.conf:1-29`
  - `apps/web/nginx/default.conf:274-294`
  - `apps/web/deploy.sh:51-56`
  - `CLAUDE.md:245-247`
  - `CLAUDE.md:508-518`
- Problem: The repo documents that public SSR pages are protected at the nginx edge, not by app-layer page limiters, and `deploy.sh` only rebuilds/restarts Docker. It does not apply or verify the host nginx template. A commit can therefore “fix” or add an edge limiter in the repo while production continues running a stale host config.
- Concrete failure scenario: A crawler floods `/`, `/p/:id`, `/map`, `/timeline`, or `/_next/image`. The app routes are dynamic (`revalidate = 0`) and multi-query/CPU-heavy; if the host nginx config was never applied or lacks real-IP normalization, the intended per-IP public/nextimage zones either do not exist or key all users to one upstream address.
- Suggested fix: Add a non-destructive deploy/ops verification step that captures `nginx -T` from the host and checks the active config for the committed limiter zones, upload caps, XFF contract, and real-IP topology. Longer term, manage the host nginx config through the same deploy/IaC path or add app-layer page throttling for deployments where edge enforcement cannot be guaranteed.

### C15-RISK-02 - Semantic search recall is bounded by recency, not by relevance

- Severity: Medium
- Confidence: High
- Status: Risk requiring production-scale validation
- File/region:
  - `apps/web/src/app/api/search/semantic/route.ts:263-311`
  - `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
  - `apps/web/src/db/schema.ts:292-304`
  - `apps/web/src/lib/clip-embeddings.ts:22-48`
  - `apps/web/README.md:67-76`
  - `CLAUDE.md:620-625`
- Problem: Both semantic text search and similar-photo search select only the newest `SEMANTIC_SCAN_LIMIT` embedding rows, then score that bounded set in process. The index supports `model_version + updated_at`, not vector similarity. This is honest in the docs, but it is still a product-aging ceiling: once the gallery exceeds the scan limit, older relevant photos can become unsearchable regardless of their score.
- Concrete failure scenario: A 30,000-photo archive has older wedding or travel photos with perfect semantic matches, but the default scan limit is 2,000 and the hard cap is 25,000. A user searches for a specific concept that exists only in older rows; the API returns weaker or empty results because those rows were never candidates.
- Suggested fix: Before presenting semantic search as complete retrieval, validate production row counts and query recall against representative old/new albums. For durable scale, introduce a real vector index/ANN sidecar, a database-native vector capability if adopted, or another all-row candidate strategy that does not make relevance dependent on upload/re-embed recency.

### C15-RISK-03 - Service-worker HTML offline caching is broad by default and future personalized routes must opt out deliberately

- Severity: Medium for future personalized/public routes
- Confidence: Medium
- Status: Risk requiring future-route validation
- File/region:
  - `apps/web/public/sw.template.js:438-473`
  - `apps/web/public/sw.template.js:547-555`
  - `apps/web/src/proxy.ts:112-122`
  - `apps/web/src/__tests__/sw-template-contract.test.ts:102-147`
- Problem: The service worker caches any OK HTML response for offline fallback unless it is admin-session-rendered or matches today’s revocable object routes (`/c`, `/s`, `/g`, `/map`). That is correct for the current public gallery, but the default is cache-all HTML. Future public pages with user-specific, expiring, or private-but-not-admin content will be cached for up to 24 hours unless the author remembers to add a route-pattern bypass or server marker.
- Concrete failure scenario: A future private proofing page, client login area, expiring preview link, or personalized public dashboard ships outside `/admin` and outside the current `[csg]`/`map` patterns. A visitor loads it once, loses network, logs out or has access revoked, and the browser can still serve the cached HTML offline.
- Suggested fix: Invert the policy to an allowlist of offline-safe public routes, or add a server-controlled opt-in/opt-out header such as `x-gk-offline-cache`. Add a source-contract test that every new HTML route is classified as offline-safe or offline-bypassed, instead of relying on broad fallback behavior.

### C15-RISK-04 - The single-writer topology is warn-only, so accidental scale-out degrades correctness instead of failing closed

- Severity: High if replicas are introduced
- Confidence: High
- Status: Risk requiring deployment-topology validation
- File/region:
  - `apps/web/src/lib/single-writer-guard.ts:6-16`
  - `apps/web/src/lib/single-writer-guard.ts:218-235`
  - `apps/web/src/instrumentation.ts:22-31`
  - `apps/web/src/lib/admin-mutation-barrier.ts:11-29`
  - `apps/web/src/lib/data.ts:49-63`
  - `CLAUDE.md:245-249`
- Problem: The app has a well-documented single-web-instance design, but the runtime guard only logs and continues when another process holds the singleton advisory lock. Several correctness and abuse-control mechanisms are process-local: restore mutation draining, upload quota/tracker state, queue/backfill status, some rate-limit fast paths, and buffered shared-group view counts.
- Concrete failure scenario: An operator accidentally deploys two web replicas against the same DB. One process starts a restore and drains only its local foreground mutation slots; an admin mutation already admitted in the other process can still complete after the import begins. Public rate-limit budgets can also split across processes, while buffered analytics can be lost per process on crashes.
- Suggested fix: Either make production startup fail closed on persistent singleton-lock contention unless an explicit `ALLOW_MULTI_INSTANCE_UNSAFE=true` override is set, or move the process-local coordination state into shared durable storage and make the guard informational only after the architecture is actually multi-instance safe. Add deploy-time replica-count validation for the documented topology.

## Final Sweep

Commonly missed areas checked:

- Admin API auth wrapping: scanner passed; admin API routes are wrapped by `withAdminAuth(...)`.
- Mutating server-action same-origin provenance: scanner passed; mutating admin actions enforce `requireSameOriginAdmin()` or carry explicit exemptions.
- Public API route rate limiting: scanner passed; public mutating/expensive routes use pre-increment helpers or documented exemptions.
- JSON-LD/script injection: public JSON-LD sites use `safeJsonLd`; no raw broad `dangerouslySetInnerHTML` path was found outside those structured-data blocks.
- Privacy boundary: public/admin select fields and `_PrivacySensitiveKeys` were reviewed; no new unguarded admin-only column exposure was found in this pass.
- Service worker drift: generated `sw.js` matches the template stamp.
- BoundedMap shallow-copy follow-up: current cycle-15 write-back fixes are present in `sharing.ts`, `admin-users.ts`, and `embeddings.ts`; no production `.data` reach-around use was found.

No review-relevant file in the 736-file inventory was intentionally skipped. Files excluded from behavioral conclusions were generated outputs, dependencies, runtime state, local secrets, and historical review/plan archives that do not define current app behavior.
