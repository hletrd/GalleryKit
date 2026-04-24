# Security Review Report

**Scope:** Entire repository, with emphasis on auth/session handling, public routes, upload/serve paths, backup/restore, sharing, rate limiting, and env/doc mismatches.

**Inventory Reviewed:**
- Auth/session/rate-limit controls: `apps/web/src/lib/{session,rate-limit,auth-rate-limit,request-origin,api-auth,action-guards}.ts`, `apps/web/src/app/actions/auth.ts`
- Public/admin server actions: `apps/web/src/app/actions/{public,images,sharing,settings,seo,tags,topics,admin-users}.ts`
- File serving/upload/processing: `apps/web/src/lib/{serve-upload,upload-paths,process-image,process-topic-image,validation,sanitize,upload-limits}.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/{db-restore,sql-restore-scan,backup-filename}.ts`
- Public surfaces and metadata: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/lib/{data,constants,image-url,seo-og-url,tag-slugs}.ts`
- Deployment/docs/config: `apps/web/next.config.ts`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/src/site-config.json`, `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.env.deploy.example`, `apps/web/.env.local.example`
- Final sweep: cross-file query parsing, CSP, fallback URL config, and reviewed existing security tests/docs for alignment

**Risk Level:** MEDIUM

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 1
- Low Issues: 1

## Confirmed Issues

### 1. Production CSP still allows inline script execution
**Severity:** LOW  
**Category:** OWASP A05 / Security misconfiguration  
**Location:** `apps/web/next.config.ts:72-75`  
**Confidence:** High  
**Exploitability:** Requires a separate HTML/DOM injection path  
**Blast Radius:** Site-wide; weakens XSS containment across every page

**Why this is a problem:**
The production `Content-Security-Policy` still includes `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`. That means any future HTML/script injection bug can execute inline JavaScript instead of being blocked by policy. This repo already does the right thing in a number of places (`safeJsonLd`, escaped React text, same-origin checks), but the CSP remains permissive enough that one missed sink would become immediately exploitable.

**Concrete failure scenario:**
A future reflected/stored markup bug lands in a localized string, SEO field, or new UI surface. Because inline scripts are allowed, an attacker can execute payloads that a strict nonce/hash-based CSP would have blocked.

**Suggested fix:**
Move analytics/bootstrap code to nonce- or hash-based scripts and remove `'unsafe-inline'` from the production `script-src` policy.

```ts
// BAD
"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com"

// GOOD (example direction)
"script-src 'self' 'nonce-<per-request-nonce>' https://www.googletagmanager.com"
```

## Likely Issues

### 2. Public tag query parsing is unbounded and can be abused for request amplification / DoS
**Severity:** MEDIUM  
**Category:** OWASP A04 / Insecure Design, input validation, rate limiting  
**Location:** `apps/web/src/lib/tag-slugs.ts:3-19`, `apps/web/src/app/[locale]/(public)/page.tsx:18-33,104-120`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-43,95-132`, `apps/web/src/app/api/og/route.tsx:29-40`  
**Confidence:** Medium  
**Exploitability:** Remote, unauthenticated  
**Blast Radius:** Public homepage, topic pages, and OG image generation

**Why this is a problem:**
`parseRequestedTagSlugs()` accepts the full `tags` query string, splits it into an unbounded array, and the public pages/OG route then process that array without a total-length or token-count cap. The home and topic pages also feed the raw result into `filterExistingTagSlugs()`, which does `availableTags.some(...)` per requested tag. That creates an attacker-controlled amount of string allocation and O(n×m) matching work on public requests.

**Concrete failure scenario:**
An attacker requests a URL with thousands of comma-separated tags, e.g. `?tags=a,b,c,...`. The server allocates a large array, trims/deduplicates it, repeatedly scans the full tag list, and then repeats similar work again while generating metadata/OG content. Enough of these requests can materially increase CPU and memory pressure, even though the individual tag names themselves are harmless.

**Suggested fix:**
Cap the total `tags` query length and the number of parsed tag tokens before splitting/filtering, and reject or truncate anything over the limit. If the app only needs a small number of filters, stop after the first N valid tags instead of processing the whole query string.

## Risks Requiring Manual Validation

### 3. Production still falls back to the checked-in localhost site config if `BASE_URL` is unset
**Severity:** LOW  
**Category:** OWASP A05 / deployment misconfiguration, env/doc mismatch  
**Location:** `apps/web/src/site-config.json:1-5`, `apps/web/src/lib/constants.ts:11-14`, `apps/web/src/lib/data.ts:883-890`, `apps/web/src/app/robots.ts:13-21`, `apps/web/src/app/sitemap.ts:8-12,19-55`  
**Confidence:** Low  
**Exploitability:** Operator mistake / misdeployment, not remote exploitation  
**Blast Radius:** Canonical URLs, sitemap, robots, metadata, and OG tags

**Why this is a problem:**
The repository ships `apps/web/src/site-config.json` with `http://localhost:3000` values, and the app falls back to that file when `BASE_URL` is not set. That fallback then flows into canonical URLs, sitemap entries, robots.txt, and SEO metadata. The docs do warn operators to replace the file or set `BASE_URL`, but the code does not enforce a production-safe value.

**Concrete failure scenario:**
A deployment boots with the checked-in config still mounted or with `BASE_URL` omitted. Public pages start advertising localhost URLs in `robots.txt`, `sitemap.xml`, OpenGraph tags, and canonical metadata. That breaks crawlability and leaks an internal hostname into user-visible metadata.

**Suggested fix:**
Make production startup/build fail closed when `BASE_URL` is missing or when the active site config still points at localhost. A small validation in `ensure-site-config.mjs` or `getSeoSettings()` would align the runtime behavior with the deployment docs.

## What I checked and did not flag
- No current tracked-source secrets or hardcoded credentials found in the repository state reviewed here.
- Auth/session flow is otherwise well hardened: HMAC session tokens, `httpOnly` cookies, same-origin checks on sensitive mutations, and defense-in-depth route/API auth wrappers.
- File serving and backup download paths have solid path containment, filename validation, and symlink checks.
- Backup/restore scanning is materially hardened against dangerous SQL payloads and concurrent restore races.
- Public data selection still excludes GPS and original filenames from unauthenticated reads.

## Security Checklist
- [x] Secrets scan completed
- [x] Authentication/session code reviewed
- [x] Authorization on admin/API paths reviewed
- [x] Input validation and public-route query handling reviewed
- [x] File upload / file serve / backup / restore reviewed
- [x] Final missed-issues sweep completed

## Verification Notes
- Static inspection of all security-relevant app, lib, route, and docs files listed above
- Cross-file review of public tag parsing, metadata generation, CSP, and config fallbacks
- Final sweep for common misses: auth bypass, path traversal, SSRF, session/cookie safety, and secrets leakage
