# Security review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc`
- Scope: cycle 2 fix wave (humanize chip labels in viewer surfaces, root-layout hreflang via builder, fixture seatbelt test).

## Inventory examined
- `apps/web/src/lib/photo-title.ts` — pure transform (`name.replace(/_/g, ' ')`). No external input handling, no DOM injection, no template eval. Safe.
- `apps/web/src/lib/locale-path.ts` — `buildHreflangAlternates` calls `localizeUrl` → `new URL(path, baseUrl)` per locale. Path strings come from server-side metadata generators with controlled inputs (`'/'`, `/${slug}`, `/p/${id}`). No user-supplied path is concatenated without normalization.
- `apps/web/src/app/[locale]/layout.tsx` — server component, no new authn/authz surface; hreflang map is metadata only.
- `apps/web/src/components/photo-viewer.tsx`, `info-bottom-sheet.tsx` — chip text wrapped in `humanizeTagLabel`. The helper never executes the input as code; React's text rendering escapes the result. Tag names already come through Drizzle parameterized queries (no raw concat).
- `apps/web/src/__tests__/tag-label-consolidation.test.ts` — uses `fs.readFileSync(path.join(REPO_ROOT, relPath))` against a hard-coded allowlist of source files. No user-controlled path; runs in vitest only. No path-traversal exposure.

## Findings

**No new MEDIUM or HIGH security findings.**

The diff under review touches only:
1. UI text rendering — output goes through React's HTML-escaping; the helper transforms `_` → ` ` only, never anything dangerous like `<`, `&`, `"`, or `'`.
2. Metadata.alternates.languages — controlled URL generation via `URL` constructor.
3. A scanner-style unit test reading hard-coded file paths.

None of these introduce a new attack surface. None of them weaken existing controls (path-traversal containment, advisory-lock scope, CSP nonce emission, session secret validation, etc.).

### Existing controls verified intact

- **Hreflang URL construction** still goes through `localizeUrl` → `absoluteUrl` → `new URL(path, baseUrl)`. The `path` argument is always a server-controlled literal at every call site. No injection vector.
- **CSP nonce** still threaded through `getCspNonce()` and reaches all `<Script>` / inline-JSON-LD nodes in the touched pages.
- **Public-route data leakage**: photo viewer's GPS render block remains gated by `isAdmin`; `info-bottom-sheet.tsx` likewise. Public select fields in `data.ts` continue to omit GPS/PII.
- **GPS coordinates** are not exposed anywhere added by this diff.
- **Tag input / autocomplete** remain server-action wrapped via `requireSameOriginAdmin()`; the diff does not touch any actions.

## LOW / informational

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **S3L-INFO-01** | Fixture test reads source files via filesystem APIs; this is fine for vitest under repo control, but worth keeping in mind so the scanner pattern is not later reused for runtime, where `path` could become user-controlled. | LOW (tracking) | High |

## Quality gates

`npm run lint:api-auth` exit 0 — every admin API route still wraps `withAdminAuth(...)`.
`npm run lint:action-origin` exit 0 — every mutating server action still returns early on `requireSameOriginAdmin()` or carries the explicit exempt comment.

## Verdict

Cycle 3 fresh security review: zero MEDIUM/HIGH, one informational tracking note. No new attack surface from the cycle-2 fix wave. Convergence indicated.
