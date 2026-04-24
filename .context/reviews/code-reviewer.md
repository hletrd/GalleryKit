# Code Review Report — code-reviewer lane

## Scope and inventory
- Repository root reviewed from `/Users/hletrd/flash-shared/gallery`.
- Inventory pass found **272 review-relevant text/code/config files**.
- Deep review focused on all executable/runtime surfaces under:
  - `apps/web/src/app/**`
  - `apps/web/src/components/**`
  - `apps/web/src/lib/**`
  - `apps/web/src/db/**`
  - `apps/web/src/i18n/**`
  - `apps/web/src/__tests__/**`
  - `apps/web/scripts/**`
  - `apps/web/e2e/**`
  - runtime/build/deploy config (`next.config.ts`, `playwright.config.ts`, `vitest.config.ts`, Docker/nginx/workflow files, package manifests, READMEs)
- Skipped as non-reviewable/generated artifacts after inventory sweep: binary screenshots/assets, upload fixtures/derivatives, `node_modules/**`, `test-results/**`, `.context/**` historical reports/plans, `plan/**`, `.omx/**`, `.omc/**`, and generated lock/snapshot artifacts such as `package-lock.json` and `apps/web/drizzle/meta/*.json`.

## Stage 1 — Spec compliance
- README-advertised feature set broadly matches the implementation: public gallery, topic pages, shared links, admin CRUD, image processing pipeline, i18n, backup/restore, and deployment surfaces are all present.
- No repository-wide “wrong feature / missing core feature” mismatch was confirmed in this pass.

## Stage 2 — Code quality / correctness findings

### 1) `getClientIp()` mis-identifies the client once you are not in the repo’s exact one-proxy topology
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** CONFIRMED
- **Primary evidence:**
  - `apps/web/src/lib/rate-limit.ts:61-79`
  - `apps/web/src/__tests__/rate-limit.test.ts:90-100`
  - `apps/web/nginx/default.conf:49-52`, `66-68`, `115-117`
- **Issue:** The implementation intentionally chooses the **right-most** IP from `X-Forwarded-For`. That only matches the current sample nginx topology when nginx is the sole trusted proxy hop. In any common multi-hop deployment (Cloudflare/ALB → nginx → app), the right-most hop is usually the **proxy**, not the browser client.
- **Failure scenario:** Login/search/share/upload rate limits collapse many users behind the same edge or load balancer into a shared bucket; audit entries also log the wrong IP. The current tests actually lock this incorrect assumption in.
- **Concrete fix:** Replace the right-most selection with explicit trusted-hop handling. Either:
  1. parse `X-Forwarded-For` from the left and strip a configured number of trusted proxies, or
  2. trust a single canonical proxy header (`X-Real-IP` / provider-specific header) only when the proxy contract guarantees it.
  Also add regression tests for direct-connect, single-proxy, and multi-proxy chains.

### 2) CDN-backed image deployments can silently break the histogram feature
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Status:** LIKELY
- **Primary evidence:**
  - `apps/web/src/components/histogram.tsx:234-266`
  - `apps/web/src/lib/constants.ts:6-7`
  - `apps/web/next.config.ts:7-55`
  - `README.md:95-107`
- **Issue:** The app explicitly supports absolute `IMAGE_BASE_URL` values for CDN/fronted image delivery, but the histogram client always loads the rendered image into a canvas and reads pixels. If `imageUrl(...)` resolves to a cross-origin CDN without permissive CORS, the canvas becomes tainted and the histogram falls back to an empty state.
- **Failure scenario:** A deployment using `IMAGE_BASE_URL=https://cdn.example.com` works for image rendering, but the histogram panel never populates in the photo viewer.
- **Concrete fix:** Either route histogram sampling through a same-origin URL/proxy, or make the CDN CORS requirement explicit and detectable (for example: fail loudly in UI when cross-origin pixels are unavailable, and document required `Access-Control-Allow-Origin` behavior).

### 3) The same-origin lint gate still has blind spots for future server-action files
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** RISK
- **Primary evidence:**
  - `apps/web/scripts/check-action-origin.ts:46-93`
  - `apps/web/scripts/check-action-origin.ts:244-260`
- **Issue:** The scanner only auto-discovers `.ts` files under `src/app/actions/` plus one hard-coded `db-actions.ts`. That means a future mutating server action placed in a `.tsx` / `.js` / `.mjs` module, or outside those hardcoded paths, can evade the CI gate entirely while still shipping without `requireSameOriginAdmin()`.
- **Failure scenario:** A new mutating action lands in `src/app/actions/foo.tsx` (or another `use server` module outside the current allowlist), CI remains green, and the defense-in-depth origin check is silently absent.
- **Concrete fix:** Expand discovery to all route-legal source extensions and/or scan every `src/app/**` module containing `use server`. Add a regression test proving `.tsx` and off-path action modules are covered.

## Final sweep
- Re-checked the dominant high-risk surfaces after findings collection: auth/session, rate limiting, data/privacy query shapes, image pipeline/queueing, public upload serving, backup/restore, sharing, settings/SEO, middleware, deployment config, and the repo’s lint/test gates.
- I did **not** find any current CRITICAL or HIGH severity issue.
- I did **not** find a repo-wide spec mismatch.
- Remaining skipped files are the non-executable/generated artifacts listed in the inventory section above.

## Verification evidence
- `npm test --workspace=apps/web` ✅ (54 files / 316 tests passed)
- `npm run typecheck --workspace=apps/web` ✅
- `npm run lint --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅

## Verdict
- **Recommendation:** COMMENT
- Rationale: core gates are green and I did not confirm any HIGH/CRITICAL defect, but the medium-severity proxy/IP handling bug should be addressed before relying on rate limiting or audit IPs in more complex production topologies.
