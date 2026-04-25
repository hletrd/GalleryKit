# Document Specialist Review — PROMPT 1 / Cycle 5 (2026-04-25)

No commits made.

## Inventory and method

Reviewed the doc/config/runtime surfaces most likely to drift:

- Top-level docs: `README.md`, `CLAUDE.md`, `AGENTS.md`
- App docs and examples: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `.env.deploy.example`
- Deployment/runtime config: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- Package metadata: `package.json`, `apps/web/package.json`
- Authoritative runtime source: `apps/web/src/lib/{content-security-policy,rate-limit,request-origin,upload-limits,upload-paths,db-restore,mysql-cli-ssl,session}.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/instrumentation.ts`, `apps/web/scripts/ensure-site-config.mjs`
- Verification tests: `apps/web/src/__tests__/{next-config,request-origin,seo-actions}.test.ts`

Final sweep re-ran targeted searches for `IMAGE_BASE_URL`, `TRUST_PROXY`, `Origin`, `Referer`, `site-config`, deploy env knobs, and proxy/SEO guardrails, then checked the matching code paths before recording findings.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| WDS-01 | LOW | High | Confirmed | `IMAGE_BASE_URL` docs omit hard URL constraints that the build/parser enforces |
| WDS-02 | MEDIUM | High | Confirmed | `TRUST_PROXY` docs omit the forwarded-hop ordering/rate-limit trust model |
| WDS-03 | LOW | High | Confirmed | Same-origin docs omit the fail-closed requirement when `Origin`/`Referer` are missing |

## Detailed findings

### WDS-01 — `IMAGE_BASE_URL` docs omit the parser/build constraints that reject query strings, hashes, and credentials

- **Status:** Confirmed
- **Severity:** LOW
- **Confidence:** High
- **Risk:** Operators can pick a CDN URL that looks valid in prose but fails the build, or can spend time debugging a production-only `IMAGE_BASE_URL` rejection that the docs never warned about.
- **Doc files/regions:** `README.md:128-145`, `apps/web/README.md:36-38`, `apps/web/.env.local.example:11-15`
- **Code files/regions:** `apps/web/src/lib/content-security-policy.ts:1-25`, `apps/web/next.config.ts:8-29`, `apps/web/src/__tests__/next-config.test.ts:5-14`
- **Why this is a problem:** The docs already say `IMAGE_BASE_URL` should be an absolute CDN origin/prefix and that production rejects plaintext `http://`, but the code is stricter: it also rejects any URL with credentials, query strings, or hashes. Those invalid forms are easy to reach if someone copies a signed CDN URL or a pre-authenticated asset URL into the env example.
- **Failure scenario:** An operator sets `IMAGE_BASE_URL=https://cdn.example.com/gallery?token=...` or uses a credentialed URL. The next production build fails immediately, but the docs only suggest “use HTTPS” and never explain why the URL is still invalid.
- **Suggested fix:** Add one short constraint note to the env/setup docs: `IMAGE_BASE_URL` must be an absolute HTTPS URL in production and must not include credentials, query strings, or hashes.

### WDS-02 — `TRUST_PROXY` docs describe the flag but not the trusted-hop rule that prevents spoofed forwarded chains

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Risk:** A reverse proxy chain that preserves attacker-controlled leftmost forwarded values can let the wrong client IP or host/proto win, which breaks rate limiting and can undermine same-origin checks.
- **Doc files/regions:** `README.md:147`, `apps/web/README.md:40`, `apps/web/.env.local.example:42-45`
- **Code files/regions:** `apps/web/src/lib/rate-limit.ts:61-85`, `apps/web/src/lib/request-origin.ts:19-24, 45-106`, `apps/web/src/__tests__/request-origin.test.ts:95-121`
- **Why this is a problem:** The docs say `TRUST_PROXY=true` is required behind a proxy and mention `X-Forwarded-For` / `X-Real-IP`, but they do not explain the actual trust rule: the app takes the right-most valid hop from multi-valued forwarded chains and treats that as authoritative when proxy trust is enabled. That matters because a proxy that prepends values, or fails to supply `X-Real-IP`, can leave the app trusting the wrong hop or falling back to `"unknown"`.
- **Failure scenario:** A deployment sits behind a load balancer plus nginx, but nginx forwards a client-supplied `X-Forwarded-For` chain without appending the trusted hop on the right. Rate limiting and provenance checks then see the wrong address, which can collapse users into one bucket or let spoofed values control the trusted chain.
- **Suggested fix:** Add one explicit sentence to the proxy docs: the trusted proxy must append the real client hop on the right side of forwarded chains, and the provided nginx pattern (`proxy_add_x_forwarded_for` plus `X-Real-IP`) is intentional.

### WDS-03 — Same-origin docs omit the deliberate fail-closed behavior when both `Origin` and `Referer` are absent

- **Status:** Confirmed
- **Severity:** LOW
- **Confidence:** High
- **Risk:** Some legitimate admin/browser flows can be rejected if a privacy tool, corporate proxy, or custom client strips both source headers; operators may misread that as an auth bug rather than an intentional guardrail.
- **Doc files/regions:** `README.md:147`, `apps/web/README.md:40`
- **Code files/regions:** `apps/web/src/lib/request-origin.ts:83-106`, `apps/web/src/app/actions/auth.ts:91-95, 254-256, 283-287`, `apps/web/src/app/api/admin/db/download/route.ts:27-32`, `apps/web/src/__tests__/request-origin.test.ts:124-143`
- **Why this is a problem:** The docs mention that same-origin validation exists, but they do not say that the check fails closed unless the request provides either `Origin` or `Referer`. The code intentionally blocks the request in that case for login/logout, mutating admin actions, and DB backup download.
- **Failure scenario:** An operator uses a hardened browser profile or proxy that strips both headers. A normal admin action now returns unauthorized even though `TRUST_PROXY` is set and the session is valid.
- **Suggested fix:** Add a brief note that the admin same-origin checks require either `Origin` or `Referer`; if both are missing, the request is intentionally rejected.

## Final sweep

After drafting the findings, I rechecked the most likely drift points in the root README, app README, env examples, Docker/nginx config, deploy helpers, site-config bootstrap, and the targeted runtime guards. I did not find any additional documentation/code mismatches that were strong enough to report.

## Verification

- Targeted tests run: `apps/web/src/__tests__/next-config.test.ts`, `apps/web/src/__tests__/request-origin.test.ts`, `apps/web/src/__tests__/seo-actions.test.ts`
- Result: 3/3 test files passed, 19/19 tests passed
