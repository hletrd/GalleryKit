# Security Review Report

**Scope:** GalleryKit security review, cycle 7 RPF (`/Users/hletrd/flash-shared/gallery`)
**Reviewer angle:** OWASP Top 10, secrets, unsafe patterns, auth/authz, CSRF/origin, upload/restore safety, privacy, deployment-secret handling
**Risk Level:** MEDIUM

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 2
- Low Issues: 1

## Inventory / Coverage
Reviewed the full security-relevant inventory (124 files) across these areas:

- **Route handlers / server actions / admin flows:** `apps/web/src/app/actions*.ts`, `apps/web/src/app/api/**`, `apps/web/src/app/uploads/**`, `apps/web/src/app/[locale]/admin/**`, public share/photo pages that emit JSON-LD.
- **Auth / session / CSRF / rate limit / middleware:** `apps/web/src/proxy.ts`, `apps/web/src/lib/{api-auth,action-guards,request-origin,session,rate-limit,auth-rate-limit}.ts`.
- **Upload / storage / image processing:** `apps/web/src/lib/{serve-upload,upload-paths,process-image,process-topic-image,image-queue,storage/**,upload-tracker*,upload-limits,validation,sanitize}.ts` and upload/admin UI callers.
- **Backup / restore / DB / schema:** `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/{db-restore,sql-restore-scan,backup-filename,mysql-cli-ssl,restore-maintenance}.ts`, `apps/web/src/db/**`, Drizzle migrations, init/migrate/seed scripts.
- **Privacy / public data / sharing:** `apps/web/src/lib/{data,safe-json-ld,image-url,seo-og-url}.ts`, sharing/public/tag/topic/settings/SEO actions.
- **Config / deployment / docs / tests:** `README.md`, `CLAUDE.md`, `apps/web/.env.local.example`, `apps/web/{next.config.ts,playwright.config.ts,drizzle.config.ts,deploy.sh,nginx/default.conf}`, `apps/web/e2e/**`, targeted `src/__tests__/**`, plus `npm audit` and a targeted git-history secret scan.

Final sweep reran targeted searches for secrets, child-process use, raw SQL, dangerous HTML sinks, direct file IO, auth wrappers, origin checks, and upload/restore paths. I did not find an unreviewed security-relevant code path in the current tree.

## Findings

### 1. Historical real secrets remain exposed in git history
**Severity:** MEDIUM  
**Confidence:** High  
**Status:** Confirmed (operational risk, not current-tree secret leakage)  
**Category:** OWASP A02 / Secrets management  
**Location:** `apps/web/.env.local.example` in historical commit `d7c3279:1-11`

**Evidence:**
- `git show d7c3279:apps/web/.env.local.example` shows:
  - `DB_PASSWORD=password` (`:5`)
  - `ADMIN_PASSWORD=password` (`:10`)
  - fixed `SESSION_SECRET=5e47a072...` (`:11`)
- Current docs already warn operators to rotate old copied values: `README.md:139-149`, `CLAUDE.md:82-84`, `apps/web/.env.local.example:17-29`.

**Why this is a problem:** Anyone who ever bootstrapped an environment from the old example file may still be using compromised credentials/session keys. Even though HEAD is clean, public git history is durable attacker knowledge.

**Concrete failure scenario:** An operator restores an old clone, copied env file, or deployment backup seeded from the historical example. An attacker who knows the old `SESSION_SECRET` can mint valid admin cookies; if the old bootstrap/admin password was reused, ordinary login also succeeds.

**Suggested fix:**
- Treat the historical values as compromised and rotate **all** environments that might have copied them.
- Keep the current warnings.
- If the project ever decides the operational blast radius justifies it, perform a coordinated history rewrite; otherwise keep the rotation warning explicit.

---

### 2. Remote admin E2E helper opens raw MySQL connections without the TLS protections used by production code
**Severity:** MEDIUM  
**Confidence:** Medium  
**Status:** Likely  
**Category:** OWASP A02 / Security Misconfiguration  
**Location:** `apps/web/e2e/helpers.ts:91-98`, `apps/web/e2e/helpers.ts:123-130`  
**Cross-reference:** production DB code requires TLS for non-local DB hosts in `apps/web/src/db/index.ts:6-12`; script helper also supports TLS in `apps/web/scripts/mysql-connection-options.js:11-23`

**Why this is a problem:** The opt-in remote admin E2E flow directly uses `mysql.createConnection(...)` without an `ssl` option. For non-local DB hosts, that means the helper relies on server defaults instead of the repo’s normal “TLS unless localhost or explicitly disabled” rule.

**Concrete failure scenario:** A developer intentionally runs remote admin E2E (`E2E_BASE_URL` non-local plus remote admin opt-in). The helper creates a DB connection to a routed MySQL host using `DB_USER` / `DB_PASSWORD` but without TLS. On a network where MySQL does not force TLS server-side, credentials and session-seeding traffic can be observed or altered.

**Suggested fix:** Route these helper connections through the same TLS decision logic as production/scripts.

```ts
// BAD
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'gallery',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gallery',
});

// GOOD
import { getMysqlConnectionOptions } from '../scripts/mysql-connection-options';
const connection = await mysql.createConnection(getMysqlConnectionOptions());
```

If you want to keep E2E independent from script files, duplicate the same “TLS for non-local unless `DB_SSL=false`” policy instead of silently downgrading transport security.

---

### 3. Dependency audit still reports a vulnerable PostCSS copy bundled through Next
**Severity:** LOW  
**Confidence:** High  
**Status:** Risk  
**Category:** OWASP A06 / Vulnerable and Outdated Components  
**Location:** `apps/web/package.json:45-46,65`, `package-lock.json:7978-7989`  
**Evidence:** `npm audit --json` reports `GHSA-qx2v-qp2m-jg93` against `postcss <8.5.10`, specifically `next`’s bundled `postcss@8.4.31`

**Why this is a problem:** The app pins top-level `postcss` to `^8.5.10`, but the installed `next@16.2.3` dependency tree still carries `node_modules/next -> postcss@8.4.31`, so the known XSS-class bug remains in the dependency graph.

**Concrete failure scenario:** If any code path or tooling step ends up stringifying attacker-controlled CSS through the vulnerable PostCSS version, the buggy escaping behavior could become an injection primitive.

**Suggested fix:** Upgrade to a `next` release that no longer vendors the vulnerable PostCSS range, then rerun `npm audit` to verify the nested copy is gone.

## Notes on areas reviewed with no issue found
- **Auth/session design:** Argon2id password hashing, HMAC session signing, hashed session storage, constant-time signature comparison, session rotation on password change, production refusal to fall back to DB-stored `SESSION_SECRET` all looked sound.
- **Access control / CSRF:** Admin API routes use `withAdminAuth`; mutating server actions consistently require `requireSameOriginAdmin()` or direct same-origin checks; download route enforces both auth and same-origin provenance.
- **Upload / file serving:** current upload and public-serving paths block traversal/symlink escapes, keep originals private, and set `nosniff`/cache headers.
- **Restore / backup:** child-process invocation avoids shell interpolation, avoids password-on-cmdline exposure, constrains restore size, scans for dangerous SQL, and uses advisory locking plus maintenance mode.
- **Privacy:** public field-selection logic excludes GPS/original filename/user filename/other sensitive fields, and JSON-LD sinks go through `safeJsonLd()`.

## Security Checklist
- [x] Secrets scan completed
- [x] Dependency audit run (`npm audit --json`)
- [x] Injection prevention reviewed
- [x] Authentication/authorization reviewed
- [x] CSRF/origin protections reviewed
- [x] Upload / restore / file handling reviewed
- [x] Privacy boundaries reviewed

## Overall assessment
The current tree is materially stronger than earlier cycles: auth/origin/restore/upload/privacy controls are mostly well-defended. The main remaining issues are **operational secret history exposure**, **TLS drift in remote E2E DB helpers**, and a **known moderate dependency advisory surfacing as a low-likelihood app risk**. I did not find a current-tree critical/high exploit path in the reviewed code.
