# Run-4 Cycle 7 — code-reviewer + debugger + tracer angle

## Inventory & method
1. **Regression review of all 11 cycle-6 fix commits** (a44e7a3d..73c11ece):
   full diffs traced for IME guards, timeline truncation, lightbox
   auto-hide/alt/space, SW HTML offline exemption, derivative cache
   unification, semantic stale-guard, checkout rollback, atom `<name>`,
   audit retention, sw-cache lib alignment, SW_VERSION refreshes.
2. **Coverage-map rotation**: built a never-mentioned-in-run4 file list by
   grepping all run4-c1..c6 review texts against every source basename
   (139 files surfaced). Deep-read the highest-logic members: money path
   (stripe.ts, download-tokens.ts, base56.ts, license-tiers.ts, webhook,
   checkout, download routes), smart-collections.ts + its three call
   sites, clip-embeddings/clip-inference/caption-generator,
   og-photo-fetch, sanitize, photo-title, upload-tracker-state,
   restore-maintenance, queue-shutdown, i18n/request, build-sw script,
   histogram.tsx, upload-dropzone.tsx, admin-user-manager.tsx,
   bulk-edit-dialog.tsx, e2e/public.spec.ts, check-public-route-rate-limit.
3. **Pattern sweeps**: parseInt-radix census (clean), server setInterval
   census (only image-queue gcInterval, cleared on shutdown),
   add/removeEventListener parity per component (balanced in all 10
   files), onKeyDown-without-IME-guard census (3 files, all
   button-targets — no text-input gap; cycle-6 census holds).

## Regression review of cycle-6 commits — verdict: SOUND
- **fea1906b (lightbox)**: `hideControlsRespectingFocus` blur() path
  verified against focus-trap semantics: `blur()` dispatches no
  `focusin`, so the trap's document-level checkFocusIn cannot re-capture;
  the next Tab is intercepted by the trap's keydown handler and
  `onFocusCapture={() => showControls(true)}` re-reveals the chrome.
  `aria-hidden` props only land while no element inside is focused
  (blur-first ordering). Space branch now consults `isEditableTarget`
  before `preventDefault`. No regression found.
- **9887199e (SW)**: `x-gk-admin-render` is set by proxy.ts on cookie
  PRESENCE (not validity) — conservative in the correct direction (only
  ever excludes more from the offline cache). API routes are excluded
  from the middleware matcher, so the header cannot appear on API
  responses; HTML pages are no-store so no shared-cache poisoning vector.
  Template/lib/`sw.js` agree (sw-template-contract suite pins it).
- **a44e7a3d (IME)**: guard checked FIRST in all five handlers; the three
  remaining `onKeyDown` sites without guards (tag-filter, image-zoom,
  info-bottom-sheet) target `<button>`/`role=button` — composition
  cannot occur there. Census complete.
- f8c4684f, f5ff5d71, 454dfe25, 7bb16726, b35f268c, d3e0a3f5, 1a2ebf8e:
  re-derived each against its review finding; all faithful. The checkout
  rollback try-block now covers both DB reads; `priceCents <= 0` check
  deliberately sits OUTSIDE the try (no rollback needed — it has its own).
  Confirmed `rollbackCheckoutAttempt(ip)` is called there too. Clean.

## NEW findings

### COR-R4C7-01 — HEAD request burns the customer's single-use paid download token (HIGH / High, CONFIRMED)
- **Files:** `apps/web/src/app/api/download/[imageId]/route.ts` (exports
  GET only; claim UPDATE at lines 234-247);
  `node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js`
  lines 39-46.
- **Mechanism:** Next.js App Router auto-implements HEAD for any route
  that exports GET by **invoking the GET handler itself**
  (`methods.HEAD = handlers.GET`) and discarding the body. The download
  GET handler performs the atomic single-use claim
  (`UPDATE entitlements SET downloadedAt = NOW(), downloadTokenHash =
  NULL WHERE id = ? AND downloadedAt IS NULL`) before streaming. A HEAD
  request therefore consumes the token and delivers ZERO bytes.
- **Failure scenario:** operator emails the documented
  `/api/download/42?token=dl_…` link (README "Manual download
  distribution"). The customer's corporate mail gateway / link checker /
  download manager probes the URL with HEAD. The claim fires; the
  customer's subsequent real GET answers `410 Token already used`. The
  paid asset is never delivered; the operator sees a "used" entitlement
  and cannot distinguish theft from a scanner probe.
- **Evidence of repo awareness elsewhere:** `app/uploads/[...path]/route.ts`
  and `app/[locale]/(public)/uploads/[...path]/route.ts` BOTH export an
  explicit `HEAD` precisely because of this Next behavior — the only
  mutating GET route in the app is the one missing it.
- **Fix:** export an explicit `HEAD` handler that never claims (405 +
  `Allow` or validation-only). Subsumed by the COR-R4C7-02 redesign:
  with claim moved to POST, the auto-HEAD of the interstitial GET
  becomes harmless, but an explicit HEAD is still cheap and exact.

### COR-R4C7-02 — claim-on-GET breaks the documented email workflow under link-scanner prefetch (MED-HIGH / High)
- **Files:** `apps/web/src/app/api/download/[imageId]/route.ts`;
  `apps/web/README.md` lines 63-77 (workflow: email the raw link).
- **Problem:** GET both claims and streams. Email-security rewriters
  (Microsoft SafeLinks/Defender, Mimecast, Proofpoint) and some webmail
  link-preview systems FETCH links in inbound mail with GET. Whichever
  request arrives first wins the single use; scanners usually arrive
  first. This is the canonical single-use-link pitfall and the reason
  password-reset/download flows use a confirmation interstitial.
- **Fix (chosen):** GET returns a small no-claim HTML interstitial with
  a POST form ("Download photo"); POST performs the exact current
  claim+stream path. Scanners do not submit forms. Already-emailed links
  keep working (same URL). Token validation/expiry/refund/used checks
  retained verbatim on both methods; the 410/404/403 taxonomy preserved.
  POST on a public route triggers the rate-limit lint — handled with the
  documented `@public-no-rate-limit-required` justification (256-bit
  token gate, same posture as the Stripe webhook exemption) or
  pre-increment; decided in the plan.

### COR-R4C7-03 — smart-collection validator accepts tag-operator ASTs the compiler rejects → public page 404s a "successfully saved" collection (MED / High, CONFIRMED)
- **Files:** `apps/web/src/lib/smart-collections.ts` — `validateNode`
  (lines 315-373: `VALID_OPERATORS` is column-global) vs
  `compileTagPredicate` (lines 248-272: throws unless `eq`/`contains`);
  `apps/web/src/app/actions/collections.ts` lines 31/80 (save validates
  with `parseSmartCollectionQuery` ONLY);
  `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` lines 93-98
  (compile throw → `notFound()`).
- **Failure scenario:** admin saves
  `{"type":"predicate","column":"tag","operator":"gt","value":"x"}`
  (or `lt/gte/lte/between/in` on `tag`) — validateNode passes (operator
  in the global set, scalar checks satisfied), the action reports
  success. Every public visit to `/c/<slug>` then throws at
  `compileSmartCollection` and renders 404 with no signal to the admin,
  who already published the URL. There is no admin UI constraining
  operators (zero .tsx callers of these actions — raw JSON is exactly
  how these queries are authored today).
- **Fix:** enforce per-column operators in `validateNode` (`tag` →
  `eq | contains` only) so the save action fails loudly with the
  existing localized `invalidCollectionQuery` error. Mirrors the
  module's own "fail at validation (write time)" doctrine from
  R4C4 HARD-R4C4-07.

### COR-R4C7-04 — upload-dropzone topic select is live during a batch upload but silently inert (MED-LOW / High)
- **File:** `apps/web/src/components/upload-dropzone.tsx` — topic
  `<select>` (lines 351-361) has no `disabled` during `uploading`; the
  upload loop reads `topic` from the click-time closure (line 211),
  while tags deliberately read LATEST values via refs (lines 68-78,
  213-219, comment "Refs for accessing latest state during async upload
  loop").
- **Failure scenario:** admin starts a 60-file batch, notices the wrong
  topic at file 5, switches the dropdown (it responds normally), and
  the remaining 55 files still land in the OLD topic with zero feedback.
  Tag edits made the same way DO apply — the same surface honors one
  live control and ignores the other.
- **Fix:** add a `topicRef` kept in sync like `selectedTagsRef` and read
  it in `uploadFile`, aligning the topic with the established
  latest-wins contract of the surface.

## Verified-clean (this angle)
- `webhook` insertId/affectedRows fresh-vs-loser disambiguation; email
  shape/cap ordering; tier allowlist; zero-amount gate — all re-derived.
- `download` route: open-before-claim ordering, handle close on every
  post-open path, RFC 6266/5987 filename emission — clean.
- `base56` rejection sampling (224 cutoff vs 56×4) — correct; pool
  regrowth path correct.
- `license-tiers.deriveLocaleFromReferer` accept-language layering;
  `getTierPriceCents` strict `/^\d+$/` parse — clean.
- `smart-collections` SQL compilation parameter binding (incl. LIKE
  escaping `[%_\\]`) — clean; depth/IN caps consistent between validate
  and compile.
- `og-photo-fetch` ascending chain + dual byte-cap — clean.
- `clip-embeddings`/`clip-inference` determinism + buffer round-trip —
  clean. `caption-generator` stub bounds — clean.
- `upload-tracker-state` prune grace + hard cap; `restore-maintenance`
  symbol-keyed global; `queue-shutdown` idempotent drain — clean.
- `histogram.tsx`: RGB-mode clip denominator uses the red-channel total —
  correct because per-channel totals are identical (each pixel counts
  once per channel); worker request/abort lifecycle leak-free; failed-URL
  fall-through chain sound.
- `admin-user-manager`, `bulk-edit-dialog` — no defects found.
- `sanitize.ts` stateful-regex hazard already handled (C8-AGG8R-01).
