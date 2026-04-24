# Verifier Code Review Report

## Scope

- Current workspace diff contained review artifacts in:
  - `.context/reviews/code-reviewer.md`
  - `.context/reviews/security-reviewer.md`
  - `.context/reviews/critic.md`
- I cross-checked those reports against the actual repo code, tests, docs, and plan notes.
- Relevant sources inspected included root docs/configs, app/web runtime code, security lint gates, targeted unit tests, targeted E2E specs, and the active plan/deferred notes.

## Verdict

- **Recommendation:** REQUEST CHANGES
- **Architectural status:** CLEAR
- **Final:** REQUEST CHANGES

## Summary

I confirmed three HIGH-severity issues in HEAD, plus two lower-severity correctness risks. I did **not** confirm any CRITICAL issue.

Fresh verification:
- `npm test --workspace=apps/web` ✅ `54` files / `316` tests passed
- `npm run lint --workspace=apps/web` ✅
- `npm run typecheck --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅, with the known Next.js edge-runtime warning reproduced
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm run lint:action-origin --workspace=apps/web` ✅
- `npm run test:e2e --workspace=apps/web` ❌ blocked by missing DB (`ECONNREFUSED 127.0.0.1:3306`)

## Findings

### 1) The documented host-nginx deployment path cannot serve uploads with the checked-in config
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Files:**
  - `README.md:161-169`
  - `apps/web/README.md:33-34`
  - `apps/web/docker-compose.yml:10-22`
  - `apps/web/nginx/default.conf:85-105`
- **Why this is a bug:** the docs describe a host-network + host-nginx deployment, but the nginx config serves uploads from `root /app/apps/web/public;`, which is a path inside the app container. The compose file only mounts that directory into the app container, not into a host nginx process.
- **Failure scenario:** a deployment follows the docs, host nginx starts with the checked-in config, HTML routes work, but `/uploads/**` 404 because the host cannot read `/app/apps/web/public/...`.
- **Concrete fix:** make the deployment model explicit and consistent. Either:
  1. run nginx in a container that shares the mount,
  2. proxy `/uploads/**` to Next instead of serving it directly from host nginx, or
  3. mount the uploads directory into the exact host path the nginx config expects.

### 2) The “fail fast if site-config is missing” promise is defeated by a tracked localhost placeholder
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Files:**
  - `apps/web/src/site-config.json:1-11`
  - `apps/web/scripts/ensure-site-config.mjs:1-9`
  - `README.md:162-169`
  - `apps/web/README.md:34`
  - `.github/workflows/quality.yml:51-52`
  - `apps/web/.gitignore:49`
- **Why this is a bug:** the repo claims builds/deploys fail fast unless a real `src/site-config.json` is supplied, but the tracked file already exists and contains localhost URLs. The prebuild script only checks existence, and CI explicitly copies the example into place, so neither path proves the file is customized.
- **Failure scenario:** an operator forgets to replace the placeholder, build still succeeds, and production emits localhost canonical URLs / OG metadata / sitemap references.
- **Concrete fix:** untrack the real `src/site-config.json`, keep only the example, make CI create the file explicitly, and make the prebuild script reject obvious placeholder values in production/deploy builds.

### 3) The action-origin security gate can return green for insecure server actions
- **Severity:** HIGH
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Files:**
  - `apps/web/scripts/check-action-origin.ts:49-93, 109-125, 148-178, 264-271`
  - `apps/web/src/__tests__/check-action-origin.test.ts:154-187, 203-243`
- **Why this is a bug:** discovery only walks `.ts` descendants under `src/app/actions/` and hard-codes `db-actions.ts`, so `.tsx`, `.js`, and `.mjs` action files are invisible to the gate. Worse, the AST check marks a function as safe if it contains **any** call expression named `requireSameOriginAdmin()`, even when the call is dead code or its return value is ignored. I confirmed the false-positive path with a temp source: `checkActionSource()` returned `OK` for `if (false) { await requireSameOriginAdmin(); }`.
- **Failure scenario:** a future mutating server action lands in `src/app/actions/foo.tsx`, or a refactor leaves `requireSameOriginAdmin()` in unreachable code, and CI still reports the action-origin gate as passing even though the mutation is not actually protected.
- **Concrete fix:** scan all supported action file extensions or all `use server` modules, and require a verifiable auth pattern rather than just a bare call expression. Add regression fixtures for `.tsx/.js/.mjs`, nested special-case filenames, and dead-code/no-op calls.

### 4) Multi-hop proxy chains mis-bucket rate limits and audit IPs
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Files:**
  - `apps/web/src/lib/rate-limit.ts:61-79`
  - `apps/web/src/__tests__/rate-limit.test.ts:90-121`
  - `apps/web/nginx/default.conf:49-68, 113-117`
  - `apps/web/docker-compose.yml:10-17`
  - Impact call sites: `apps/web/src/app/actions/auth.ts:96,313`, `apps/web/src/app/actions/public.ts:53`, `apps/web/src/app/actions/images.ts:124`, `apps/web/src/app/actions/admin-users.ts:110`, `apps/web/src/app/actions/sharing.ts:102,198`, `apps/web/src/app/api/admin/db/download/route.ts:77`
- **Why this is a bug:** `getClientIp()` walks `X-Forwarded-For` from the **right-most** valid hop. That only works when the app is behind exactly one trusted proxy hop. In a normal multi-hop deployment (`Cloudflare/ALB -> nginx -> app`, or any upstream proxy chain), the right-most value is the proxy peer, not the browser client.
- **Failure scenario:** login/search/share/upload/admin-user rate limits collapse many users behind the same edge/load-balancer IP; DB-backup audit logs record proxy IPs instead of the real requester.
- **Concrete fix:** parse `X-Forwarded-For` using explicit trusted-hop semantics (configurable hop count or a canonical provider header), or trust only a single header with a documented proxy contract. Add regression tests for direct, single-hop, and multi-hop chains.

### 5) CDN-backed images can silently break the histogram panel
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Status:** LIKELY
- **Files:**
  - `apps/web/src/components/histogram.tsx:234-259`
  - `apps/web/src/lib/image-url.ts:4-9`
  - `apps/web/src/lib/constants.ts:6-7`
  - `apps/web/next.config.ts:50-54, 107-118`
  - Relevant render surfaces: `apps/web/src/app/[locale]/(public)/page.tsx:154-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:153-159`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:208-219`
- **Why this is a bug:** `imageUrl()` can return an absolute CDN URL, and `Histogram` always sets `img.crossOrigin = 'anonymous'` before drawing the image into canvas. If the CDN does not send permissive CORS headers, `getImageData()` taints the canvas and the code silently falls back to an empty histogram.
- **Failure scenario:** an otherwise working CDN deployment shows blank histogram UI in the photo viewer, with no explicit user-facing error.
- **Concrete fix:** either document and enforce the required `Access-Control-Allow-Origin` behavior for `IMAGE_BASE_URL`, or route histogram sampling through a same-origin proxy/path and show an explicit fallback message when pixels are unavailable.
- **Coverage gap:** `apps/web/src/__tests__/histogram.test.ts:28-59` only exercises worker request routing, not cross-origin canvas behavior.

### 6) `drizzle-kit push` does not reuse the repo’s TLS-aware MySQL connection policy
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Status:** CONFIRMED
- **Files:**
  - `apps/web/drizzle.config.ts:6-12`
  - `apps/web/src/db/index.ts:6-25`
  - `apps/web/scripts/mysql-connection-options.js:11-23`
  - `apps/web/package.json:16`
- **Why this is a bug:** runtime DB access and migration scripts enable TLS for non-local hosts, but `drizzle.config.ts` emits a plain `mysql://user:pass@host:port/db` URL with no TLS options. That means `npm run db:push` can silently bypass the repo’s normal transport-security posture on remote MySQL targets.
- **Failure scenario:** an operator runs `npm run db:push` against a managed DB over an untrusted network; credentials/schema traffic travel without the TLS protections the rest of the repo expects.
- **Concrete fix:** reuse the shared MySQL connection helper or mirror its TLS decision logic in `drizzle.config.ts`; alternatively fail closed for non-local hosts unless secure options are explicit.

## Historical / operational note

- `git show d7c3279:apps/web/.env.local.example` confirms the repo once contained real bootstrap secrets (`DB_PASSWORD=password`, `ADMIN_PASSWORD=password`, `SESSION_SECRET=...`).
- Current tracked files only contain placeholders and explicit rotation warnings in `README.md`, `CLAUDE.md`, and `apps/web/.env.local.example`.
- I am **not** treating this as a current HEAD leak, but the history-based secret remains recoverable to anyone who clones the repo history and would need rotation if any environment bootstrapped from that older example.

## Non-blocking notes

- The CSP hardening item from the prior review is a real hardening backlog item, but the inline-script surface is broader than described: the app emits inline JSON-LD scripts on public pages as well as the GA bootstrap. `safeJsonLd()` already escapes script-breaking characters, so this is a policy/hardening concern rather than a present exploit.
- `npm run build --workspace=apps/web` reproduced the known Next.js warning about the edge runtime disabling static generation for `/api/og`; the repository already tracks that as a deferred framework tradeoff.

## Skipped / not re-reviewed in full

Generated or non-reviewable artifacts were excluded from the deep pass:
- `node_modules/**`
- `apps/web/.next/**`
- `test-results/**`
- binary/image/font assets and upload fixtures under `apps/web/public/uploads/**`
- historical review/archive material under `.context/**` beyond the current review docs
- runtime state/cache surfaces under `.omx/**` and `.omc/**`

## Final sweep

I re-checked the main trust-boundary surfaces after the findings pass:
- auth/session
- rate limiting and proxy trust
- request-origin enforcement
- backup/restore download and restore SQL scanning
- upload serving / storage abstraction
- image URL generation and histogram behavior
- lint gates and tests
- build/typecheck/lint/test gates

The repo is currently test- and build-green, but the three HIGH findings above block a merge-ready verdict.
