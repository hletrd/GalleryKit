# Code Reviewer Report

## Inventory / Files Examined

Reviewed the full non-generated repo surface relevant to runtime behavior and quality:

- Root rules/docs/scripts: 5
  - `AGENTS.md`, `CLAUDE.md`, `README.md`, `package.json`, `scripts/deploy-remote.sh`
- App configs/public/site files: 19
- App source (non-test): 152
- Unit tests: 57
- E2E specs/helpers: 6
- Migration/schema files: 7
- Scripts: 14
- Locale message files: 2

Total review-relevant text/code files examined via inventory + whole-tree static sweep: **262**.

Whole-repo checks run:

- `npm run typecheck --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm run lint:action-origin --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (57 files / 329 tests passed)
- `npm run test:e2e --workspace=apps/web` ⚠️ blocked by missing MySQL on `127.0.0.1:3306`
- Repo-wide grep sweeps for `console.log`, empty `catch`, likely hardcoded secrets, risky file/SQL/process patterns ✅

Notes:

- MCP/LSP code-intel transport was unavailable during this run, so type safety was verified with repo-native `tsc`/eslint/test commands instead.
- I directly read the high-risk cross-file paths (`auth`, `request-origin`, uploads, image queue/processing, DB backup/restore, public routes, admin actions/components, data layer), then did a whole-tree sweep over the remaining relevant files/tests/config.

## Findings by Severity

### MEDIUM

#### 1) Same-origin guard trusts the first forwarded hop, not the trusted one
- **File / region:** `apps/web/src/lib/request-origin.ts:9-10,32-45,79-86`
- **Status:** **Likely**
- **Confidence:** Medium
- **Why this is an issue:** `normalizeHeaderValue()` always takes the first comma-separated value. When `TRUST_PROXY=true`, both `x-forwarded-proto` and `x-forwarded-host` flow through that helper. In chained / append-style proxy setups, the left-most value can be attacker-controlled while the trusted proxy appends the real hop later.
- **Concrete failure scenario:** A deployment behind an append-style reverse proxy receives `X-Forwarded-Host: evil.example, gallery.atik.kr` and matching `Origin: https://evil.example`. `hasTrustedSameOrigin()` can derive `https://evil.example` as the expected origin and incorrectly accept the request for admin actions / backup download.
- **Suggested fix:** Parse trusted proxy headers the same way `getClientIp()` treats `x-forwarded-for`: prefer the trusted/right-most hop (or reject multi-valued `x-forwarded-host`/`x-forwarded-proto` outright unless the deployment guarantees overwrite semantics). Add regression tests for comma-separated forwarded chains.

#### 2) CSV export still triple-buffers large datasets in memory
- **File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:51-93`
- **Status:** **Confirmed**
- **Confidence:** High
- **Why this is an issue:** The implementation loads up to 50k rows into `results`, copies them into `csvLines`, then materializes a second full copy with `csvLines.join("\n")`. The comment says it avoids holding both the DB result and full CSV in memory simultaneously, but the code still creates multiple large live representations.
- **Concrete failure scenario:** On a large gallery with long titles/tag lists, `exportImagesCsv()` can spike heap usage badly enough to stall the process or OOM the admin request, especially under concurrent exports.
- **Suggested fix:** Stream rows directly to the response/download path, or paginate/chunk rows and append incrementally so only one bounded chunk is live at a time. Avoid `results` + `csvLines` + `csvContent` existing together.

#### 3) SQL restore scanner can be bypassed across large chunk/comment boundaries
- **File / region:**
  - `apps/web/src/lib/sql-restore-scan.ts:54-95`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:362-384`
- **Status:** **Risk**
- **Confidence:** Medium
- **Why this is an issue:** The scanner only carries a fixed `64 * 1024` tail between 1 MB restore chunks. That catches short boundary splits, but not statements whose dangerous tokens are separated by more than 64 KB of comment/literal content that gets stripped before matching.
- **Concrete failure scenario:** A crafted dump splits a banned statement (for example `CREATE ... TRIGGER` / `CREATE ... PROCEDURE`) across chunk boundaries with >64 KB of removable comment/literal padding between tokens. The fixed tail drops the first token, the regex never sees the full statement, and `mysql` executes it during restore.
- **Suggested fix:** Replace the fixed-window regex scan with a streaming SQL lexer/tokenizer that preserves parse state across chunks after comment/literal stripping, or at minimum keep state keyed to partial dangerous-token prefixes instead of raw byte windows. Add regression coverage with a >64 KB split.

### LOW

#### 4) Regression tests miss the two boundary cases above
- **File / region:**
  - `apps/web/src/__tests__/request-origin.test.ts:24-114`
  - `apps/web/src/__tests__/sql-restore-scan.test.ts:66-75`
- **Status:** **Confirmed**
- **Confidence:** High
- **Why this is an issue:** Current tests cover single-hop forwarded headers and a 2 KB SQL chunk split, but not comma-separated forwarded chains or >64 KB scanner boundaries.
- **Concrete failure scenario:** Refactors preserve the happy-path tests while reintroducing (or failing to catch) proxy-chain provenance bugs or long-gap SQL-scan bypasses.
- **Suggested fix:** Add explicit tests for multi-value `x-forwarded-host` / `x-forwarded-proto`, and for a split dangerous statement with a gap larger than `SQL_SCAN_TAIL_BYTES`.

## Final Sweep / Commonly Missed Issues Check

Checked explicitly for:

- hardcoded secrets / credentials in source
- missing admin auth wrappers on admin API routes
- missing same-origin checks on mutating server actions
- path traversal / symlink issues on upload serving and backup download
- raw SQL / shell-spawn surfaces
- empty catches / swallowed failures
- privacy leaks from public image selectors
- queue / restore / upload cross-file race conditions
- stale cache / revalidation gaps on admin mutations

No CRITICAL or HIGH issues found in the current repo snapshot.

## Verification Evidence

- Typecheck: pass
- ESLint: pass
- API-auth lint: pass
- Action-origin lint: pass
- Unit tests: pass (`57` files, `329` tests)
- E2E: not runnable in this environment because Playwright webServer init failed on missing MySQL (`ECONNREFUSED 127.0.0.1:3306`)

## Final Skipped-File Check

Intentionally skipped as non-review-relevant/generated/runtime artifacts:

- `node_modules/**`
- `.next/**`
- `playwright-report/**`
- `test-results/**`
- `.git/**`
- `.omx/**`, `.omc/**`, `.context/**`, `plan/**` runtime/history artifacts
- binary fixtures/images (for example `apps/web/e2e/fixtures/*.jpg`, screenshots)

No other review-relevant source/config/test files were intentionally skipped.

## Recommendation

**COMMENT** — repo is generally in good shape and passes its configured gates, but the three medium findings above are worth addressing before treating the current state as fully hardened.
