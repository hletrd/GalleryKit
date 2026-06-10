# Plan 285 — Run-4 Cycle 7 fixes

**Source review:** `.context/reviews/run4-cycle7/_aggregate.md` (6 findings
→ 4 fix tasks; TEST-R4C7-05 and DOC-R4C7-06 fold into their parent tasks;
0 new deferrals — see plan-286 ledger). Per-angle provenance in the same
directory. Repo policy: GPG-signed commits, Conventional Commits + gitmoji,
per-iteration push, per-cycle deploy, no suppressions. HARD-SCOPE: no
edit/culling/scoring features.

## Task 1 — COR-R4C7-01 + COR-R4C7-02 (+TEST-R4C7-05, DOC-R4C7-06): make the paid-download claim survive safe-method prefetch
**Files:** `apps/web/src/app/api/download/[imageId]/route.ts`,
new `apps/web/src/lib/download-interstitial.ts`,
new `apps/web/src/__tests__/download-interstitial.test.ts`,
new `apps/web/src/__tests__/download-route-method-contract.test.ts`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`,
`apps/web/README.md`

Root cause: the single-use claim (atomic `UPDATE … SET downloadedAt`)
is bound to GET — a safe method per RFC 9110 — so Next's auto-HEAD
(`methods.HEAD = handlers.GET`, vendored source verified) and any
mail-gateway/link-checker GET burns the token with no bytes delivered.

- [ ] Extract shared validation: token shape → hash → entitlement lookup
      (keep the D-101-06 used-row disambiguation) → constant-time verify →
      expiry → refunded → used. Pure helper returning either an error
      `{status, message}` or the valid entitlement; both methods use it;
      response taxonomy (400/403/404/410) unchanged.
- [ ] `GET` (rewritten): validation only — **NO claim, NO fs access**.
      On success return a 200 localized HTML interstitial:
      photo title (HTML-escaped), explanatory line ("single-use link,
      click to download"), a `<form method="post">` (action omitted so
      the POST goes to the same URL + query — token never enters the
      HTML body) with a ≥44px submit button. Headers: NO_STORE,
      `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options:
      nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`,
      and a restrictive inline CSP (`default-src 'none'; style-src
      'unsafe-inline'; form-action 'self'; base-uri 'none';
      frame-ancestors 'none'`) because API routes bypass the proxy
      middleware CSP (proxy.ts matcher excludes /api).
      Auto-HEAD now executes a claim-free GET → COR-R4C7-01 resolved
      structurally (no token mutation on any safe method).
- [ ] `POST` (new): the EXACT previous GET body — shared validation →
      lstat/realpath/open-before-claim (C3-RPF-05 / R4C4-06 ordering
      preserved verbatim) → atomic claim → stream with RFC 6266/5987
      Content-Disposition. Carries
      `@public-no-rate-limit-required: gated by a 256-bit single-use
      token; shape regex short-circuits forgeries before any DB work
      (same posture as the Stripe webhook exemption); a per-IP budget
      would penalize legitimate customer retries after scanner probes`
      so lint:public-route-rate-limit stays green with a documented
      reason.
- [ ] `lib/download-interstitial.ts`: pure builder
      `buildDownloadInterstitialHtml({locale, photoTitle, t})` +
      `escapeHtml`. Locale from
      `deriveLocaleFromReferer(null, acceptLanguage)` (existing helper);
      strings from `messages/{en,ko}.json` under a new `downloadPage`
      namespace via `getTranslations({locale, namespace})` if route-
      handler context allows, else direct message-import fallback —
      decision recorded in code comment. EN/KO keys land together
      (parity gate).
- [ ] Tests: unit — interstitial escaping (`<script>` title, quote
      attribute), form has `method="post"` and no `action` attribute, no
      token substring in the HTML; source-contract — route exports POST;
      GET section contains no `downloadedAt`/`update(entitlements)`;
      claim UPDATE present exactly once (in POST); exemption tag present;
      `open(` precedes the claim in POST (ordering pin).
- [ ] Docs: rewrite the route docblock (GET=interstitial, POST=claim,
      HEAD-safe note) and README "Manual download distribution"
      (scanner rationale; the emailed link now lands on a confirmation
      page; claim happens on the customer's explicit submit).
- [ ] Gates green; GPG-signed commit + push.

## Task 2 — COR-R4C7-03 (+TEST-R4C7-05): reject tag-column operators the compiler cannot execute, at save time
**Files:** `apps/web/src/lib/smart-collections.ts`,
`apps/web/src/__tests__/smart-collections.test.ts`
- [ ] `validateNode`: per-column operator enforcement — for
      `column === 'tag'` only `eq`/`contains` pass; throw
      `SmartCollectionQueryError` with the operator/column named (server
      log detail; the action already maps to the localized
      `invalidCollectionQuery`). Keep `compileTagPredicate`'s throw as
      defense in depth for pre-existing rows.
- [ ] Tests: rejection cases for `tag` × `gt/gte/lt/lte/between/in`;
      acceptance for `tag` × `eq/contains`; plus a validate/compile
      AGREEMENT property — every minimal AST accepted by `validateNode`
      (each column × each operator it permits) must compile without
      throwing, so the asymmetry CLASS cannot regress.
- [ ] Gates green; GPG-signed commit + push.

## Task 3 — COR-R4C7-04 (+TEST-R4C7-05): align mid-upload topic semantics with the surface's latest-wins contract
**Files:** `apps/web/src/components/upload-dropzone.tsx`,
new `apps/web/src/__tests__/upload-dropzone-topic-wiring.test.ts`
- [ ] Add `topicRef` synced from `topic` state (same pattern as
      `selectedTagsRef`); `uploadFile` appends `topicRef.current` to the
      FormData so a mid-batch topic correction applies to files not yet
      uploaded — matching the deliberate tag behavior on the same
      surface. Comment documents the latest-wins contract.
- [ ] Source-contract test: `topicRef.current` is what reaches
      `formData.append('topic', …)`; the ref-sync effect exists.
- [ ] Gates green; GPG-signed commit + push.

## Task 4 — Cycle hygiene
- [ ] Archive `plan/plan-283-run4-cycle6-fixes.md` → `plan/done/`
      (all 10 tasks landed, verified by the cycle-6 progress commit and
      this cycle's regression review). `plan-284` stays active (open
      OPS-R4C6-01 ledger item).
- [ ] Run ALL gates repo-wide (eslint, typecheck, vitest, api-auth,
      action-origin, public-route-rate-limit, build, e2e); fix anything
      that surfaces; refresh SW_VERSION via the established build step
      if the build mutates `public/sw.js`.
- [ ] Deploy per cycle policy (`npm run deploy`) after all green.

## Progress log
- (updated during PROMPT 3)
