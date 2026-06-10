# Plan 283 — Run-4 Cycle 6 fixes

**Source review:** `.context/reviews/run4-cycle6/_aggregate.md` (12 findings
→ 10 fix tasks; TEST-R4C6-11 carries the SW contract suite, the IME/timeline
test gaps fold into their parent tasks; 1 ops-runbook deferral in plan-284).
Per-angle provenance in the same directory. Repo policy: GPG-signed commits,
Conventional Commits + gitmoji, per-iteration push, per-cycle deploy, no
suppressions. HARD-SCOPE: no edit/culling/scoring features; no
content-hash-filename migration.

## Task 1 — COR-R4C6-01: IME composition guards on every Enter/Arrow text-input handler
**Files:** new `apps/web/src/lib/ime.ts`,
`apps/web/src/components/tag-input.tsx`,
`apps/web/src/components/search.tsx`,
`apps/web/src/components/image-manager.tsx`,
`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`,
`apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`,
new `apps/web/src/__tests__/ime-composition-guard.test.ts`
- [x] `lib/ime.ts`: `isImeComposingNativeEvent(e: KeyboardEvent)` =
      `e.isComposing || e.keyCode === 229` (Safari/legacy-Chromium quirk);
      `isImeComposingReactEvent(e: React.KeyboardEvent)` delegating to the
      nativeEvent. Client-safe pure module.
- [x] `tag-input.tsx handleKeyDown`: return early when composing (entire
      handler — Enter/comma must not add, Backspace must not pop tags,
      arrows must not hijack candidate navigation, Escape must not close).
- [x] `search.tsx`: input `onKeyDown` early-return when composing (arrows/
      Enter); window `keydown` handler early-return when composing (⌘K /
      Escape).
- [x] `image-manager.tsx` batch-add input, `topic-manager.tsx` inline-rename
      input, `tokens-client.tsx` token-name input: guard the Enter branch.
- [x] Tests: unit cases for both helper shapes (composing keydown with
      isComposing=true; keyCode 229; plain Enter passes); source-contract
      assertions that each of the five surfaces consults the guard before
      acting.

**Done:** helper + 5 surfaces guarded; 13 new tests green (unit + source contracts).


## Task 2 — COR-R4C6-02: timeline/year silent 100-photo truncation
**Files:** `apps/web/src/lib/data-timeline.ts`,
`apps/web/src/app/[locale]/(public)/timeline/page.tsx`,
`apps/web/src/app/[locale]/(public)/year/[year]/page.tsx`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`,
new `apps/web/src/__tests__/data-timeline-truncation.test.ts`
- [x] `TIMELINE_PAGE_LIMIT` 100 → 500; `getTimelineImages` fetches
      `limit + 1` and returns `{ images, truncated }` (lookahead row
      dropped); `getYearInReviewImages` propagates `truncated`.
      Correct the non-sargable `YEAR()` index-coverage comment
      (document-specialist).
- [x] Both pages render a localized, visible truncation notice when
      `truncated` ("Showing the {count} most recent photos of {year}.")
      — EN+KO added together. JSON-LD unchanged (already slice(0,10)).
- [x] Tests: helper returns truncated=false at exactly limit rows,
      true at limit+1 (mock db); source-contract pins both pages render
      the notice key.

**Done:** limit 500 + lookahead + visible notices on both pages; 9 new tests green.


## Task 3 — UX-R4C6-03 + A11Y-R4C6-04 + COR-R4C6-12: lightbox interaction cluster
**Files:** `apps/web/src/components/lightbox.tsx`,
`apps/web/src/__tests__/lightbox-controls-contract.test.ts` (new)
- [x] Auto-hide: both hide-timer callbacks keep controls ONLY when the
      active element is inside the dialog AND matches `:focus-visible`
      (try/catch the matches call); when hiding with a (mouse-focused)
      control still holding focus, blur it first so `aria-hidden` never
      applies to a focused element (WCAG 4.1.2). blur() emits no focusin,
      so FocusTrap will not re-capture until the next Tab — which
      correctly re-reveals controls via `onFocusCapture`.
- [x] Remove the `aria-label={currentIndex+1 / totalCount}` from the
      lightbox `<img>` — alt text must win accessible-name computation;
      the `role="status"` live-region counter already announces position.
- [x] Space branch: move `isEditableTarget(e)` above
      `preventDefault()`/`stopPropagation()`.
- [x] Source-contract tests: no aria-label on the lightbox img; editable
      check precedes preventDefault in the Space branch; hide path
      consults `:focus-visible`.

**Done:** focus-visible keepalive + blur-before-hide; ARIA label removed from the slide img; Space guard reordered; 5 contract tests green.


## Task 4 — COR-R4C6-05: revive the SW HTML offline fallback honestly (+ kill the dead Cookie sniff)
**Files:** `apps/web/src/proxy.ts`, `apps/web/public/sw.template.js`,
`apps/web/public/sw.js` (regenerated), CLAUDE.md (PWA note),
`apps/web/src/__tests__/sw-template-contract.test.ts` (new, shared with Task 6)
- [x] `proxy.ts`: after the intl middleware produces a response, set
      `x-gk-admin-render: 1` when `request.cookies.get('admin_session')`
      is present (HTML page surface only — matcher already excludes
      /api and dotted paths). Reflects the requester's own cookie back
      to the same client; no cross-user disclosure.
- [x] `sw.template.js`: delete `hasAdminSession()` (forbidden-header
      dead code). `networkFirstHtml` caches 200 GET HTML when NOT
      (401/403 ∨ `x-gk-admin-render` present) — explicitly documented
      offline-only exemption from the framework-default `no-store`
      (entries are served exclusively when the network fails; 24 h TTL
      + MAX_HTML_ENTRIES eviction now reachable). Image path keeps
      `isSensitiveResponse` semantics unchanged.
- [x] Regenerate `public/sw.js` (build-sw) in the same commit; follow-up
      SW_VERSION refresh commit after the last code commit per the
      established per-deploy pattern.
- [x] CLAUDE.md: document the offline-only HTML cache exemption + the
      admin-render marker.
- [x] Contract tests: template contains the marker check and no
      `request.headers.get('Cookie')`; proxy source sets the header.

**Done:** marker header + offline-only exemption + dead cookie sniff removed + CLAUDE.md PWA section; 6 contract tests green.


## Task 5 — ARCH-R4C6-06: one cache policy for image derivatives
**Files:** `apps/web/next.config.ts`, `apps/web/nginx/default.conf`,
`CLAUDE.md`, `apps/web/src/__tests__/next-config-uploads-headers.test.ts` (new)
- [x] `headers()`: add `source: '/uploads/:format(jpeg|webp|avif)/:file*'`
      → `Cache-Control: public, max-age=3600, must-revalidate` (matches
      serve-upload; applies to the Next static path that actually serves
      production today — fixes the per-view revalidation RTT immediately
      and deployment-independently).
- [x] `nginx/default.conf`: `expires 1y; … immutable` →
      `Cache-Control "public, max-age=3600, must-revalidate"` with a
      comment explaining the in-place re-encode hazard (drop `expires`).
- [x] CLAUDE.md: correct "immutable cache-control" claim + ETag section
      (static-first precedence; serve-upload serves locale-prefixed and
      missing paths; unified policy).
- [x] Test: source-contract on next.config (uploads headers rule present
      with the exact policy string) and nginx conf (no `immutable` on the
      uploads location).
- [x] Host-nginx drift (production lacks the repo uploads location) →
      recorded in plan-284 as ops runbook item (non-code).

**Done:** unified 3600/must-revalidate policy across next.config headers(), nginx conf, docs; 3 contract tests green; host-nginx drift recorded in plan-284.


## Task 6 — TEST-R4C6-11: align sw-cache lib with the shipped template + template contract suite
**Files:** `apps/web/src/lib/sw-cache.ts`,
`apps/web/src/__tests__/sw-cache.test.ts`,
`apps/web/src/__tests__/sw-template-contract.test.ts` (shared with Task 4)
- [x] Backport the template's quota-eviction accounting to
      `recordAndEvict` (`const deleted = await cache.delete(...)`; only
      subtract/count when deleted) — `evicted` return stops overcounting
      browser-quota-evicted entries; document the lib as the tested
      reference for the template (shipped copy).
- [x] Update the lib unit suite for the new accounting (missing-entry
      case asserts 0 bytes counted).
- [x] Template contract: `if (deleted)` accounting present in
      sw.template.js recordAndEvict.

**Done:** lib accounting aligned with the shipped template + phantom-eviction unit case + template contract pin; 26 tests green across both suites.


## Task 7 — COR-R4C6-07: semantic search stale-response guard
**Files:** `apps/web/src/components/search.tsx`,
`apps/web/src/__tests__/search-stale-response.test.ts` (new)
- [x] Re-check `requestId === requestIdRef.current` after
      `await resp.json()` before `setResults` (mirror the keyword branch).
- [x] Test: interleaved semantic responses — stale A resolving after
      fresh B must not clobber B's results (mock fetch with deferreds).

**Done:** guard added after resp.json(); locked by an ordering source contract (repo locks client components via source contracts — no jsdom render harness in the suite).


## Task 8 — COR-R4C6-08: checkout route Pattern-2 rollback on DB failure
**Files:** `apps/web/src/app/api/checkout/[imageId]/route.ts`,
existing checkout test suite (extend)
- [x] Wrap the image fetch + `getTierPriceCents` in try/catch →
      `rollbackCheckoutAttempt(ip)` + JSON `{ error }` 500 with NO_STORE
      (structured console.error with imageId/ip per the C7-RPF-01 log
      shape).
- [x] Test: db.select throws → rollback called, 500 JSON + no-store.

**Done:** DB window contained with rollback + structured log + JSON 500/no-store; 2 behavioral tests green.


## Task 9 — STD-R4C6-09: RFC 4287-conformant `<author><name>`
**Files:** `apps/web/src/lib/atom-feed.ts`,
`apps/web/src/__tests__/atom-feed.test.ts` (fixture correction)
- [x] `renderAuthorBlock`: emit `<name>` without the `type` attribute
      (atomPersonConstruct admits none); keep type="text" on the actual
      Text constructs (title/summary/rights).
- [x] Update the fixture that pins `<name type="text">` in the same
      commit — fixture correction, not a weakening (it locked
      schema-invalid output).

**Done:** bare <name>; 3 fixtures corrected in the same commit; 39 atom-feed tests green.


## Task 10 — COR-R4C6-10: audit-log retention env validation
**Files:** `apps/web/src/lib/audit.ts`,
`apps/web/src/__tests__/audit-retention.test.ts` (new)
- [x] `purgeOldAuditLog`: accept the env value only when
      `Number.isFinite(d) && d > 0`; otherwise fall back to 90. Also
      guard the explicit `maxAgeMs` param the same way (negative
      param → treated as default) for symmetry.
- [x] Tests: negative env → 90d cutoff (past, not future); zero/garbage
      → 90d; valid value honored; negative explicit param → default.

**Done:** positivity guard on both inputs; 5 unit cases green.

## Gate work (PROMPT 3)
- [x] All 8 gates green after the tasks: eslint 0/0, typecheck PASS,
      vitest 1675/1675 (174 files, +47 this cycle), lint:api-auth PASS,
      lint:action-origin PASS, lint:public-route-rate-limit PASS,
      production build OK, playwright e2e 20/20.
- [x] SW_VERSION refresh commit after the final code commit (template
      changed this cycle) — commit 47517ce0 (d3e0a3f5-p7).
- [ ] Deploy per-cycle via `npm run deploy` once green.
