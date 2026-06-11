# Plan 311 — Run-4 Cycle 20 fixes

**Source review:** `.context/reviews/run4-cycle20/_aggregate.md`
**Status:** IMPLEMENTED — task landed; gates + deploy recorded below

Repo-rule constraints honored: GPG-signed commits (`-S`), conventional
commits + gitmoji, fine-grained per-fix commits, pull --rebase before
push, per-cycle gates (eslint, typecheck, vitest, api-auth,
action-origin, public-route-rate-limit, build, playwright e2e), deploy
per cycle via `npm run deploy`. HARD-SCOPE: no edit/culling/scoring
features — this hardens an existing same-origin validator.

## Task 1 — SEC-R4C20-01 + TEST-R4C20-02: close the `validateSeoOgImageUrl` backslash bypass (MED-LOW)

Finding: the relative-path fast-path in `validateSeoOgImageUrl`
(`lib/seo-og-url.ts:9-11`) accepts ANY single-leading-slash value as a
"safe relative path." `/\evil.com` satisfies `startsWith('/') &&
!startsWith('//')`, but browsers/crawlers normalize `\`→`/` per the
WHATWG URL spec, so it resolves to `https://evil.com/`. Two live
consumers: (1) every public page's `<meta og:image>`; (2) the 302
`Location` header in `app/api/og/photo/[id]/route.tsx:255` → open
redirect. The upstream `normalizeStringRecord` already strips C0
controls (tab/CR/LF), so backslash is the only character that both
survives normalization and re-normalizes to `/` — a `includes('\\')`
reject is the complete fix for the realistic vector.

- [x] `apps/web/src/lib/seo-og-url.ts`: in the relative branch, reject any
      value containing a backslash before returning true, with a comment
      naming the WHATWG `\`→`/` normalization and this finding ID. The
      same-origin absolute branch is unchanged.
- [x] `apps/web/src/__tests__/seo-actions.test.ts`: add reject cases for
      `/\evil.com`, `/\/evil.com`, `/\\evil.com`, and `/foo\bar`, plus a
      re-assert that `/uploads/og.jpg` still passes. Proven failing
      pre-fix (the four backslash cases returned true before the guard).
- Commit: `fix(seo): 🛡️ reject backslash in OG image URL same-origin gate (SEC-R4C20-01)`

## Recorded (no separate fix)

- **DES-R4C20-01** — off-site OG image link-preview brand-integrity harm:
  root cause is SEC-R4C20-01; the validator fix resolves it. No UI change.
- **document-specialist** — `seo.ts:126-129` comment ("restrict to
  relative or same-origin URLs") now matches behavior after the fix; no
  separate doc edit.

## Gate + deploy record

(filled in after PROMPT 3)
