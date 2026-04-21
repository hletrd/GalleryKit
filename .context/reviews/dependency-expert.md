# Dependency/Toolchain Review — Cycle 2

## Inventory of reviewed surfaces
I inspected the repo guidance and the dependency/toolchain surfaces below before scoring risk:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `apps/web/package.json`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `.dockerignore`
- `apps/web/.dockerignore`

I also checked live audit / resolution data from npm for the workspace:

- `npm audit --json --workspace=apps/web`
- `npm audit --json --omit=dev --workspace=apps/web`
- `npm view drizzle-kit version dependencies deprecated --json`
- `npm view drizzle-kit dist-tags --json`
- `npm view @esbuild-kit/esm-loader version dependencies deprecated --json`
- `npm view @esbuild-kit/core-utils version dependencies deprecated --json`

## Summary
- **1 moderate security/toolchain issue** in dev-only install paths
- **1 medium toolchain drift issue** in the current lockfile / peer graph
- **1 low-severity config drift issue** around TypeScript major version alignment
- **0 production dependency vulnerabilities** from `npm audit --omit=dev`

## Findings

### 1) Dev-only esbuild advisory chain still enters the main workspace install
**Severity:** moderate  
**Confidence:** high  
**Failure scenario:** A developer or CI job that installs the workspace devDependencies gets a known esbuild advisory chain through `drizzle-kit`. If any tooling process exposes the esbuild dev server surface, it can leak request/response data to an untrusted website.

**Evidence**
- `apps/web/package.json:15,65-73` — `db:push` is wired to `drizzle-kit push`, and `drizzle-kit` is a direct devDependency.
- `package-lock.json:7200-7210` — `drizzle-kit@0.31.10` depends on `@esbuild-kit/esm-loader` and `esbuild`.
- `package-lock.json:1388-1410` — `@esbuild-kit/core-utils@3.3.2` is deprecated and pins `esbuild ~0.18.20`.
- `npm audit --json --workspace=apps/web` — reports 4 moderate vulnerabilities total, including `esbuild` (GHSA-67mh-4wv8-2f99), `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, and `drizzle-kit`.
- `npm audit --json --omit=dev --workspace=apps/web` — production dependency audit is clean, so this is confined to the dev/tooling path.
- External source URLs:
  - https://github.com/advisories/GHSA-67mh-4wv8-2f99
  - https://www.npmjs.com/package/drizzle-kit
  - https://www.npmjs.com/package/@esbuild-kit/esm-loader
  - https://www.npmjs.com/package/@esbuild-kit/core-utils

**Suggested fix**
- The stable `drizzle-kit` line still pulls the deprecated `@esbuild-kit/*` loader chain, so there is no simple upgrade-only fix today.
- Best remediation is to **isolate or replace** the DB push tooling so the main workspace no longer inherits that chain (for example, move schema push into a separate tooling package/container or replace the dev-install path with checked-in migration execution).
- If you must keep it temporarily, treat it as an accepted dev-only advisory and keep it out of runtime images and production install sets.

### 2) The current lockfile is not peer-clean around esbuild for Vite/Vitest
**Severity:** medium  
**Confidence:** high  
**Failure scenario:** Fresh installs or CI builds can surface `ELSPROBLEMS` / invalid-tree warnings, and Vite/Vitest may resolve the hoisted esbuild copy unexpectedly instead of the version Vite 8 expects.

**Evidence**
- `package-lock.json:132-154` — the Vite peer range requires `esbuild ^0.27.0 || ^0.28.0`.
- `package-lock.json:7980-8016` — the root hoisted `esbuild` in the lockfile is `0.18.20`.
- `package-lock.json:7200-7210` — `drizzle-kit` also brings in its own esbuild subtree, increasing the chance of competing esbuild copies in the workspace.
- `apps/web/Dockerfile:19-26` — both build stages run `npm ci` from the repo lockfile, so the same peer graph is reproduced inside the container build.
- `npm ls drizzle-kit @esbuild-kit/esm-loader @esbuild-kit/core-utils esbuild --workspace=apps/web --all` — reported `invalid: esbuild@0.18.20 ... "^0.27.0 || ^0.28.0" from vite` in this workspace.

**Suggested fix**
- Regenerate the lockfile after removing the package that hoists `esbuild@0.18.20`, or swap that package for a peer-clean alternative.
- If the conflicting tooling is unavoidable, move it behind a separate install boundary so the app workspace can satisfy Vite’s peer range on its own.
- Re-run `npm ls` after the change; the tree should no longer report invalid esbuild peers.

### 3) TypeScript major-version drift between docs, manifest, and lockfile
**Severity:** low  
**Confidence:** high  
**Failure scenario:** Contributors follow the documented TypeScript 6 stack, but the lockfile still resolves the workspace to TypeScript 5.9.3 and `typescript-eslint` explicitly peers `<6.0.0`. A lockfile regeneration can therefore cause lint/tooling churn or an accidental major jump.

**Evidence**
- `apps/web/package.json:71-73` — declares `typescript: "^6"`.
- `README.md:11-14` — the top-level badge advertises TypeScript 6.
- `CLAUDE.md:11` — the repo guidance also states TypeScript 6.0.
- `package-lock.json:13204-13217` — the lockfile resolves `typescript@5.9.3`.
- `package-lock.json:13238-13241` — `typescript-eslint` peers `typescript >=4.8.4 <6.0.0`.

**Suggested fix**
- Either align the manifest/docs to the currently locked 5.9.x toolchain, or upgrade the lint/tooling stack so it is ready for TS6 before widening the version range.
- Until that alignment is made, avoid regenerating the lockfile casually because the TypeScript major can shift under the lint stack.

## Missed-issues sweep
I checked for additional dependency/toolchain risks beyond the findings above:

- **Runtime/prod audit:** `npm audit --omit=dev --workspace=apps/web` returned zero vulnerabilities, so I did not find a production-package CVE to escalate.
- **Docker/runtime deps:** `apps/web/Dockerfile` uses `node:24-slim`, installs `python3`, `make`, `g++`, `gosu`, and `mariadb-client`, and the repo `.dockerignore` files exclude `node_modules`, `.next`, env files, and upload/database data. I did not find a packaging leak or missing runtime system dependency that is currently blocking.
- **Node version drift:** `.nvmrc`, `apps/web/package.json`, and the Docker base image all line up on Node 24, so there is no Node-major mismatch to flag.
- **Package-manager/config drift:** I did not see a separate `.npmrc`, Renovate config, or workflow-level dependency policy that contradicted the lockfile.

Overall, the remaining risk is concentrated in the dev-tooling chain (`drizzle-kit`/`esbuild`) and the TS-major alignment. No additional blocking dependency issue surfaced in the sweep.
