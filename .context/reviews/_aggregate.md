# Cycle 1 Aggregate Review

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`

## Agent coverage

Completed provenance reviews: code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, and designer. The web designer performed live browser checks at desktop, 393 px, and 320 px widths. No reviewer failed.

## New deduplicated findings

### C1-01 — DB failure bypasses the account-scoped in-memory login budget

- Severity/Confidence: High / High
- Agreement: security-reviewer, critic, verifier
- Regions: `apps/web/src/app/actions/auth.ts:125-175`; auth limiter behavior/order tests
- Failure: the durable IP increment is awaited before the account map advances. If it rejects, distributed guesses retain only per-IP fallback budgets during the outage.
- Disposition: scheduled this cycle; advance both local budgets before durable awaits and add rejection-path behavior coverage.

### C1-02 — Similar Photos mount guard stays false after React Strict Effects replay

- Severity/Confidence: Medium / High
- Agreement: critic, verifier
- Regions: `apps/web/src/components/similar-photos.tsx:63-79`; `similar-photos-abort-source.test.ts`
- Failure: setup never restores `mountedRef.current = true`, so development Strict Mode cleanup/setup replay can suppress valid results and loading completion.
- Disposition: scheduled this cycle; restore the symmetric setup and pin it with regression coverage.

### C1-03 — Production semantic-search label erases the 320 px gallery identity

- Severity/Confidence: Medium / High
- Agreement: designer, test-engineer
- Regions: `apps/web/src/components/search.tsx:381-398`; `nav-client.tsx:97-110`; nav E2E/source contracts
- Failure: production mode forces a 143.55 px search label; at the WCAG reflow width the brand/home link is squeezed to a zero-width invisible focus target.
- Disposition: scheduled this cycle; keep the nav label desktop-only even in production and add 320 px coverage.

### C1-04 — Nav setting copy hides footer/sitemap side effects and direct-route reachability

- Severity/Confidence: Medium / High
- Agreement: critic, verifier
- Regions: `apps/web/messages/{en,ko}.json:790-792`; nav/footer/sitemap consumers
- Failure: the UI calls these nav-bar switches, but they also remove footer and sitemap discovery while the routes remain directly public.
- Disposition: scheduled this cycle; restore concise, explicit bilingual discovery-scope copy.

### C1-05 — GeoIP packaging/data failures silently degrade all countries to `XX`

- Severity/Confidence: Medium / High
- Agreement: code-reviewer, debugger, tracer
- Regions: `apps/web/src/instrumentation.ts:12-20`; `apps/web/src/lib/analytics.ts:34-61`
- Failure: startup and lookup catches erase the cause and permanently memoize a null lookup; health stays green while country analytics become uniformly unknown.
- Disposition: scheduled this cycle; keep fail-degraded behavior but emit a clear once-per-process diagnostic and validate startup loading.

### C1-06 — Deploy scripts proceed after detecting wrong-owner secret files

- Severity/Confidence: Medium / High
- Agreement: security-reviewer
- Regions: `scripts/deploy-remote.sh:55-93`; `apps/web/deploy.sh:17-43`; deploy contract tests
- Failure: root/sudo execution can source or consume a less-privileged user's env file, including a file-controlled shell deploy command.
- Disposition: scheduled this cycle; fail closed unless the file owner is the executing user or the explicitly trusted repository owner (shared-mount support), and extend contract coverage.

### C1-07 — Desktop first-row image priority arrives only after hydration

- Severity/Confidence: Medium / High (verifier rated Low-Medium; aggregate preserves the higher perf severity)
- Agreement: perf-reviewer, verifier
- Regions: `apps/web/src/components/home-client.tsx:26-76,124-126,227-242`
- Failure: SSR and hydration start with two columns, so cards 3-5 on wider screens miss the browser's initial eager/high-priority decision.
- Disposition: scheduled this cycle; use an SSR-safe maximum first-row eager set while keeping high fetch priority conservative, with initial-state coverage.

## Revalidated carry-forward findings

The remaining review items are not newly discovered: shared background DB/CPU budget oversubscription; warn-only single-writer enforcement; semantic writer ownership; public projection duplication; migration/reconcile structural parity; SQL restore/file-store boundary; 10k map rendering; GPS-strip heap buffering; plural upload/body-cap mismatch; semantic ranking scans; and failed-health deploy cleanup. Each remains explicitly recorded with original severity/confidence, reason, and exit criterion in `.context/plans/deferred-carry-forward.md` and its cited authoritative cycle registers. No severity is downgraded and no new work is hidden under deferral.

## Final aggregation sweep

Cross-role duplicates were merged at the highest severity/confidence. Current auth/API/origin/rate-limit scanners, privacy projections, restore fences, upload cleanup, i18n key parity, and current standalone GeoIP data placement were independently cleared; those are not findings.
