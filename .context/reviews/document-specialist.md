# Document Specialist Review — Cycle 8 / Prompt 1

No code changes were made. This review only updates the review artifact.

## Scope and method

I reviewed the doc/config/runtime surfaces most likely to drift and checked them against the authoritative source and tests:

- Top-level docs: `README.md`, `CLAUDE.md`, `AGENTS.md`
- App docs and examples: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `.env.deploy.example`
- Runtime/deploy config: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- Package metadata: `package.json`, `apps/web/package.json`
- Authoritative source/tests: `apps/web/src/lib/{content-security-policy,rate-limit,request-origin,upload-limits,upload-paths,db-restore,mysql-cli-ssl,session}.ts`, `apps/web/src/app/actions/{auth,images,public,sharing,topics,tags,seo,settings,admin-users}.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/[locale]/(public)/{page,[topic]/page,p/[id]/page,g/[key]/page,s/[key]/page}.tsx`, `apps/web/scripts/{ensure-site-config,check-api-auth,check-action-origin}.ts`, and the matching unit/e2e tests under `apps/web/src/__tests__` and `apps/web/e2e`

Final sweep re-checked `IMAGE_BASE_URL`, `BASE_URL`/site-config bootstrap, `TRUST_PROXY` / same-origin guards, public route freshness, and the action-origin scanner contract.

## Status legend

- **Confirmed** — direct doc/code mismatch or missing warning proven by source comparison.
- **Likely** — plausible mismatch, but I would want runtime/ops confirmation before treating it as definitive.
- **Manual-validation risk** — a behavior that is real but would need an operator workflow check to prove.

All findings below are **confirmed**. I did not retain any likely-only or manual-validation-only items after the final sweep.

## Findings summary

| ID | Status | Severity | Summary |
|---|---|---|---|
| WDS-01 | Confirmed | Low | `IMAGE_BASE_URL` docs omit the build-time URL constraints that reject credentials, query strings, and hashes. |
| WDS-02 | Confirmed | Medium | The site-config / `BASE_URL` setup docs omit the production build gate that rejects placeholder or missing absolute URLs. |
| WDS-03 | Confirmed | Low | The proxy docs omit the fail-closed same-origin rule when both `Origin` and `Referer` are missing. |
| WDS-04 | Confirmed | Medium | The “public route freshness” note claims shared pages set `revalidate = 0`, but the shared pages do not export it. |
| WDS-05 | Confirmed | Low | The action-origin scanner docs overstate the exemption format by saying “leading JSDoc”; the code accepts any leading comment containing the tag. |

## Detailed findings

### WDS-01 — `IMAGE_BASE_URL` docs omit the parser/build constraints that reject credentials, query strings, and hashes

- **Status:** Confirmed
- **Severity:** Low
- **Confidence:** High
- **Risk:** An operator can copy a CDN URL that looks valid in prose but still fails the build, or waste time debugging a production-only rejection that the docs never warned about.
- **Doc files/regions:** `README.md:129-145`, `apps/web/README.md:36-38`, `apps/web/.env.local.example:11-15`
- **Code files/regions:** `apps/web/src/lib/content-security-policy.ts:1-25`, `apps/web/next.config.ts:8-29`, `apps/web/src/__tests__/next-config.test.ts:5-14`
- **Why this is a problem:** The docs correctly say `IMAGE_BASE_URL` must be absolute and HTTPS in production, but the implementation is stricter: it also rejects any URL with credentials, query strings, or hashes. That is easy to miss if someone copies a signed CDN URL or a pre-authenticated asset URL into the env example.
- **Failure scenario:** An operator sets `IMAGE_BASE_URL=https://cdn.example.com/gallery?token=...` or `https://user:pass@cdn.example.com/gallery`. The next production build fails immediately with a parser error, but the docs only mention HTTPS and remote-image allowlisting.
- **Concrete fix:** Add one short constraint note to the setup docs and env examples: `IMAGE_BASE_URL` must be an absolute HTTPS URL in production and must not include credentials, query strings, or hashes.

### WDS-02 — The site-config / `BASE_URL` setup docs omit the production build gate that rejects placeholder or missing absolute URLs

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **Risk:** A fresh deployment that follows the copy/paste instructions can reach the build step with a placeholder `site-config.json` URL and fail only after the operator has already configured the database and admin password.
- **Doc files/regions:** `README.md:43-58`, `README.md:116-145`, `README.md:167-170`, `apps/web/README.md:15-18`, `apps/web/README.md:36-43`, `apps/web/src/site-config.example.json:1-11`
- **Code files/regions:** `apps/web/scripts/ensure-site-config.mjs:4-38`, `apps/web/Dockerfile:44-48`
- **Why this is a problem:** The docs tell users to copy `src/site-config.example.json`, but the build-time guard rejects the example’s placeholder hostnames in production unless `BASE_URL` is set or `site-config.json.url` is replaced with a real absolute URL. That requirement is enforced, but it is not called out clearly in the setup instructions.
- **Failure scenario:** An operator copies the example site config, leaves `url` as `https://example.com` or `http://localhost:3000`, and runs the documented production build/deploy path. `ensure-site-config.mjs` aborts the build with a placeholder-URL error, which feels like a hidden precondition.
- **Concrete fix:** Add an explicit production warning next to the site-config copy step: the checked-in example URL is placeholder-only, and production builds require a real absolute `BASE_URL` or a non-placeholder `site-config.json.url`.

### WDS-03 — The proxy docs omit the fail-closed same-origin rule when both `Origin` and `Referer` are missing

- **Status:** Confirmed
- **Severity:** Low
- **Confidence:** High
- **Risk:** An operator can misdiagnose a 403 from a hardened browser, privacy tool, or custom client as an auth regression when it is actually the intended provenance guard.
- **Doc files/regions:** `README.md:148`, `apps/web/README.md:40`, `apps/web/.env.local.example:42-50`
- **Code files/regions:** `apps/web/src/lib/request-origin.ts:19-24,45-106`, `apps/web/src/app/actions/auth.ts:91-95,206-219`, `apps/web/src/app/api/admin/db/download/route.ts:13-32`, `apps/web/src/__tests__/request-origin.test.ts:124-143`
- **Why this is a problem:** The docs explain that `TRUST_PROXY=true` is needed behind a reverse proxy and that forwarded host/proto values matter, but they do not say that the same-origin check fails closed if both `Origin` and `Referer` are absent. The implementation intentionally rejects those requests for login, mutating admin actions, and backup downloads.
- **Failure scenario:** A browser, proxy, or privacy extension strips both `Origin` and `Referer`. The admin action returns unauthorized/403 even though the session is valid and `TRUST_PROXY` is configured, because the request provenance is intentionally incomplete.
- **Concrete fix:** Add a short note to the proxy section: admin same-origin checks require either `Origin` or `Referer`; if both are missing, the request is intentionally rejected.

### WDS-04 — The “public route freshness” note claims shared pages set `revalidate = 0`, but the shared pages do not export it

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **Risk:** Maintainers may assume the shared photo/group routes have the same explicit freshness policy as home, topic, and photo pages, when that is not currently true in code.
- **Doc files/regions:** `CLAUDE.md:199-205`
- **Code files/regions:** `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:14-17`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:28-31`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:1-129`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:1-129`
- **Why this is a problem:** The CLAUDE note states that public photo, topic, shared, and home pages all currently set `revalidate = 0` so updates are visible immediately. The home/topic/photo routes do, but the shared-group and shared-photo routes do not export that setting. The note therefore overstates the explicit caching policy.
- **Failure scenario:** A maintainer relies on the CLAUDE note while changing shared-route behavior or debugging freshness. They may assume the routes are explicitly uncached when they are only currently behaving fresh through other dynamic code paths.
- **Concrete fix:** Either add `export const revalidate = 0` to the shared routes if that policy is intended, or update the CLAUDE note to describe the actual split: home/topic/photo are explicit, shared routes are not.

### WDS-05 — The action-origin scanner docs overstate the exemption format by saying “leading JSDoc”; the code accepts any leading comment containing the tag

- **Status:** Confirmed
- **Severity:** Low
- **Confidence:** High
- **Risk:** The documented contract is stricter than the implementation, so future reviewers may believe a plain leading comment is insufficient even though the scanner would accept it.
- **Doc files/regions:** `CLAUDE.md:242-245`, `apps/web/scripts/check-action-origin.ts:28-35`
- **Code files/regions:** `apps/web/scripts/check-action-origin.ts:100-105,228-243`, `apps/web/src/__tests__/check-action-origin.test.ts:85-95`
- **Why this is a problem:** The docs say read-only exports must use a leading JSDoc exemption comment, but the scanner only checks for the `@action-origin-exempt` marker anywhere in the leading comment block. That means the implementation is broader than the documented contract.
- **Failure scenario:** A maintainer does a comment-style cleanup and changes the exemption from JSDoc to a plain leading comment with the same tag. The lint still passes, but the docs make it sound like the exact JSDoc form is required.
- **Concrete fix:** Either tighten the scanner to require JSDoc specifically, or loosen the docs to say “a leading comment containing `@action-origin-exempt`.”

## Final sweep

I rechecked the remaining doc/config surfaces for additional mismatches and did not retain any further findings beyond the five above.

