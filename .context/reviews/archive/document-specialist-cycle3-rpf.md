# Document Specialist Review — Cycle 3 / Prompt 1

Scope: documentation / config / comment / runtime-source mismatches only.  
Implementation files were not edited.

## Findings

### 1) Remote deploy docs point at the wrong deploy-env location
- **Severity:** medium
- **Confidence:** high
- **Files / regions:**
  - `README.md:103-113`
  - `.env.deploy.example:1-4`
  - `scripts/deploy-remote.sh:5-6,47-50`
- **What mismatches:** The README tells users to keep deploy credentials in a gitignored root `.env.deploy` and to copy `.env.deploy.example` to `.env.deploy`. The deploy wrapper actually defaults to `$HOME/.gallerykit-secrets/gallery-deploy.env` unless `DEPLOY_ENV_FILE` is set, and the example file also documents that home-directory default.
- **Failure scenario:** A user follows the README literally, creates `./.env.deploy`, and runs `npm run deploy`. The wrapper still reports a missing deploy env file because it is looking in the home-directory path, not the repo root.
- **Concrete fix:** Make the docs and script agree. Either:
  1. Update the README to say `DEPLOY_ENV_FILE=.env.deploy npm run deploy`, or
  2. Change the script default to the repo-root `.env.deploy`.

### 2) Local Playwright admin E2E setup overstates the required flag
- **Severity:** low
- **Confidence:** high
- **Files / regions:**
  - `apps/web/README.md:45-46`
  - `apps/web/e2e/helpers.ts:28-45`
- **What mismatches:** The README says that when `ADMIN_PASSWORD` is an Argon2 hash, local Playwright admin flows require both `E2E_ADMIN_PASSWORD` and `E2E_ADMIN_ENABLED=true`. The helper auto-enables admin E2E whenever a plaintext `E2E_ADMIN_PASSWORD` exists on a local origin, so the `E2E_ADMIN_ENABLED=true` flag is not required in that case.
- **Failure scenario:** A maintainer copies the README and adds an unnecessary opt-in flag, or assumes admin E2E is disabled when a plaintext `E2E_ADMIN_PASSWORD` is already present and local tests actually auto-enable.
- **Concrete fix:** Reword the README to say that `E2E_ADMIN_PASSWORD` is sufficient for local hashed-password setups, and that `E2E_ADMIN_ENABLED=true` is only needed to force-enable or override the default skip behavior.

### 3) GA configuration source is split between site-config and a stale env fallback
- **Severity:** low
- **Confidence:** medium
- **Files / regions:**
  - `apps/web/src/lib/content-security-policy.ts:40-45`
  - `apps/web/src/proxy.ts:45-49`
  - `apps/web/src/app/[locale]/layout.tsx:118-126`
  - `apps/web/src/__tests__/content-security-policy.test.ts:7-18`
- **What mismatches:** The runtime callers that matter (`proxy.ts` and `layout.tsx`) source Google Analytics from `site-config.json.google_analytics_id`. The CSP helper still defaults to `process.env.NEXT_PUBLIC_GA_ID`, but the app does not use that env var in the real production path.
- **Failure scenario:** A maintainer sets `NEXT_PUBLIC_GA_ID` expecting the app to emit/allow GA consistently, but the real runtime path ignores it because the middleware and layout are keyed off `site-config.json` instead.
- **Concrete fix:** Remove the `NEXT_PUBLIC_GA_ID` fallback from `buildContentSecurityPolicy`, or document it as a helper-only fallback and make sure runtime callers stay on one authoritative source.

## Missed-issues sweep

Second pass covered:
- root README / CLAUDE / AGENTS
- `.env.deploy.example` and `apps/web/.env.local.example`
- Docker / compose / nginx / deploy scripts
- root and workspace package scripts
- targeted runtime helpers and tests around deploy, E2E auth, CSP, request origin, upload limits, and MySQL SSL behavior

No additional documentation/code mismatches surfaced beyond the three findings above.
