# Cycle 37 Critic Review

Scope: whole-repository critic pass for product contract, maintainability, operability, edge cases, code/docs drift, hidden assumptions, UX risk, and cross-module coupling. No product code was edited.

## Inventory

I first read the workspace rules in `AGENTS.md` and the detailed operating guide in `CLAUDE.md`, then built a review inventory from tracked files.

- Inventory size: 3,626 tracked files.
- High-signal areas inventoried: `apps/web/src/app` routes/actions (81), `apps/web/src/components` (61), `apps/web/src/lib` (115), `apps/web/src/db` (3), `apps/web/drizzle` migrations/meta (34), `apps/web/scripts` (29), `apps/web/e2e` (12), `apps/web/src/__tests__` (368), root/app docs, deploy scripts, nginx/Docker config, and `.context` review history.
- Examined files included: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `apps/web/package.json`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/photo-navigation.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/map/map-client.tsx`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/nginx/default.conf`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, and `scripts/check-proxy-topology.mjs`.

Validation run during review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Source sweeps covered `dangerouslySetInnerHTML`, `innerHTML`, raw SQL surfaces, route/action exemption comments, public route rate-limit exemptions, OpenStreetMap tile usage, semantic search paths, and privacy/product copy.

## Findings

### C37-CRIT-01: Lightroom upload path still materializes the full multipart body before streaming to disk

- Severity: Medium
- Confidence: Medium
- Status: Likely
- Perspective: operability, edge-case resource exhaustion, cross-module upload contract
- Files/lines:
  - `apps/web/README.md:56` documents upload and nginx caps up to 200 MiB per file / 216 MiB route cap.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:136-141` admits requests up to the configured file cap plus multipart overhead.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:165-195` serializes multipart parsing but still calls `await request.formData()`.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:203-209` only checks the `File` size after the framework has parsed the multipart body.
  - `apps/web/src/lib/process-image.ts:882-888` confirms the downstream helper streams only after the framework has already materialized the `File`.

Concrete failure scenario: an external publish client uploads a 180-200 MiB image through `/api/admin/lr/upload` on the disk-constrained production host. The route has a one-request parse slot, but the active request still materializes the multipart body before `saveOriginalAndGetMetadata()` can stream it to disk. Native Sharp/libvips work then adds memory pressure after the large `File` exists. Under a small container/host memory ceiling, the process can OOM or restart mid-upload, causing a failed publish and potentially interrupting unrelated visitors.

Suggested fix: replace `request.formData()` on the LR route with a streaming multipart parser that writes the file to a staging path while enforcing the declared and actual byte caps, then pass the staged file path into the existing metadata/processing pipeline. If that is too large a change, document a minimum memory budget for the 216 MiB route cap and lower the cap by default for the external upload path.

### C37-CRIT-02: The self-hosted/privacy contract under-documents the always-on OpenStreetMap tile dependency

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Perspective: product contract, privacy/operability, docs drift
- Files/lines:
  - `README.md:29` frames the product around self-hosting and first-party/self-hosted local analytics by default.
  - `README.md:38` advertises map browsing as part of the visitor experience.
  - `README.md:77` calls out Google Analytics as the explicit third-party analytics opt-in, but does not mention map tile requests in the configuration section.
  - `apps/web/src/components/map/map-client.tsx:116-119` hardcodes `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`.
  - `apps/web/src/lib/content-security-policy.ts:133-137` permanently allowlists the three OpenStreetMap tile hosts.
  - `apps/web/messages/en.json:851-852` and `apps/web/messages/ko.json:851-852` do disclose the tile-server request on the privacy page.

Concrete failure scenario: an operator deploys GalleryKit for a no-third-party-request portfolio, leaves Google Analytics disabled as documented, and enables map-visible topics. Visitors to `/map` still make direct browser requests to OpenStreetMap tile servers, exposing IP/device/referrer and approximate viewed map area. The privacy page copy is accurate, but the setup/product docs do not make this an operator-level dependency or configuration decision.

Suggested fix: either make the tile URL an explicit deploy/config setting with a self-host/proxy/disable option, or document the OpenStreetMap dependency next to the map feature and analytics configuration. If strict self-hosting is a supported deployment posture, add an option to hide `/map` or require an operator-supplied tile endpoint before rendering it.

### C37-CRIT-03: Photo prev/next navigation loses the visitor's source collection context

- Severity: Medium
- Confidence: Medium
- Status: Likely
- Perspective: UX risk, hidden assumption, cross-module coupling
- Files/lines:
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:187-191` builds a topic/tag-filtered image list for the collection page.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:229` passes the topic-filtered first page into `HomeClient`.
  - `apps/web/src/components/masonry-card.tsx:78-82` links every card to `/p/{id}` without carrying topic/tag/search/timeline/map context.
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:286-291` renders `PhotoViewer` with only `[image]` plus server-computed `prevId` and `nextId`.
  - `apps/web/src/lib/data.ts:1161-1197` computes previous/next against all processed images, with no topic/tag/source filter.
  - `apps/web/src/components/photo-viewer.tsx:225-257` routes prev/next to `/p/{id}` when not in a shared-group view.

Concrete failure scenario: a visitor opens `/ko/travel?tags=seoul`, clicks a photo, then swipes next in the viewer expecting the next Seoul/travel photo. Because the detail page recomputes adjacency globally, the next item can be from a different topic or tag filter. The same context loss applies to map, timeline, search, and smart-collection entry points unless those flows stay in an in-page lightbox.

Suggested fix: preserve the source collection explicitly when linking to a photo, for example with a signed/validated query context, session key, or route-specific viewer state, and compute adjacency within that bounded context. If global chronology is the intended behavior, label it clearly in the viewer and provide a return-to-source affordance so the UX does not imply filtered continuation.

### C37-CRIT-04: The proxy topology check is documented as read-only but consumes semantic-search rate-limit budget

- Severity: Low
- Confidence: High
- Status: Confirmed
- Perspective: operability, diagnostics, hidden side effect
- Files/lines:
  - `scripts/check-proxy-topology.mjs:7-10` describes the check as read-only and says it reaches same-origin/client-IP/rate-limit handling.
  - `scripts/check-proxy-topology.mjs:106-127` sends two POST probes to `/api/search/semantic`.
  - `apps/web/src/app/api/search/semantic/route.ts:173-184` pre-increments the semantic-search limiter before semantic mode lookup and before disabled-mode responses.
  - `apps/web/src/lib/rate-limit.ts:415-426` implements that semantic limiter as an in-process counter.

Concrete failure scenario: during a deploy/proxy incident, an operator repeatedly runs `npm run check:proxy-topology -- --url ...` from the same public IP. Each run consumes two semantic-search attempts in the app process. With the current 30/minute semantic cap, repeated diagnostics can push the operator or shared NAT users into 429 responses, obscuring the original proxy issue with a local rate-limit artifact.

Suggested fix: change the help text to state the probe consumes semantic limiter attempts, or add a dedicated diagnostic path that exercises the same forwarded host/proto logic without charging the public semantic-search budget. A narrower alternative is to roll back the semantic limiter for a recognized internal diagnostic header, but only if that header is trusted at the edge and cannot be used publicly to bypass rate limits.

## Non-Findings / Guardrails Confirmed

- Admin API exports are covered by `withAdminAuth(...)`; `lint:api-auth` passed for `api/admin/db/download` and `api/admin/lr/upload`.
- Mutating server actions enforce same-origin provenance or carry scanned read-only/public-rate-limited exemptions; `lint:action-origin` passed.
- Public mutating/expensive route handlers either use a pre-increment rate-limit helper or carry an explicit exemption; `lint:public-route-rate-limit` passed.
- Public map GPS exposure has a strong two-layer guard: `getMapImages()` joins only `topics.map_visible = true`, filters non-null coordinates, and asserts every returned row's `topic_map_visible` at `apps/web/src/lib/data.ts:1777-1816`.
- Privacy-sensitive field selection is intentionally guarded in `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, and `apps/web/src/__tests__/privacy-fields.test.ts`.
- JSON-LD uses `safeJsonLd` on the inspected public pages; I did not find an obvious raw `dangerouslySetInnerHTML` XSS path in the reviewed public page surfaces.
- The quarantined storage abstraction is defended by `apps/web/src/__tests__/storage-quarantine.test.ts`; I did not treat the unused local storage adapter as active production coupling.

## Final Missed-Issues Sweep

Before writing this review I did a final pass over public routes, admin routes, server actions, upload serving, semantic/similar search, map/timeline/photo pages, deploy scripts, nginx limits, Docker config, schema/migrations, privacy copy, and representative tests. I did not run the full lint/typecheck/build/test suite because this was a read-only critic pass and the targeted invariant gates above already covered the highest-risk auth/origin/rate-limit claims. Residual risk remains in unexecuted browser-flow behavior, very large gallery performance, and deployment-specific proxy/CDN setups that cannot be proven from source alone.
