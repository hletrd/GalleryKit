# Security Review Report — Cycle 10

**Repo:** `/Users/hletrd/flash-shared/gallery`  
**Reviewer:** security-reviewer  
**Date:** 2026-04-22

## Scope / Inventory

### Docs and config reviewed
- `README.md`
- `CLAUDE.md`
- `apps/web/README.md`
- `apps/web/.env.local.example`
- `.env.deploy.example`
- `apps/web/docker-compose.yml`
- `apps/web/nginx/default.conf`
- `apps/web/Dockerfile`
- `apps/web/deploy.sh`
- `apps/web/next.config.ts`
- `apps/web/src/site-config.example.json`
- local untracked secret/config presence checked without disclosing values:
  - `apps/web/.env.local`
  - `.env.deploy`
  - `apps/web/src/site-config.json`

### Security-sensitive code paths reviewed
- Auth/session/authz:
  - `apps/web/src/proxy.ts`
  - `apps/web/src/lib/session.ts`
  - `apps/web/src/lib/api-auth.ts`
  - `apps/web/src/lib/rate-limit.ts`
  - `apps/web/src/lib/auth-rate-limit.ts`
  - `apps/web/src/app/actions/auth.ts`
  - `apps/web/src/app/actions/admin-users.ts`
  - `apps/web/scripts/check-api-auth.ts`
- Public/private data access and sharing:
  - `apps/web/src/lib/data.ts`
  - `apps/web/src/app/actions/public.ts`
  - `apps/web/src/app/actions/sharing.ts`
  - `apps/web/src/app/[locale]/(public)/page.tsx`
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
  - `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- Upload/file handling:
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/lib/upload-paths.ts`
  - `apps/web/src/lib/process-image.ts`
  - `apps/web/src/lib/process-topic-image.ts`
  - `apps/web/src/app/actions/images.ts`
  - `apps/web/src/lib/storage/index.ts`
  - `apps/web/src/lib/storage/local.ts`
  - `apps/web/src/lib/storage/s3.ts`
  - `apps/web/src/lib/storage/minio.ts`
- DB backup/restore and admin API:
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - `apps/web/src/lib/sql-restore-scan.ts`
  - `apps/web/src/lib/db-restore.ts`
  - `apps/web/src/lib/backup-filename.ts`
- DB/schema:
  - `apps/web/src/db/index.ts`
  - `apps/web/src/db/schema.ts`
- Public API routes:
  - `apps/web/src/app/api/health/route.ts`
  - `apps/web/src/app/api/og/route.tsx`

### Verification performed
- Secrets scan across tracked repo content and history-oriented checks
- Dependency audit: `npm audit --workspaces --json`
- Auth coverage check: `npm run lint:api-auth --workspace=apps/web`
- Targeted security tests:
  - `src/__tests__/session.test.ts`
  - `src/__tests__/serve-upload.test.ts`
  - `src/__tests__/backup-download-route.test.ts`
  - `src/__tests__/sql-restore-scan.test.ts`
  - `src/__tests__/privacy-fields.test.ts`
  - `src/__tests__/auth-rate-limit.test.ts`
  - `src/__tests__/rate-limit.test.ts`

## Overall Risk Level
**MEDIUM**

The current HEAD has solid baseline controls around admin auth, session signing, route protection, upload path traversal, backup-download containment, and public/private field separation. The most important remaining concerns are: a historically exposed bootstrap secret in git history, production CSP still allowing inline script execution, and bearer share links that do not expire by default.

## Summary
- **Confirmed issues:** 4
- **Likely issues:** 1
- **Manual-validation risks:** 1
- **Current tracked hardcoded secrets in HEAD:** none found
- **Dependency audit:** no critical/high production dependency findings; 1 moderate dev-tool chain advisory family (`drizzle-kit`/`esbuild`)

---

## Confirmed Issues

### 1. Historical bootstrap secret and default admin password were committed to git history
**Severity:** HIGH  
**Category:** Secrets Exposure / Identification and Authentication Failures  
**Location:** historical `apps/web/.env.local.example`
- commit `d7c3279066285c94e9b1570cb37778b3031378e3` lines 8-11
- commit `d068a7fbd62642d574d605055afe8df9c223f635` lines 9-12

**Evidence**
- `d7c3279...:apps/web/.env.local.example:8-11`
  - `ADMIN_PASSWORD=password`
  - concrete `SESSION_SECRET=...`
- `d068a7f...:apps/web/.env.local.example:9-12`
  - `ADMIN_PASSWORD=password`
  - generated-secret placeholder only replaced later

**Impact:** Any deployment or fork that copied those example values could be compromised. If the old `SESSION_SECRET` was ever used in a live environment, an attacker with repo history can forge valid admin session cookies. If the documented default password was reused, admin login becomes trivial.

**Exploit / failure scenario:**
1. Attacker pulls git history or reads a mirror.
2. Operator reused the exposed secret/password during an earlier deployment.
3. Attacker either logs in with the known password or forges an HMAC-signed `admin_session` token matching `apps/web/src/lib/session.ts`.
4. Full admin access follows, including backup download and DB restore.

**Suggested fix:**
- Treat the old secret and old default password as compromised.
- Rotate `SESSION_SECRET` everywhere.
- Force-reset admin credentials if any environment may have been bootstrapped from the old example.
- If policy permits, rewrite history or at minimum publish a security advisory/rotation notice.

**Confidence:** High

---

### 2. Production CSP still allows inline script execution
**Severity:** MEDIUM  
**Category:** Security Misconfiguration / Injection Impact Amplification  
**Location:** `apps/web/next.config.ts:68-75, 91`

**Issue:** The production CSP includes `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`.

**Impact:** Any future HTML/script injection bug becomes much easier to weaponize because inline JavaScript is explicitly allowed. CSP stops being a meaningful last-line mitigation for DOM/script injection on production pages.

**Exploit / failure scenario:**
1. An attacker finds any injection point that can place inline script or an event-handler gadget into HTML.
2. Because `'unsafe-inline'` is allowed, the browser executes it instead of blocking it.
3. Session-bearing admin browsers become much easier to target.

**Suggested fix:**
- Remove `'unsafe-inline'` from `script-src` in production.
- Use nonces or hashes for the minimal inline scripts Next.js needs.
- If GTM must remain, allow its host explicitly but keep inline execution nonce/hash-gated.

**Confidence:** High

---

### 3. Share bearer URLs do not expire by default; photo shares cannot expire at all
**Severity:** MEDIUM  
**Category:** Broken Access Control / Sensitive Data Exposure  
**Location:**
- `apps/web/src/db/schema.ts:29, 87-95`
- `apps/web/src/app/actions/sharing.ts:17-18, 109-114, 194-202`
- `apps/web/src/lib/data.ts:492-507, 544-551`

**Issue:**
- Photo shares are stored as `images.share_key` with no expiry field at all.
- Group shares have `shared_groups.expires_at`, but `createGroupShareLink()` inserts only `{ key: groupKey }`, leaving expiry `NULL`.
- Public lookup accepts photo shares indefinitely and group shares whenever `expires_at IS NULL`.

**Impact:** Leaked or forwarded share links remain valid indefinitely unless an admin manually revokes them. This increases blast radius for accidental disclosure in chats, email archives, browser history, logs, screenshots, and referrer leakage from copied URLs.

**Exploit / failure scenario:**
1. Admin shares a private photo/group link once.
2. Recipient forwards it or it leaks from a ticket/chat/browser history.
3. Months later, anyone holding the URL still has access because the bearer token never ages out.

**Suggested fix:**
- Add a photo-share expiry column (for example `images.share_expires_at`).
- Apply a default TTL to both photo and group shares.
- Enforce expiry in `getImageByShareKey()` and `getSharedGroup()`.
- Let admins extend/override TTL explicitly rather than defaulting to perpetual access.

**Confidence:** High

---

### 4. Public health endpoint exposes real-time backend status to unauthenticated clients
**Severity:** LOW  
**Category:** Information Exposure / Security Misconfiguration  
**Location:**
- `apps/web/src/app/api/health/route.ts:6-16`
- `apps/web/Dockerfile:69-71`
- `apps/web/nginx/default.conf:108-122`

**Issue:** `/api/health` returns `200 {status:"ok"}` or `503 {status:"degraded"}` without authentication. The Dockerfile uses it for local health checks, but the nginx config proxies all unmatched paths publicly, so the same endpoint is reachable externally unless separately blocked.

**Impact:** Attackers can use it for recon and outage monitoring: identify maintenance windows, DB outages, restart events, or deploy timing without authentication.

**Exploit / failure scenario:**
1. Internet client polls `/api/health`.
2. Response flips to `503` when DB is unavailable.
3. Attacker correlates instability windows with restore operations, deploys, or broader attack timing.

**Suggested fix:**
- Keep container health checks on localhost/internal-only paths.
- Or require a secret header/token.
- Or block `/api/health` at the reverse proxy from public access.

**Confidence:** High

---

## Likely Issues

### 5. Rate limiting fails open into a shared `unknown` identity if proxy trust is misconfigured
**Severity:** MEDIUM  
**Category:** Authentication / Session Handling / Abuse Protection  
**Location:**
- `apps/web/src/lib/rate-limit.ts:59-82`
- `apps/web/docker-compose.yml:15-18`
- `README.md` and `apps/web/README.md` proxy/trust guidance

**Issue:** The app only trusts `X-Forwarded-For`/`X-Real-IP` when `TRUST_PROXY=true`. Otherwise, client identity becomes the literal string `unknown`. In the documented compose setup this is configured correctly, but any proxied deployment that forgets `TRUST_PROXY=true` collapses all login/search/share throttling into one shared bucket.

**Impact:** This becomes either a self-inflicted denial of service (all users share one limiter) or ineffective attribution for abuse-handling, depending on topology.

**Exploit / failure scenario:**
1. App is deployed behind a reverse proxy but `TRUST_PROXY` is omitted.
2. Every visitor is keyed as `unknown`.
3. A small number of requests can throttle everyone else, especially login/search/share operations.

**Suggested fix:**
- Fail closed on startup in production when proxy headers are present but `TRUST_PROXY` is unset.
- Alternatively, require an explicit deployment mode and log/healthcheck-fail when the app sees proxy headers without trust enabled.

**Confidence:** High

---

## Manual-Validation Risks

### 6. Dependency audit flags a moderate dev-tool advisory chain (`drizzle-kit` → `esbuild`)
**Severity:** LOW  
**Category:** Vulnerable Components  
**Location:**
- `apps/web/package.json`
- `package-lock.json`
- `npm audit --workspaces --json`

**Issue:** `npm audit` reports a moderate advisory chain through `drizzle-kit` / `@esbuild-kit/*` / `esbuild` (GHSA-67mh-4wv8-2f99). Based on the dependency placement here, this appears build/dev-tooling-oriented rather than a runtime production path.

**Impact:** Lower immediate risk for the deployed app, but still worth tracking for developer workstation exposure and CI hygiene.

**Suggested fix:**
- Validate whether the team invokes the affected tooling in exposed/shared dev environments.
- Upgrade or replace the vulnerable toolchain when compatible.
- Treat as lower priority than the application-level findings above.

**Confidence:** Medium

---

## Positive Controls Verified
- Admin server actions reviewed all enforce `isAdmin()` or `getCurrentUser()` gatekeeping.
- `/api/admin/db/download` is wrapped in `withAdminAuth()` and the repo includes `scripts/check-api-auth.ts` to catch future misses.
- Session cookies are `httpOnly`, conditionally `secure`, and HMAC-signed with server-side DB lookup for hashed session IDs.
- Public/private data separation is explicit in `apps/web/src/lib/data.ts`; GPS and original filenames are omitted from public queries, with compile-time guardrails.
- Upload serving path traversal and symlink handling are explicitly defended in `apps/web/src/lib/serve-upload.ts`.
- Backup download path traversal/symlink checks are robust.
- SQL restore path blocks multiple dangerous statements and passed targeted tests.
- No current tracked hardcoded secrets were found in HEAD.

## Missed-Issues Sweep Notes
Final repo-wide sweep focused on:
- all server action auth gates
- all `route.ts` / `route.tsx` files
- file/path joins around user-controlled inputs
- dangerous sinks (`dangerouslySetInnerHTML`, raw SQL, child-process use)
- secret patterns in tracked content and historical env-example commits

I did **not** find a confirmed auth bypass, confirmed path traversal, confirmed SQL injection, or confirmed current tracked secret in HEAD beyond the historical git-history exposure already listed.

## Verification Evidence
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm run test --workspace=apps/web -- src/__tests__/session.test.ts src/__tests__/serve-upload.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/rate-limit.test.ts` ✅ (7 files, 40 tests passed)
- `npm audit --workspaces --json` ✅ (moderate dev-tool advisory chain only)

