# Security Reviewer — Cycle 8 (Fresh, broad sweep)

**Scope:** AuthN/AuthZ, CSRF/origin, CSP, headers, rate-limit, injection, file IO, DB, infra.

## File inventory examined

- `lib/{auth-rate-limit,rate-limit,session,api-auth,action-guards,request-origin,validation,csv-escape,sanitize,content-security-policy}.ts`
- `app/actions/{auth,images,public,sharing,admin-users,topics,seo,settings}.ts`
- `app/[locale]/admin/db-actions.ts`
- `app/api/admin/db/download/route.ts`, `app/api/og/route.tsx`
- `lib/{serve-upload,upload-paths,upload-tracker,upload-tracker-state,process-image}.ts`
- `proxy.ts`, `apps/web/Dockerfile`, `docker-compose.yml`, `nginx/default.conf`
- `db/{index,schema}.ts`, `instrumentation.ts`

## Findings

### S8F-01 — Audit-log surface stores raw client-supplied filename in `image_upload` metadata
**Where:** `apps/web/src/app/actions/images.ts:407-412`
```ts
logAuditEvent(currentUser.id, 'image_upload', 'image', undefined, undefined, {
    count: successCount,
    failed: failedFiles.length,
    topic,
    tags: tagNames.join(','),
}).catch(console.debug);
```
And in `failedFiles`: filenames are `file.name` (raw client-supplied). Subsequent `failedFiles` is *not* persisted into audit, but on the deletion path `requestedIds` IS persisted. **Tag names** persisted into audit have already been validated by `isValidTagName`/`isValidTagSlug` so injection through tags is mitigated. **Filenames are not in audit metadata yet**, so this isn't an exploit today — but the asymmetry between "filenames recorded in `console.error`" and "filenames not in audit" makes incident response harder.
**Recommendation:** When an upload partially fails, include the *sanitized* user_filename of the failed entry in audit metadata so post-mortems do not require log scraping. This is a hardening, not a vulnerability.
**Severity:** LOW — defensive observability gap, not a vulnerability.
**Confidence:** Medium.

### S8F-02 — `next.config.ts` `Permissions-Policy` does not opt out of Topics / Attribution-Reporting / FedCM
**Where:** `apps/web/next.config.ts:45`, `nginx/default.conf:39, 110`
**What:** A photo gallery has clear privacy intent. `interest-cohort=()`, `browsing-topics=()`, `attribution-reporting=()`, `private-state-token-redemption=()`, `private-state-token-issuance=()` are missing. Chromium will continue to use the site's traffic for Topics API inference for visiting users.
**Recommendation:** Append the missing directives. No functional change — strictly opt-out hardening.
**Severity:** LOW (privacy / browser-feature posture).
**Confidence:** Medium.

### S8F-03 — `app/api/og/route.tsx` is unauthenticated, no rate-limit, no validation length sanity beyond regex/length
**Where:** `apps/web/src/app/api/og/route.tsx:17-37`
**What:** Anyone can hit `/api/og?topic=<slug>&tags=t1,t2,…` repeatedly. The route validates topic length ≤ 200 and slug regex; `tagList` is sliced to 20 tags. There is **no rate limit** — the existing `loadMoreRateLimit`/`searchRateLimit` Maps are not consulted. Each invocation triggers a full DB lookup (`getTopicBySlug`) PLUS the React-tree → SVG → PNG pipeline (CPU-bound).
**Failure scenario:** A drive-by attacker scripts `for i in $(seq 1 10000)` against `/api/og?topic=valid-topic&tags=...` and burns CPU. With Sharp concurrency capped but `next/og` running on Node, the process becomes unresponsive to legitimate traffic.
**Recommendation:** Reuse the per-IP `searchRateLimit` Map (or a dedicated `og` bucket) with a small budget (e.g., 30/min/IP). Combine with the existing `Cache-Control: no-store` change so legitimate crawlers cache and abusive scripts get rejected.
**Severity:** MEDIUM — CPU-amplification DoS on a public unauthenticated endpoint.
**Confidence:** High.

### S8F-04 — `process-image.ts` accepts `.gif` and `.bmp` formats but `image/gif` is exposed in `serve-upload.ts` CONTENT_TYPES (without a directory whitelist)
**Where:** `apps/web/src/lib/process-image.ts:42` (ALLOWED_EXTENSIONS includes `.gif`, `.bmp`), `apps/web/src/lib/serve-upload.ts:19-26` (CONTENT_TYPES has `.gif`).
**What:** `serve-upload.ts` validates the directory ↔ extension pair via `DIR_EXTENSION_MAP`, which only allows `.jpg/.jpeg`, `.webp`, `.avif`. So `.gif` cannot actually be served. But it CAN be uploaded as an "original" that Sharp processes. GIF processing in Sharp is OK for static frames but animated GIFs are silently coerced. BMP is rare and large.
**Recommendation:** Either (a) drop `.gif/.bmp` from ALLOWED_EXTENSIONS to match the served formats, or (b) document why originals can be GIF/BMP even though derivatives can't. Currently the asymmetry hides the policy.
**Severity:** LOW — confusing but not exploitable.
**Confidence:** Medium.

### S8F-05 — `apps/web/Dockerfile` does not run `npm ci --ignore-scripts` for the production image
**Where:** `apps/web/Dockerfile:32, 26`
**What:** `npm ci` runs `postinstall` scripts on every dependency. With Sharp, argon2, mysql2 all having native postinstall steps this is necessary for the `deps` stage. But the `prod-deps` stage also runs unguarded postinstall — a malicious dep update at any future time could execute arbitrary code at image build time. Modern best-practice: `--ignore-scripts` on `prod-deps` and explicitly rebuild the few native deps needed (`sharp`, `argon2`).
**Recommendation:** Switch `prod-deps` to `npm ci --omit=dev --ignore-scripts --workspace=apps/web && npm rebuild --workspace=apps/web sharp argon2`. The `deps` stage (used only for `next build`) can keep scripts on if the build fails without them, but typically the same approach works.
**Severity:** LOW — supply-chain hardening, not a current vulnerability.
**Confidence:** Medium.

### S8F-06 — `instrumentation.ts` SIGTERM handler accepts up to 15s; `docker-compose.yml` `stop_grace_period: 30s`
**Where:** `apps/web/src/instrumentation.ts:8-15`, `apps/web/docker-compose.yml:11`
**What:** Behavior is fine — Compose grants 30s, app forces exit at 15s. But there is **no explicit reaction to SIGKILL after 15s**: the app has already called `process.exit(0)`. If the queue still has work, `flushBufferedSharedGroupViewCounts` may have been racing the timeout. The shutdown bias is correct.
**Concern:** The shutdown handler does not reject *new* `requireSameOriginAdmin` actions during the 15s window. A late-arriving authenticated mutation could begin and partially commit while the process is exiting.
**Recommendation:** Set a `state.shuttingDown` flag (already exists for the queue) and have `requireSameOriginAdmin` short-circuit when it's true. Most Compose deployments pause traffic at the proxy before sending SIGTERM, which mitigates this — but defense in depth is cheap.
**Severity:** LOW — depends on operator's reverse-proxy drain behavior.
**Confidence:** Low.

### S8F-07 — `verifySessionToken` uses `cache(...)` for per-request dedup but the cache also persists for the *full request lifetime* of a server action
**Where:** `apps/web/src/lib/session.ts:94`
**What:** React `cache()` deduplicates within a render pass / server action. After a password change inside `updatePassword`, the new session token is set into the cookie at line 387, but if the same request later calls `getCurrentUser()` it would re-derive against the OLD token because `cache()` already memoized the previous token's lookup. In practice `updatePassword` redirects/returns before further calls happen, but a future code-path that calls `getCurrentUser()` after `updatePassword` in the same request boundary could see stale state.
**Recommendation:** Document this caveat at the cache call site, or wrap the cache with a manual invalidation hook for password change.
**Severity:** LOW — speculative, depends on future refactor.
**Confidence:** Low.

### S8F-08 — `nginx/default.conf` has `Permissions-Policy` set in two places (top-level AND inside specific location blocks)
**Where:** `apps/web/nginx/default.conf:39, 110`
**What:** Defense-in-depth header repetition. With `add_header ... always` Nginx applies the *most-specific* one, so duplicating is fine. But maintenance hazard: a future operator who updates only the top-level value will see the stale value still served from the location block. Pure cosmetic.
**Severity:** LOW.
**Confidence:** Medium.

## Severity distribution

- MEDIUM: 1 (S8F-03 OG route DoS amplifier)
- LOW: 7

## Cross-cutting observations

- No fresh exploitable vulnerabilities discovered. The auth/upload/restore boundary is genuinely well-hardened from prior cycles.
- The most material residual risk is S8F-03 (`/api/og` rate limiting) — a public, unauthenticated CPU-bound endpoint with no rate limit is the standard external-trigger amplifier pattern.
- Privacy-header coverage (S8F-02) and supply-chain hardening (S8F-05) are next-tier maintenance items.
