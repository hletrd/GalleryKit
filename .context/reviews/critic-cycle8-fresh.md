# Critic — Cycle 8 (Fresh, broad sweep)

**Stance:** what should the team push back on, what assumptions are stale, what is the loop converging on.

## Observations

### CR-CRIT-01 — The loop is materially converging
After 7 cycles, fresh broad-surface review surfaces predominantly delivery / observability micro-issues (cache headers, sitemap config, header completeness) rather than security or correctness defects. The recent obsession with Unicode-formatting char classes appears resolved at every entry point (alias, tag, label, title, description, SEO, CSV). **This is a valid outcome.** The cycle prompt specifically calls this out: "If reviewers find nothing material, that's a valid outcome — say so and let convergence happen naturally."

**Recommendation:** Continue to allow plans for genuinely new categories (delivery caching, browser privacy posture, supply-chain hardening) but do not invent sequels to the rate-limit / Unicode themes purely to fill the cycle.

### CR-CRIT-02 — Stale assumption: `force-dynamic` + `revalidate` cohabit
`apps/web/src/app/sitemap.ts:7-8` has both `dynamic = 'force-dynamic'` and `revalidate = 3600`. Operators reading the file will assume the sitemap is hourly-cached. It is not. This is a documentation drift that no reviewer caught earlier because the tests don't measure cache behavior. Worth fixing — but more importantly, worth a CI lint rule (or a comment) flagging contradictory module-level config exports.

### CR-CRIT-03 — The site ships a public unauthenticated CPU-bound endpoint with no rate limit
`/api/og` (apps/web/src/app/api/og/route.tsx) is the only public unauthenticated route that performs CPU-bound work without a rate-limit budget. Every other public surface (`searchImagesAction`, `loadMoreImages`) has both an in-memory and a DB-backed rate limit. The asymmetry is the kind of thing that causes incident-postmortem regret. This deserves a plan.

### CR-CRIT-04 — Audit log retention defaults to 90 days but the OWASP guidance for admin actions is 1 year
`apps/web/src/lib/audit.ts:52` defaults to 90 days. For a personal gallery this is a reasonable trade-off; for an operator subject to data-retention obligations the 90-day default is too short. The env var `AUDIT_LOG_RETENTION_DAYS` exists, so this is configurable — but the README/CLAUDE.md does not document it as a knob to consider.

**Recommendation:** Document `AUDIT_LOG_RETENTION_DAYS` in `.env.local.example` and CLAUDE.md alongside `SESSION_SECRET` and `TRUST_PROXY`.

### CR-CRIT-05 — `apps/web/scripts/check-action-origin.ts` handles `@action-origin-exempt` by leading-comment match. Fragile.
The lint script's existing fixture-based test (`__tests__/check-action-origin.test.ts`) covers the happy path. But the lint relies on a specific comment shape; a future formatter that reflows comments could silently break the exemption. Not currently broken, just fragile — a brittleness budget item.

**Recommendation:** Switch to a structured pragma (e.g., a marker function call `_actionOriginExempt('reason')` that the lint searches for in the AST) to make it formatter-resistant. Defer if there's no current breakage.

### CR-CRIT-06 — Aggregating 7 cycles' findings reveals a backlog of "deferred LOW/perf" items
Backlog includes: AGG6R-09 BMP/GIF derivative asymmetry; D6-04 photo-page ISR; D6-09 CSP nonce on every public response; PERF-02 search sequential JOINs (the `searchImages` short-circuit only catches the 100-result-saturated case). Not all of these need to ship — some should be explicitly closed as "won't fix, accepted trade-off" rather than left ambiguously deferred.

**Recommendation:** A single plan that walks the deferred backlog and either schedules each or marks it WONTFIX with a one-line rationale. Hygiene over implementation.

## Net stance

The codebase is in stable, maintainable territory. Cycle 8's fresh sweep produced:
- 1 medium-severity item worth scheduling (`/api/og` DoS amplifier)
- 4-6 cosmetic / docs items worth bundling into a single hygiene plan
- 0 fresh security or correctness regressions

A reasonable next-cycle posture is "schedule the OG fix; bundle the rest as one hygiene plan; let convergence land naturally."
