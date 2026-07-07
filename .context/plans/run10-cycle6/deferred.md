# Run 10 Cycle 6 Deferred Findings

Date: 2026-07-07

Repo policy read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, existing `.context/plans/cycle-*-deferred.md`. Security/correctness/data-loss findings are not deferred here unless they are manual operator validation items that cannot be completed by local source changes alone.

## Deferred Items

### D6-01 - Smart collections are public-readable but not admin-operable

- Original severity/confidence: Medium / High
- Source finding: AGG-C6-09 (`DES-C6-D1`, `UXR-C6-03`)
- Citation: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`, `apps/web/src/app/actions/collections.ts:16-150`, `apps/web/src/components/admin-nav.tsx:15-25`, `CLAUDE.md:162`
- Reason for deferral: already tracked as `DEF-C5-20` / carry-forward; a correct fix is a full admin Collections workflow, not a narrow bug fix.
- Exit criterion: admin UI/API workflow exists for list/create/edit/delete/preview/publish of smart collections, or the public/read-side feature is explicitly made internal-only.

### D6-02 - Timeline/date archive queries remain non-sargable

- Original severity/confidence: Low today, Medium at scale / High
- Source finding: AGG-C6-10 (`PERF-C6-01`)
- Citation: `apps/web/src/lib/data-timeline.ts:88-116`, `apps/web/src/lib/data-timeline.ts:125-207`
- Reason for deferral: performance/schema work requiring query-shape changes and possibly generated columns/index migrations; not a security, correctness, or data-loss finding at current personal-gallery scale.
- Exit criterion: archive/year/month queries use sargable range predicates or generated/indexed month/day keys, with regression coverage or `EXPLAIN` evidence.

### D6-03 - Public text search uses leading-wildcard LIKE scans

- Original severity/confidence: Low today, Medium at scale / Medium-High
- Source finding: AGG-C6-11 (`PERF-C6-02`)
- Citation: `apps/web/src/app/actions/public.ts:248-329`, `apps/web/src/lib/data.ts:1573-1704`
- Reason for deferral: requires product/search-index strategy for substring/Korean search; current route is rate-limited and bounded.
- Exit criterion: public search uses a selective index strategy or explicit query-shape/latency budget with tests.

### D6-04 - Cached images can wait on HEAD before paint

- Original severity/confidence: Low / Medium
- Source finding: AGG-C6-12 (`PERF-C6-03`)
- Citation: `apps/web/public/sw.template.js:376-430`, `apps/web/src/lib/serve-upload.ts:42-106`
- Reason for deferral: performance optimization requiring service-worker behavior changes and browser-level timing tests; not blocking correctness.
- Exit criterion: stale cached image bytes return immediately while revalidation runs in `event.waitUntil()`, with slow-HEAD regression coverage.

### D6-05 - Production CSP allows inline styles

- Original severity/confidence: Low / Medium
- Source finding: AGG-C6-13 (`SR6-L01`)
- Citation: `apps/web/src/lib/content-security-policy.ts:138-155`
- Reason for deferral: hardening requires compatibility proof for Next/font, Tailwind, and component inline styles. This is a likely hardening issue, not a confirmed injection vulnerability.
- Exit criterion: inline styles are removed/replaced with hashes/nonces, or an accepted CSP tradeoff is documented with browser compatibility evidence.

### D6-06 - Deployment/operator validation risks

- Original severity/confidence: Medium evidence risks / Medium-High
- Source finding: AGG-C6-14 (`SR6-M01`, `SR6-M02`, `SR6-M03`, `SR6-M04`, `CRIT-RISK-C6-01`, `ARCH-C6-R1`, `VER-C6-R2`)
- Citation: `apps/web/nginx/default.conf:1-29`, `apps/web/nginx/default.conf:46-69`, `apps/web/docker-compose.yml:15-22`, `CLAUDE.md:483-495`, `scripts/deploy-remote.sh:55-93`, `apps/web/deploy.sh:51-104`
- Reason for deferral: these require live operator evidence or credential/topology checks. Source changes cannot prove TLS edge exposure, proxy trust, historical secret rotation, plaintext backup storage, or active host-nginx limiter application.
- Exit criterion: deployment ledger records TLS/HTTP behavior, proxy spoof tests, secret rotation confirmation, backup handling policy, `nginx -t`/reload evidence, and burst probes for public/next-image limiters.

### D6-06a - Upstream stable dependency audit blockers

- Original severity/confidence: Medium / High
- Source finding: AGG-C6-03 (`SR6-C01`) plus cycle gate/audit follow-up for Next nested PostCSS
- Citation: `apps/web/package.json:77`, `package-lock.json` entries for `@esbuild-kit/core-utils -> esbuild@0.18.20`, `package-lock.json` entries for `next -> postcss@8.4.31`
- Reason for deferral: current latest stable packages do not expose a nonbreaking patched tree. `npm view drizzle-kit version` returns `0.31.10` and that package still declares `@esbuild-kit/esm-loader`; `npm view next version` returns `16.2.10` and that package still declares `postcss@8.4.31`. `npm audit fix --force` proposes breaking downgrades, while `next@canary` has the patched PostCSS but violates the latest-stable policy.
- Exit criterion: stable `drizzle-kit` removes the deprecated `@esbuild-kit` chain or provides a patched transitive tree; stable `next` depends on patched PostCSS; then `npm audit --workspace=apps/web --audit-level=moderate` passes without force/downgrade/canary.

### D6-07 - Storage abstraction remains a local-only product-boundary trap

- Original severity/confidence: Low-Medium / High
- Source finding: AGG-C6-15 (`CRIT-RISK-C6-02`, `ARCH-C6-R2`)
- Citation: `CLAUDE.md:150`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/types.ts`, `.context/plans/deferred-carry-forward.md:75`
- Reason for deferral: product architecture decision already tracked as `C2-27`; requires either deletion/renaming or full storage-backend project across upload, processing, serving, backup, restore, and docs.
- Exit criterion: abstraction is deleted/renamed as local-only, or a full non-local storage backend project lands end-to-end.

### D6-08 - Restore/import and upload-stream edge coverage gaps

- Original severity/confidence: Low to Medium / Medium
- Source finding: AGG-C6-16 (`DBG-C6-02`, `DBG-C6-03`, `CQR6-RISK-03`)
- Citation: `apps/web/src/lib/serve-upload.ts:330-366`, `apps/web/src/app/[locale]/admin/db-actions.ts:42-80`, `apps/web/src/app/[locale]/admin/db-actions.ts:760-848`
- Reason for deferral: this cycle fixes the concrete restore barriers first; broader child-process harnessing and low-confidence listener cleanup are follow-on robustness work.
- Exit criterion: upload abort listener cleanup is explicit, and restore import child-process failure modes are behavior-tested for timeout, spawn error, stream errors, nonzero close, migration failure, marker cleanup, and queue resume state.

### D6-09 - Broad test/e2e/coverage gaps

- Original severity/confidence: Low to Medium / High
- Source finding: AGG-C6-17 (`TE-C6-01` through `TE-C6-06`, `VER-C6-R1`, `DES-C6-M1`)
- Citation: `apps/web/package.json:13-27`, `apps/web/vitest.config.ts:16-39`, `apps/web/e2e/public.spec.ts:4-153`, `apps/web/scripts/seed-e2e.ts:36-267`, `apps/web/src/app/api/admin/lr/upload/route.ts:84-609`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-280`, `apps/web/e2e/nav-visual-check.spec.ts:58-85`, `apps/web/e2e/origin-guard.spec.ts:27-73`
- Reason for deferral: broad e2e/coverage infrastructure work is not a security/correctness defect by itself and would expand this cycle beyond the scheduled fixes. Targeted tests are still required for implemented fixes.
- Exit criterion: ratcheted coverage exists for critical directories; positive e2e covers map/timeline/year/smart collections; LR PAT upload has real auth-to-upload integration; token UI interaction is browser/component tested; nav visuals compare screenshots; authenticated origin e2e runs in CI or documented release validation. Local Playwright also needs a disposable MySQL path or documented remote fixture mode so browser-flow gates do not depend on the production dataset containing local seeded keys.

### D6-10 - CLIP and analytics validation risks

- Original severity/confidence: Low-Medium to Medium / Medium-High
- Source finding: AGG-C6-18 (`CQR6-RISK-01`, `CQR6-RISK-02`, `TE-C6-06`)
- Citation: `apps/web/src/lib/background-db-writes.ts:42-75`, `apps/web/src/app/actions/public.ts:436-525`, `apps/web/src/lib/clip-model.ts:200-229`, `apps/web/src/__tests__/clip-offline-load.test.ts:23-65`
- Reason for deferral: analytics dropping at cap is an intentional overload policy unless product requires completeness; CLIP activation requires seeded weights/operator environment.
- Exit criterion: analytics completeness policy and metrics are documented, and CLIP offline/integration proof runs in an isolated or non-flaky harness before production activation changes.

### D6-11 - UI performance, data-backed browser, and future RTL evidence gaps

- Original severity/confidence: Low to Medium / Medium-High
- Source finding: AGG-C6-19 (`DES-C6-M1`, `DES-C6-M2`, `DES-C6-M3`)
- Citation: `apps/web/src/app/[locale]/layout.tsx:103-109`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/masonry-card.tsx`, `apps/web/src/components/photo-viewer.tsx`
- Reason for deferral: local DB outage prevented live data-backed review; Web Vitals and future RTL require representative seeded/staging environments. This is validation work, not a confirmed defect.
- Exit criterion: seeded browser pass and Web Vitals traces cover public/admin data-backed flows; any RTL locale addition includes layout/accessibility tests before release.
