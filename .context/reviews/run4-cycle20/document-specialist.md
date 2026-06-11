# Document-specialist — Run-4 Cycle 20

Single-subagent in-context pass.

## Inventory (this angle)

Doc/code fidelity check across the rotation cluster, focusing on the
stated contracts in code comments vs actual behavior.

## Findings

### Concur with SEC-R4C20-01 — comment promises a guarantee the code doesn't keep

- **Citation:** `apps/web/src/app/actions/seo.ts:126-129`.
  ```ts
  // Validate OG image URL format if provided.
  // Restrict to relative paths (starting with /) or same-origin URLs
  // to prevent admins from setting tracker/malicious external URLs
  // in every public page's <meta og:image> tag.
  ```
  The comment asserts the validator *restricts* to relative or same-origin
  URLs. The backslash bypass (`/\evil.com` → `https://evil.com/`) means
  the "relative paths" branch admits an off-site authority — so the doc
  over-promises relative to behavior. Fixing SEC-R4C20-01 makes the code
  match the comment; no separate doc edit needed once the validator
  rejects backslashes.

## CLAUDE.md fidelity — no drift this cycle

The cycle-20 fix surface (`lib/seo-og-url.ts`) is not referenced by name
in CLAUDE.md's Key Files table, and the change is a behavior-preserving
tightening of an existing validator (rejects a value that should never
have been accepted), so no CLAUDE.md section requires an update. The
Security Architecture § "Privacy" and "Database Security" bullets are
unaffected.

## Clean-pass

- `download-filename.ts` header doc matches the implementation (NFKD,
  UNICODE_FORMAT_CHARS, 60-char cap, `photo-{id}` fallback).
- `og-photo-fetch.ts` lineage comments (R21→R24-M1) match the ascending
  iteration + atomic-rename-contract reasoning in code.
- `backfill-alt-text.ts` header `auto_alt_text_enabled` / `--force` gate
  now matches code after cycle-19 DOC-R4C19-05 — re-confirmed implemented.
