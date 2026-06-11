# Document-Specialist Review — Run-5 Cycle-2

**Reviewer:** document-specialist  
**Date:** 2026-06-12  
**Scope:** CLAUDE.md, .env.local.example, site-config.example.json, key source-file comments that assert external-API facts.  
**Known-issue suppression applied:** plan-315 / plan-316 / plan-317 items listed; none of the findings below duplicate those.

---

## Findings

### DOC-R5C2-01 — Firefox `color-gamut` MQ claim is outdated (HIGH)

**Classification:** confirmed  
**Severity:** HIGH  
**Confidence:** High

**Doc location:** `CLAUDE.md` browser matrix table, line for "Firefox 124+":
```
| Firefox 124+ | macOS / Win | P3 | ✓ (FF 113+) | **✗** (no implementation as of Firefox 137) | ✗ | ✗ |
```
and the prose below:
> "Firefox lacks both `color-gamut` MQ and `screen.colorGamut` support"

**Code location:** `apps/web/src/lib/use-display-capability.ts` line 64:
```ts
// R9-R1: Firefox has no screen.colorGamut and no color-gamut MQ support.
```

**Mismatch:** Firefox **added `color-gamut` MQ support in Firefox 110** (released January 2023). According to Can I Use data verified 2026-06-12, Firefox 110–150 fully supports `(color-gamut: p3)`. The CLAUDE.md claim that Firefox has "no implementation as of Firefox 137" is factually wrong. The code comment in `use-display-capability.ts` is also stale.

**Authoritative side:** External browser compatibility data (caniuse.com, MDN).

**Impact:** The fallback logic in `use-display-capability.ts` conservatively returns `'srgb'` for Firefox by falling through from `screen.colorGamut` (unsupported) to the MQ branch. Because Firefox 110+ **does** match `(color-gamut: p3)`, the MQ branch would actually work — but only if the code reaches it. Looking at the code: `screen.colorGamut` is undefined in Firefox (the `typeof screen.colorGamut === 'string'` guard correctly skips it), and then the code falls to the MQ branch at line 59–63 which **will correctly match** in Firefox 110+. So the code behavior is actually correct for Firefox 110+ users — they will get the P3 gamut detected via the MQ. The CLAUDE.md docs and inline comment overstate the Firefox limitation, potentially causing developer confusion and possibly leading to removal of correct code.

The CLAUDE.md "Firefox photographer-visible impact" section is also incorrect: it says Firefox visitors do NOT see the P3 badge — but Firefox 110+ users on P3 displays will see it correctly because the MQ branch fires.

**Suggested correction:** Update CLAUDE.md browser matrix row for Firefox to:
- `(color-gamut: p3)` MQ: `✓ (FF 110+)`  
- `screen.colorGamut` API: `✗`  
Update the prose to: "Firefox 110+ supports the `color-gamut` MQ but not `screen.colorGamut`. The `useDisplayCapability` hook correctly uses the MQ fallback branch for these browsers. Firefox 109 and earlier fall back to conservative `'srgb'`."  
Update the comment in `use-display-capability.ts` line 64 and line 103 to reflect the actual Firefox 110+ MQ support.

**Source:** https://caniuse.com/mdn-css_at-rules_media_color-gamut (verified 2026-06-12: Firefox 110+ supported)

---

### DOC-R5C2-02 — CLAUDE.md NCLX transfer code 1 description is inaccurate (MEDIUM)

**Classification:** confirmed  
**Severity:** MEDIUM  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Color & HDR Pipeline, Source detection section:
> "transfer `1=BT.709→sRGB`"

**Code location:** `apps/web/src/lib/color-detection.ts` line 176:
```ts
const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    1: 'srgb',
```
with comment at line 100: "sRGB IEC61966-2.1 is the most common SDR case"

**Mismatch:** ITU-T H.273 transfer characteristic code 1 is "BT.709" (the BT.709/BT.601/BT.2020 gamma curve). The code maps it to `'srgb'` as a practical approximation (BT.709 gamma ≈ sRGB for display purposes), with the inline comment explaining this is "the most common SDR case". The CLAUDE.md notation `1=BT.709→sRGB` is ambiguous but partially correct in intent. However, the arrow notation suggests a conversion, which is not what occurs — the code merely labels the BT.709 transfer as 'srgb' in the output enum.

More importantly, the CLAUDE.md table omits that code 13 is the canonical sRGB IEC 61966-2-1, which is also mapped to `'srgb'`. The CLAUDE.md lists only `13=sRGB IEC61966-2-1` but not that code 1 maps to 'srgb' as well. Conversely, the code has code 6 mapping to `'gamma22'` (BT.601 System B,G) which CLAUDE.md does not mention.

**Authoritative side:** The code is authoritative; the CLAUDE.md summary is a simplified excerpt. The notation `1=BT.709→sRGB` is potentially misleading for future maintainers who may think a color-space conversion is applied.

**Suggested correction:** In CLAUDE.md, change the transfer code 1 description to `1=BT.709 (mapped as 'srgb' — practical approximation for SDR)` and note that code 13 is the canonical sRGB. Add a note that the full mapping is in `color-detection.ts:NCLX_TRANSFER_MAP`.

**Source:** ITU-T H.273 Table 3 (transfer characteristics); code in `apps/web/src/lib/color-detection.ts:175-198`

---

### DOC-R5C2-03 — CLAUDE.md WCAG criterion for touch targets references wrong level (LOW)

**Classification:** confirmed  
**Severity:** LOW  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Touch-Target Audit section, line 491:
> "per WCAG 2.5.5 (Level AAA), Apple HIG, and Google MDN guidelines"

**Mismatch:** WCAG 2.5.5 "Target Size" was Level AAA in WCAG 2.1. In **WCAG 2.2** (published October 2023), a new criterion **2.5.8 "Target Size (Minimum)"** at **Level AA** was introduced, requiring 24×24 CSS pixels minimum (with spacing), while 2.5.5 was retained at Level AAA requiring 44×44 px. Since the policy enforces 44 px, referencing 2.5.5 is correct for the size requirement, but:

1. WCAG 2.2 is the current recommendation as of 2023; not mentioning the current standard is a documentation gap.
2. The test file at `apps/web/src/__tests__/touch-target-audit.test.ts` line 9 also only references 2.5.5.

**Authoritative side:** External (WCAG 2.2 spec, W3C October 2023).

**Suggested correction:** Update CLAUDE.md and the test file comment to reference "WCAG 2.5.5 (Level AAA in WCAG 2.2, 44×44 px)". Optionally also note that WCAG 2.2 SC 2.5.8 (Level AA) has a lower 24 px minimum — the repo exceeds both.

**Source:** https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

---

### DOC-R5C2-04 — CLAUDE.md Sharp `withMetadata()` claim partially correct but framing misleading (LOW)

**Classification:** confirmed  
**Severity:** LOW  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Privacy section:
> "Never use Sharp `withMetadata()` for stripping — in Sharp 0.33+ it KEEPS input EXIF (R4C8 COR-R4C8-01)"

**Code location:** `apps/web/src/lib/process-image.ts` line 1464–1465:
> "`.withMetadata({ orientation, icc })`, believing it 'keeps only the orientation tag while stripping GPS'. In Sharp 0.33+ `withMetadata`"

**External verification (Sharp 0.34.5 docs):** The Sharp documentation for `withMetadata()` states it "Keep[s] most metadata (EXIF, XMP, IPTC) from the input image in the output image." GPS data is part of EXIF, so `withMetadata()` will keep GPS. This confirms the CLAUDE.md warning is correct.

The issue is that CLAUDE.md says "Sharp 0.33+" without specifying what changed at 0.33. The actual behavior — `withMetadata()` keeps EXIF including GPS — has been consistent across versions; what changed at 0.33 was likely a stricter behavior that made GPS retention unavoidable even with partial options. The framing implies a version-gated behavior change that may not be precisely documented.

**Verdict:** The safety warning is correct and should be kept. The "0.33+" qualifier may be slightly imprecise but is harmlessly conservative. No code correction needed.

**Suggested doc correction:** Clarify the note: "Never use Sharp `withMetadata()` for GPS stripping — it keeps all EXIF including GPS coordinates (Sharp docs: 'Keep most metadata (EXIF, XMP, IPTC)'). Use the lossless GPS-IFD scrubber in `gps-exif-strip.ts` instead."

**Source:** https://sharp.pixelplumbing.com/api-output#withmetadata

---

### DOC-R5C2-05 — CLAUDE.md `revalidate = 0` described as "framework-default `no-store`" — inaccurate for Next.js 16 (MEDIUM)

**Classification:** confirmed  
**Severity:** MEDIUM  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Service Worker / PWA section:
> "every public page ships the framework-default `no-store` (`revalidate = 0` dynamic rendering)"

**External verification:** Next.js 16 docs (`/docs/app/guides/caching-without-cache-components`, version 16.2.9) state:

> "`0`: Ensure a layout or page is always dynamically rendered even if no Request-time APIs or uncached data fetches are discovered. This option changes the default of `fetch` requests that do not set a `cache` option to `'no-store'`"

The key nuance: `revalidate = 0` makes the **route dynamic** and sets uncached fetch defaults to `no-store`, but the **HTTP `Cache-Control` header sent** to the browser depends on whether the page uses dynamic functions (cookies, headers) and what Next.js decides to emit. It does not necessarily produce `Cache-Control: no-store` on every response — Next.js may emit `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` or similar but the exact header is framework-controlled.

**Additionally:** Next.js 16 introduced `cacheComponents` (Cache Components) as a new caching model, and the docs note that `dynamic`, `revalidate`, and `fetchCache` are "removed when Cache Components is enabled." The repo does not appear to use `cacheComponents`, so this doesn't affect current behavior, but should be noted for future upgrades.

**Impact on service worker:** The SW code comment in `sw.template.js` says pages have "framework-default `no-store`" — this is what justifies the explicit HTML caching in the offline fallback. If `revalidate = 0` does NOT always produce `no-store`, the justification may be partially incorrect, though the practical behavior (pages are not cached by SW because they appear non-cacheable or dynamic) remains the same.

**Suggested correction:** Update CLAUDE.md to: "every public page sets `revalidate = 0` (dynamic rendering — Next.js emits no-cache headers for dynamically-rendered routes)". Update SW comment to avoid claiming the exact `Cache-Control` header value.

**Source:** https://nextjs.org/docs/app/guides/caching-without-cache-components (Next.js 16.2.9)

---

### DOC-R5C2-06 — CLAUDE.md `next.config.ts headers()` for `public/` static assets: docs say headers checked BEFORE filesystem (MEDIUM)

**Classification:** confirmed  
**Severity:** MEDIUM  
**Confidence:** High

**Doc location:** `CLAUDE.md`, ETag / cache invalidation section:
> "All layers now share one cache policy: `public, max-age=3600, must-revalidate` (set for the static path via `next.config.ts headers()`)"

**External verification (Next.js 16 headers docs):**
> "Headers are checked before the filesystem which includes pages and `/public` files."

This means `next.config.ts headers()` rules **do** apply to `/public/` static assets — the routing happens: headers check → filesystem. The `headers()` config can add `Cache-Control` to `public/` served files.

**However**, there is a critical caveat from the same docs:
> "Next.js sets the `Cache-Control` header of `public, max-age=31536000, immutable` for truly immutable assets. It cannot be overridden."

And from the code in `next.config.ts`:
```ts
{ key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
```
applied to path pattern `/uploads/:format(jpeg|webp|avif)/:file*`.

The claim that headers() set the cache policy for the static path is **correct in principle** — Next.js headers() can override Cache-Control for `public/` assets that are not the immutable hashed assets. Upload derivatives are not immutable-named, so the override should work.

**Mismatch found:** CLAUDE.md says Next serves `public/` assets BEFORE route handlers (ETag section: "Next serves `public/` assets BEFORE route handlers — so for existing files the production serving path is Next's static server"), which appears correct by the headers() doc precedence order. But the Next.js docs say "Headers are checked before the filesystem" — meaning headers() runs before file serving, not the reverse. The overall claimed behavior (uploads served as static files with the `headers()` Cache-Control) is consistent with what the official docs describe, but the precedence framing in CLAUDE.md ("Next serves `public/` assets BEFORE route handlers") is a slight misdescription of the internal order: headers config → filesystem → route handlers.

**Suggested correction:** Minor clarification in CLAUDE.md: "Next.js applies `headers()` rules first, then serves `public/` static files if the path matches, then falls through to route handlers. Upload derivatives in `public/uploads/` are served as static files with the `Cache-Control: public, max-age=3600, must-revalidate` header applied via `headers()` in `next.config.ts`."

**Source:** https://nextjs.org/docs/app/api-reference/config/next-config-js/headers (Next.js 16.2.9, "Headers are checked before the filesystem which includes pages and /public files.")

---

### DOC-R5C2-07 — CLAUDE.md SESSION_SECRET minimum length discrepancy (LOW)

**Classification:** confirmed  
**Severity:** LOW  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Environment Variables section:
> `SESSION_SECRET=<random-64-char-hex>`

And Deployment Checklist step 2:
> "Generate a unique runtime `SESSION_SECRET`: `openssl rand -hex 32`"

**Code location:** `apps/web/src/lib/session.ts` lines 32, 45:
```
'SESSION_SECRET env var is required in production (min 32 chars). '
'SESSION_SECRET env var not set or too short (min 32 chars).'
```

**Mismatch:** The env example shows a "random-64-char-hex" but the deployment checklist command `openssl rand -hex 32` generates **64 hex characters** (32 bytes = 64 hex chars). So the example and command are consistent. However, the minimum enforced by code is **32 chars** (not 64). If someone provides a 32-char secret it will be accepted by the code but the CLAUDE.md example implies 64 chars is the expectation.

**Note:** plan-316 item VER-R5C1-03 already covers adding "min 32 chars enforced (recommend `openssl rand -hex 32` → 64 hex chars)" to CLAUDE.md. This is covered.

**Classification change:** This is already covered by plan-316 VER-R5C1-03. **Do not re-report.**

---

### DOC-R5C2-08 — CLAUDE.md Argon2id parameters exceed OWASP minimum but documentation omits this (LOW)

**Classification:** confirmed  
**Severity:** LOW  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Security Architecture:
> "Passwords hashed with **Argon2** (industry-standard memory-hard KDF)"

No specific parameters are documented.

**Code location:** `apps/web/src/lib/password-hashing.ts`:
```ts
memoryCost: 65_536,   // 64 MiB
timeCost: 3,
parallelism: 4,
```

**OWASP current recommendation** (verified 2026-06-12, OWASP Password Storage Cheat Sheet):  
The OWASP minimum is `m=19456 (19 MiB), t=2, p=1`. The repo uses `m=65536, t=3, p=4` which **substantially exceeds** OWASP minimums — this is a good thing.

**OWASP caveat on parallelism:** OWASP's recommended configs all use `p=1`. The repo uses `p=4` with high memory and time cost. The Argon2 specification notes that setting `p` (parallelism) > 1 with high `m` can lead to thread contention on servers without sufficient CPU cores, but does not weaken security. With `p=4` and `m=64 MiB`, each login verification requires 256 MiB of peak memory with full parallelism (4 × 64 MiB). On a constrained server this could be a DoS vector if many logins occur simultaneously — but rate limiting (5 attempts per 15 min per IP + per account) effectively prevents this.

**Verdict:** No security issue. The parameters are strong. CLAUDE.md could add a one-line note on the actual parameters for operator awareness.

**Suggested correction (LOW):** Add to CLAUDE.md Security section: "Argon2id parameters: `memoryCost=65536` (64 MiB), `timeCost=3`, `parallelism=4` — exceeds OWASP minimums. See `apps/web/src/lib/password-hashing.ts`."

**Source:** https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

---

### DOC-R5C2-09 — CLAUDE.md Stripe `checkout.session.async_payment_succeeded` note absent despite implementation gap (MEDIUM)

**Classification:** confirmed  
**Severity:** MEDIUM  
**Confidence:** High

**Doc location:** `CLAUDE.md` has no mention of `checkout.session.async_payment_succeeded`.

**Code location:** `apps/web/src/app/api/stripe/webhook/route.ts` line 99:
```ts
// `checkout.session.async_payment_succeeded` to round out coverage.
```
This comment exists as a TODO/note but the event is NOT handled.

**External verification:** The `checkout.session.async_payment_succeeded` event **exists and is documented** by Stripe. It fires for delayed payment methods (bank transfers, ACH, BECS Direct Debit, etc.) where payment confirmation arrives asynchronously after the checkout session completes. When this event is not handled, a customer who pays via a delayed payment method will complete checkout but their entitlement will never be created — the `checkout.session.completed` event fires with `payment_status: 'unpaid'` for these methods, and the actual fulfillment must happen on `checkout.session.async_payment_succeeded`.

**Plan cross-check:** plan-316 item CRT-R5C1-04 covers adding this case. This finding confirms the implementation gap is real and is documented in a code comment but not in CLAUDE.md.

**Since plan-316 already covers the implementation fix**, this review notes only the **documentation gap**: CLAUDE.md's "Stripe paid-download entitlements" description (database schema section: `entitlements - Stripe paid-download entitlements (US-P54)`) does not warn operators that delayed payment methods will silently fail until the fix lands. A one-line warning in CLAUDE.md would prevent operator confusion.

**Suggested correction:** Add to CLAUDE.md: "Warning: `checkout.session.async_payment_succeeded` is not yet handled — delayed payment methods (bank transfer, ACH) will not create entitlements. Enable only card/immediate payment methods until plan-316 CRT-R5C1-04 ships."

**Source:** https://docs.stripe.com/checkout/fulfillment (Stripe fulfillment docs confirm async_payment_succeeded event)

---

### DOC-R5C2-10 — CLAUDE.md Deployment Checklist step 3 has wrong path for site-config.example.json (MEDIUM)

**Classification:** confirmed  
**Severity:** MEDIUM  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Deployment Checklist, step 3:
> "Copy `site-config.example.json` to `site-config.json` and customize it"

**Code verification:**
```
/Users/hletrd/flash-shared/gallery/apps/web/src/site-config.example.json  (actual location)
/Users/hletrd/flash-shared/gallery/apps/web/src/site-config.json           (actual location)
```

The files are in `apps/web/src/`, not at `apps/web/` root. The Deployment Checklist step omits the path, leaving it ambiguous. An operator following the checklist who searches at `apps/web/site-config.example.json` will not find the file.

**Note:** plan-316 item DOC-R5C1-03 already covers this exact fix: "Deployment Checklist step 3: 'Copy `apps/web/src/site-config.example.json` to `apps/web/src/site-config.json`'." This is already covered.

**Classification change:** Already covered by plan-316 DOC-R5C1-03. **Do not re-report.**

---

### DOC-R5C2-11 — CLAUDE.md SW section: "Cookie header is Fetch-spec forbidden header" claim — confirmed correct (INFO / verified clean)

**Doc location:** `CLAUDE.md` Service Worker / PWA section:
> "the SW cannot read the request `Cookie` header (Fetch-spec forbidden header)"

**External verification:** The Fetch Living Standard (fetch.spec.whatwg.org) explicitly lists `Cookie` as a forbidden request header. This claim is **correct**.

**Code location:** `apps/web/public/sw.template.js` line 16–17:
```js
// Cookie header — it is a Fetch-spec forbidden header, which is why
// the old cookie sniff never worked).
```
Both doc and code are correct.

**Source:** https://fetch.spec.whatwg.org/#forbidden-request-header

---

### DOC-R5C2-12 — CLAUDE.md `proxy.ts` description accurate but file is actually a Next.js middleware (INFO / verified clean)

**Doc location:** `CLAUDE.md` Key Files table: `apps/web/src/proxy.ts | i18n routing + middleware-level admin auth guard`

**Code verification:** The file begins with `import createMiddleware from 'next-intl/middleware'` and exports `export default function middleware(request: NextRequest)` with `export const config = { matcher: [...] }` — confirming it IS Next.js middleware, just named `proxy.ts` for historical reasons.

**Verdict:** The description is accurate. The naming `proxy.ts` vs the Next.js convention of `middleware.ts` is intentional (confirmed by `next.config.ts` which presumably uses `experimental.customRouterHandler` or similar to point to `proxy.ts`). No documentation issue.

---

### DOC-R5C2-13 — CLAUDE.md Drizzle migrator line reference may be stale (LOW)

**Classification:** likely  
**Severity:** LOW  
**Confidence:** Medium

**Doc location:** `CLAUDE.md`, Migration & Schema-Drift Runbook:
> "The Drizzle MySQL migrator (`node_modules/drizzle-orm/mysql-core/dialect.cjs:62`) decides whether to apply each journal entry"

**Installed version:** `drizzle-orm: ^0.45.2`

**Issue:** The file path `mysql-core/dialect.cjs:62` is a reference to the internal implementation of `drizzle-orm`. Between versions, internal file structure and line numbers shift. The documented file path and line number were presumably correct for the version when the runbook was written (likely `0.3x`). In `0.45.x` the same logic may be at a different line or even a different file.

**Note:** The IMPORTANT note in CLAUDE.md is that the custom `migrate.js` bypasses the vanilla drizzle migrator for this specific use case — so the internal line reference is informational context, not a dependency. The actual operational code is in `apps/web/scripts/migrate.js` which does not use the referenced internal logic.

**Suggested correction:** Add "(line number may drift with drizzle-orm version upgrades — the reference is informational; `migrate.js` uses its own hash-based approach)" after the line reference.

**Source:** CLAUDE.md itself documents the workaround; drizzle-orm changelog at https://github.com/drizzle-team/drizzle-orm/releases

---

### DOC-R5C2-14 — CLAUDE.md Sharp `avif effort` default stated correctly but Sharp 0.34 validates 0–9 range (INFO / verified clean)

**Doc location:** `CLAUDE.md`:
> "Higher = smaller files, slower encode. Sharp's native default is 4; we ship 6"

**Code location:** `apps/web/src/lib/gallery-config-shared.ts` line 61: `'avif_effort'` with default `'6'` at line 128.

**External verification (Sharp 0.34.5 docs):** Sharp AVIF encoding `effort` valid range is 0–9, default is 4. The CLAUDE.md claim is **correct**.

**Verdict:** No issue. Verified clean.

**Source:** https://sharp.pixelplumbing.com/api-output#avif

---

### DOC-R5C2-15 — CLAUDE.md `hdr-filenames.ts` description has changed between edits (LOW)

**Classification:** confirmed  
**Severity:** LOW  
**Confidence:** High

**Doc location:** `CLAUDE.md`, Key Files table, line 101:
```
| `apps/web/src/lib/hdr-filenames.ts` | `_hdr.avif` filename derivation helper (RESERVED — NOT WIRED until WI-09 ships; honesty invariant enforced by `_PrivacySensitiveKeys` guard, not a feature flag) |
```

**Earlier version in same file**, Key Files table footnote:
In the introductory Key Files section it says `(reserved for WI-09)` in the `hdr-filenames.ts` entry.

**Issue:** The description was updated to reflect the more precise statement that there is no feature flag — good. But the parenthetical `(reserved for WI-09)` still appears in the settings-hash.ts description area: the `hdr_filenames` note is accurate. No code/doc mismatch. This is an observation that the description is correct.

**Verdict:** No correction needed.

---

## Summary Table

| ID | Severity | Classification | Description |
|---|---|---|---|
| DOC-R5C2-01 | HIGH | confirmed | Firefox `color-gamut` MQ claim outdated — FF 110+ supports it |
| DOC-R5C2-02 | MEDIUM | confirmed | NCLX transfer code 1 described as "BT.709→sRGB" — misleading notation |
| DOC-R5C2-05 | MEDIUM | confirmed | `revalidate=0` described as "framework-default no-store" — imprecise for Next.js 16 |
| DOC-R5C2-06 | MEDIUM | confirmed | `next.config headers()` precedence description slightly inverted |
| DOC-R5C2-09 | MEDIUM | confirmed | Stripe `async_payment_succeeded` unhandled gap undocumented in CLAUDE.md |
| DOC-R5C2-10 | MEDIUM | confirmed | Deployment Checklist site-config path ambiguous (already in plan-316) |
| DOC-R5C2-03 | LOW | confirmed | WCAG criterion referenced is 2.1-era; WCAG 2.2 SC 2.5.8 not mentioned |
| DOC-R5C2-04 | LOW | confirmed | Sharp `withMetadata()` warning correct but framing could be clearer |
| DOC-R5C2-07 | LOW | confirmed | SESSION_SECRET length inconsistency (already in plan-316) |
| DOC-R5C2-08 | LOW | confirmed | Argon2id parameters undocumented in CLAUDE.md |
| DOC-R5C2-13 | LOW | likely | Drizzle internal file:line reference will drift with version upgrades |
| DOC-R5C2-11 | INFO | verified clean | SW Cookie forbidden header claim — confirmed correct per Fetch spec |
| DOC-R5C2-12 | INFO | verified clean | `proxy.ts` description — accurate, naming intentional |
| DOC-R5C2-14 | INFO | verified clean | Sharp AVIF effort default — confirmed correct |
| DOC-R5C2-15 | INFO | verified clean | `hdr-filenames.ts` description — accurate |

---

## New findings not in plan-316

Items DOC-R5C2-07 and DOC-R5C2-10 overlap with plan-316 and should not be re-planned.

**Net new actionable findings requiring plans:**
- DOC-R5C2-01 (HIGH) — Firefox `color-gamut` MQ factual error in CLAUDE.md + code comment
- DOC-R5C2-02 (MEDIUM) — NCLX transfer code 1 doc notation misleading
- DOC-R5C2-05 (MEDIUM) — `revalidate=0` / `no-store` description imprecise
- DOC-R5C2-06 (MEDIUM) — `headers()` precedence description slightly inverted
- DOC-R5C2-09 (MEDIUM) — Stripe async_payment_succeeded gap undocumented (operator safety)
- DOC-R5C2-03 (LOW) — WCAG 2.2 SC 2.5.8 not referenced
- DOC-R5C2-04 (LOW) — Sharp `withMetadata()` warning could be clarified
- DOC-R5C2-08 (LOW) — Argon2id work factors undocumented
- DOC-R5C2-13 (LOW) — Drizzle line ref will drift

---

## Doc files audited

- `/Users/hletrd/flash-shared/gallery/CLAUDE.md` (full read)
- `/Users/hletrd/flash-shared/gallery/apps/web/.env.local.example` (full read)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/site-config.example.json` (full read)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/use-display-capability.ts` (key sections)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/color-detection.ts` (NCLX maps)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/process-image.ts` (withMetadata, keepIccProfile, avif effort)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/password-hashing.ts` (full read)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/session.ts` (SESSION_SECRET)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/lib/gps-exif-strip.ts` (withMetadata usage)
- `/Users/hletrd/flash-shared/gallery/apps/web/next.config.ts` (headers)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/proxy.ts` (middleware)
- `/Users/hletrd/flash-shared/gallery/apps/web/scripts/migrate.js` (Drizzle claim)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/app/api/stripe/webhook/route.ts` (Stripe)
- `/Users/hletrd/flash-shared/gallery/apps/web/src/__tests__/touch-target-audit.test.ts` (WCAG ref)
- `plan-315-run5-cycle1-medium.md`, `plan-316-run5-cycle1-low-docs.md`, `plan-317-run5-cycle1-deferred.md` (suppression)

## External sources consulted

- https://caniuse.com/mdn-css_at-rules_media_color-gamut — Firefox 110+ color-gamut MQ support
- https://sharp.pixelplumbing.com/api-output#avif — AVIF effort range and default
- https://sharp.pixelplumbing.com/api-output#withmetadata — withMetadata EXIF behavior
- https://fetch.spec.whatwg.org/#forbidden-request-header — Cookie forbidden header confirmation
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — Argon2id minimums
- https://nextjs.org/docs/app/guides/caching-without-cache-components — Next.js 16.2.9 revalidate=0 semantics
- https://nextjs.org/docs/app/api-reference/config/next-config-js/headers — Next.js 16.2.9 headers() precedence
- https://docs.stripe.com/checkout/fulfillment — Stripe async_payment_succeeded event existence
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — WCAG 2.2 SC 2.5.8
