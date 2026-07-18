# Critic Review — Cycle 1 Group B

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`
Role: critic

## Inventory and perspectives

I read `AGENTS.md` and `CLAUDE.md` and inventoried the full repository, including
all app/components/lib/DB source, 369 tests, scripts, migrations, deployment
configuration, translations, and committed review/plan history. The critique
used correctness, operator, photographer, privacy, accessibility, performance,
failure-recovery, maintainability, and documentation perspectives. Cross-file
claims were traced to their consumers rather than accepted from comments.

## Findings

### CRIT-C1-01 — “Navigation links” setting also changes sitemap discovery

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed product/SEO contract mismatch
- Regions: `apps/web/messages/en.json:790-792`,
  `apps/web/messages/ko.json:790-792`,
  `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:878-907`,
  `apps/web/src/components/nav-client.tsx:35-48`,
  `apps/web/src/components/footer.tsx:43-56`,
  `apps/web/src/app/sitemap.ts:26-33,46-76,114-121`
- Test evidence: `apps/web/src/__tests__/sitemap-robots.test.ts:77-92`

The settings UI now says only “Show or hide nav-bar links” / “내비게이션 바 링크
표시 여부,” and the individual hint text that mentioned the footer was removed.
In reality each switch controls three surfaces: the main navigation, footer
links, and whether `/timeline` or `/map` is emitted in the sitemap. The routes
remain public and directly reachable.

Concrete failure scenario: an admin hides Map to simplify the nav, believing
the setting is presentational. The map also disappears from `sitemap.xml`,
changing crawler discovery/SEO without disclosure. Conversely, an admin who
intends to unpublish GPS navigation may wrongly assume the route itself is
disabled, while direct `/map` access still works.

Suggested fix: make the product contract explicit and consistent. Either limit
the setting to nav/footer presentation and always include the public route in
the sitemap, or rename/describe it as a discovery-visibility setting and state
that the route remains directly accessible. Restore copy in both locales and
add a settings-to-nav/footer/sitemap contract test.

### CRIT-C1-02 — Similar Photos’ mount guard is not React Strict Effects safe

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed development correctness defect
- Regions: `apps/web/src/components/similar-photos.tsx:63-79,97-134`
- Test gap: `apps/web/src/__tests__/similar-photos-abort-source.test.ts:7-27`

`mountedRef` starts as `true`, but the effect only returns a cleanup that sets
it to `false`; the effect setup never restores it to `true`. React development
Strict Mode intentionally runs effect setup → cleanup → setup on initial mount.
After that probe this ref remains false for the still-mounted component.
`isCurrentOpenRequest()` then rejects every response and the `finally` guard
refuses to clear loading.

Concrete failure scenario: in `next dev`, open Similar Photos under production
semantic mode. The fetch can succeed, but no results commit and the panel can
remain in its loading state because the mounted guard says the live component
is unmounted. This makes local/operator verification of the production-only
feature misleading. The existing source test proves that the ref is consulted,
not that its lifecycle is correct.

Suggested fix: set `mountedRef.current = true` in the effect setup before
returning cleanup, matching `load-more.tsx:154-159`, or remove the redundant
mount ref if abort/request identity fully owns stale commits. Add a StrictMode
component test that expands the panel and resolves the fetch.

### CRIT-C1-03 — Login’s two fallback limiters are coupled by one awaited try block

- Severity: **High**
- Confidence: **High**
- Status: Confirmed security/availability design defect
- Region: `apps/web/src/app/actions/auth.ts:137-175`

The IP and account limiters are conceptually independent defenses, yet the
implementation serializes both in-memory and durable updates in a single try.
Failure of the first durable IP update prevents even the account **memory**
update from occurring. This is brittle failure composition: a degraded shared
dependency removes the independent fallback that was meant to survive it.

Concrete failure scenario and fix are the same as `SEC-C1-01`: distributed
guesses regain per-IP-only budgets during DB failure. Mutate both local guards
first, then isolate durable failures.

## Broader critique / accepted boundaries

- The codebase has unusually strong source-contract coverage, but several tests
  assert textual presence/order rather than execute the failure semantics they
  claim to protect. The auth ordering and Similar Photos tests demonstrate this
  gap directly.
- Operational correctness still depends on a single web writer and manually
  synchronized host nginx state. Those risks are candidly documented and
  already deferred; they should remain visible until enforcement exists.
- Public map and semantic search are bounded, not scalable. Their caps make the
  failure finite, while the UI/request-path architecture still degrades near
  those caps.
- Privacy projections, GPS stripping, restore fencing, and color-delivery
  honesty are consistent with the stated photographer-first product boundary.

## Final missed-issue sweep

I revisited every route/action export, the current change set, settings-to-
consumer mappings, source-only regression tests, error paths, concurrency
guards, privacy projections, and operator scripts. No additional high-
confidence finding survived cross-file validation. In particular, the recent
English/Korean prose compaction preserved key parity and the substantive HDR,
GPS, analytics, token, and backfill warnings; the navigation description is the
material exception because downstream behavior is broader than the new copy.
