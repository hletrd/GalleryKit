# Security / Critic / Verifier — Run-4 Cycle 20

NOTE: single orchestrator-spawned subagent; nested Agent/Task spawning is
unavailable in this context (same documented constraint as
run2/run3/run4-c1..c19). Each angle below was executed as a distinct
full-inventory in-context pass; no angle sampled.

## Inventory (this angle)

Rotation cluster this cycle: the **admin-controlled URL / redirect /
same-origin validation surface** — the run's mention-count map shows the
SEO settings + OG fallback redirect path has not had a line-level pass
since the C6L-SEC-01 Unicode-formatting work. Files walked:
- `lib/seo-og-url.ts` (`validateSeoOgImageUrl`)
- `app/actions/seo.ts` (`updateSeoSettings` write-time validation chain)
- `app/api/og/photo/[id]/route.tsx` (`buildFallbackResponse` 302 Location)
- `app/[locale]/(public)/page.tsx`, `c/[slug]/page.tsx`, `[topic]/page.tsx`
  (`<meta og:image>` consumers of `seo.og_image_url`)
- `lib/request-origin.ts` (`hasTrustedSameOrigin` family)
- `lib/locale-path.ts` (`localizePath` / `absoluteUrl` redirect builders)
- `lib/og-photo-fetch.ts` (internal sized-derivative fetch / SSRF posture)
- `proxy.ts` redirect sites, auth.ts redirect sites

## Findings

### SEC-R4C20-01 — `validateSeoOgImageUrl` backslash bypass of the same-origin gate (MED-LOW / High, CONFIRMED)

- **Citation:** `apps/web/src/lib/seo-og-url.ts:9-11`.
  ```ts
  if (trimmedUrl.startsWith('/') && !trimmedUrl.startsWith('//')) {
      return true;   // <-- any single-leading-slash value passes as "relative"
  }
  ```
- **Problem:** the relative-path fast-path accepts ANY value that starts
  with a single `/` and is not `//…`. A value like `/\evil.com` satisfies
  both conditions (second char is `\`, not `/`), so it is accepted as a
  "safe relative path." But browsers and link-preview crawlers normalize
  backslashes to forward slashes per the WHATWG URL spec, so
  `/\evil.com` resolves to the scheme-relative `//evil.com` →
  `https://evil.com/`. The validator's own stated purpose
  (`seo.ts:127-129`) is *"to prevent admins from setting tracker/malicious
  external URLs in every public page's `<meta og:image>` tag"* — the
  backslash defeats exactly that intent.
- **Proof (validator logic, reproduced):**
  ```
  "/\evil.com"  -> treated relative: true | new URL(v,'https://gallery.atik.kr') = https://evil.com/
  "//evil.com"  -> treated relative: false (correctly rejected — existing test)
  ```
- **Two live manifestations of the same gap:**
  1. `<meta property="og:image" content="/\evil.com">` is emitted on every
     public home/topic/collection page (`page.tsx:55-56`,
     `[topic]/page.tsx:84-85`, `c/[slug]/page.tsx:51-52`). Social crawlers
     resolve it to `https://evil.com/` and fetch the attacker's image for
     link previews of the gallery.
  2. `app/api/og/photo/[id]/route.tsx:251-258` puts `seo.og_image_url`
     **directly into a 302 `Location:` header**. `Location: /\evil.com`
     normalizes to `//evil.com` in every browser → an **open redirect**
     off the gallery's own OG endpoint.
- **Failure scenario:** an admin (or anyone who briefly obtains an admin
  session / CSRF-style mistake during settings edit) sets
  `seo_og_image_url = /\attacker.example/x.png`. It passes
  `validateSeoOgImageUrl`, persists, and every public page now advertises
  an off-site OG image and the `/api/og/photo/*` endpoint becomes an
  open redirector to `attacker.example`.
- **Confidence:** High. The validator branch is reproduced above; the two
  consumers are cited line-level.
- **Severity adjudication (critic):** admins are trusted root accounts
  (CLAUDE.md: any admin can restore DB, change settings), so this is NOT
  a privilege-escalation defect — hence MED-LOW, not HIGH. But the repo
  *deliberately wrote a same-origin validator here as defense-in-depth*
  (the C6L-SEC-01 lineage shows the SEO surface is explicitly hardened
  against malicious/spoofed admin input), and that validator has a clean
  bypass. Closing it is a one-line, zero-risk correctness fix to a
  security control whose entire reason for existing is to block this. The
  upstream `normalizeStringRecord` strips C0 controls (tab/CR/LF), so
  backslash is the ONLY character that both (a) survives normalization and
  (b) is re-normalized to `/` by browsers — meaning a `includes('\\')`
  reject is the complete fix for the realistic vector.
- **Fix:** in the relative branch, reject any value containing a
  backslash before returning true. Add a regression test asserting
  `/\evil.com`, `/\/evil.com`, and `/\\evil.com` are rejected while
  `/uploads/og.jpg` still passes.
- **Verifier note:** counter-hypothesis "browsers don't normalize `\` in
  the path" was ruled out — WHATWG URL parsing treats `\` as `/` for
  special schemes (http/https), and `new URL('/\\evil.com', base).href`
  empirically yields `https://evil.com/`.

## Clean-pass surfaces this angle

- `hasTrustedSameOrigin` family (request-origin.ts): fail-closed default
  (C1R-01), proxy-aware right-most X-Forwarded-* selection only under
  `TRUST_PROXY=true`, default-port stripping symmetric for http/https,
  `toOrigin` try/catch returns null → reject. No bypass found.
- `og-photo-fetch.ts`: internal fetch is constrained to
  `${origin}/uploads/jpeg/${baseFilename.replace(...)}` where `origin`
  derives from `new URL(req.url).origin` (the gallery's own origin) and
  `baseFilename` is a DB-sourced sanitized filename; per-attempt 10 s
  timeout + 1 MB cap. No SSRF to arbitrary hosts.
- `locale-path.ts` redirect builders: all callers pass internal literal
  paths (`/admin`, `/admin/dashboard`); `absoluteUrl` uses `new URL(path,
  base)` correctly. No user-controlled authority injection.
- `seo.ts` write chain: per-field `sanitizeAdminString` + length caps via
  `countCodePoints` + `normalizeStringRecord` allowlist; only the
  `og_image_url` same-origin sub-check carries the SEC-R4C20-01 gap.

## Regression review of cycle-19 fix commits — SOUND

`2881e32f` (topics tuple unwrap), `962931f1` (cicp-recheck unwrap),
`66871cb5` (keyset + alt-text gate), `a61cfb45` (migrate-titles refusal),
`046d7cb3` (star re-export fail-closed), `5ae58a7a` (topic e2e) verified
line-level against the live tree. The tuple-unwrap idiom
`Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result`
is identical at both new sites and matches the house pattern. No
follow-on findings.
