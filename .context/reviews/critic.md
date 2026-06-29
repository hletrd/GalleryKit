# Cycle 13 Critic Review

Review target: repository state inspected on 2026-06-29 from `/Users/hletrd/flash-shared/gallery`.

Role: critic subagent. I did not modify production code, revert changes, run deploys, or change runtime data. This report is the intended output.

## Coverage

Required guidance read first:
- `AGENTS.md`
- `CLAUDE.md`
- Code-review skill instructions

Inventory built before findings:
- 6471 review-relevant files after excluding `.git`, `node_modules`, build output, test reports, runtime data, and upload/resource payload directories.
- Active source focus: `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/drizzle/**`, `apps/web/e2e/**`, root/app package/config files, nginx/docker/deploy files, `.github/**`, `README.md`, `AGENTS.md`, `CLAUDE.md`, and committed `.context/**` review/plan history.

High-risk surfaces read directly:
- Public pages and analytics actions.
- Admin/public API route guard patterns.
- Rate-limit/proxy IP handling.
- Data privacy projections and privacy tests.
- Migrations, migration runner, schema tests, and journal tests.
- Service worker template/generated contract tests.
- Smart collections, search, share links, uploads, deploy, nginx, and docs.

## Findings Summary

Confirmed issues: 3

Likely issues: 0

Risks needing manual validation: 1

No Critical or High findings were promoted from this pass.

## Confirmed Issues

### C13-CRIT-01 - Fire-and-forget analytics can still reject before the internal catch

Severity: Medium

Confidence: High

Category: Correctness / operations / testing

Status: Confirmed

Code regions:
- `apps/web/src/app/actions/public.ts:357-361` documents photo view recording as fire-and-forget, non-blocking, and internally swallowed.
- `apps/web/src/app/actions/public.ts:365-384` catches only the final `db.insert(...).values(...).catch(...)`; `headers()`, `buildViewParams(...)`, rate limiting, and the visibility `db.select(...)` can still reject before that catch is attached.
- `apps/web/src/app/actions/public.ts:388-410` has the same pattern for topic views.
- `apps/web/src/app/actions/public.ts:415-441` has the same pattern for shared-group views.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:163-165` discards the returned promise with `void recordPhotoView(image.id)` and says errors are swallowed internally.
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164` discards `recordTopicView(...)`.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-131` discards `recordSharedGroupView(...)`.
- `apps/web/src/__tests__/public-actions.test.ts:241-250` covers successful non-blocking inserts.
- `apps/web/src/__tests__/public-actions.test.ts:253-267`, `apps/web/src/__tests__/public-actions.test.ts:295-304`, and `apps/web/src/__tests__/public-actions.test.ts:307-317` cover public-target miss, maintenance skip, and rate-limit skip, but not a rejected pre-insert select/header path.

Failure scenario:
During a transient DB outage, the visibility lookup in `recordPhotoView`, `recordTopicView`, or `recordSharedGroupView` rejects before the final insert promise exists. The page call site has already discarded the returned promise, so the rejection is unhandled from the render path. Depending on runtime settings, this can produce unhandled-rejection noise, trigger process restarts, or at minimum violate the explicit product invariant that analytics must never break public UX.

Suggested fix:
Wrap the full recorder body after cheap input validation in a top-level `try/catch`, then log at most a concise analytics warning and return. Alternatively attach `.catch(...)` at every `void record*View(...)` call site, but the invariant is easier to preserve inside the recorder. Add regression tests where `headers()` or the public-target `db.select(...)` rejects and each recorder resolves without throwing or producing an unhandled promise.

### C13-CRIT-02 - nginx collapses forwarded client IPs while docs describe a multi-hop edge topology

Severity: Medium

Confidence: High for the mismatch; production impact depends on the actual edge topology.

Category: Operations / security / docs / cross-module contract

Status: Confirmed

Code regions:
- `apps/web/nginx/default.conf:6-8` says this nginx can be the internal HTTP hop behind a TLS-terminating load balancer.
- `apps/web/nginx/default.conf:25-29` repeats that the file is intended behind a TLS-terminating edge/load balancer.
- `apps/web/nginx/default.conf:68-70`, `apps/web/nginx/default.conf:85-87`, `apps/web/nginx/default.conf:102-104`, `apps/web/nginx/default.conf:118-120`, `apps/web/nginx/default.conf:142-144`, `apps/web/nginx/default.conf:159-161`, `apps/web/nginx/default.conf:181-183`, and `apps/web/nginx/default.conf:194-196` set `X-Real-IP` and `X-Forwarded-For` to `$remote_addr` in every proxied location.
- `apps/web/src/lib/rate-limit.ts:161-183` trusts `X-Forwarded-For` only when `TRUST_PROXY=true`, then selects the client immediately before the trusted proxy suffix and falls back to `X-Real-IP`.
- `apps/web/src/lib/rate-limit.ts:168-173` explicitly models a chain like `client, cdn, nginx` with `TRUSTED_PROXY_HOPS=2`.
- `README.md:151-154` documents shipped nginx as an internal hop, says compose forces `TRUST_PROXY=true`, and tells operators to set `TRUSTED_PROXY_HOPS=2` for `CDN/LB -> nginx -> app`.
- `apps/web/src/__tests__/nginx-config.test.ts:30-33` currently locks the opposite behavior by asserting nginx does not use `$proxy_add_x_forwarded_for` and does overwrite inbound `X-Forwarded-For` with `$remote_addr`.

Failure scenario:
If production has Cloudflare or another TLS/LB hop in front of host nginx, the upstream edge may send a verified `X-Forwarded-For: client, edge` chain. Host nginx then replaces it with only `$remote_addr`, which is the edge or load-balancer address. The app sees a one-element chain; with `TRUSTED_PROXY_HOPS=2` it cannot select a client slot, and its fallback `X-Real-IP` is the same edge address. Login, search, share, analytics, and other per-IP buckets then collapse many real users behind the edge into one bucket, while abuse from one client can throttle unrelated users.

Suggested fix:
Choose and encode one topology. If upstream CDN/LB support is intended, configure nginx to verify the trusted upstream first, for example with `set_real_ip_from`, `real_ip_header X-Forwarded-For`, and `real_ip_recursive on`, then forward the sanitized client identity consistently and update the nginx source test. If a single host-nginx hop is the only supported topology, remove the multi-hop/CDN guidance from `README.md` and nginx comments, keep `TRUSTED_PROXY_HOPS=1`, and keep the anti-spoofing overwrite test as the documented contract.

### C13-CRIT-03 - Review scratch files under `.context/reviews` are easy to commit accidentally

Severity: Low

Confidence: High

Category: Maintainability / repository hygiene / docs

Status: Confirmed

Code regions:
- `.gitignore:19-21` ignores `.context/*` and then unignores `.context/reviews/**`.
- `.gitignore:22-25` re-ignores only review logs and `gate-logs`, leaving temporary inventory or scratch artifacts under `.context/reviews` trackable.

Failure scenario:
A reviewer or automation process writes an intermediate inventory, JSON dump, raw grep output, or hidden scratch file under `.context/reviews` while producing a committed review artifact. Because the negation unignores the entire subtree, that scratch file appears in `git status` and can be committed with the report. I hit this exact footgun during this review with a temporary `.context/reviews/.critic-inventory.tmp` inventory file.

Suggested fix:
Add explicit ignore rules for `.context/reviews/**/*.tmp`, `.context/reviews/**/.tmp-*`, or hidden scratch files such as `.context/reviews/.*.tmp`. Better yet, document or create a separate ignored `.context/scratch/` location for reviewer inventories and generated diagnostics.

## Likely Issues

None promoted. The remaining suspicious areas either already have source-contract tests or depend on deployment state that I could not validate from the repository alone.

## Risks Needing Manual Validation

### C13-CRIT-R1 - Current production proxy topology determines whether C13-CRIT-02 is live

Severity: Medium if production has a CDN/LB in front of host nginx; Low if host nginx is the only trusted hop.

Confidence: Medium

Manual validation needed:
- Confirm whether live traffic reaches `apps/web/nginx/default.conf` directly from clients or through Cloudflare / a TLS load balancer / another reverse proxy.
- Confirm the live values of `TRUST_PROXY` and `TRUSTED_PROXY_HOPS`.
- Check rate-limit logs or analytics distribution for edge-IP bucket collapse.

Suggested validation:
From a controlled client, send a request through the live edge and inspect the app-visible `x-forwarded-for` / `x-real-ip` chain via a temporary authenticated diagnostic path or logs that do not expose public data. Do not trust raw client-injected forwarded headers; validate from the trusted edge side.

## Final Sweep

Commonly missed issue classes checked:
- Public/admin route auth wrappers and mutating-action same-origin guards.
- Public mutating API rate-limit pre-increment conventions and explicit exemptions.
- Privacy-sensitive admin fields in public data projections and the symmetric type/test guard.
- JSON-LD sinks and CSP nonce/safe-string helper usage.
- Upload path traversal controls, original-file serving restrictions, and edge/body-size contracts.
- Semantic-search, smart-collection, shared-link, and public analytics expensive-resource paths.
- Migration journal monotonicity, reconcile coverage, and schema/runtime write contracts.
- Service worker template/generated file drift and bounded cache-warming tests.
- Deployment docs, nginx, Docker, and host-network assumptions.
- Touch-target/a11y test surfaces and Korean/i18n message surfaces.

No additional high-confidence correctness, data-loss, privacy, or security findings were promoted from that sweep.

Verification performed for this review:
- Read required guidance before analysis.
- Built a non-excluded repository inventory before findings.
- Ran repo-wide static searches for unsafe sinks, guard coverage, uploads, proxy headers, migrations, env/config, and source-contract patterns.
- Read high-risk files directly and checked cited line anchors.
- Did not run lint/typecheck/test suites because this was a review-only artifact and no production code was modified.
