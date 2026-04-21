# Security Review Report

**Scope:** Entire repository inventory, with emphasis on auth/session handling, admin routes, public routes, upload/serve paths, backup/restore flows, storage backends, deployment config, scripts, and dependency posture.
**Inventory method:** `rg --files` across the repo, then targeted review of every review-relevant file group (routes, server actions, lib/, db/, scripts/, deploy/config/docs).
**Risk Level:** MEDIUM

## Inventory Summary
- **Deployment/config:** `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, repo/app READMEs, `.env.local.example`
- **Auth/session/rate limiting:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/api-auth.ts`
- **Admin mutation surfaces:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/{images,admin-users,settings,seo,topics,tags,sharing}.ts`
- **Public/api routes:** all `route.ts[x]` files under `apps/web/src/app/**`, plus public page loaders under `apps/web/src/app/[locale]/(public)/**`
- **Uploads/storage/image processing:** `apps/web/src/lib/{serve-upload,process-image,process-topic-image,upload-paths,upload-limits,storage/*,image-queue}.ts`
- **Data/db:** `apps/web/src/lib/data.ts`, `apps/web/src/db/{index,schema}.ts`, drizzle migrations
- **Scripts/tests/docs:** `apps/web/scripts/*`, relevant tests under `apps/web/src/__tests__/*`, repo docs for deployment/security assumptions

## Scan Summary
- **Secrets scan:** current tree contains placeholders/examples only; no active hardcoded credentials were found in live code paths.
- **Dependency audit:** `npm audit --omit=dev --json` returned **0 production vulnerabilities**. `npm audit --workspace=apps/web --json` returned **4 moderate dev-tooling vulnerabilities** tied to `drizzle-kit` → `@esbuild-kit/*` → `esbuild` (GHSA-67mh-4wv8-2f99).
- **Missed-issues sweep:** reviewed every route file, all `spawn`/filesystem call sites, upload/serve path joins, `dangerouslySetInnerHTML` sites, and proxy/IP trust logic.

## Confirmed Issues

### 1. Reverse proxy accepts bodies far larger than the app-level upload/restore caps, enabling disk-exhaustion DoS before application validation runs
**Severity:** MEDIUM  
**Category:** Security Misconfiguration / Availability  
**Confidence:** High  
**Location:** `apps/web/nginx/default.conf:16-18,92-105`, `apps/web/src/lib/upload-limits.ts:1-22`, `apps/web/src/app/[locale]/admin/db-actions.ts:236-299`

**Why it is a problem:** nginx will accept up to **10GB** request bodies for all proxied paths, while the app only intends to process about **2 GiB total upload batches** and **250 MB restore files**. That means nginx can buffer or spool multi-GB request bodies to disk before Next.js/server-action validation rejects them.

**Concrete failure scenario:** an unauthenticated attacker repeatedly sends 8–10GB POST requests to any proxied path (for example `/en/admin`, `/api/health`, or `/`). Even if the app rejects the request later, nginx has already spent disk and I/O budget receiving it. On a small host this can fill `/var/lib/nginx` or the proxy temp volume and take down both the gallery and unrelated services on the same machine.

**Suggested fix:** cap nginx to the real maximum body size you are willing to absorb at the edge, and set a tighter route-specific limit for restore if needed.

```nginx
# BAD
client_max_body_size 10G;

# GOOD
client_max_body_size 2G;

location ~ ^(/[a-z]{2})?/admin/db {
    client_max_body_size 250M;
    limit_req zone=admin burst=10 nodelay;
    proxy_pass http://nextjs;
}
```

Also document that any increase to `UPLOAD_MAX_TOTAL_BYTES` must be mirrored in nginx **and** backed by enough proxy temp storage.

### 2. Public health endpoint exposes real-time database status and gives unauthenticated callers a cheap DB probe primitive
**Severity:** LOW  
**Category:** Security Misconfiguration / Information Exposure  
**Confidence:** High  
**Location:** `apps/web/src/app/api/health/route.ts:1-16`, `apps/web/nginx/default.conf:92-105`, `apps/web/Dockerfile:56-58`

**Why it is a problem:** `/api/health` is publicly reachable through the catch-all nginx proxy and performs a live `SELECT 1` against the database on every request. That gives anyone on the internet a free liveness oracle for the DB tier and a low-cost way to create extra connection churn during incidents.

**Concrete failure scenario:** while the gallery is under load or partially degraded, an attacker polls `/api/health` at high frequency to distinguish app-only failures from DB failures and to add steady background DB traffic. That improves reconnaissance during an outage and slightly increases recovery time because each probe still hits MySQL.

**Suggested fix:** either restrict `/api/health` to localhost/internal monitoring or gate it behind a shared secret/header.

```ts
// BAD
export async function GET() {
  await db.execute(sql`SELECT 1`);
  return Response.json({ status: 'ok' });
}

// GOOD
export async function GET(request: Request) {
  const secret = process.env.HEALTHCHECK_TOKEN;
  if (!secret || request.headers.get('x-healthcheck-token') !== secret) {
    return new Response('Not found', { status: 404 });
  }

  await db.execute(sql`SELECT 1`);
  return Response.json({ status: 'ok' });
}
```

If Docker is the only consumer, prefer a loopback-only endpoint or a local process check instead of exposing this through the public reverse proxy.

### 3. Dev tooling includes a known esbuild advisory through `drizzle-kit`
**Severity:** LOW  
**Category:** Vulnerable and Outdated Components  
**Confidence:** High  
**Location:** `apps/web/package.json:56-70` (`drizzle-kit`), confirmed by `npm audit --workspace=apps/web --json`

**Why it is a problem:** the workspace still pulls a `drizzle-kit` chain that resolves to vulnerable `esbuild` versions affected by **GHSA-67mh-4wv8-2f99**. The blast radius is limited to local/dev-tooling flows, but it is still a real dependency finding.

**Concrete failure scenario:** a developer runs a vulnerable dev server or tooling workflow on a hostile network, and a malicious website interacts with the esbuild dev server behavior described in the advisory.

**Suggested fix:** upgrade `drizzle-kit` to a version whose dependency tree no longer resolves to vulnerable `esbuild`, then rerun the audit.

```json
// BAD
"devDependencies": {
  "drizzle-kit": "^0.31.10"
}

// GOOD
"devDependencies": {
  "drizzle-kit": "<patched version that resolves GHSA-67mh-4wv8-2f99>"
}
```

Re-run:

```bash
npm audit --workspace=apps/web --json
```

## Likely Issues

### 4. Restore maintenance protection is process-local, so multi-instance deployments can still mutate state during a restore window
**Severity:** MEDIUM  
**Category:** Software and Data Integrity Failures  
**Confidence:** Medium  
**Location:** `apps/web/src/app/[locale]/admin/db-actions.ts:243-284`, `apps/web/src/lib/restore-maintenance.ts:1-55`, representative checks in `apps/web/src/app/actions/images.ts:81-120` and `apps/web/src/app/actions/auth.ts:69-100`

**Why it is a problem:** the restore lock itself uses MySQL `GET_LOCK`, which is cross-process, but the request-blocking flag checked by other actions (`getRestoreMaintenanceMessage`) is only stored in `globalThis`. That means only the process that started the restore enters maintenance mode; sibling Node processes or additional app instances will keep accepting uploads, auth changes, and admin mutations unless they independently share the same state.

**Concrete failure scenario:** in a horizontally scaled deployment, instance A starts a restore and acquires the DB advisory lock. Instance B never sees `globalThis` change, so it still accepts an image upload or password change mid-restore. The restored DB can then diverge from filesystem state or user expectations, undermining the integrity guarantee that restore mode is supposed to provide.

**Suggested fix:** move restore-maintenance state to a cross-instance store (DB row, Redis, or another distributed lock/flag) and have all mutation paths consult that shared state.

```ts
// BAD: process-local only
const restoreMaintenanceKey = Symbol.for('gallerykit.restoreMaintenance');

// GOOD: shared DB-backed flag
export async function isRestoreMaintenanceActive(): Promise<boolean> {
  const [row] = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(eq(adminSettings.key, 'restore_maintenance'))
    .limit(1);

  return row?.value === 'true';
}
```

Then set/clear the shared flag inside the same administrative restore workflow and check it from every state-changing server action.

## Risks Requiring Manual Validation

### 5. `TRUST_PROXY=true` makes rate limiting and audit IP attribution depend on network topology; direct exposure would allow `X-Forwarded-For` spoofing
**Severity:** MEDIUM if misdeployed, otherwise none in the documented topology  
**Category:** Identification and Authentication Failures / Security Misconfiguration  
**Confidence:** Medium  
**Location:** `apps/web/src/lib/rate-limit.ts:59-82`, `apps/web/docker-compose.yml:10-18`, `README.md:123-133`

**Why it needs manual validation:** when `TRUST_PROXY=true`, the app trusts the first syntactically valid IP in `X-Forwarded-For`. That is safe only if the Node process is reachable **exclusively** through a trusted reverse proxy that rewrites or sanitizes that header. The provided compose/nginx setup appears to do that, but any alternate deployment (published container port, extra proxy hop, CDN, or misconfigured ingress) changes the trust boundary.

**Concrete failure scenario:** an operator reuses the same container image with `TRUST_PROXY=true` but exposes the app directly on a LAN/VPS port. An attacker sends `X-Forwarded-For: 198.51.100.99` and gets arbitrary per-request IPs for login/search/share/user-create/password-change rate limits and audit log attribution, bypassing abuse controls.

**Suggested fix:** validate the actual ingress path in production and, if you need more than one trusted proxy hop, parse only trusted proxy-added addresses rather than the leftmost arbitrary value.

```ts
// BAD
if (process.env.TRUST_PROXY === 'true') {
  const parts = xForwardedFor.split(',');
  return parts[0];
}

// GOOD
if (process.env.TRUST_PROXY === 'true') {
  // Example: trust only the rightmost proxy-added hop or sanitize at nginx.
  const parts = xForwardedFor.split(',').map(p => p.trim()).filter(Boolean);
  const candidate = parts.at(-1) ?? null;
  const normalized = normalizeIp(candidate);
  if (normalized) return normalized;
}
```

At minimum, ensure the app is not directly reachable when `TRUST_PROXY=true`, and make nginx overwrite forwarded headers instead of passing client-supplied chains through unchanged.

## Checklist
- [x] No active hardcoded secrets found in current tree
- [x] Input validation reviewed for auth, uploads, topics/tags/settings, and public routes
- [x] Injection defenses reviewed for DB and restore/import flows
- [x] Authentication/authorization reviewed for admin routes, sessions, and API wrappers
- [x] Dependency audit run (`npm audit --omit=dev --json`, `npm audit --workspace=apps/web --json`)

