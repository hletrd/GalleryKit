# Critic Review — Cycle 6

Inventory: 281 review-relevant tracked text files across docs/config, app config, routes/actions/pages, components, UI primitives, libs/storage/db/i18n, scripts, migrations, tests/e2e, and locale messages. Verification observed by agent: lint, typecheck, unit tests, API-auth lint, and action-origin lint passed.

## Findings

### CRIT6-01 — Anonymous `loadMoreImages` has no server-side rate limit despite docs claiming it does
- **Location:** `apps/web/src/app/actions/public.ts:23-40`; docs contradiction `CLAUDE.md:127-130`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed.
- **Problem:** The anonymous infinite-scroll action is bounded by validation but not throttled; docs say public search/load-more rely on validation and rate limiting, but only search is rate-limited.
- **Failure scenario:** A bot hammers offsets/tags and forces repeated DB reads.
- **Suggested fix:** Add the same in-memory + DB-backed per-IP throttle used for search or redesign as a cacheable GET route; fix docs.

### CRIT6-02 — `seo_locale` is an admin-visible setting that does not affect metadata at runtime
- **Location:** `apps/web/src/app/actions/seo.ts:37-43,91-93,131-133`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:16-22,144-153`; metadata generation under `apps/web/src/app/[locale]/**`
- **Severity/confidence:** Medium / High
- **Status:** Confirmed.
- **Problem:** Admins can edit and save OG Locale, but metadata generation ignores the setting and derives from route locale.
- **Failure scenario:** A visible SEO control is inert, misleading operators and reviewers.
- **Suggested fix:** Wire the configured locale into metadata generation or remove the setting.

### CRIT6-03 — `CLAUDE.md` is materially stale about caching behavior
- **Location:** `CLAUDE.md:198-202`; public route `revalidate = 0` settings in `apps/web/src/app/[locale]/(public)/**`
- **Severity/confidence:** Low-Medium / High
- **Status:** Confirmed.
- **Problem:** Docs claim photo/topic/home ISR durations while live code renders public surfaces fresh with `revalidate = 0`.
- **Failure scenario:** Future agents/operators reason about DB load and cache invalidation from stale docs.
- **Suggested fix:** Update docs or intentionally restore ISR with a documented invalidation model.

### CRIT6-04 — Production CSP whitelists `cdn.jsdelivr.net` with no in-repo consumer
- **Location:** `apps/web/src/lib/content-security-policy.ts:58-69`
- **Severity/confidence:** Low / High
- **Status:** Confirmed.
- **Problem:** Production `style-src` includes a third-party origin not used by the repo.
- **Failure scenario:** Policy is unnecessarily broad and noisier during incident review.
- **Suggested fix:** Remove `https://cdn.jsdelivr.net` unless a runtime dependency requires it and add CSP tests for minimal origins.
