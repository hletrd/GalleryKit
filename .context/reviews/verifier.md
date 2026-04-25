# Evidence-based correctness review — Cycle 6

Scope: 850 tracked files inventoried; reviewed docs/config, app source, scripts/migrations, tests/e2e. Verification observed by agent: lint, typecheck, unit tests, API-auth lint, action-origin lint passed; prior Playwright last-run reported passed.

## Findings

### VER6-01 — The action-origin lint gate can be satisfied by dead/nested calls and the getter exemption is a bypass path
- **Location:** `apps/web/scripts/check-action-origin.ts:99-103,112-128,158-181`; tests `apps/web/src/__tests__/check-action-origin.test.ts:17-153`; policy docs `CLAUDE.md:241-245`
- **Severity/confidence:** High / High
- **Status:** Confirmed with synthetic probes.
- **Problem:** The scanner accepts any `requireSameOriginAdmin()` call anywhere in the action body AST, including nested helpers or unreachable branches. It also skips any export matching `^get[A-Z]`, which is a name heuristic rather than proof of read-only behavior.
- **Failure scenario:** A mutating action ships without a real origin guard while CI reports the lint gate green.
- **Suggested fix:** Accept only effective top-level guard calls or explicit exemptions; replace blanket getter exemption with explicit allowlist/exempt comments; add regression tests.

### VER6-02 — The default e2e gate can pass while admin workflows remain unexecuted
- **Location:** `apps/web/package.json:19`; `apps/web/playwright.config.ts:17-19,34-65`; `apps/web/e2e/admin.spec.ts:6-7`; `apps/web/e2e/helpers.ts:28-74`; `apps/web/e2e/origin-guard.spec.ts:50-52`; `apps/web/.env.local.example:24-28`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed skip path; environment-dependent.
- **Problem:** `npm run test:e2e` can pass while admin E2E specs are skipped unless local/plaintext credentials or explicit flags are present.
- **Failure scenario:** Admin login/upload/delete regressions are not executed in the main Playwright gate.
- **Suggested fix:** Require a separately reported admin E2E lane in CI or fail/loudly annotate when admin tests are skipped in CI.
