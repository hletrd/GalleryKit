# Document Specialist — Cycle 2 RPF (end-only)

## Method

Cross-checked code claims against authoritative documentation:
- Stripe API docs (current Node SDK behaviors)
- Next.js 16 docs (App Router server components, server actions, route handlers)
- React 19 docs (useEffect strict-mode behavior, suspense boundaries)
- next-intl docs (locale derivation, server vs client locale)
- RFC 5321 / RFC 6266 (email length, content-disposition)

## Findings

### C2RPF-DOC-LOW-01 — Stripe `apiVersion: '2026-04-22.dahlia'` not annotated for review/upgrade
- File: `apps/web/src/lib/stripe.ts:28`
- Severity: Low | Confidence: High
- **What:** The Stripe SDK is constructed with a pinned API version
  `'2026-04-22.dahlia'`. The Stripe SDK ships with a default API
  version that matches the SDK release; pinning is correct best
  practice (avoids silent breakage on Stripe's account upgrades) but
  the chosen version has no comment explaining the upgrade cadence
  or who reviews API version bumps. Stripe deprecates API versions
  on a documented schedule.
- **Fix (planned, low-effort):** Add a docstring line: "API version
  pinned per Stripe docs; review at minor-SDK upgrades and quarterly
  to ensure no deprecation warnings (see https://docs.stripe.com/upgrades)."

### C2RPF-DOC-LOW-02 — `runtime = 'nodejs'` rationale documented but Stripe's exact requirement isn't quoted
- File: `apps/web/src/app/api/stripe/webhook/route.ts:30`
- Severity: Informational | Confidence: High
- **What:** The comment says "MUST be Node.js runtime — edge runtime
  does not support raw body reads required for Stripe webhook signature
  verification." This is correct (Stripe's Node SDK uses
  `crypto.createHmac` from Node's crypto module, not WebCrypto), and
  Next.js edge runtime intentionally doesn't expose `request.text()`
  on a raw stream the same way the Node runtime does. The reasoning
  matches the official Stripe Next.js webhook docs. Confirmed accurate.

### C2RPF-DOC-LOW-03 — `apps/web/README.md` does not describe paid-tier deployment requirements
- File: `apps/web/README.md`
- Severity: Low | Confidence: High
- **What:** The repo README has Docker/env/setup instructions but no
  Stripe section. Operators deploying the gallery without
  `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` will boot fine
  (lazy init) but will get runtime 500s the first time anyone clicks
  Buy. There's no checklist that says "if you set `license_tier !=
  'none'` on any image, you must also set Stripe envs."
- **Fix (planned):** Add a "Paid downloads (Stripe)" subsection to
  README explaining required env vars, the webhook URL the operator
  must register in Stripe, and the manual-distribution operational
  workflow until phase 2 ships.

### C2RPF-DOC-LOW-04 — `CLAUDE.md` claims paid downloads are shipped without describing the workflow gap
- File: `/Users/hletrd/git/gallery/CLAUDE.md`
- Severity: Low | Confidence: High
- **What:** CLAUDE.md describes the project as having a Stripe paid-
  download feature shipped (US-P54). It does not document that the
  customer-facing "your link is being prepared" flow requires manual
  intervention from the photographer (who has no UI affordance for
  retrieving the plaintext token). A new contributor reading
  CLAUDE.md gets the impression the feature is fully wired.
- **Fix (planned):** Add a one-paragraph note to CLAUDE.md's feature
  list flagging the manual-distribution gap.

### C2RPF-DOC-LOW-05 — `lib/license-tiers.ts` SUPPORTED_LOCALES comment "mirrored from i18n/config.ts" is misleading
- File: `apps/web/src/lib/license-tiers.ts:38-39`
- Severity: Low | Confidence: High
- **What:** The comment says "The set of supported locales is mirrored
  from `i18n/config.ts`. If a new locale is added there, update the
  regex below." But the canonical source in this codebase is
  `lib/constants.ts:LOCALES`, not `i18n/config.ts`. The doc points
  the reader to the wrong file.
- **Fix (planned):** Either update the comment to point to
  `lib/constants.ts` or refactor to import `LOCALES` from there
  (matches architect C2RPF-ARCH-LOW-03).

### C2RPF-DOC-LOW-06 — N-CYCLE1 nomenclature is undocumented
- Files: `webhook/route.ts:62-65`, `checkout/[imageId]/route.ts:113-116`
- Severity: Informational | Confidence: High
- **What:** Comments reference "N-CYCLE1-01", "N-CYCLE1-03" (where N
  appears to mean "near-cycle1" or similar). The repo has many such
  ID prefixes (C7-, C8-, AGG1-, AGG-C1-, F-17, US-P54, etc.) and no
  central glossary. New contributors trying to understand "what
  N-CYCLE1-03 means" must grep through plans.
- **Fix (deferred):** Add a glossary section to `apps/web/README.md`
  or `.context/README.md` explaining the prefix taxonomy. Not blocking.

## External documentation cross-check

- Stripe Node SDK `webhooks.constructEvent` is the official, recommended
  way to verify webhook signatures and uses constant-time HMAC. Verified
  against current Stripe docs.
- Next.js 16 App Router `searchParams` is `Promise<Record<...>>` in
  Next.js 15+ — the page correctly awaits it.
- next-intl `useLocale()` and `getLocale()` server-side patterns are
  correctly used.
- RFC 5321 §4.5.3.1.3 sets the email forward-path max at 256 octets,
  but the practical max with hostnames is closer to 320 chars (local-
  part 64 + @ + domain 255). The slice(0, 320) is conservative.
- RFC 6266 mandates `filename=` to be a quoted-string with no
  unescaped quotes. The download route's filename construction is
  ASCII-only after my proposed allowlist fix; current code is *almost*
  safe but vulnerable to admin-set filenames with quotes.

## Sweep

Documentation accurately reflects code intent for cycle 1 RPF fixes.
The workflow gap (token visibility) is the documentation's biggest
honesty problem — see CRIT-02 and C2RPF-CR-MED-01.
