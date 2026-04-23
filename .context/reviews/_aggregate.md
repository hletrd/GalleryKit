# Aggregate Review — Cycle 3 (2026-04-23)

## Agent inventory and execution status
Attempted review lanes this cycle:
- Completed subagents: `code-reviewer`, `security-reviewer`
- Leader fallback reviews written after subagent retries stalled or were blocked: `verifier`, `test-engineer`, `perf-reviewer`
- Spawn failures after retry due agent-thread limits: `critic`, `architect`, `debugger`, `tracer`, `document-specialist`, `designer`, `dependency-expert`

## AGENT FAILURES
The following lanes were requested, retried once when possible, and still could not complete because the session hit the subagent thread cap (`max 6`) or the lane stalled without updating its file:
- `critic` — spawn failed twice because of thread limit
- `architect` — spawn failed twice because of thread limit
- `debugger` — spawn failed on retry because of thread limit
- `tracer` — spawn failed on retry because of thread limit
- `document-specialist` — spawn failed on retry because of thread limit
- `designer` — spawn failed on retry because of thread limit
- `dependency-expert` — spawn failed on retry because of thread limit
- `verifier` — two spawned attempts stalled on stale prior-cycle output; leader produced fallback review for this cycle
- `test-engineer` — two spawned attempts stalled on stale prior-cycle output; leader produced fallback review for this cycle
- `perf-reviewer` — could not be spawned because of thread limit; leader produced fallback review for this cycle

## Dedupe / cross-agent agreement notes
- **High-signal, multi-lane agreement:** locale-reserved topic route gap (`code-reviewer`, `verifier`, `test-engineer`), histogram worker correlation bug (`code-reviewer`, `verifier`, `perf-reviewer`, `test-engineer`), restore-under-traffic ambiguity (`code-reviewer`, `verifier`, `perf-reviewer`, `test-engineer`), weak/example secret hygiene (`security-reviewer`), AWS SDK vulnerability (`security-reviewer`).
- Where a test-gap finding mapped directly to a confirmed code issue, the aggregate keeps one implementation item and explicitly requires regression coverage.

## Merged findings

### AGG3-01 — Topic and alias validation still permit locale-reserved route segments
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Signal:** Multi-agent agreement (`code-reviewer`, `verifier`, `test-engineer`)
- **Citations:** `apps/web/src/lib/validation.ts:1-16`, `apps/web/src/app/actions/topics.ts:51-65`, `apps/web/src/app/actions/topics.ts:328-336`, `apps/web/src/__tests__/validation.test.ts:98-107`, `apps/web/src/__tests__/topics-actions.test.ts:138-148`
- **Why it is a problem:** The router reserves `/{locale}` for `en` and `ko`, but topic/alias validation only blocks hardcoded segments like `admin`, `g`, `p`, `s`, `uploads`.
- **Concrete failure scenario:** Admin creates topic slug or alias `en`; creation succeeds, but the route is shadowed by the locale segment and is unreachable.
- **Suggested fix:** Reserve locale codes via `LOCALES` for both slugs and aliases, and add regression tests.
- **Disposition:** IMPLEMENT

### AGG3-02 — Histogram worker replies are not request-correlated, so rapid navigation can render the wrong histogram
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Signal:** Multi-agent agreement (`code-reviewer`, `verifier`, `perf-reviewer`, `test-engineer`)
- **Citations:** `apps/web/src/components/histogram.tsx:21-58`, `apps/web/src/components/photo-viewer.tsx:50-140`
- **Why it is a problem:** Every pending histogram promise listens for the next worker `message`. When multiple requests overlap, a stale response can resolve the wrong pending request.
- **Concrete failure scenario:** User flips quickly between photos; the second photo shows the first photo’s histogram, and the real second response is dropped or wasted.
- **Suggested fix:** Add request IDs/pending map to the shared worker protocol and add regression coverage for overlapping requests.
- **Disposition:** IMPLEMENT

### AGG3-03 — Example configuration still normalizes weak secret hygiene and does not warn operators to rotate historically exposed bootstrap secrets
- **Severity:** HIGH
- **Confidence:** HIGH
- **Signal:** Security-reviewer
- **Citations:** `apps/web/.env.local.example:1-25`, `CLAUDE.md:72-79`, historical git revision noted in `.context/reviews/security-reviewer.md`
- **Why it is a problem:** Current examples still use `DB_PASSWORD=password`, and the repo needs an explicit warning that any environment seeded from older examples must rotate `SESSION_SECRET`/bootstrap credentials because the earlier committed values are permanently compromised.
- **Concrete failure scenario:** An operator copies the example verbatim or reuses an older secret from history, making admin/database compromise materially easier.
- **Suggested fix:** Replace weak live-looking defaults with non-usable placeholders and document mandatory rotation of older example secrets.
- **Disposition:** IMPLEMENT

### AGG3-04 — Production dependency tree ships a known-vulnerable AWS SDK XML-builder chain
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Signal:** Security-reviewer
- **Citations:** `apps/web/package.json:22-24`, `package-lock.json`, `npm audit --omit=dev --json`
- **Why it is a problem:** The direct S3 packages pull in the advisory chain rooted in `fast-xml-parser` / `@aws-sdk/xml-builder`.
- **Concrete failure scenario:** When S3/MinIO paths are enabled, specially crafted values can exercise the vulnerable XML builder path; regardless of exploitability, shipping known-vulnerable prod packages is a security release risk.
- **Suggested fix:** Move the direct AWS SDK deps to the audit-recommended non-vulnerable version and refresh the lockfile.
- **Disposition:** IMPLEMENT

### AGG3-05 — Public gallery routes still pay exact `count(*)` cost on every request
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Signal:** Perf-reviewer
- **Citations:** `apps/web/src/lib/data.ts:247-269`, `apps/web/src/app/[locale]/(public)/page.tsx:108-113`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:118-123`
- **Why it is a problem:** Hot unauthenticated routes do both the listing query and an exact filtered count, increasing DB work on every page load.
- **Concrete failure scenario:** Large galleries or crawler bursts spend extra time on full counts just to drive `hasMore` and header counts.
- **Suggested fix:** Move to `PAGE_SIZE + 1` for `hasMore` and scope a separate/cached exact-count strategy if the UI still needs totals.
- **Disposition:** DEFER (architectural/public-contract performance change)

### AGG3-06 — Restore mode behavior for concurrent public readers is still operationally ambiguous
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Signal:** Multi-agent agreement (`code-reviewer`, `verifier`, `perf-reviewer`, `test-engineer`)
- **Citations:** `apps/web/src/app/[locale]/admin/db-actions.ts:248-289`, `apps/web/src/lib/restore-maintenance.ts:1-26`, public reads under `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`
- **Why it is a problem:** Writes are blocked during restore, but public reads do not obviously return a maintenance mode. The intended behavior under live traffic is not proven.
- **Concrete failure scenario:** During restore, visitors can hit partial data, transient SQL errors, or stale cache artifacts.
- **Suggested fix:** Either gate public reads during restore or stage-validate/document the degraded-read contract.
- **Disposition:** DEFER (needs operational/product decision + staging validation)

### AGG3-07 — Production CSP still allows `unsafe-inline`, weakening XSS containment
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Signal:** Security-reviewer
- **Citations:** `apps/web/next.config.ts:50-71`
- **Why it is a problem:** Inline script/style execution remains broadly allowed in production, so CSP would not materially contain many future injection bugs.
- **Concrete failure scenario:** A future HTML/script injection in an admin-editable surface executes inline payloads despite CSP.
- **Suggested fix:** Move to nonce/hash-based CSP and remove `unsafe-inline` where feasible.
- **Disposition:** DEFER (broader CSP rollout likely needs framework/analytics coordination)

### AGG3-08 — `/api/health` publicly exposes DB-readiness state
- **Severity:** LOW
- **Confidence:** HIGH
- **Signal:** Security-reviewer
- **Citations:** `apps/web/src/app/api/health/route.ts:1-18`, `README.md:163`, `CLAUDE.md:206`
- **Why it is a problem:** Anyone can poll the endpoint and learn whether the DB is currently degraded, under restore, or healthy.
- **Concrete failure scenario:** Attackers time nuisance traffic or credential attacks around restore/outage windows using the endpoint as an oracle.
- **Suggested fix:** Keep `/api/live` public and restrict `/api/health` to trusted monitors if external monitoring does not require public access.
- **Disposition:** DEFER (deployment contract decision)

### AGG3-09 — Explicit same-origin / CSRF enforcement is inconsistent across authenticated mutation/download surfaces
- **Severity:** MEDIUM
- **Confidence:** MEDIUM
- **Signal:** Security-reviewer
- **Citations:** `apps/web/src/app/actions/auth.ts:91-95`, `apps/web/src/app/actions/auth.ts:272-290`, `apps/web/src/app/api/admin/db/download/route.ts:12-62`
- **Why it is a problem:** The repo explicitly validates same-origin for login, but not uniformly for other authenticated mutations or the backup download route.
- **Concrete failure scenario:** Depending on framework/browser behavior, an admin browser could be induced to perform unwanted authenticated actions or downloads.
- **Suggested fix:** Apply consistent same-origin/CSRF protections across all authenticated mutations and sensitive downloads.
- **Disposition:** DEFER (needs broader auth-surface audit and compatibility review)

### AGG3-10 — Proxy misconfiguration can collapse rate limiting to the shared `unknown` bucket
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Signal:** Security-reviewer
- **Citations:** `apps/web/src/lib/rate-limit.ts:61-86`, `apps/web/.env.local.example:29-34`, `README.md:127-132`
- **Why it is a problem:** Without `TRUST_PROXY=true`, all proxied traffic can share one rate-limit identity.
- **Concrete failure scenario:** One client exhausts login/search/share buckets for everyone behind the reverse proxy.
- **Suggested fix:** Consider failing closed in production when proxy headers are present but `TRUST_PROXY` is unset, or otherwise keep the existing documentation and staging validation.
- **Disposition:** DEFER (deployment-policy decision)

## Finding count
- Total merged findings this cycle: **10**
- Implement now: **4**
- Deferred/manual with explicit follow-up criteria needed: **6**
