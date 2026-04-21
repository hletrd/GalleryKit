# Security Review Report

**Scope:** Repo-wide review of `apps/web` auth/session logic, admin/public server actions, API routes, upload/download/restore flows, share-link generation/validation, DB/schema/runtime scripts, deploy/container/nginx config, and critical security tests. Reviewed files included every security-relevant file under:
- `apps/web/src/app/actions/*.ts`
- `apps/web/src/app/api/**/*.ts*`
- `apps/web/src/app/uploads/**/*.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- public/share route entrypoints under `apps/web/src/app/[locale]/(public)/**`
- `apps/web/src/lib/*.ts` and `apps/web/src/lib/storage/*.ts`
- `apps/web/src/db/*.ts`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`
- `apps/web/scripts/*`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`
- critical regression tests in `apps/web/src/__tests__/*`

**Risk Level:** MEDIUM

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 3
- Low Issues: 2

## Inventory / coverage notes
Examined, without sampling, the code paths that control:
- **Auth/authz/session:** `src/app/actions/auth.ts`, `src/lib/session.ts`, `src/proxy.ts`, `src/lib/api-auth.ts`, `src/lib/rate-limit.ts`, `src/lib/auth-rate-limit.ts`, `src/app/actions/admin-users.ts`
- **Uploads/downloads/path handling:** `src/app/actions/images.ts`, `src/lib/process-image.ts`, `src/lib/process-topic-image.ts`, `src/lib/serve-upload.ts`, `src/lib/upload-paths.ts`, `src/lib/validation.ts`, `src/app/api/admin/db/download/route.ts`, `src/app/uploads/[...path]/route.ts`, `src/app/[locale]/(public)/uploads/[...path]/route.ts`
- **Backup/restore/maintenance:** `src/app/[locale]/admin/db-actions.ts`, `src/lib/sql-restore-scan.ts`, `src/lib/db-restore.ts`, `src/lib/restore-maintenance.ts`, `src/lib/backup-filename.ts`
- **Public data/share surfaces:** `src/lib/data.ts`, `src/app/actions/public.ts`, `src/app/actions/sharing.ts`, `src/app/[locale]/(public)/s/[key]/page.tsx`, `src/app/[locale]/(public)/g/[key]/page.tsx`
- **Config/runtime/deploy:** `src/db/index.ts`, `src/db/schema.ts`, `apps/web/package.json`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `scripts/deploy-remote.sh`, `nginx/default.conf`, DB bootstrap/migration scripts
- **Regression evidence:** reviewed tests covering sessions, backup download, upload serving, restore stdin handling, SQL restore scan, validation, upload tracker, and rate limiting.

## Confirmed / Likely / Manual-validation findings

### 1. Cross-instance restore protection is incomplete because the maintenance gate is process-local
**Severity:** MEDIUM  
**Category:** OWASP A04 Insecure Design / restore integrity  
**Status:** **Confirmed**  
**Confidence:** High  
**Location:**
- `apps/web/src/lib/restore-maintenance.ts:1-56`
- `apps/web/src/app/[locale]/admin/db-actions.ts:243-287`
- representative gate checks in `apps/web/src/app/actions/auth.ts:71-74,262-265`, `apps/web/src/app/actions/images.ts:86-89,353-356,439-442,568-571`, `apps/web/src/app/actions/sharing.ts:65-66,157-158,267-268`

**Exploitability:** Authenticated admin or any in-flight authenticated mutation in a multi-instance deployment  
**Blast Radius:** Database restore can complete while other instances still accept writes, leaving restored DB state diverged from filesystem, sessions, tags, uploads, or admin changes.

**Issue:**
`restoreDatabase()` correctly acquires a DB advisory lock, but the mutation-blocking “maintenance mode” uses `globalThis` state. That state exists only inside the current Node process. During a restore on instance A, instance B will still report `active: false` and continue to allow uploads, password changes, tag/topic edits, share-link mutations, etc.

**Concrete failure scenario:**
An admin starts a restore on instance A. While MySQL is replaying the dump, another admin request lands on instance B and uploads an image or changes a password. The restore succeeds, but the post-restore system is no longer the restored snapshot the admin intended to recover.

**Remediation:**
Move the maintenance flag into a cross-process coordination primitive already trusted by all instances (DB row / advisory-lock-backed check / shared store), and have mutation guards query that shared state instead of `globalThis`.

```ts
// BAD: process-local only
const restoreMaintenanceKey = Symbol.for('gallerykit.restoreMaintenance');

export function isRestoreMaintenanceActive() {
  return getRestoreMaintenanceState().active;
}

// GOOD: cross-instance gate backed by DB/shared store
export async function isRestoreMaintenanceActive(): Promise<boolean> {
  const [row] = await db
    .select({ value: adminSettings.value })
    .from(adminSettings)
    .where(eq(adminSettings.key, 'restore_maintenance'))
    .limit(1);
  return row?.value === 'true';
}

export async function beginRestoreMaintenance(tx: DbTx) {
  await tx.insert(adminSettings)
    .values({ key: 'restore_maintenance', value: 'true' })
    .onDuplicateKeyUpdate({ set: { value: 'true' } });
}

export async function endRestoreMaintenance(tx: DbTx) {
  await tx.delete(adminSettings).where(eq(adminSettings.key, 'restore_maintenance'));
}
```

---

### 2. The SQL restore scanner can likely be bypassed across chunk boundaries with >64 KiB token padding
**Severity:** MEDIUM  
**Category:** OWASP A03 Injection / unsafe restore pipeline  
**Status:** **Likely risk**  
**Confidence:** Medium  
**Location:**
- `apps/web/src/lib/sql-restore-scan.ts:1-75`
- `apps/web/src/app/[locale]/admin/db-actions.ts:327-344`

**Exploitability:** Authenticated admin session, stolen admin session, or malicious insider uploading a crafted dump  
**Blast Radius:** Malicious SQL such as `CREATE TRIGGER`, `CREATE FUNCTION`, `SET GLOBAL`, or `INTO OUTFILE` can survive the pre-scan and execute during restore.

**Issue:**
The restore safety scan uses regex over 1 MiB chunks and preserves only a 64 KiB trailing carry-over (`SQL_SCAN_TAIL_BYTES`). If a banned token sequence is deliberately split across a chunk boundary with more than 64 KiB of whitespace/comment padding, the combined scan window can miss the full statement even though MySQL will still parse it.

**Concrete failure scenario:**
A crafted dump places `CREATE` near the end of chunk N and `TRIGGER` more than 64 KiB into chunk N+1, with whitespace or comment padding between them. The scanner never sees the complete dangerous statement in one combined string, but `mysql` still executes it when the file is replayed.

**Remediation:**
Replace regex chunk scanning with statement-aware tokenization/parsing, or drastically tighten the restore model to an allowlist of statements. If regex scanning remains, keep an overlap large enough for worst-case whitespace/comments and parse MySQL conditional comments/token boundaries explicitly.

```ts
// BAD: regex over bounded carry-over
let scanTail = '';
for (const chunk of chunks) {
  const { combined, nextTail } = appendSqlScanChunk(scanTail, chunk, 64 * 1024);
  if (containsDangerousSql(combined)) throw new Error('disallowed');
  scanTail = nextTail;
}

// GOOD: token/statement-aware scanning
for await (const statement of parseMysqlStatements(createReadStream(tempPath))) {
  if (!isAllowedRestoreStatement(statement)) {
    throw new Error(`Disallowed SQL statement: ${statement.type}`);
  }
}
```

---

### 3. Public share readers still accept short legacy keys, which are too weak if any such rows still exist
**Severity:** MEDIUM  
**Category:** OWASP A01 Broken Access Control / token entropy weakness  
**Status:** **Likely risk requiring manual validation**  
**Confidence:** High on code path, Medium on actual exposure  
**Location:**
- `apps/web/src/app/actions/sharing.ts:17-18,109,214`
- `apps/web/src/lib/data.ts:492-495,538-540`

**Exploitability:** Remote, unauthenticated, if legacy 5- or 6-character keys remain in the database  
**Blast Radius:** Unauthorized access to publicly shared photos or groups that still use old short tokens.

**Issue:**
New share links are generated at 10 Base56 characters, but the public readers still accept image keys of length 5 or 10 and group keys of length 6 or 10. That preserves backward compatibility for a materially weaker key space.

**Concrete attack scenario:**
If the database still contains older 5-character photo keys or 6-character group keys, an attacker can online-enumerate the far smaller search space and discover valid shared resources without any admin compromise.

**Remediation:**
Inventory and rotate legacy short keys, then remove short-length acceptance from public readers.

```ts
// BAD: legacy weak-key compatibility in public readers
if (!isBase56(trimmedKey, [5, 10])) return null;
if (!isBase56(trimmedKey, [6, 10])) return null;

// GOOD: only accept strong keys after migration
if (!isBase56(trimmedKey, 10)) return null;
```

**Manual validation:**
Run a one-time production query to confirm whether short keys still exist:

```sql
SELECT COUNT(*) AS short_photo_keys
FROM images
WHERE share_key IS NOT NULL AND CHAR_LENGTH(share_key) < 10;

SELECT COUNT(*) AS short_group_keys
FROM shared_groups
WHERE `key` IS NOT NULL AND CHAR_LENGTH(`key`) < 10;
```

---

### 4. The health endpoint is intentionally unauthenticated and reveals DB availability to the public internet
**Severity:** LOW  
**Category:** OWASP A05 Security Misconfiguration  
**Status:** **Confirmed**  
**Confidence:** High  
**Location:**
- `apps/web/src/app/api/health/route.ts:1-16`
- `apps/web/Dockerfile:69-71`

**Exploitability:** Remote, unauthenticated  
**Blast Radius:** Recon only; exposes whether the app can currently reach the database.

**Issue:**
`/api/health` returns `200 {status:"ok"}` or `503 {status:"degraded"}` to anyone. That is useful for Docker health checks, but it also gives attackers a cheap external signal about backend state and outage windows.

**Concrete failure scenario:**
An attacker polls `/api/health` to identify deployment restarts, DB outages, or recovery windows, then times login brute-force or operational probing around degraded periods.

**Remediation:**
If public health visibility is unnecessary, restrict it to localhost/reverse proxy or require a shared header. If it must remain public, treat it as an accepted low-severity exposure.

```ts
// GOOD: internal/shared-secret health check
export async function GET(request: Request) {
  if (request.headers.get('x-health-token') !== process.env.HEALTHCHECK_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }
  // ...existing DB probe...
}
```

---

### 5. `npm audit` reports a moderate dev-toolchain advisory through `drizzle-kit` → `esbuild`
**Severity:** LOW  
**Category:** Vulnerable and Outdated Components  
**Status:** **Confirmed**  
**Confidence:** High  
**Location:**
- `apps/web/package.json:56-70` (`drizzle-kit` devDependency)
- `package-lock.json:1266-1287,1307-1547` (`@esbuild-kit/*`, `esbuild 0.18.20` resolution chain)

**Exploitability:** Developer-machine / local dev tooling context, not the production request path  
**Blast Radius:** Primarily local development exposure if affected tooling is running.

**Issue:**
`npm audit --json` reports moderate vulnerabilities in the installed dev dependency chain (`drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`). The advisory returned was `GHSA-67mh-4wv8-2f99` for esbuild’s dev-server behavior.

**Remediation:**
Update `drizzle-kit`/transitives to a non-vulnerable resolution and re-run audit. Treat as lower priority than runtime-path issues because the production server path does not import this chain.

## Secrets scan
- **Tracked-source result:** no committed live secrets found in current tracked source/config reviewed.
- **History result:** targeted history review of `apps/web/.env.local.example` confirmed an **older weak default bootstrap password** existed historically (`ADMIN_PASSWORD=password`), but I did **not** confirm a current tracked real secret in source. Current HEAD examples use placeholders.
- **Workspace note:** `.env.deploy` exists locally in the workspace, but `git ls-files` shows it is untracked/gitignored, so this is **not** a repository-tracked secret leak in the current state.

## OWASP / control-by-control verdict
- **A01 Broken Access Control:** generally solid on admin routes and server actions; notable remaining issue is legacy short share-key acceptance.
- **A02 Cryptographic Failures:** session cookies are HMAC-signed with `timingSafeEqual`; Argon2id is used for passwords; production correctly refuses DB-backed session-secret fallback.
- **A03 Injection:** app queries use Drizzle parameterization; main remaining concern is restore-pipeline SQL scanning, not normal CRUD queries.
- **A04 Insecure Design:** multi-instance restore maintenance remains the main design flaw.
- **A05 Security Misconfiguration:** public `/api/health` is a low-grade exposure; deploy docs/nginx headers are otherwise thoughtful.
- **A06 Vulnerable Components:** dev-toolchain advisory remains open.
- **A07 Identification/Auth Failures:** login/password flows are well-hardened with IP + account rate limiting, session invalidation, and secure cookie settings.
- **A08 Software/Data Integrity Failures:** restore pipeline is partially hardened, but the scan model is still regex-based and therefore brittle.
- **A09 Logging/Monitoring Failures:** audit logging is present on sensitive admin actions and backup downloads.
- **A10 SSRF:** no confirmed SSRF sink found in live request paths reviewed; URL handling (`seo_og_image_url`, `IMAGE_BASE_URL`, S3/MinIO config) is validation-heavy and not used for attacker-triggered server-side fetches in the current request path.

## Areas reviewed with no confirmed issue found
- **Path traversal / symlink escape:** upload serving and backup download routes perform segment validation, containment checks, symlink checks, and `realpath` verification.
- **File upload handling:** original uploads are stored outside the public web root, file size and pixel limits exist, and processed derivatives are served from allowlisted dirs/extensions only.
- **Download handling:** backup filenames are strictly constrained and streamed with no-cache headers.
- **Auth/session:** secure cookie flags, HMAC signing, expiry cleanup, and session invalidation on password change all look materially sound.
- **XSS:** JSON-LD `dangerouslySetInnerHTML` uses `safeJsonLd()` to escape `<`; no unsafe HTML sink was found beyond that controlled pattern.
- **DB transport security:** runtime DB pool and migration helper auto-enable TLS for non-local DB hosts unless explicitly disabled with `DB_SSL=false`.

## Final missed-issues sweep
Performed final sweep across:
- auth/session/proxy/rate-limit code
- upload/download/path/restore/storage code
- public share/search/public data surfaces
- deploy/runtime/Docker/nginx configs
- secrets regex scan, targeted git-history scan, and `npm audit --json`
- dangerous sinks grep (`dangerouslySetInnerHTML`, `eval`, `fetch`, process-spawn/file I/O)

No additional confirmed repo-tracked secret, SSRF sink, or path traversal issue surfaced beyond the findings above.

## Security Checklist
- [x] No tracked hardcoded secrets found in reviewed committed files
- [x] Input validation reviewed across auth, topics, tags, uploads, backup download, and share flows
- [x] Injection prevention reviewed for normal DB queries and restore pipeline
- [x] Authentication/authorization reviewed for admin routes, server actions, and API routes
- [x] Session handling and crypto reviewed
- [x] File uploads/downloads and path traversal controls reviewed
- [x] Dependency audit run (`npm audit --json`)
- [x] Final missed-issues sweep completed
