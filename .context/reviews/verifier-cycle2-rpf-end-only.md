# Verifier — Cycle 2 RPF (end-only)

## Method

Evidence-based verification of cycle 1 RPF claims and current state.
Run all gates, inspect each fix's actual implementation, validate that
the claimed behavior holds.

## Gate evidence

- `npm run lint` — exit 0, clean (verified at cycle start).
- `npm run typecheck` — exit 0, clean (typecheck:app + typecheck:scripts).
- `npm run lint:api-auth` — exit 0, clean.
- `npm run lint:action-origin` — exit 0, clean.
- `npm test` — 900 tests passed (104 files), exit 0.
- `git status` — clean, on master, in sync with origin.

## Cycle 1 RPF fix verifications

### V-01 — C1RPF-PHOTO-HIGH-01 / Stripe checkout rate limit ✓
Verified: `apps/web/src/app/api/checkout/[imageId]/route.ts:61-72` calls
`preIncrementCheckoutAttempt(ip)` BEFORE any DB work. Rollback on every
4xx early-return path (lines 78, 90, 94, 98, 104, 149). Pattern matches
the OG/share rate-limit posture (Pattern 2). Constants in
`lib/rate-limit.ts:66-68`: 10 req / 60s window. Confirmed.

### V-02 — C1RPF-PHOTO-HIGH-02 / checkoutStatus toast ✓ (with caveat)
Verified: `p/[id]/page.tsx:139-143` extracts `?checkout=` from
`searchParams`, narrows to `'success' | 'cancel' | null`, passes to
`PhotoViewer` as `checkoutStatus`. `photo-viewer.tsx:104-118` renders
toast on first mount via ref-guarded effect, strips the URL param.
**Caveat:** the toast copy says "your download link is being prepared",
which is a workflow promise the code does not actually fulfill (see
critic CRIT-02 + code-reviewer C2RPF-CR-MED-01). The technical fix
landed; the workflow it implies does not exist.

### V-03 — C1RPF-PHOTO-MED-01 / drop tokenHash from log ✓
Verified: `webhook/route.ts:132` log line is
`Entitlement created: imageId=${imageId} tier=${tier} session=${sessionId}`
— no tokenHash, no customerEmail. The error log at line 75-80 logs only
presence-flags, not values. Confirmed.

### V-04 — C1RPF-PHOTO-MED-02 / tier allowlist at webhook ingest ✓
Verified: `webhook/route.ts:90-94` calls `isPaidLicenseTier(tier)` from
`lib/license-tiers.ts`. Allowlist is `['editorial', 'commercial', 'rm']`.
Rejection returns 200 + warn-log so Stripe stops retrying. Confirmed.

### V-05 — C1RPF-PHOTO-LOW-01 / Intl.NumberFormat for Buy button ✓
Verified: `photo-viewer.tsx:484-491` uses
`new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' })`
inside an IIFE with a fallback to the old `$` format on any throw. The
`locale` is the prop received from server. Confirmed.

### V-06 — C1RPF-PHOTO-LOW-02 / hide gratis Download on paid images ✓
Verified: `photo-viewer.tsx:840` guard is
`downloadHref && (!image.license_tier || image.license_tier === 'none')`.
The button only renders when the image has no paid tier. Confirmed.

### V-07 — C1RPF-PHOTO-LOW-03 / locale-aware Stripe redirect URLs ✓
Verified: `checkout/[imageId]/route.ts:112` calls
`deriveLocaleFromReferer(request.headers.get('referer'))`, threads the
locale into both `success_url` and `cancel_url`. Helper in
`lib/license-tiers.ts:44-58` matches the spec.

### V-08 — N-CYCLE1-01 / customer email truncation ✓
Verified: `webhook/route.ts:67` truncates to 320 chars (RFC-5321 max).
Note: truncation is by JS string length not byte length (see
code-reviewer C2RPF-CR-LOW-06). Acceptable for ASCII emails.

### V-09 — N-CYCLE1-02 / tagsParam length cap on topic redirect ✓
Verified: commit 62209d9 added length cap. Source review pending in
deferred carry-forward.

### V-10 — N-CYCLE1-03 / Stripe product_data.name truncation ✓
Verified: `checkout/[imageId]/route.ts:117` slices `image.title` to
200 chars. Note: no ellipsis indicator (see code-reviewer C2RPF-CR-LOW-09).

## New verification claims for this cycle

The plan-from-reviews phase will schedule items below. Verifier
re-runs gates after PROMPT 3 implementation.

## Outstanding workflow gap

The plaintext download token is generated in webhook scope and
silently dropped. Three reviewers (code-reviewer, critic, architect)
independently flagged this as the highest-signal remaining issue.
Verifier confirms: there is no code path that exposes the plaintext
token to anyone after webhook completion. The workflow described in
docstrings ("manual distribution via /admin/sales") does not exist.

This is not a regression; the original US-P54 phase 1 design assumed
the email pipeline was a separate phase. But the customer-facing toast
promises a flow the system can't fulfill, which is a verifiable
mismatch.
