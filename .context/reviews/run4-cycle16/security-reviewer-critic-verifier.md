# Run-4 Cycle 16 — security-reviewer + critic + verifier angle

Same single-subagent constraint as prior run-4 cycles; this angle
re-walked the full rotation inventory (see
`code-reviewer-debugger-tracer.md`) with OWASP/secrets/authz eyes,
then verified each candidate finding against primary sources.

## Security findings

### COR-R4C16-02 — production CSP blocks GA4 regional collection endpoints: silent analytics loss for EU-resident visitors (MED-LOW / High, verified against Google's CSP guidance)

`lib/content-security-policy.ts:73-76` allows only
`https://www.google-analytics.com` in `connect-src` (and no GA hosts
in `img-src`). Google's official guidance for GA4 (gtag.js, no
advertising features) requires:

- `script-src https://*.googletagmanager.com`
- `img-src https://*.google-analytics.com https://*.googletagmanager.com`
- `connect-src https://*.google-analytics.com
  https://*.analytics.google.com https://*.googletagmanager.com`

(Verified 2026-06-11 at
developers.google.com/tag-platform/security/guides/csp.)

GA4 routes `/g/collect` beacons through region endpoints —
`region1.google-analytics.com` for EU data-residency — which the
current literal `www.` host does not cover, and falls back to image
beacons (img-src) when fetch/sendBeacon is blocked. Concrete failure:
an EU visitor loads the gallery; gtag.js loads fine
(`www.googletagmanager.com` is allowed); every collection beacon is
then CSP-blocked; the gallery owner's analytics silently undercount
all EU traffic. No user-facing breakage, no server log — only
browser-console CSP violations nobody is watching.

**Fix:** broaden the GA branch of `buildContentSecurityPolicy` to the
Google-documented non-advertising set above (wildcards on the LEFT of
the hostname are valid CSP); extend
`__tests__/content-security-policy.test.ts` accordingly. Do NOT add
the doubleclick/google.<TLD> advertising hosts — the product only
ships plain GA4 page analytics.

### Security re-verification of the rotation set — clean

- `download-tokens.ts`: token shape pre-check before any hashing;
  stored-hash shape check distinguishes DB corruption from attacker
  input; `timingSafeEqual` on equal-length buffers; no length oracle.
- `base56.ts`: CSPRNG (`crypto.randomBytes`) + rejection sampling —
  no modulo bias; bounded retry.
- `stripe.ts`: secrets read lazily from env, never logged; webhook
  verification delegated to the SDK's constant-time implementation.
- `license-tiers.ts`: tier allowlist closed ('none' excluded by
  design); Referer parsing wrapped in try/catch; no open-redirect
  surface (locale only, not URL, is derived).
- `action-guards.ts` / `request-origin` wiring: unchanged, still the
  strict default.
- `content-security-policy.ts` (non-GA portion): nonce'd script-src,
  `object-src 'none'`, `frame-ancestors 'self'`, `base-uri 'self'`,
  `form-action 'self'` — sound. `style-src 'unsafe-inline'` is the
  long-standing Tailwind/Next tradeoff (already recorded in prior
  cycles).
- GA config-source consistency: the proxy passes
  `siteConfig.google_analytics_id` into the CSP builder (proxy.ts:47)
  and the layout gates the `<Script>` tags on the SAME
  `siteConfig.google_analytics_id` with the same regex — the
  `NEXT_PUBLIC_GA_ID` default in the builder signature is
  test-only, not a drift surface. Verified non-finding.
- `upload-dropzone.tsx`: client caps mirror server caps
  (`uploadLimits` injected); no client-trust issue (server re-checks).
- `image-manager.tsx` bulk-delete / `images.ts` bulk-update: id
  validation (integer, >0, ≤100), tag-name `requireCleanInput`,
  parameterized Drizzle calls, audit logging — clean.
- Compiled-chunk sweep: no secret material in client chunks
  (IMAGE_BASE_URL is a public URL by definition; its absence
  client-side is a correctness bug — COR-R4C16-03 — not a leak).

## Critic pass (fix-shape review of this cycle's candidates)

- **COR-R4C16-01:** the right fix is the established c14 pattern, NOT
  a bespoke wrapper component around AlertDialogAction. A wrapper
  ("AsyncAlertDialogAction") would be cleaner in the abstract but
  diverges from the shipped tag-manager idiom and adds an
  ui-primitives surface the audit suite doesn't know; six mechanical
  call-site fixes + a source-inspection lock keeps one idiom
  greppable. db/page.tsx MUST be exempted via marker, not fixed — its
  dialog is a pure confirm gate with page-level progress; forcing the
  dialog to stay open through a 250 MB restore upload would be worse.
- **COR-R4C16-02:** resist the temptation to add the full advertising
  host list "while we're here" — every extra host is connect-src
  attack surface (exfil destinations). Scope to the analytics tier.
- **COR-R4C16-03:** the dataset-injection fix is preferred over a
  `NEXT_PUBLIC_IMAGE_BASE_URL` rename because the Docker flow sets env
  at CONTAINER runtime, after `next build` — a NEXT_PUBLIC var would
  bake the build host's (empty) value and merely move the bug. The
  dataset read must be lazy (inside the function, document-guarded),
  never at module scope, or SSR breaks. Keep the server path reading
  the existing constant so server-only consumers (atom feed, OG
  metadata, serve-upload) are untouched.
- **UX-R4C16-06:** anchor math must be extracted and unit-tested, not
  duplicated inline a second time — the wheel path is the reference
  implementation; three inline copies of anchor arithmetic is how the
  c15 theme bug happened (canonical logic + diverging copy).
- **DES-R4C16-04/05:** smallest-possible diffs; the audit extension
  for native `<select>` must ship failing-then-passing fixtures like
  every prior audit extension (c15 set the precedent).

## Verifier pass (evidence per finding)

| Finding | Evidence | Verdict |
|---|---|---|
| COR-R4C16-01 | `ui/alert-dialog.tsx:121-131` raw Radix Action; six call sites read in full; c14 reference `tag-manager.tsx:148-160` confirmed as the only preventDefault user (grep) | CONFIRMED |
| COR-R4C16-02 | Current builder output vs Google CSP guide fetched 2026-06-11; regex over `content-security-policy.ts` | CONFIRMED |
| COR-R4C16-03 | `constants.ts:7` non-public env; 9 client consumers (grep -l); compiled chunk `0z_8k18mys.tf.js` contains runtime `env.IMAGE_BASE_URL||""` | CONFIRMED |
| DES-R4C16-04 | `upload-dropzone.tsx:368` literal `h-10` on native `<select>`; audit FORBIDDEN domain excludes `<select` (test file read) | CONFIRMED |
| DES-R4C16-05 | `settings-client.tsx:184-190` banner div without live-region role; `bulk-edit-dialog.tsx:324-326` validation `<p>` without role="alert"; precedent: C4-RPF-09 added role="alert" to sales errorLoad | CONFIRMED |
| UX-R4C16-06 | `image-zoom.tsx:174-178,204-208` zero-anchor transform vs wheel path 98-113 anchored math | CONFIRMED (severity judgment Medium — interaction-design, not logic error) |

## HARD-SCOPE check

No finding proposes edit/culling/scoring/preset features. All
candidates tighten existing surfaces: feedback fidelity (dialogs),
delivery correctness (CDN base), analytics integrity (CSP), target
size + live-region a11y, and viewing UX (zoom anchor).
